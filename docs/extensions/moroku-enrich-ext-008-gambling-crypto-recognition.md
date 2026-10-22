# Moroku Enrich — Extension 008: Gambling & Crypto-Exchange Recognition

*Extension to `moroku-enrich-spec.md`. Self-contained. Applied 22 Oct 2026 —
taxonomy 1.2 → 1.3, engine 1.4.0 → 1.5.0. Origin: gambling and crypto fall
through to `other_expenses`, so they are invisible to the lending-signals
service, and gambling is the strongest behavioural red flag in an RG 209
assessment. Tracked as
[ENR-25](https://moroku.atlassian.net/browse/ENR-25) (relates to ENR-24).*

---

## 0. Why

At 1.4.0 a gambling or crypto transaction had no home: no category, no brand
rules, no MCC mappings. A card bet fell to `other_expenses`; a bet paid by
transfer/PayID/BPAY was swallowed as a `transfer`; a payout or crypto sale came
back as `uncategorised_credit` (or, worst case, `income`). The lending-signals
service needs these tagged — and needs deposits and withdrawals separable — before
it can compute net gambling or flag crypto exposure.

Same shape as ext-007 (new categories + AU brand lists + MCC mappings + seed),
plus engine surface ext-007 did not need: tagging **inflows** without ever
calling them income, a **variable confidence** model, new **input/output fields**,
**BPAY** matching, and a **scored** precision/recall test. Additive within
taxonomy major 1 (**1.2 → 1.3**).

## 1. Taxonomy additions (flat peer ids)

Four expense categories (21 → **25**), all `discretionary`:

| id | excluded (out / in) | notes |
|---|---|---|
| `gambling_wagering` | false / **true** | sports & race betting |
| `gambling_casino` | false / **true** | casinos, online casino |
| `gambling_lottery` | false / **true** | split from wagering so a weekly ticket isn't scored like sports betting |
| `quasi_cash` | false / false | MCC-only fallback for 6050/6051/6540 with no brand; low confidence |

Two non-expense outcomes (5 → **7**), both `excluded: true` in **both** directions
(speculative flow, not a living cost):

| id | notes |
|---|---|
| `crypto_exchange` | exchange buys/sells |
| `crypto_atm` | crypto ATMs — split out because they matter for scam detection |

The sub-categories are **flat peer ids**, not a hierarchy (the taxonomy is flat,
as in ext-007). The parent is recoverable from the id prefix (`gambling_`,
`crypto_`).

**Per-direction `excluded`.** A gambling *deposit* (debit) is discretionary
spend; a gambling *inflow* (winning) is not spend. The static taxonomy carries
`excluded: false` for the gambling ids and the chain overrides to `true` on
inflows (`chain.ts`, via `build()`'s `excluded` opt). Crypto is excluded in both
directions, so the crypto ids are non-expense outcomes and need no override.

## 2. Detection module — `packages/engine/src/high-risk-flow.ts` (HIGH_RISK_VERSION 1.0.0)

A dedicated tier, like `income.ts`/`savings.ts`. `detectHighRiskFlow(merchant,
input)` owns the gambling/crypto brands, MCCs and BPAY biller codes, and is the
one place with a **variable** confidence model — `mcc.ts` and `rules.ts` stay flat
and are untouched.

Internal precedence (spec §6: rules → MCC → LLM): a **brand** (or biller code) is
consulted first and sets the sub-category; the **MCC** only refines confidence. A
lottery brand therefore yields `gambling_lottery` even on a wagering MCC — and the
lottery brand rule is ordered ahead of wagering so "TAB KENO" is lottery.

**Confidence** (spec §6):

| evidence | confidence |
|---|---|
| brand + consistent MCC | 0.95 |
| brand alone | 0.80 |
| gambling MCC alone | 0.80 |
| quasi-cash MCC alone | 0.50 |

**Haystack**: `source_category_description` + normalised `match_key` +
`merchant_name` + `reference` + `biller_name`, lowercased. Biller code is matched
exactly.

**Collision guards** (spec §3) — anchored patterns: `TAB` only as
`tabcorp`/`tabtouch`/`tab.com.au`/`tab limited`; `crown` only as
`crown melbourne|sydney|perth|casino|resorts|towers`; `star` only as
`the star sydney|gold coast` / `star entertainment|casino|city`; `treasury` only
as `treasury brisbane|casino`. A collision test set (Crown Street, The Table,
Lucky Star, Starbucks, Treasury Wine, tobacco) is pinned to produce **zero** false
gambling tags.

**MCC map**: 7995→wagering, 7800→lottery, 7801→casino, 7802→wagering, 9754→
wagering; 6050/6051/6540→crypto with a crypto brand, else `quasi_cash`.

## 3. Chain integration — `packages/engine/src/chain.ts`

- **Direction** (`in`/`out`) is computed from the sign of `amount` and carried on
  every result (omitted when `amount` is absent).
- **High-risk detection runs first** — before exclusion/credit/income — so it can
  tag inflows (winnings, crypto sales) that the credit branch would otherwise book
  as income/`uncategorised_credit`, and deposits arriving as transfer/PayID/BPAY
  that the exclusion tier would otherwise swallow. **It also beats the override
  tiers**, consistent with the existing exclusion/credit-before-override
  short-circuit (ext-006 §10) — documented as deliberate: a correction cannot
  currently hide a gambling/crypto flow.
- **Venue cash-withdrawal flag** (spec §7): an ATM/cash withdrawal at a licensed
  venue (`hotel|rsl|leagues|tavern|club`) gets a low-confidence
  `venue_cash_withdrawal` flag while keeping the excluded `transfer` outcome.
  **Deviation**: the spec wanted a `cash_withdrawal` category; minting one would
  reclassify *all* ATM traffic, so we flag rather than reclassify.
- `matched_rule_id` is now surfaced for `high_risk`, `rules` and `income` hits
  (the rule id already existed internally but was discarded).

## 4. Schema changes

- **Input** (`CategoriseInput`, `TransactionSchema`): `merchant_name`,
  `reference`, `biller_name`, `biller_code` (all optional).
- **Output** (`EnrichResult`): `direction?: "in" | "out"` and
  `matched_rule_id?: string`, both omitted when absent. The categorise handler
  spreads the full result, so they flow through without a whitelist change.
- `summarise` is unaffected: excluded results (gambling inflows, crypto) stay out
  of the `confident_pct` denominator; `by_source` picks up the new `high_risk`
  source automatically.

## 5. BPAY biller codes

Deposits arrive by card (MCC present), PayID/NPP (brand in description/reference)
and BPAY (biller code + name). Only **Sportsbet's** code (89672) is publicly
verifiable today; it is seeded in `BILLER_CODES`. **The rest are a gap to close
from real data**: collect each operator's published deposit biller code (and the
exchanges', where they use BPAY — most use PayID/Osko) and extend the table. The
detector matches `biller_code` exactly, so adding a code is a one-line change.

## 6. Seed — `scripts/seed-merchants.ts`

The gambling/crypto brands are seeded into `merchants_global` at **0.80**
(brand-alone confidence), importing `HIGH_RISK_SEED_GROUPS` from the detection
module (one source of truth). The detection tier runs ahead of the dictionary and
supersedes these at runtime (so it can bump to 0.95 with a consistent MCC and
handle inflows); the seed exists so the dictionary carries a floor and
`GET /v1/merchants/{key}` resolves them. Run after merge:

```
npx tsx scripts/seed-merchants.ts --stage dev  --apply
npx tsx scripts/seed-merchants.ts --stage test --apply
```

## 7. Versioning

| Component | Was | Now |
|---|---|---|
| `TAXONOMY_VERSION` | `1.2` | `1.3` |
| `ENGINE_VERSION` | `1.4.0` | `1.5.0` |
| `HIGH_RISK_VERSION` | — | `1.0.0` |
| `MCC_TABLE_VERSION` | `1.3.0` | `1.3.0` — unchanged |
| `RULES_VERSION` | `1.3.0` | `1.3.0` — unchanged |
| `NORMALISER_VERSION` | `1.1.0` | `1.1.0` — unchanged |

No key migration (normaliser untouched). Engine 1.5.0 is a MINOR bump: results
move into the new categories and inflows change class, but replay determinism
holds (`engine_version` is stamped on every result).

## 8. Acceptance (all green)

- `npm run build`, `npm test` (**267 tests**, 73 new), `npm run synth`.
- Scored harness (`packages/engine/test/high-risk-flow.test.ts` over
  `fixtures/gambling-crypto.fixture.ts`): gambling precision ≥ 95% & recall ≥ 90%;
  crypto precision ≥ 95% with a brand; **zero** false gambling on the collision
  set; **no** inflow tagged income; no lottery-as-wagering where a lottery brand
  is present; confidence values match the table.
- Every brand covered across card / PayID / BPAY and both directions.

## 9. Notes / documented deviations & residual risk

- Detection beats user/tenant overrides (same posture as exclusion/credit today;
  ext-006 §10). Flagged for review.
- `venue_cash_withdrawal` is a flag on the existing excluded outcome, not a new
  `cash_withdrawal` category.
- BPAY biller codes beyond Sportsbet are a gap to fill from real data (§5).
- Residual brand-collision risk on short/ambiguous names (`neds`, `betr`,
  `dabble`): anchored where possible, but a "Ned's Auto" could still match. Tune
  from real Kanopi/Odyssey traffic; the seed/brand lists are deliberately editable.

## 10. Not in scope

- Hierarchy in the taxonomy (sub-categories are flat ids).
- Reclassifying ATM traffic into a `cash_withdrawal` category (§3, flag only).
- Live deploy — this is a PR; deploy with `--context llmTier=on` as for ENR-24,
  then seed dev + test.
