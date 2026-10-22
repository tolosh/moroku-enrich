/**
 * High-risk flow detection (ext-008 / ENR-25) — gambling & crypto-exchange.
 *
 * A dedicated tier, like income.ts / savings.ts, evaluated BEFORE every other
 * tier in the chain (even exclusion/credit) so it can:
 *   - tag INFLOWS (gambling winnings, crypto sales) and keep them out of income;
 *   - tag deposits that arrive as a transfer / PayID / BPAY (which would
 *     otherwise be swallowed by the exclusion tier).
 *
 * It owns its own brands, MCCs and BPAY biller codes, and it is the one place in
 * the engine with a VARIABLE confidence model (spec §6). The generic mcc.ts and
 * rules.ts stay flat and are deliberately untouched.
 *
 * Internal precedence (spec §6: rules → MCC → LLM): a brand (or biller) match is
 * consulted first, then the MCC. A brand match sets the sub-category; the MCC
 * only refines confidence (brand + a consistent MCC → 0.95). A lottery brand
 * therefore yields `gambling_lottery` even on a wagering MCC, because the brand
 * wins — and the lottery brand rule is ordered ahead of the wagering rule so a
 * "TAB KENO" line is lottery, not wagering.
 *
 * Collisions are guarded with anchored patterns (spec §3): `TAB` only as
 * tabcorp / tabtouch / tab.com.au / tab limited (never TABLE/TABACCO); `crown`
 * only as crown melbourne|sydney|perth|casino|resorts|towers (not a Crown Street
 * café); `star` only as the star sydney|gold coast / star entertainment|casino|
 * city (not any merchant containing "star").
 *
 * Confidence (spec §6):
 *   brand + consistent MCC   0.95
 *   brand alone              0.80
 *   gambling MCC alone       0.80
 *   quasi-cash MCC alone     0.50
 *
 * Direction and the per-direction `excluded` decision are applied by the chain,
 * not here (this module is a pure signal detector).
 */
import { CATEGORY, NON_EXPENSE } from "./categories.js";
import type { CategoriseInput } from "./types.js";
import type { NormalisedMerchant } from "./normaliser.js";

export interface HighRiskHit {
  /** A gambling_* / quasi_cash / crypto_* category id. */
  category: string;
  /** Variable per spec §6 (0.95 / 0.80 / 0.50). */
  confidence: number;
  /** Brand rule id, biller id, or `mcc-<code>` — surfaced as matched_rule_id. */
  matchedRuleId: string;
}

const CONF_BRAND_AND_MCC = 0.95;
const CONF_BRAND_ALONE = 0.8;
const CONF_GAMBLING_MCC_ALONE = 0.8;
const CONF_QUASI_CASH_MCC_ALONE = 0.5;

interface BrandRule {
  id: string;
  pattern: RegExp;
  category: string;
}

/**
 * Brand rules, ordered — first match wins. Lottery is ahead of wagering so a
 * lottery brand always yields `gambling_lottery`. Crypto ATM is ahead of the
 * exchange rule so an ATM operator is not read as an exchange. Patterns run
 * against a lowercased haystack, so they are written lowercase and anchored.
 *
 * REPLACEABLE DATA: curated AU seeds, not an exhaustive register — validate and
 * extend against real Kanopi/Odyssey traffic. Keep in step with
 * HIGH_RISK_SEED_GROUPS below and the fixture set.
 */
const BRAND_RULES: readonly BrandRule[] = [
  {
    id: "G1-lottery",
    pattern: /\b(the lott|lotterywest|keno)\b/,
    category: CATEGORY.GAMBLING_LOTTERY,
  },
  {
    // `crown`/`star`/`treasury` are anchored to their venue forms to avoid
    // Crown Street / "star" cafés / the Treasury department.
    id: "G2-casino",
    pattern:
      /\b(crown (?:melbourne|sydney|perth|casino|resorts|towers)|the star (?:sydney|gold coast)|star (?:entertainment|casino|city)|skycity|treasury (?:brisbane|casino))\b/,
    category: CATEGORY.GAMBLING_CASINO,
  },
  {
    // `tab` only in anchored forms; `betr` word-bounded (won't hit "better").
    id: "G3-wagering",
    pattern:
      /\b(sportsbet|tabcorp|tabtouch|tab\.com\.au|tab limited|bet365|ladbrokes|neds|pointsbet|betfair|unibet|bluebet|betr|dabble|playup|topsport|palmerbet)\b/,
    category: CATEGORY.GAMBLING_WAGERING,
  },
  {
    id: "C1-crypto-atm",
    pattern: /\b(coinflip|localcoin)\b/,
    category: NON_EXPENSE.CRYPTO_ATM,
  },
  {
    id: "C2-crypto-exchange",
    pattern:
      /\b(coinspot|swyftx|independent reserve|btc markets|coinjar|digital surge|coinbase|binance|kraken|crypto\.com)\b/,
    category: NON_EXPENSE.CRYPTO_EXCHANGE,
  },
];

/** Gambling MCCs → sub-category (ISO 18245). */
const GAMBLING_MCC: Readonly<Record<string, string>> = {
  "7995": CATEGORY.GAMBLING_WAGERING, // betting incl. lottery tickets & casino chips
  "7800": CATEGORY.GAMBLING_LOTTERY, // government-owned lotteries
  "7801": CATEGORY.GAMBLING_CASINO, // government-licensed online casinos
  "7802": CATEGORY.GAMBLING_WAGERING, // government-licensed horse/dog racing
  "9754": CATEGORY.GAMBLING_WAGERING, // horse/dog racing, state lotteries
};

