# Moroku Enrich — Extension 006: Odyssey Taxonomy Additions

*Extension to `moroku-enrich-spec.md`. Self-contained. Applied 15 Aug 2026 —
taxonomy 1 → 1.1, engine 1.2.0 → 1.3.0. Origin: Odyssey becomes enrich customer
#2, and its three live missions need signal the Kanopi expense taxonomy does not
carry. Decisions taken with Colin, 15 Aug 2026.*

---

## 0. Why

Odyssey's challenge configs match transaction categories by name. Taxonomy v1 —
lifted verbatim from Kanopi (ext-002) — is an **expense** taxonomy, and expense
categorisation is only one of Odyssey's three missions:

| Odyssey mission | Taxonomy v1 coverage |
|---|---|
| Spending | good — `groceries`, `utilities`, `subscriptions`, `transport`, `dining_entertainment` all land |
| Borrowing | partial — `loan_repayment` / `mortgage` exist, but BNPL instalments read as `loan_repayment` |
| Saving | **none** — every internal movement collapses to `transfer`, so a deposit is indistinguishable from a withdrawal |
| *(income denominators)* | **none** — every credit returns `uncategorised_credit` |

Rather than let Odyssey run a second categorisation vocabulary, the taxonomy
extends to cover it. **Decision (Colin, 15 Aug):** extend globally rather than
gate additions per tenant — "we built it and had 15 categories as a starting
point; it will no doubt expand over time as it learns."

Per spec §2 these changes are **additive within taxonomy major 1** — nothing is
renamed, removed or re-classified — so the version moves **1 → 1.1**.

## 1. Taxonomy additions

Two expense categories (15 → **17**):

| # | Category id | Default classification | Why |
|---|---|---|---|
| 16 | `bnpl` | financial_commitment | A BNPL instalment is a scheduled obligation. Reading it as discretionary flatters affordability (spec §1.3). |
| 17 | `general_retail` | discretionary | Department stores, electronics, homewares, hobby — the largest block inside the `other_expenses` catch-all. Splitting it out makes the catch-all mean "genuinely unclassified" again. |

Three non-expense outcomes (2 → **5**):

| Outcome | Excluded | Why |
|---|---|---|
| `income` | yes | Recognised salary/benefit credits. Spec §2's `income`, pulled forward from phase 2. Excluded because income is emphatically not spend. |
| `savings_deposit` | yes | Money into savings. |
| `savings_withdrawal` | yes | Money out of savings. |

All three keep `excluded: true`, so **no spend denominator moves**:
`confident_pct` and the fallback-rate alarm are computed over exactly the same
population as on 1.2.0.

## 2. Income recognition (`packages/engine/src/income.ts`)

Runs on **credits only**, after the exclusion tier, before the
`uncategorised_credit` fallthrough. A credit matching nothing keeps returning
`uncategorised_credit` — recognition is strictly additive and silence is the
default. Confidence **0.9** (above the 0.8 low-confidence threshold: these cues
are explicit, not inferred).

Cue set (word-boundaried, ordered): `I1-salary`, `I2-payroll`, `I3-wages`,
`I4-benefits` (Centrelink / Services Australia / JobSeeker / Youth Allowance /
Austudy / Abstudy / Family Tax Benefit / Paid Parental Leave / Veterans
Affairs), `I5-pension`.

Deliberately **excluded** as cues: `DIRECT CREDIT`, `DEPOSIT`, bare `PAY`.
Over-recognising income flatters affordability, so a cue earns its place only
if a false positive on a credit is implausible.

**The income tier matches the RAW description as well as the normalised key.**
This is a deviation from the rules tier and it is load-bearing: the normaliser
strips trailing location tokens, so `SERVICES AUSTRALIA` normalises to
`services` and every agency cue containing a place name would be unreachable.
Income payers are employers and agencies, not merchants — the normalisation
that helps the dictionary actively hurts here. Pinned by a regression test.

## 3. Savings subtyping (`packages/engine/src/savings.ts`)

Splits `transfer` into `savings_deposit` / `savings_withdrawal` inside the
exclusion tier, because a savings movement *is* a transfer.

**Direction is not the sign of the amount.** `TRANSFER TO SAVINGS -500` seen on
a transaction account is a deposit INTO savings despite the negative amount; the
same movement on the savings account is +500. So:

- `account_type: "savings"` → the sign is authoritative (this row IS the savings
  account: credit = deposit, debit = withdrawal);
- otherwise → the description's direction word is authoritative, and the sign is
  the counterparty's view and is deliberately ignored.

**`account_type` alone never promotes a transaction into a savings movement.** A
savings account also carries card purchases, interest and fees; treating every
row on one as a savings movement would silently destroy expense categorisation
for any caller sending savings-account data. `account_type` only refines the
direction of a movement already established as a transfer (by the exclusion
tier) or stated in words in the description. Pinned by a regression test.

A second arm catches real deposits the exclusion patterns miss — `AUTO SAVE TO
SAVINGS` carries no `TRANSFER`/`TFR` token. It requires the direction to be
stated in the description.

A savings movement whose direction cannot be established **stays `transfer`**.
Guessing would put fabricated inflows into a savings measure, which is the exact
class of error the conservative posture exists to prevent.

## 4. MCC and rules changes

- **MCC 1.1.0 → 1.2.0.** The general retail / department / electronics /
  homewares / hobby block (5200–5999 group, 33 codes) moves from
  `other_expenses` to `general_retail`. Classification unchanged (both
  `discretionary`), so **no affordability number moves**. Travel, personal care,
  professional services and government stay on `other_expenses`.
