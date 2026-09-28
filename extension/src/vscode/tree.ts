// The "Ashley" view in the activity bar: connection, grid install, workers, accounts, tokens.
import * as vscode from 'vscode';
import { GridApi, GridStatus } from '../core/gridApi';
import { AshleyStore } from './store';
import { testConnection } from '../core/wizard';

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

export class AshleyTree implements vscode.TreeDataProvider<Item> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private cache: Item[] = [];
  private loading = false;
  lastStatus: GridStatus | null = null;

  constructor(private store: AshleyStore, private grid: () => GridApi) {}

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
    if (!s.accessId) {
      return [new Item('Not set up yet', 'info', { icon: 'rocket', description: 'run the wizard', command: { command: 'ashley.setup', title: 'Set up' } })];
    }
    const conn = await testConnection(s.sshAlias);
    items.push(
      new Item(conn.ok ? `Connected as ${s.accessId}` : 'Cannot reach the grid', 'root', {
        description: conn.ok ? `${s.sshAlias} -> ${conn.hostname}` : conn.error.split('\n')[0],
        icon: conn.ok ? 'pass' : 'error',
        tooltip: conn.ok ? 'ssh -o BatchMode=yes works: Claude and Remote-SSH can use the grid without prompts' : 'Run the wizard or "Ashley: Check everything"',
        command: conn.ok ? undefined : { command: 'ashley.doctor', title: 'Doctor' },
      }),
    );
    if (!conn.ok) {
      this.lastStatus = null;
      return items;
    }
    const st = await this.grid().status();
    this.lastStatus = st;
    if (st.error) {
      items.push(new Item('Ashley not installed on the grid', 'root', { description: st.error, icon: 'cloud-upload', command: { command: 'ashley.gridBootstrap', title: 'Install' } }));
      return items;
    }
    items.push(
      new Item(st.ready ? 'Grid ready' : 'Grid installing', 'root', {
        description: st.ready ? `Claude Code ${st.claude_version ?? ''}${(st as any).source === 'shared' ? `, shared container ${(st as any).container}` : ''}` : st.bootstrap_job ? `job ${st.bootstrap_job} ${st.bootstrap_state ?? ''}` : 'no bootstrap job',
        icon: st.ready ? 'pass' : 'sync~spin',
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
        tooltip: `job ${w.job} ${w.job_state}\nnode ${w.node}\nprocessed ${state.processed ?? 0}, running ${(state.running ?? []).length}, queued ${w.queued ?? 0}\nclaude ${state.claude_version ?? ''}`,
        data: w,
      });
    });
    items.push(new Item('Claude workers', 'root', { icon: 'server-process', description: workers.length ? `${workers.length}` : 'none: start one', children: workers, command: workers.length ? undefined : { command: 'ashley.workerStart', title: 'Start' } }));
    const accounts = (st.accounts ?? []).map(
      (a) => new Item(a.name, 'account', { description: `${a.kind}${a.enabled ? '' : ' (disabled)'}${a.cooldown_until ? ' cooling until ' + new Date(a.cooldown_until).toLocaleTimeString() : ''}`, icon: a.kind === 'api-key' ? 'credit-card' : 'account' }),
    );
    items.push(new Item('Claude accounts on the grid', 'root', { icon: 'key', description: accounts.length ? '' : 'none', children: accounts }));
    const jobs = (st.jobs ?? []).filter((j) => !j.name.startsWith('ashley_')).slice(0, 15).map((j) => new Item(`${j.jobId} ${j.name}`, 'job', { description: `${j.state} ${j.node} ${j.elapsed}/${j.timeLimit}`, icon: j.state === 'RUNNING' ? 'play' : 'clock' }));
    items.push(new Item('Other Slurm jobs', 'root', { icon: 'list-ordered', description: `${jobs.length}`, children: jobs }));
    try {
      const who = await this.grid().accessWhoami();
      if (who) {
        if (who.admin) {
          const rows = await this.grid().accessList();
          const pending = rows.filter((r) => r.state === 'pending').length;
          items.push(new Item('Shared library access (you are the lab admin)', 'root', { description: `${pending} pending, ${rows.filter((r) => r.state === 'approved').length} approved`, icon: pending ? 'bell-dot' : 'organization', command: { command: 'ashley.access', title: 'Manage' } }));
        } else {
          items.push(new Item('Shared library access', 'root', { description: who.granted ? 'granted' : who.state === 'none' ? 'request it once everything else is set up' : who.state, icon: who.granted ? 'pass' : who.state === 'pending' ? 'clock' : 'organization', command: { command: 'ashley.access', title: 'Request' } }));
        }
      }
    } catch {
      /* grid did not answer */
    }
    const secrets = await this.store.secretSummary();
    items.push(
      new Item('Tokens on this laptop', 'root', {
        icon: 'lock',
        children: secrets.map((x) => new Item(x.name.split(' (')[0], 'token', { description: x.present ? 'stored' : 'missing', icon: x.present ? 'pass' : 'circle-outline', command: { command: 'ashley.manageTokens', title: 'Manage' } })),
      }),
    );
    return items;
  }
}
