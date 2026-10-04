// The "Beethoven" view in the activity bar: connection, grid install, workers, accounts, tokens.
import * as vscode from 'vscode';
import { GridApi, GridStatus, GridClaudeStatus } from '../core/gridApi';
import { BeethovenStore } from './store';
import { testConnection, localClaudeStatus } from '../core/wizard';
import { accountPlace, accountProcessEnv, asLabel, inheritedConfigDir } from '../core/accounts';

type Kind = 'root' | 'worker' | 'account' | 'token' | 'job' | 'info';

export class Item extends vscode.TreeItem {
  constructor(label: string, public kind: Kind, opts: { description?: string; tooltip?: string; icon?: string; children?: Item[]; command?: vscode.Command; data?: unknown } = {}) {
    super(label, opts.children && opts.children.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    this.description = opts.description;
    this.tooltip = opts.tooltip;
    if (opts.icon) this.iconPath = new vscode.ThemeIcon(opts.icon);
    this.children = opts.children ?? [];
    this.command = opts.command;
    this.contextValue = kind;
    this.data = opts.data;
  }
  children: Item[];
  data: unknown;
}

export class BeethovenTree implements vscode.TreeDataProvider<Item> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private cache: Item[] = [];
  private loading = false;
  lastStatus: GridStatus | null = null;

  constructor(private store: BeethovenStore, private grid: () => GridApi) {}

  refresh(): void {
    this.cache = [];
    this._onDidChange.fire();
  }

  getTreeItem(e: Item): vscode.TreeItem {
    return e;
  }

  async getChildren(e?: Item): Promise<Item[]> {
    if (e) return e.children;
    if (this.cache.length) return this.cache;
    if (this.loading) return [new Item('Loading...', 'info', { icon: 'loading~spin' })];
    this.loading = true;
    try {
      this.cache = await this.build();
    } finally {
      this.loading = false;
    }
    return this.cache;
  }