- **Rules 1.1.0 → 1.2.0.** New `P3-bnpl` priority cue (afterpay, zip pay/money,
  klarna, humm, openpay, payright, sezzle, latitudepay, brighte); `afterpay` /
  `zip pay` / `zippay` removed from `3-loan`. Bare `latitude` **stays** on
  `3-loan` — Latitude Financial writes personal loans as well as LatitudePay.
  New `15-general-retail` appended **last** in the chain so every more specific
  rule keeps first refusal (notably `11-subscriptions` for `amazon prime`, and
  `13-clothing` for myer/kmart/target/big w).
- The normaliser strips `ZIP *` as a gateway prefix, so `ZIP*WOOLWORTHS`
  correctly remains the underlying purchase and never reaches `P3-bnpl`. Pinned.

## 5. Deviations

1. **`uncategorised_credit.excluded` corrected `false` → `true`.** The taxonomy
   said `false` while the chain forced `true` on the credit path, so a *user
   override* to that id resolved as spend and diluted `confident_pct`. All
   non-expense outcomes are now uniformly `excluded: true`. The chain path is
   unchanged.
2. **`ext-002 D3` superseded.** BNPL was routed through `loan_repayment` because
   there was no BNPL category. It now resolves to `bnpl`; classification is
   unchanged, so nothing downstream of classification moves.
3. **Income matches the raw description** (§2), unlike every other tier.
4. **`TAXONOMY_VERSION` is now re-exported from `@moroku-enrich/taxonomy`** by
   `engine/src/version.ts` rather than restated, so the two cannot drift.

## 6. Versioning and migration

| Component | Was | Now |
|---|---|---|
| `TAXONOMY_VERSION` | `1` | `1.1` |
| `ENGINE_VERSION` | `1.2.0` | `1.3.0` |
| `MCC_TABLE_VERSION` | `1.1.0` | `1.2.0` |
| `RULES_VERSION` | `1.1.0` | `1.2.0` |
| `NORMALISER_VERSION` | `1.1.0` | **`1.1.0` — unchanged** |
| `INCOME_VERSION` | — | `1.0.0` |
| `SAVINGS_VERSION` | — | `1.0.0` |

**No key migration is required.** The normaliser is untouched, so no `match_key`
moves and every stored `merchants_global` / `overrides` / `llm_cache` row stays
valid. Contrast ext-004, which needed `scripts/migrate-normaliser-keys.ts`.

Engine 1.3.0 is a MINOR bump, not a patch, because **results move between
categories**. Replay determinism (spec §6) is preserved: `engine_version` is
stamped on every result, so re-running a historical batch pinned to 1.2.0 still
reproduces its report exactly.

## 7. Kill switch

`INCOME_SAVINGS_ENABLED` (SSM `/moroku-enrich/<stage>/config/income-savings-enabled`,
`ChainOptions.incomeSavingsEnabled`) — **defaults ON**, note the inverted default
versus `LLM_TIER_ENABLED`. ext-006 is part of the engine; the flag exists only so
the tier can be disabled from config without a code change if Kanopi's shadow
diff needs quietening. Setting it false restores 1.2.0 outcomes exactly (credits
→ `uncategorised_credit`, all transfers → `transfer`); the two new *expense*
categories are taxonomy, not tier, and are unaffected by the switch. Pinned by
tests.

## 8. Consequence for Kanopi — read this before deploying

This is **not** a purely additive change to what Kanopi sees. Four result
classes move:

| Was (1.2.0) | Now (1.3.0) | Trigger |
|---|---|---|
| `uncategorised_credit` | `income` | credit matching an income cue |
| `transfer` | `savings_deposit` / `savings_withdrawal` | directed savings movement |
| `other_expenses` | `general_retail` | 33 retail MCCs |
| `loan_repayment` | `bnpl` | BNPL brands |

Kanopi's shadow client maps the 15 ids and will diff on all four until it learns
the new ones. Classification is unchanged in every case, so any consumer reading
`classification` rather than `category` is unaffected — **including every
affordability figure**. Sequence the cutover as: deploy → confirm the shadow
diff matches exactly these four classes and nothing else → update Kanopi's
mapping. `GET /v1/taxonomy` serves the new list; consumers should read it rather
than hard-code (spec §2).

## 9. Acceptance

- `npm run build`, `npm test`, `npm run synth` green. **185 tests** (was 159):
  13 pinning tests updated to the new behaviour, 26 added.
- Every non-expense outcome is `excluded: true`; every `CATEGORY.*` and
  `NON_EXPENSE.*` binding reconciles against the taxonomy (tripwire extended to
  cover non-expense ids).
- The 15 verbatim Kanopi ids and their default classifications are pinned
  unchanged by a dedicated test — the additive guarantee is enforced, not
  asserted in prose.
- Regression tests for the two traps: `account_type: "savings"` must not promote
  a purchase; a normaliser-destroyed agency cue must still match.

## 10. Not in scope

- **Corrections cannot fix a miscategorised credit or transfer.** The exclusion
  and credit branches short-circuit before the user/tenant override tiers, so an
  override on a credit is stored but never consulted. Pre-existing (ext-004 §5
  made `transfer` a valid correction target but the chain still short-circuits);
  ext-006 does not change chain ordering. Worth a follow-up.
- **Income granularity.** A single `income` id, per spec §2. Odyssey's dotted
  vocabulary carries nine variants (salary, pension, casual, gig, freelance,
  bonus, dividend, invoice, drawings); no rule or MCC signal distinguishes gig
  from freelance on real bank data, so they would all fall back. The income
  denominator is a sum and needs the total, not the breakdown.
- **`shopping`.** Odyssey's `shopping` concept now maps to `general_retail` +
  `clothing`; no separate id.
- **Promotion worker, merchants_global seeding** — unchanged, still open.
