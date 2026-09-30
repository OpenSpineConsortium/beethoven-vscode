# Arbitration: the clause held in reserve, and when to adopt it

Written for the maintainer and counsel. The agreement of Beethoven for VS Code (Ashley for VS Code
until 3.0.0) has sent disputes, since version 3 and still in version 5, to Michigan courts with a
class-action waiver, a jury waiver, notice-and-cure and a one-year limit on contract and warranty
claims, and says arbitration may be offered in a future version by re-acceptance. This file records
why, and holds the clause text for that day.

## Why version 3 has no arbitration clause

From `docs/research/reports/Ashley liability shield and Marketplace.md` (2026-09-28):

- Under the AAA Consumer schedule the business bears about $3,275 per desk case ($375 filing,
  $1,400 case management, $1,500 desk arbitrator) or $4,775 with a hearing, plus $600 to register the
  clause and $600 a year; a mass filing starts at an $8,125 initiation fee plus about $1,375 per case
  (100 claims: about $145,000). Courts do not police that leverage (*Frazier v. X Corp.*, 2d Cir.
  2025; *Jones v. Starz*, 9th Cir. 2025).
- The Michigan Consumer Protection Act limits class actions to Michigan residents' actual damages.
  At a few hundred licenses of tens of dollars, the class ceiling is below the mass-arbitration
  floor: the clause would cost more than what it prevents.
- Mass-arbitration batching protocols are the weakest part of such clauses (*Heckman v. Live
  Nation*, 9th Cir. 2024, striking one with its delegation clause and class waiver).
- Arbitration with a class waiver is legally strong when it fits the business (*Concepcion*, *In re
  StockX* under Michigan law), so the door is kept open.

## The threshold for revisiting

Revisit when any of these holds: more than about 2,000 paid licenses in force; a single-claim
exposure that a court could plausibly award above the arbitration cost; a class filing received; or
counsel's view that a stand-alone class waiver will not hold in Michigan for the claims seen. If
adopted, the clause must be accepted afresh (section 17), applies only to later disputes, and keeps:
AAA Consumer Rules by name; a separate delegation paragraph; a 30-day e-mail opt-out; a small-claims
election; a public-injunction carve-out; a federal-law savings clause; the business paying all fees
beyond the consumer's capped filing fee; **no** bellwether or batching protocol; the class waiver
surviving an opt-out; and no waiver of the Michigan Uniform Arbitration Act's rights to counsel,
notice of initiation or arbitrator disclosure.

## Clause text held in reserve (from the superseded draft of version 3)

(a) Arbitration. If the problem is not resolved under the notice-and-cure paragraph, any dispute,
claim or controversy arising out of or relating to Beethoven for VS Code, your license, this
agreement (including its formation, interpretation, breach or validity) or your relationship with
Licensor, whether based in contract, tort, statute or any other theory, will be resolved by binding
arbitration on an individual basis, and not in court, except as (c) and (f) provide. The arbitration
is administered by the American Arbitration Association under its Consumer Arbitration Rules in
force when the claim is filed, before one arbitrator, by written submissions, telephone or video
unless the arbitrator or the rules require an in-person hearing, in which case it takes place in the
county where you live. The Federal Arbitration Act governs this section. The arbitrator may award
any individual relief a court could, and applies this agreement and the law that applies.

(b) Delegation. The arbitrator, and not any court, decides all questions about the scope,
enforceability, interpretation and validity of this section, except that a court decides whether the
class-action waiver is enforceable.

(c) What stays outside arbitration. (1) Either party may bring an individual claim in small-claims
court where it qualifies. (2) Either party may seek an injunction in court to stop unauthorised use
or infringement of intellectual property. (3) A request for public injunctive relief that the law of
your state does not allow to be waived is decided by a court after the arbitrator has decided the
individual claims.

(d) Fees. If you start arbitration, you pay the consumer filing fee the AAA rules set (or ask the
AAA for a waiver); Licensor pays the remaining administrative and arbitrator fees. If Licensor starts
it, Licensor pays all of them. Each party pays its own lawyers, unless a statute or the arbitrator
under the rules provides otherwise for a claim found frivolous or brought in bad faith.

(e) Class-action waiver. As in the current section 19(c); if held unenforceable for a claim, that
claim is severed from arbitration and decided by a court, never arbitrated on a class basis.

(f) Your right to opt out. You may reject this arbitration clause by sending Licensor, within 30
days of first accepting the agreement that contains it, a written notice stating your name, the
e-mail in your license record and that you opt out of arbitration, to the notice address on the
Beethoven support page. Opting out does not affect any other term, and Licensor will not treat you
differently for it.

(g) Michigan Uniform Arbitration Act. Nothing in this section waives your right to be represented by
a lawyer, to notice of the initiation of an arbitration, or to the arbitrator's disclosures.

## Engineering notes for that day

The signing dialog's third affirmation names the dispute terms; the wording changes with the clause
and `TERMS_VERSION` is bumped so every installation re-accepts. An opt-out command existed in the
draft (`Ashley: Opt out of arbitration` then; `Beethoven: Opt out of arbitration` if restored,
recording the choice in the acceptance record and copying the notice text); it was removed with the
clause and can be restored from the repository history (commit "Version 2.0.0 ... terms version 3").