  private async build(): Promise<Item[]> {
    const s = this.store.settings();
    const items: Item[] = [];
    const lic = this.store.licenseGate?.check();
    if (lic && !lic.ok) {
      return [new Item('Beethoven needs a license', 'info', { icon: 'key', description: lic.detail, command: { command: 'beethoven.license', title: 'License' } })];
    }
    if (!s.accessId) {
      return [new Item('Not set up yet', 'info', { icon: 'rocket', description: 'run the wizard', command: { command: 'beethoven.setup', title: 'Set up' } })];
    }
    // the gate checks the license against a Wayne State sign-in Beethoven saw happen; without one, every other command refuses
    if (this.store.licenseGate && !this.store.licenseGate.identity()) {
      items.push(
        new Item('Wayne State sign-in', 'account', {
          description: 'not signed in: click to sign in',
          icon: 'warning',
          tooltip: 'Beethoven checks your license against your Wayne State sign-in. Sign in once; the same step as in the wizard',
          command: { command: 'beethoven.wsuSignIn', title: 'Sign in with Wayne State' },
        }),
      );
    }
    const conn = await testConnection(s.sshAlias);
    items.push(
      new Item(conn.ok ? `Connected as ${s.accessId}` : 'Cannot reach the grid', 'root', {
        description: conn.ok ? `${s.sshAlias} -> ${conn.hostname}` : conn.error.split('\n')[0],
        icon: conn.ok ? 'pass' : 'error',
        tooltip: conn.ok ? 'ssh -o BatchMode=yes works: Claude and Remote-SSH can use the grid without prompts' : 'Run the wizard or "Beethoven: Check everything"',
        command: conn.ok ? undefined : { command: 'beethoven.doctor', title: 'Doctor' },
      }),
    );
    if (!conn.ok) {
      this.lastStatus = null;
      return items;
    }
    const st = await this.grid().status();
    this.lastStatus = st;
    if (st.error) {
      items.push(new Item('Beethoven not installed on the grid', 'root', { description: st.error, icon: 'cloud-upload', command: { command: 'beethoven.gridBootstrap', title: 'Install' } }));
      return items;
    }
    items.push(
      new Item(st.ready ? 'Grid ready' : (st as any).awaiting_access ? 'Waiting for lab access' : 'Grid installing', 'root', {
        description: st.ready ? `Claude Code ${st.claude_version ?? ''}${(st as any).source === 'shared' ? `, shared container ${(st as any).container}` : ''}` : (st as any).awaiting_access ? 'the last setup step; your lead approves it' : st.bootstrap_job ? `job ${st.bootstrap_job} ${st.bootstrap_state ?? ''}` : 'installing',
        icon: st.ready ? 'pass' : (st as any).awaiting_access ? 'clock' : 'sync~spin',
        tooltip: `scripts v${st.version}; root ${st.root}; runtime ${st.runtime ?? '?'}`,
      }),
    );
    if (st.home_soft_gb && st.home_soft_gb > 0) {
      const pct = Math.round(((st.home_used_gb ?? 0) / st.home_soft_gb) * 100);
      items.push(new Item(`Home quota ${pct}%`, 'info', { description: `${st.home_used_gb} of ${st.home_soft_gb} GB`, icon: pct > 90 ? 'warning' : 'database' }));
    }
    const workers = (st.workers ?? []).map((w: any) => {
      const state = w.state ?? {};
      const alive = w.alive;
      const desc = w.job_state === 'RUNNING' ? `${w.node || '?'} ${alive ? state.status ?? 'running' : 'starting'} q=${w.queued ?? 0}` : `${w.job_state ?? 'stopped'}`;
      return new Item(`Worker ${w.name}`, 'worker', {
        description: desc,
        icon: w.job_state === 'RUNNING' ? (alive ? 'vm-running' : 'vm-connect') : w.job_state === 'PENDING' ? 'clock' : 'vm-outline',
        tooltip: `job ${w.job} ${w.job_state}\nnode ${w.node}\nprocessed ${state.processed ?? 0}, running ${(state.running ?? []).length}, queued ${w.queued ?? 0}\nclaude ${state.claude_version ?? ''}\nphone access: ${state.phone ?? 'off'}`,
        data: w,
      });
    });
    items.push(new Item('Claude workers', 'root', { icon: 'server-process', description: workers.length ? `${workers.length}` : 'none: start one', children: workers, command: workers.length ? undefined : { command: 'beethoven.workerStart', title: 'Start' } }));
    const accounts = (st.accounts ?? []).map(
      (a) => new Item(a.name, 'account', { description: `${a.kind}${a.enabled ? '' : ' (disabled)'}${a.cooldown_until ? ' cooling until ' + new Date(a.cooldown_until).toLocaleTimeString() : ''}`, icon: a.kind === 'api-key' ? 'credit-card' : 'account' }),
    );
    items.push(new Item('Claude accounts on the grid', 'root', { icon: 'key', description: accounts.length ? '' : 'none', children: accounts }));
    items.push(await this.claudeOnGrid());
    // our own jobs (workers, installs, access requests) are shown elsewhere; ashley_ is their name before the rename
    const jobs = (st.jobs ?? []).filter((j) => !/^(beethoven|ashley)_/.test(j.name)).slice(0, 15).map((j) => new Item(`${j.jobId} ${j.name}`, 'job', { description: `${j.state} ${j.node} ${j.elapsed}/${j.timeLimit}`, icon: j.state === 'RUNNING' ? 'play' : 'clock' }));
    items.push(new Item('Other Slurm jobs', 'root', { icon: 'list-ordered', description: `${jobs.length}`, children: jobs }));
    try {
      const who = await this.grid().accessWhoami();
      if (who) {
        if (who.admin) {
          const rows = await this.grid().accessList();
          const pending = rows.filter((r) => r.state === 'pending').length;
          items.push(new Item('Shared library access (you are the lab admin)', 'root', { description: `${pending} pending, ${rows.filter((r) => r.state === 'approved').length} approved`, icon: pending ? 'bell-dot' : 'organization', command: { command: 'beethoven.access', title: 'Manage' } }));
        } else {
          items.push(new Item('Shared library access', 'root', { description: who.granted ? 'granted' : who.state === 'none' ? 'request it once everything else is set up' : who.state, icon: who.granted ? 'pass' : who.state === 'pending' ? 'clock' : 'organization', command: { command: 'beethoven.access', title: 'Request' } }));
        }
      }
    } catch {
      /* grid did not answer */
    }
    items.push(await this.claudeOnLaptop(s.claudeExecutable));
    const secrets = await this.store.secretSummary();
    const retired = await this.store.retiredSecrets();
    const manage = { command: 'beethoven.manageTokens', title: 'Manage' };
    items.push(
      new Item('Tokens on this laptop', 'root', {
        icon: 'lock',
        children: [
          ...secrets.map((x) => {
            const name = x.name.split(' (')[0];
            // a missing or rejected token starts the wizard's own step for it; "expired" is what the daily check found, not a new call to the service
            const renew = { command: 'beethoven.renewToken', title: 'Renew', arguments: [x.id] };
            if (x.status === 'missing') return new Item(name, 'token', { description: 'missing: click to sign in', icon: 'circle-outline', command: renew });
            if (x.status === 'expired') return new Item(name, 'token', { description: 'expired: click to renew', icon: 'warning', tooltip: `no longer accepted (${x.detail ?? 'the service rejected it'}); renewing updates the grid copy too`, command: renew });
            return new Item(name, 'token', { description: 'stored', icon: 'pass', command: manage });
          }),
          // an earlier version's API key, never used now: shown until the student deletes it
          ...retired.map((r) => new Item(r.name, 'token', { description: 'not used: click to delete', icon: 'info', command: manage })),
        ],
      }),
    );
    return items;
  }

