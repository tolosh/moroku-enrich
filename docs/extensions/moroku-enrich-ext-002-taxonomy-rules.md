# Moroku Enrich — Extension 002: Taxonomy v1 (verbatim) & Merged Rules Tier

*Extension to `moroku-enrich-spec.md`. Self-contained. Source: Kanopi's as-built
"Transaction Categorisation Baseline" (August 2026), extracted from
`recalculate-expenses/index.ts`, `docuscan-webhook/index.ts` and
`src/lib/freedom/categorization.ts`. This unblocks the two inputs STATUS.md
lists as blocked. Commit to `docs/extensions/` when applying.*

---

## 0. Correction to decision §9.1: the taxonomy is 15 categories, not 16

The base spec and kickoff said "16" — an approximation from an earlier analysis.
The verbatim Kanopi taxonomy has **15** expense categories. All guard/tripwire
tests flip to **`.toBe(15)`**. The placeholder registry reconciles against the
list below; any `__pending__` sentinel left after applying this extension is a
build error.

## 1. Taxonomy v1 — verbatim, frozen

`taxonomy_version: "1"`. Identifiers exactly as in Kanopi. Default
classifications are as the current engine assigns them.

| # | Category id | Default classification |
|---|---|---|
| 1 | `mortgage` | financial_commitment |
| 2 | `rent` | financial_commitment |
| 3 | `loan_repayment` | financial_commitment |
| 4 | `groceries` | essential |
| 5 | `utilities` | essential |
| 6 | `vehicle_running` | essential |
| 7 | `transport` | essential |
| 8 | `insurance` | essential |
| 9 | `strata` | essential |
| 10 | `education` | essential |
| 11 | `subscriptions` | discretionary |
| 12 | `dining_entertainment` | discretionary |
| 13 | `clothing` | discretionary |
| 14 | `healthcare` | essential |
| 15 | `other_expenses` | discretionary |

Notes:
- `loan_repayment` had **no rule at all** in the old engine (documented
  limitation: "unreachable"). It is a real category and gets a rule in §3.
- `other_expenses` defaults `discretionary` **as a taxonomy default**; the
  conservative-fallback path continues to force `essential` + `unverified` at
  assignment time per the earlier ruling. Deliberate rule/dictionary hits on
  `other_expenses` keep the discretionary default.
- Plus the non-expense outcomes already implemented: `transfer`,
  `uncategorised_credit` (not counted in the 15).

## 2. Exclusions tier — verbatim port

Category codes `TNFC`, `OTFD`; description regex
`/\b(transfer|withdrawal|cash advance|atm withdrawal)\b/`. The old engine
dropped these; Enrich already returns them as `transfer` / `excluded: true` —
keep that behaviour. Only debits enter the expense chain (credits →
`uncategorised_credit` per the credit ruling).

## 3. Rules tier — merged chain (single source of truth)

Merges the two drifted edge-function chains (union of both brand lists) with
the priority cues folded in, ported once as the legacy floor at confidence 0.7.
Ordered; first match wins. Haystack: `source_category_description` +
description (post-normalisation input, lowercased). **All bare-token matches
use word boundaries** — the old chains used substring includes, which is the
source of the "current rental agreement" → rent class of bug.

Priority cues (evaluate before brand rules, as in the baseline):

| Order | Pattern | Category / classification |
|---|---|---|
| P1 | `\b(fuel|petrol|service station)\b` | `vehicle_running` / essential |
| P2 | `\b(cinema|cinemas|hoyts|event cinemas|village cinemas|ticketek|ticketmaster)\b` | `dining_entertainment` / discretionary |

Main chain (code match OR description regex, as today):

