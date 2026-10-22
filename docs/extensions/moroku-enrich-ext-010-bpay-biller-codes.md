# Moroku Enrich — Extension 010: BPAY Biller-Code Table

*Extension to `moroku-enrich-spec.md`. Self-contained. Applied 22 Oct 2026 —
engine 1.5.0 → 1.7.0 (HIGH_RISK_VERSION 1.0.0 → 1.1.0), taxonomy unchanged.
Origin: ENR-25 follow-up (item 2) from Colin — collect published BPAY biller
codes now rather than waiting for deposit data, with provenance and a
published→confirmed lifecycle. Tracked as
[ENR-27](https://moroku.atlassian.net/browse/ENR-27).*

---

## 0. Why

Gambling/crypto deposits arrive by card (MCC), PayID/NPP (brand in the text) and
**BPAY** (a numeric biller code + per-account CRN). The gambling detector already
matches `biller_code` exactly, but only Sportsbet's code was seeded. Colin asked
to collect the rest now and give each code provenance and a review lifecycle.

## 1. What the research found (2026-10-22)

**Only two fixed BPAY biller codes are publicly verifiable** — Sportsbet (89672,
already seeded) and **TABtouch (1214, new)**. For every other operator that
offers BPAY, the code is shown only inside the logged-in cashier (per-account),
so it cannot be sourced from public pages. No codes were guessed.

| Brand | Category | BPAY? | Code | Note |
|---|---|---|---|---|
| Sportsbet | wagering | yes | **89672** | official help centre |
| TABtouch | wagering | yes | **1214** | official; ref = account no. for accts ≥ 2176660 |
| Ladbrokes | wagering | yes | in-account | Entain; code shown in My Account → Deposit |
| Neds | wagering | yes | in-account | Entain; article says use the code in My Account |
| The Lott | lottery | yes | in-account | per-account CRN |
| Lotterywest | lottery | yes | in-account | per-account |
| bet365 | wagering | **no** | — | card/PayID |
| Betfair | wagering | **no** | — | official: no BPAY |
| BlueBet / Betr / TopSport | wagering | **no** | — | now one **betr** platform (Debit/PayID/PayPal/Apple/Google/EFT) |
| Dabble | wagering | no (likely) | — | |
| TAB (Tabcorp) | wagering | unknown | — | help centre login-gated; recommend TAB support 131 802 |
| PointsBet | wagering | unknown | — | acquired by BlueBet; methods may have changed |
| Unibet / PlayUp / Keno | wagering/lottery | unknown | — | login-gated cashiers |
| Palmerbet | wagering | yes (likely) | — | third-party only; unconfirmed on own site |
| All exchanges | exchange | **no** | — | CoinSpot, Swyftx, Independent Reserve, BTC Markets, CoinJar (retired BPAY 2022), Digital Surge, Coinbase, Binance, Kraken, Crypto.com — PayID/Osko |
| Coinflip / Localcoin | crypto_atm | **no** | n/a | cash-only ATMs |

**Card / PayID is the only detection path** for: bet365, Betfair, the betr-platform
brands (BlueBet/Betr/TopSport), Dabble, **all crypto exchanges**, and crypto ATMs.

## 2. Change — `packages/engine/src/high-risk-flow.ts`

`BILLER_CODES` entries now carry provenance and a lifecycle:

```
interface BillerCodeEntry {
  category; id; brand;
  source: "published" | "confirmed";
  found_date; source_url;
  review_after?;   // published: found + 90d
}
```

- **Seeded** (both `published`): `89672` Sportsbet, `1214` TABtouch — both
  `gambling_wagering`, `review_after` 2027-01-20.
- **Lifecycle**: `published` = sourced from the operator's page, not yet seen in
  real data; `confirmed` = matched a real transaction. Promotion is operational
  (flip `source` when a hit is observed); auto-promotion via usage telemetry is a
  documented follow-up (no biller-hit telemetry exists yet).
- **`billerCodesDueForReview(asOf?)`** — a pure helper returning `published`
  codes past their `review_after`, for a scheduled check to recheck or drop a
  code that never appeared in real data within 90 days.

Detection is otherwise unchanged (biller code → category, brand-strength, 0.80
alone / 0.95 with a consistent MCC). A line that also carries the brand name
matches the brand rule first — same category, so no behavioural loss.

## 3. Versioning

| Component | Was | Now |
|---|---|---|
| `HIGH_RISK_VERSION` | `1.0.0` | `1.1.0` |
| `ENGINE_VERSION` | `1.6.0` | `1.7.0` |
| `TAXONOMY_VERSION` | `1.4` | `1.4` — unchanged |

A biller code (1214) now resolves where it previously fell through — a MINOR
engine bump; no migration.

## 4. Acceptance

- `npm run build`, `npm test` (271 tests), `npm run synth` green.
- TABtouch 1214 and Sportsbet 89672 resolve to `gambling_wagering`; every biller
  entry has `source`/`found_date`/`source_url`; `billerCodesDueForReview` surfaces
  published codes only after their review date.
- After deploy, `/v1/health` reports `engine 1.7.0 / taxonomy 1.4`.

## 5. Follow-ups

- Capture **in-account** codes (Ladbrokes, Neds, The Lott, Lotterywest) from a
  logged-in deposit screen or the first real transaction, then add as `published`
  and promote to `confirmed` on match.
- Resolve the **unknowns** (TAB, PointsBet, Unibet, PlayUp, Keno, Palmerbet).
- Wire **auto-promotion / auto-flag**: emit a biller-code-hit metric so a code is
  promoted on first real match and `billerCodesDueForReview` can be swept on a
  schedule instead of by hand.
- Confirm **TABtouch 1214** against a live logged-in deposit screen (sourced from
  the help page).
