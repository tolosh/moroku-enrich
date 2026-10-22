# Moroku Enrich — Extension 009: Fines Reclassification

*Extension to `moroku-enrich-spec.md`. Self-contained. Applied 22 Oct 2026 —
taxonomy 1.3 → 1.4, engine 1.5.0 → 1.6.0. Origin: a follow-up from Colin after
ENR-25, aligning `fines_penalties` with how the lending-signals affordability
engine treats spend. Tracked as
[ENR-26](https://moroku.atlassian.net/browse/ENR-26).*

---

## 0. Why

The affordability engine builds **general living expenses (GLE)** from essential
and basic spend, and counts debt repayments **separately** as commitments. So a
category's classification decides which bucket it lands in:

- `essential` → fines go **into living expenses**. A single $400 speeding fine
  would inflate monthly GLE across the whole lookback and distort the
  serviceability ratios (DSR, NDI).
- `discretionary` → implies the applicant could cut fines back. They can't.
- `financial_commitment` → keeps fines **out of** living expenses; a fine paid in
  instalments is instead picked up as a repayment.

`financial_commitment` is the correct bucket. `fines_penalties` had shipped at
1.2 (ext-007) as `essential`, flagged "to confirm" — now confirmed.

## 1. Change

| id | was | now |
|---|---|---|
| `fines_penalties` | `essential` | **`financial_commitment`** |

`debt_collection` (ext-007) was checked and is **already** `financial_commitment`
for the same reason — no change.

Category ids and the MCC/rules routing are untouched: a fines transaction still
resolves to `fines_penalties`; only its `default_classification` moves, so
downstream a fine now sits with commitments rather than living expenses.

## 2. Versioning — the additivity exception

| Component | Was | Now |
|---|---|---|
| `TAXONOMY_VERSION` | `1.3` | `1.4` |
| `ENGINE_VERSION` | `1.5.0` | `1.6.0` |

Taxonomy changes are meant to be **additive within a major** (no rename, remove
or re-classify). This is a **re-classification**, so it is a deliberate exception:
`fines_penalties` was only days old (1.2) and no affordability consumer had yet
relied on it, so this is a *correction* caught before use, not a re-class of a
stable category. It therefore rides a MINOR taxonomy bump rather than a major.
`ENGINE_VERSION` bumps too (not a taxonomy-only change) so replay stays
deterministic: a historical batch pinned to 1.5.0 still reproduces `essential`.

No key migration (normaliser untouched).

## 3. Acceptance

- `npm run build`, `npm test` (267 tests), `npm run synth` green.
- `taxonomy.test.ts` pins `fines_penalties: "financial_commitment"` and version
  `1.4`; the chain test asserts a 9222 fines MCC resolves to
  `fines_penalties / financial_commitment`.
- After deploy, `/v1/health` reports `engine 1.6.0 / taxonomy 1.4`.

## 4. Not in scope

- BPAY biller-code collection (the other ENR-25 follow-up) — tracked separately.
