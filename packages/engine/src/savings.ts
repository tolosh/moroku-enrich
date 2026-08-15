/**
 * Savings subtyping (ext-006) — splits `transfer` into `savings_deposit` /
 * `savings_withdrawal` where, and only where, the direction is unambiguous.
 *
 * Why this sits inside the exclusion tier rather than beside it: a savings
 * movement IS a transfer. It keeps `excluded: true`, so spend denominators,
 * `confident_pct` and the fallback-rate alarm are all untouched — the only
 * change is that the caller can now tell an inflow from an outflow.
 *
 * ## Direction is not the sign of the amount
 *
 * This is the trap. `TRANSFER TO SAVINGS -500` seen on a *transaction* account
 * is a deposit INTO savings, even though the amount is negative; the same
 * movement seen on the *savings* account is +500. So:
 *
 *   - `account_type: "savings"` → the sign is authoritative (this row IS the
 *     savings account: credit = deposit, debit = withdrawal).
 *   - otherwise → the description's direction word is authoritative
 *     ("to savings" = deposit, "from savings" = withdrawal) and the sign is
 *     the counterparty's view, so it is deliberately ignored.
 *
 * ## `account_type` alone must never trigger subtyping
 *
 * A savings account carries card purchases, interest and fees as well as
 * transfers. Treating every row on it as a savings movement would silently
 * destroy expense categorisation for any caller that sends savings-account
 * data. So `account_type` only ever refines the direction of a movement the
 * chain has ALREADY established is a transfer (via the exclusion tier) or that
 * the description says in words is a savings movement. It never promotes an
 * ordinary transaction into one.
 *
 * Anything savings-ish whose direction cannot be established stays `transfer`.
 * Guessing would put fabricated inflows into a savings measure, which is
 * exactly the class of error the conservative posture exists to prevent.
 */
import { NON_EXPENSE } from "./categories.js";
import type { CategoriseInput } from "./types.js";

/** Account type marking the row as the savings account itself. */
const SAVINGS_ACCOUNT_TYPE = "savings";

/** The savings nouns a direction word may attach to. */
const SAVINGS_NOUN = "(?:SAVINGS?|SAVER|SAVINGS ACCOUNT|GOAL)";

/**
 * Direction cues. Word-boundaried, and the gap between the direction word and
 * the noun is bounded so "FROM AMAZON ... GOAL" style coincidences can't match.
 */
const TO_SAVINGS = new RegExp(`\\b(?:TO|INTO)\\b[^A-Z0-9]{0,12}\\b${SAVINGS_NOUN}\\b`);
const FROM_SAVINGS = new RegExp(
  `\\b(?:FROM|OUT\\s+OF)\\b[^A-Z0-9]{0,12}\\b${SAVINGS_NOUN}\\b`,
);

/** True when the row is the savings account itself. */
function isSavingsAccount(input: CategoriseInput): boolean {
  return input.account_type?.trim().toLowerCase() === SAVINGS_ACCOUNT_TYPE;
}

/**
 * True when the DESCRIPTION states a savings movement in words ("transfer to
 * savings", "out of goal saver"). This is the only cue allowed to promote a
 * transaction the exclusion tier did not already catch — `\bTRANSFER\b` misses
 * strings like "AUTO SAVE TO SAVINGS", and those are real deposits.
 *
 * Note this is deliberately NOT satisfied by `account_type` alone.
 */
export function isExplicitSavingsMovement(input: CategoriseInput): boolean {
  const desc = (input.description ?? "").toUpperCase();
  return TO_SAVINGS.test(desc) || FROM_SAVINGS.test(desc);
}

/**
 * Resolve a savings movement to its directed outcome, or `undefined` when the
 * direction cannot be established (caller then falls back to plain `transfer`).
 *
 * Only meaningful for a transaction the caller has already established is a
 * transfer or an explicit savings movement — it does not gate on that itself.
 */
export function resolveSavingsOutcome(input: CategoriseInput): string | undefined {
  // 1 — The row IS the savings account: the sign is authoritative.
  if (isSavingsAccount(input) && typeof input.amount === "number" && input.amount !== 0) {
    return input.amount > 0 ? NON_EXPENSE.SAVINGS_DEPOSIT : NON_EXPENSE.SAVINGS_WITHDRAWAL;
  }

  // 2 — Seen from the other side (or with no usable amount): only the
  //     description can tell us direction. The sign is the counterparty's view
  //     and is intentionally not consulted here.
  const desc = (input.description ?? "").toUpperCase();
  if (TO_SAVINGS.test(desc)) return NON_EXPENSE.SAVINGS_DEPOSIT;
  if (FROM_SAVINGS.test(desc)) return NON_EXPENSE.SAVINGS_WITHDRAWAL;

  // 3 — Savings-ish but directionless (e.g. "SAVINGS TFR"): stay `transfer`.
  return undefined;
}
