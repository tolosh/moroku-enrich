# Moroku Enrich — Extension 007: High-Risk Lending Merchant Categories

*Extension to `moroku-enrich-spec.md`. Self-contained. Applied 22 Oct 2026 —
taxonomy 1.1 → 1.2, engine 1.3.0 → 1.4.0. Origin: responsible-lending / RG 209
assessments weight certain merchant classes heavily, and the taxonomy carried no
bucket for them, so they were invisible. Tracked as
[ENR-24](https://moroku.atlassian.net/browse/ENR-24).*

---

## 0. Why

A question from Colin: *can Enrich reliably tag debt collectors, SACC lenders,
wage-advance apps, BNPL providers and fines agencies?*

The honest answer at 1.3.0 was **BNPL yes, the rest no** — and the reason was
structural, not a data gap. `bnpl` got its own category in ext-006; the other
four classes had **no taxonomy id at all**, so even a perfect brand match had
nowhere to land:

| Merchant class | 1.3.0 outcome | Problem |
|---|---|---|
| SACC / payday lender | `loan_repayment` (via `3-loan`) or fallback | indistinguishable from a mortgage/car-loan repayment |
| Wage-advance app | fallback (`other_expenses`) | invisible |
| Debt collector | fallback (`other_expenses`) | invisible — the single strongest hardship signal |
| Fines / infringements | `other_expenses` (MCC 9211/9222/9223) | buried in the catch-all |

Folding a payday loan into `loan_repayment` or a collector into
`other_expenses` loses exactly the flag a reviewer wants. The fix is the same
shape as ext-006's `bnpl`: a dedicated category per class, plus curated AU brand
cues and MCC mappings so the signal actually fires.

Per spec §2 these are **additive within taxonomy major 1** — nothing renamed,
removed or re-classified — so the version moves **1.1 → 1.2**.

## 1. Taxonomy additions

Four expense categories (17 → **21**):

| # | Category id | Default classification | Why |
|---|---|---|---|
| 18 | `sacc_loan` | financial_commitment | Small Amount Credit Contracts (payday loans ≤ $2,000). A scheduled obligation, and a strong affordability signal in its own right. |
| 19 | `wage_advance` | financial_commitment | Earned-wage-access / pay-advance apps. A recurring obligation; reading it as discretionary flatters affordability. |
| 20 | `debt_collection` | financial_commitment | Payments to collectors / debt buyers. The single strongest hardship indicator in a bank feed. |
| 21 | `fines_penalties` | **essential** *(to confirm — see §5)* | Statutory penalties / infringements. Non-discretionary and non-negotiable, but not ongoing credit. |

No non-expense outcomes added; the 5 from ext-006 are unchanged.

`sacc_loan`, `wage_advance` and `debt_collection` are `financial_commitment` —
the same class as `bnpl` and `loan_repayment` — so they read as obligations, not
spend. `fines_penalties` is `essential`: see §5 for the reasoning and the open
question.

## 2. Rules changes (`packages/engine/src/rules.ts`, 1.2.0 → 1.3.0)

Four new priority cues, placed **after `P3-bnpl` and ahead of the brand chain**,
so a high-risk lender is tagged as such rather than collapsing into the generic
`3-loan` rule. All word-boundaried, confidence 0.70 like every rules hit.

| Cue | Category | Representative brands (curated AU seed) |
|---|---|---|
| `P4-sacc` | `sacc_loan` | nimble, cash converters, wallet wizard, moneyme, sunshine loans, credit24, ferratum, cigno, jacaranda finance, fair go finance, swoosh finance, speckle, fundo, beyond cash, good2go |
| `P5-wage-advance` | `wage_advance` | beforepay, mypaynow, advancepay / commbank advancepay, earnd, wagetap, payactiv, wagestream |
| `P6-debt-collection` | `debt_collection` | baycorp, credit corp, panthera, milton graham, pioneer credit, collection house, recoveries corp, complete credit solutions, prushka, probe group, indebted, lion finance |
| `P7-fines` | `fines_penalties` | revenue nsw, fines victoria, state debt recovery / sdro, revenue sa, infringement, penalty notice, court fine |

Traps handled explicitly:

- **`P4-sacc` sits ahead of `3-loan`** so a SACC lender is never swept into
  `loan_repayment`. Pinned (SACC-beats-loan test).
- **`advancepay` is matched specifically** — a bare `advance` would collide with
  "cash advance", which is an *exclusion*. Pinned.
- **Wage-advance direction limit.** The rules tier is only reached on **debits**.
  A wage *advance* is an inflow and is handled by the income/credit tier first,
  so `P5` tags the repayment/fee debit, not the advance itself. This is a real
  limit of the signal, not a bug — documented here so no one expects the advance
  leg to be categorised.
- **Debt-collector short forms** (`arl`, `ccs`) are deliberately omitted —
  too collision-prone; only full agency names match.
- **No toll brands in `P7`.** Tolls are `transport`, not fines.

## 3. MCC changes (`packages/engine/src/mcc.ts`, 1.2.0 → 1.3.0)

| Code(s) | Was (1.2.0) | Now (1.3.0) | Diff? |
|---|---|---|---|
| 7322 (debt collection agencies) | *unmapped* | `debt_collection` | **No** — pure addition |
| 9211 (court costs), 9222 (fines), 9223 (bail/bond) | `other_expenses` | `fines_penalties` | **Yes** — behavioural diff |
| 9311 (tax payments) | `other_expenses` | `other_expenses` — unchanged | No — a tax is not a fine |

MCC is 0.95, above the rules tier, so where both fire the MCC mapping wins — as
intended for the three fines codes.

## 4. Seeding (`scripts/seed-merchants.ts`) — NEW

A dry-run-by-default script that lifts the canonical brands from §2 to the
**dictionary tier** (`merchants_global`, confidence 0.95, source `"seed"`), which
sits **above** rules in the chain. So a known brand resolves with dictionary
confidence and a stable canonical name rather than the 0.70 regex floor; brands
the seed does not list still fall to the P-rule. The two layers are
complementary — keep the seed list and the P4–P7 regexes in step.

```
npx tsx scripts/seed-merchants.ts --stage dev            # dry run — prints plan
npx tsx scripts/seed-merchants.ts --stage dev --apply    # writes merchants_global
```

Idempotent (PutItem under the normalised `match_key`). Seeded rows carry no
`correction_count`, so promotion/learning treats them as an authoritative floor,
not as corroborated user corrections.

## 5. The `fines_penalties` classification — open question

`fines_penalties` defaults **`essential`**. The reasoning: a fine is statutory
and non-negotiable, so the conservative, least-wrong reading is that it is not
discretionary spend the household could simply cut. But it is also not an ongoing
credit obligation, so `financial_commitment` would overstate it. `essential` is
the safest of the three, and it matches the conservative-fallback posture
(unknowns are forced `essential`).

**To confirm with Colin.** If a reviewer would rather see fines as
`discretionary` (a signal of avoidable behaviour) or `financial_commitment` (a
debt to the state), it is a one-line change in `packages/taxonomy/src/index.ts`
with no migration. Flagged rather than assumed.

## 6. Versioning and migration

| Component | Was | Now |
|---|---|---|
| `TAXONOMY_VERSION` | `1.1` | `1.2` |
| `ENGINE_VERSION` | `1.3.0` | `1.4.0` |
| `MCC_TABLE_VERSION` | `1.2.0` | `1.3.0` |
| `RULES_VERSION` | `1.2.0` | `1.3.0` |
| `NORMALISER_VERSION` | `1.1.0` | **`1.1.0` — unchanged** |
| `INCOME_VERSION` | `1.0.0` | `1.0.0` — unchanged |
| `SAVINGS_VERSION` | `1.0.0` | `1.0.0` — unchanged |

**No key migration is required.** The normaliser is untouched, so no `match_key`
moves and every stored row stays valid. The seed (§4) is a separate, optional
deploy step, not a migration.

Engine 1.4.0 is a MINOR bump because **results move between categories** (§7).
Replay determinism (spec §6) is preserved: `engine_version` is stamped on every
result, so a historical batch pinned to 1.3.0 reproduces exactly.

## 7. Consequence for consumers — read before deploying

Additive for the two new MCC/brand classes that were previously *unmapped*
(7322, and every SACC/wage-advance/collector brand that used to fall back). But
some results **move**:

| Was (1.3.0) | Now (1.4.0) | Trigger |
|---|---|---|
| `loan_repayment` or fallback | `sacc_loan` | SACC/payday brand |
| `other_expenses` (fallback) | `wage_advance` | wage-advance brand, on a debit |
| `other_expenses` (fallback) | `debt_collection` | collector brand |
| `other_expenses` (MCC 9211/9222/9223) | `fines_penalties` | fines MCC |

Classification moves too (fallback was `essential`; SACC/wage/collector are now
`financial_commitment`), so unlike ext-006 this **does** move affordability
figures for the affected transactions — correctly: these are obligations that
were previously invisible or misread. `GET /v1/taxonomy` serves the new list;
consumers should read it rather than hard-code (spec §2).

## 8. Acceptance

- `npm run build`, `npm test`, `npm run synth` green.
- Taxonomy: 21 expense categories; exact-ids test extended with the four new ids
  and classifications; version 1.2 pinned (health + `/v1/taxonomy`).
- Rules: every rule reachable (P4–P7 samples added); SACC-beats-loan and
  `advancepay` ≠ "cash advance" pinned.
- MCC: 7322 → `debt_collection`, 9211/9222/9223 → `fines_penalties`, 9311 stays
  `other_expenses`; every row still reconciles against the taxonomy.
- Full-chain: a SACC/wage/collector debit resolves via rules; a 9222 debit
  resolves via MCC to `fines_penalties` / `essential`.

## 9. Not in scope

- **`fines_penalties` classification** is provisional — §5.
- **Exhaustive brand register.** The seed is canonical AU brands, not every
  lender/collector. Extend from real Kanopi/Odyssey traffic; the rule catches the
  long tail at 0.70 in the meantime.
- **Wage-advance inflow leg** (§2) — only the repayment/fee debit is tagged.
- **BNPL** already handled (ext-006 `bnpl`); untouched here.