  /** Claude Code's own sign-in on this laptop (status only, the wizard's step "Claude on this laptop"), under the account beethoven.account names when it names one. */
  private async claudeOnLaptop(claudeExecutable: string): Promise<Item> {
    // the store brings the terminals' variables in line as it reads, so the row shows what the next terminal gets
    const choice = this.store.accountChoice();
    const inherited = inheritedConfigDir(choice);
    const base = 'Claude Code on this laptop, signed in with your own Claude Pro or Max subscription. Beethoven only checks; it stores nothing';
    const tooltip =
      choice.kind === 'account'
        ? `${base}. The setting "account" picks ${choice.label}: every integrated terminal of this window uses that account's sign-in (${accountPlace(choice)})${inherited ? `. ${inherited}` : ''}`
        : choice.kind === 'invalid' || choice.kind === 'remote'
          ? `${choice.problem}${inherited ? ` ${inherited}.` : ''}`
          : `${base}${inherited ? `. ${inherited}` : ''}`;
    const lc = await localClaudeStatus(claudeExecutable, accountProcessEnv(choice));
    const as = asLabel(choice);
    // a label that is not applied: the usual sign-in is what the terminals use, so that is what the row shows, with why
    if (choice.kind === 'invalid') return new Item('Claude on this laptop', 'account', { description: `${lc.detail}; the account setting "${choice.label}" is not used: click to fix it`, icon: 'warning', tooltip, command: { command: 'workbench.action.openSettings', title: 'Open the setting', arguments: ['beethoven.account'] } });
    const remote = choice.kind === 'remote' ? `; the account setting "${choice.label}" is not applied in a remote window` : '';
    if (!lc.ok) return new Item('Claude on this laptop', 'account', { description: lc.detail + as + remote, icon: 'warning', tooltip });
    if (lc.loggedIn && lc.subscription) return new Item('Claude on this laptop', 'account', { description: lc.detail + as + remote, icon: 'pass', tooltip });
    return new Item('Claude on this laptop', 'account', {
      description: `${lc.detail}${as}${remote}${remote ? '' : ': click to sign in'}`,
      icon: lc.loggedIn ? 'warning' : 'circle-outline',
      tooltip,
      command: remote ? undefined : { command: 'beethoven.claudeLocalSignIn', title: 'Sign in to Claude on this laptop' },
    });
  }

  /** The sign-in on the grid as Claude Code reports it (beethoven claude status --json); read once per refresh like the other grid rows. */
  private async claudeOnGrid(): Promise<Item> {
    const signIn = { command: 'beethoven.claudeSignIn', title: 'Sign in to Claude on the grid' };
    const tooltip = 'Claude Code keeps its own sign-in in your grid account (~/.beethoven/claude); Beethoven never sees it. It lasts about a month';
    let cs: GridClaudeStatus | null = null;
    try {
      cs = await this.grid().claudeStatus();
    } catch {
      /* grid did not answer */
    }
    if (!cs) return new Item('Claude on the grid', 'account', { description: 'the grid did not answer', icon: 'warning', tooltip });
    const phone = cs.consent ? '; phone access enabled' : '';
    if (cs.login?.loggedIn && cs.login.subscription === false) return new Item('Claude on the grid', 'account', { description: 'signed in, but not with a Claude subscription: click to sign in again', icon: 'warning', tooltip, command: signIn });
    if (cs.login?.loggedIn) return new Item('Claude on the grid', 'account', { description: `signed in${cs.login.email ? ` as ${cs.login.email}` : ''}${phone}`, icon: 'pass', tooltip });
    if (cs.login && cs.login.loggedIn === false && cs.dir_present) return new Item('Claude on the grid', 'account', { description: 'sign-in ended: click to sign in', icon: 'warning', tooltip, command: signIn });
    if (cs.dir_present) return new Item('Claude on the grid', 'account', { description: `signed in (a running worker will confirm it)${phone}`, icon: 'pass', tooltip });
    return new Item('Claude on the grid', 'account', { description: 'not signed in: click to sign in', icon: 'circle-outline', tooltip, command: signIn });
  }
}