/** Quasi-cash MCCs — crypto_exchange only with a brand match, else quasi_cash. */
const QUASI_CASH_MCC: ReadonlySet<string> = new Set(["6050", "6051", "6540"]);

/**
 * BPAY biller codes → sub-category. A biller code is a brand-strength signal.
 * SEED — validate against real data: only Sportsbet's code (89672) is published
 * and verifiable today; collect the rest from each operator's deposit page or
 * from real transaction data. Codes are per-biller and can change.
 */
const BILLER_CODES: Readonly<Record<string, { category: string; id: string }>> = {
  "89672": { category: CATEGORY.GAMBLING_WAGERING, id: "biller-sportsbet-89672" },
};

function familyOf(category: string): "gambling" | "crypto" | "other" {
  if (category.startsWith("gambling_")) return "gambling";
  if (category.startsWith("crypto_")) return "crypto";
  return "other";
}

/**
 * Detect a gambling/crypto flow. Pure: returns the category, a variable
 * confidence and the matched rule id, or undefined. The chain applies direction
 * and the per-direction `excluded` decision.
 */
export function detectHighRiskFlow(
  merchant: NormalisedMerchant,
  input: CategoriseInput,
): HighRiskHit | undefined {
  const haystack = [
    input.source_category_description,
    merchant.match_key,
    input.merchant_name,
    input.reference,
    input.biller_name,
  ]
    .filter((s): s is string => Boolean(s))
    .join(" ")
    .toLowerCase();

  const mcc = input.mcc?.trim();
  const gamblingMcc = mcc ? GAMBLING_MCC[mcc] : undefined;
  const isQuasiMcc = mcc ? QUASI_CASH_MCC.has(mcc) : false;

  // 1. Brand (regex), then BPAY biller code — both brand-strength. First wins.
  let brand: { category: string; ruleId: string } | undefined;
  for (const rule of BRAND_RULES) {
    if (rule.pattern.test(haystack)) {
      brand = { category: rule.category, ruleId: rule.id };
      break;
    }
  }
  if (!brand && input.biller_code) {
    const b = BILLER_CODES[input.biller_code.trim()];
    if (b) brand = { category: b.category, ruleId: b.id };
  }

  if (brand) {
    const fam = familyOf(brand.category);
    const consistentMcc =
      (fam === "gambling" && gamblingMcc !== undefined) || (fam === "crypto" && isQuasiMcc);
    return {
      category: brand.category,
      confidence: consistentMcc ? CONF_BRAND_AND_MCC : CONF_BRAND_ALONE,
      matchedRuleId: brand.ruleId,
    };
  }

  // 2. MCC alone — no brand. Gambling MCC keeps its sub-category; quasi-cash
  //    MCCs (no crypto brand) fall to the low-confidence quasi_cash bucket.
  if (gamblingMcc) {
    return { category: gamblingMcc, confidence: CONF_GAMBLING_MCC_ALONE, matchedRuleId: `mcc-${mcc}` };
  }
  if (isQuasiMcc) {
    return { category: CATEGORY.QUASI_CASH, confidence: CONF_QUASI_CASH_MCC_ALONE, matchedRuleId: `mcc-${mcc}` };
  }

  return undefined;
}

/**
 * Canonical brand display names grouped by category, for the merchant seed
 * (scripts/seed-merchants.ts). One source of truth with BRAND_RULES above —
 * keep them in step. The seed normalises each name to its match_key.
 */
export interface HighRiskSeedGroup {
  category: string;
  brands: readonly string[];
}

export const HIGH_RISK_SEED_GROUPS: readonly HighRiskSeedGroup[] = [
  {
    category: CATEGORY.GAMBLING_LOTTERY,
    brands: ["The Lott", "Lotterywest", "Keno"],
  },
  {
    category: CATEGORY.GAMBLING_CASINO,
    brands: [
      "Crown Melbourne",
      "Crown Sydney",
      "Crown Perth",
      "The Star Sydney",
      "The Star Gold Coast",
      "Star Entertainment",
      "SkyCity Adelaide",
      "Treasury Brisbane",
    ],
  },
  {
    category: CATEGORY.GAMBLING_WAGERING,
    brands: [
      "Sportsbet",
      "Tabcorp",
      "TABtouch",
      "bet365",
      "Ladbrokes",
      "Neds",
      "PointsBet",
      "Betfair",
      "Unibet",
      "BlueBet",
      "Betr",
      "Dabble",
      "PlayUp",
      "TopSport",
      "Palmerbet",
    ],
  },
  {
    category: NON_EXPENSE.CRYPTO_ATM,
    brands: ["Coinflip", "Localcoin"],
  },
  {
    category: NON_EXPENSE.CRYPTO_EXCHANGE,
    brands: [
      "CoinSpot",
      "Swyftx",
      "Independent Reserve",
      "BTC Markets",
      "CoinJar",
      "Digital Surge",
      "Coinbase",
      "Binance",
      "Kraken",
      "Crypto.com",
    ],
  },
];