| # | Codes | Description regex | Category |
|---|---|---|---|
| 1 | `MRTG` | `\b(mortgage|home loan)\b` | `mortgage` |
| 2 | `RNT` | `\brent(al)?\b` (word-bounded — see deviations) | `rent` |
| 3 | — | `\b(personal loan|car loan|loan repayment|afterpay|zip pay|zippay|latitude|plenti|harmoney)\b` | `loan_repayment` |
| 4 | `GROC` | `\b(grocery|grocer|woolworths|coles|aldi|iga|foodworks|harris farm)\b` | `groceries` |
| 5 | `UTIL`,`UTLW`,`OTHD` | `\b(utility|electric|electricity|energy|gas|water|internet|broadband|phone|mobile|telstra|optus|vodafone|agl|origin|energyaustralia|red energy)\b` | `utilities` |
| 6 | `VHFL` | `\b(diesel|caltex|shell|bp|ampol|7-eleven fuel|united petroleum)\b` | `vehicle_running` |
| 7 | `TRVL` | `\b(transport|uber|taxi|didi|ola|ferry|train|bus|tram|opal|myki|translink|toll|linkt|eastlink)\b` | `transport` |
| 8 | `INSDC` | `\b(insurance|nrma|aami|allianz|budget direct|youi|medibank|bupa|hcf|nib)\b` | `insurance` |
| 9 | `SRTA` | `\b(strata|body corporate|owners corporation)\b` | `strata` |
| 10 | `EDUCP` | `\b(school|education|tuition|tafe|university|childcare|kindergarten)\b` (bare `fees` removed — see deviations) | `education` |
| 11 | `STRM` | `\b(netflix|spotify|stan|binge|kayo|disney|youtube premium|apple\.com/bill|amazon prime|subscription|stream)\b` | `subscriptions` |
| 12 | `REST` | `\b(restaurant|cafe|coffee|hotel|bar|pub|takeaway|doordash|uber eats|menulog|deliveroo|mcdonald|kfc|hungry jack|domino)\b` | `dining_entertainment` |
| 13 | `CLTH` | `\b(clothing|fashion|myer|david jones|kmart|target|big w|uniqlo|cotton on)\b` | `clothing` |
| 14 | `HLTH` | `\b(medical|health|pharmacy|chemist|doctor|dental|dentist|physio|optometrist|terry white|priceline)\b` | `healthcare` |

Classification per rule = the category's taxonomy default. No rule for
`other_expenses` — reaching it via rules is impossible by design; it arrives
only via override, MCC, dictionary, LLM, or fallback.

### Deviations from the baseline (intentional, each needs a pinning test)

1. **Word boundaries everywhere** — fixes `current` matching `rent`, etc.
   Test: `"CURRENT ACCOUNT FEE"` must NOT be `rent` or `education`.
2. **Bare `fees` removed from education** (baseline ambiguity: "fees →
   education"). `"ANNUAL CARD FEE"` → no rule match (falls to later tiers /
   fallback), `"SCHOOL FEES TERM 3"` → `education` via `school`.
3. **`loan_repayment` rule added** (rule 3) — the baseline documented it as
   unreachable; BNPL instalments (Afterpay/Zip) classify as
   `loan_repayment` / financial_commitment, which is what lenders probe.
4. **`hotel`/`bar` stay in `dining_entertainment`** — baseline parity kept
   deliberately (AU usage: hotel ≈ pub). Accommodation MCCs (7011) may map
   differently in the MCC table; taxonomy v1 has no travel-accommodation
   category, so lodging MCCs → `other_expenses` (discretionary, non-fallback).
5. **Union of both drifted chains** — statements-path gaps (`diesel`, `coffee`,
   utility brands) are covered; nothing from either chain was dropped.
6. **Modernised brand additions** within existing rule intents (Ampol, Linkt,
   Menulog, etc.) — additions only, no re-ordering.

## 4. Baseline regression tests — port verbatim

From Kanopi's test suite; all must pass through the full chain:

- `COLES EXPRESS 5512 FUEL` → `vehicle_running` (P1 beats groceries)
- `7-ELEVEN 4102 BURNLEY FUEL` → `vehicle_running`
- `WOOLWORTHS PETROL RICHMOND` → `vehicle_running`
- `COLES 0234 RICHMOND` → `groceries` (no cue; rule 4)
- `VILLAGE CINEMAS` / `HOYTS` / `EVENT CINEMAS` / `TICKETEK` / `TICKETMASTER`
  → `dining_entertainment`

Add chain-order tests the old engine never had: every rule reachable, priority
cues outrank rules 4/12, exclusions outrank everything except (nothing).

## 5. MCC table completion

With real category ids, replace registry placeholders and complete the ISO
18245 mapping (~300 rows). Anchors: 5411 → `groceries`; 5541/5542 →
`vehicle_running`; 5812/5813/5814 → `dining_entertainment`; 5912 →
`healthcare`; 5651/5691 → `clothing`; 4900 → `utilities`; 6300 → `insurance`;
4111/4121/4131 → `transport`; 7011 → `other_expenses` (see deviation 4);
8211/8220/8299 → `education`; 6513 → `rent`. Fill the remainder per ISO 18245
with the taxonomy-default classification per category.

## 6. Acceptance

1. Taxonomy guard flips `.toBe(0)` → **`.toBe(15)`**; no `__pending__`
   sentinels remain; reconciliation tripwire passes.
2. All §4 baseline regression tests green through the full chain.
3. All six §3 deviations have pinning tests.
4. MCC table complete, every row targeting a real taxonomy id, fuel MCCs still
   → `vehicle_running`.
5. Full suite + `cdk synth` green.

*Not in scope: Kanopi's aggregation maths (coverage months, monthly averaging)
stays in Kanopi; the Freedom benchmark re-mapping (`mapCategory`) is a Kanopi
phase 3 concern.*
