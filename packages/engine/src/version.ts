/**
 * Component versions that roll up into the engine_version stamped on every
 * result. Bumping the normaliser re-keys the dictionary (a match_key produced
 * by v1.1.0 may differ from v1.0.0), so it is versioned independently and its
 * value is a component of ENGINE_VERSION per spec §4.
 *
 * ENGINE_VERSION is the released semver reproduced on every categorise result;
 * it is what makes replay (spec §6) deterministic: re-running a historical
 * batch on a pinned engine_version reproduces the report exactly.
 */
// 1.1.0 (ext-004 §4): strip EFTPOS/VISA/DEBIT/V POS prefixes + CARDxx fragments.
// Re-keys affected dictionary/cache rows — see scripts/migrate-normaliser-keys.ts.
// UNCHANGED by ext-006 — deliberately. No match_key moves, so ext-006 needs no
// key migration and every stored dictionary/llm_cache row stays valid.
export const NORMALISER_VERSION = "1.1.0";
// 1.3.0 (ext-007): 7322 → debt_collection; 9211/9222/9223 re-homed
// other_expenses → fines_penalties (a diff on those three fines codes).
// 1.2.0 (ext-006): general retail / department / electronics / hobby split out
// of other_expenses into general_retail. Classification unchanged.
// 1.1.0: 4899 + digital-subscription MCCs (5815-5818, 5968) → subscriptions
// (were misclassifying streaming as utilities/essential). Shadow-mode fix.
export const MCC_TABLE_VERSION = "1.3.0";
// 1.3.0 (ext-007): P4-P7 priority cues — SACC/payday, wage-advance, debt
// collection, fines — curated AU brand lists ahead of the brand chain.
// 1.2.0 (ext-006): P3-bnpl priority cue added (afterpay/zip taken off 3-loan);
// 15-general-retail appended last.
// 1.1.0 (ext-004 §1/§2): catch-all OTHD removed; bare-transfer exclusion.
export const RULES_VERSION = "1.3.0";
// 1.0.0 (ext-006): income recognition over credits — spec §2, pulled forward.
export const INCOME_VERSION = "1.0.0";
// 1.0.0 (ext-006): savings deposit/withdrawal subtyping inside the exclusion tier.
export const SAVINGS_VERSION = "1.0.0";
// 1.0.0 (ext-007): high-risk lending priority cues live in rules.ts (RULES_VERSION).
// 1.0.0 (ext-008): gambling & crypto detection — a dedicated tier (high-risk-flow.ts)
// that owns its own brands, MCCs and biller codes plus the variable confidence
// model (0.95/0.80/0.80/0.50), so mcc.ts and rules.ts are deliberately untouched.
// 1.1.0 (ext-010): BPAY biller-code table gains provenance (source/date/url) and
// the published->confirmed lifecycle; adds TABtouch (1214) alongside Sportsbet.
export const HIGH_RISK_VERSION = "1.1.0";

/**
 * The released engine semver. Bump when any component above changes.
 *
 * 1.7.0 (ext-010) — MINOR: BPAY biller-code table gains provenance and the
 * published→confirmed lifecycle, and adds TABtouch (1214). A biller code now
 * resolves to gambling_wagering where it previously fell through.
 *
 * 1.6.0 (ext-009) — MINOR: `fines_penalties` re-classified essential →
 * financial_commitment (ENR-26, taxonomy 1.4). A result's category is unchanged;
 * its classification moves, so a fine now sits with commitments, not living
 * expenses. Bumped (not a taxonomy-only change) so replay stays deterministic.
 *
 * 1.5.0 (ext-008) — MINOR: gambling & crypto-exchange recognition. Four new
 * expense categories (gambling_wagering/casino/lottery, quasi_cash) and two
 * excluded outcomes (crypto_exchange, crypto_atm); a new detection tier
 * (HIGH_RISK_VERSION 1.0.0) that tags INFLOWS without ever calling them income
 * and carries a variable confidence model; new input fields (merchant_name,
 * reference, biller_name, biller_code) and output fields (direction,
 * matched_rule_id). Additive within taxonomy major 1 (TAXONOMY 1.3). Replay
 * determinism preserved: engine_version is stamped on every result.
 *
 * 1.4.0 (ext-007) — MINOR: four new expense categories (sacc_loan,
 * wage_advance, debt_collection, fines_penalties) with curated AU brand cues
 * (RULES 1.3.0) and MCC moves (MCC_TABLE 1.3.0 — 7322 → debt_collection,
 * 9211/9222/9223 → fines_penalties). Additive within taxonomy major 1
 * (TAXONOMY 1.2). Replay determinism preserved: engine_version is stamped on
 * every result, so a historical batch re-run on 1.3.0 reproduces exactly.
 *
 * 1.3.0 (ext-006) — MINOR, not patch: results move between categories
 * (recognised salary credits `uncategorised_credit` → `income`; directed
 * savings transfers `transfer` → `savings_deposit`/`savings_withdrawal`; retail
 * MCCs `other_expenses` → `general_retail`; BNPL brands `loan_repayment` →
 * `bnpl`). Replay determinism is preserved because engine_version is stamped on
 * every result — a historical batch re-run on 1.2.0 still reproduces exactly.
 */
export const ENGINE_VERSION = "1.7.0";

/**
 * The taxonomy version this engine build targets. Re-exported from the
 * authoritative package rather than restated, so the two can never drift; the
 * taxonomy itself (categories + classifications) is served by GET /v1/taxonomy
 * so consumers never hard-code it.
 */
export { TAXONOMY_VERSION } from "@moroku-enrich/taxonomy";
