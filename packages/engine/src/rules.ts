/**
 * Rules tier (spec §4 step 5; ext-002 §3) — the merged legacy floor at
 * confidence 0.7.
 *
 * The two drifted Kanopi edge-function chains are merged here into one ordered
 * chain (union of both brand lists). Two priority cues (fuel, cinema) evaluate
 * before the brand rules, exactly as in the baseline. Ordered — first match
 * wins. A rule matches on its category code OR its description regex.
 *
 * Haystack = source_category_description + the post-normalisation merchant key,
 * lowercased. ALL bare-token matches use word boundaries — the old chains used
 * substring `includes`, the source of the "current" → rent class of bug
 * (ext-002 deviation 1). Classification for a hit is the category's taxonomy
 * default, resolved by the chain.
 */
import { CATEGORY } from "./categories.js";
import type { CategoriseInput } from "./types.js";
import type { NormalisedMerchant } from "./normaliser.js";

export interface Rule {
  /** Stable id for audit / tests. */
  id: string;
  /** Source-category codes that trigger this rule (matched case-insensitively). */
  codes?: readonly string[];
  /** Description regex (matched against the lowercased haystack). */
  pattern?: RegExp;
  /** Target category — a CATEGORY.* reference. */
  category: string;
}

/** Confidence stamped on a rules-tier hit (spec §4 step 5). */
export const RULES_CONFIDENCE = 0.7;

/**
 * The merged Kanopi ruleset, ordered. P1/P2 are the priority cues (evaluated
 * first); rules 1–14 are the brand chain. First match wins (ext-002 §3).
 */
export const RULES: readonly Rule[] = [
  // --- Priority cues (outrank the brand rules) ---
  { id: "P1-fuel", pattern: /\b(fuel|petrol|service station)\b/, category: CATEGORY.VEHICLE_RUNNING },
  {
    id: "P2-cinema",
    pattern: /\b(cinema|cinemas|hoyts|event cinemas|village cinemas|ticketek|ticketmaster)\b/,
    category: CATEGORY.DINING_ENTERTAINMENT,
  },

  // --- Brand chain ---
  { id: "1-mortgage", codes: ["MRTG"], pattern: /\b(mortgage|home loan)\b/, category: CATEGORY.MORTGAGE },
  { id: "2-rent", codes: ["RNT"], pattern: /\brent(al)?\b/, category: CATEGORY.RENT },
  {
    id: "3-loan",
    pattern: /\b(personal loan|car loan|loan repayment|afterpay|zip pay|zippay|latitude|plenti|harmoney)\b/,
    category: CATEGORY.LOAN_REPAYMENT,
  },
  {
    id: "4-groceries",
    codes: ["GROC"],
    pattern: /\b(grocery|grocer|woolworths|coles|aldi|iga|foodworks|harris farm)\b/,
    category: CATEGORY.GROCERIES,
  },
  {
    id: "5-utilities",
    // OTHD ("other debits") removed (ext-004 §1): it is a DocuScan catch-all
    // code carrying no category signal, and it was short-circuiting to utilities
    // before description matching (the Opal bug). Codes match only when specific.
    // Audit: OTHD was the only catch-all in the chain; all other codes (MRTG,
    // RNT, GROC, UTIL, UTLW, VHFL, TRVL, INSDC, SRTA, EDUCP, STRM, REST, CLTH,
    // HLTH) are category-specific and retained.
    codes: ["UTIL", "UTLW"],
    pattern:
      /\b(utility|electric|electricity|energy|gas|water|internet|broadband|phone|mobile|telstra|optus|vodafone|agl|origin|energyaustralia|red energy)\b/,
    category: CATEGORY.UTILITIES,
  },
  {
    id: "6-fuel-brands",
    codes: ["VHFL"],
    pattern: /\b(diesel|caltex|shell|bp|ampol|7-eleven fuel|united petroleum)\b/,
    category: CATEGORY.VEHICLE_RUNNING,
  },
  {
    id: "7-transport",
    codes: ["TRVL"],
    pattern:
      /\b(transport|uber|taxi|didi|ola|ferry|train|bus|tram|opal|myki|translink|toll|linkt|eastlink)\b/,
    category: CATEGORY.TRANSPORT,
  },
  {
    id: "8-insurance",
    codes: ["INSDC"],
    pattern: /\b(insurance|nrma|aami|allianz|budget direct|youi|medibank|bupa|hcf|nib)\b/,
    category: CATEGORY.INSURANCE,
  },
  {
    id: "9-strata",
    codes: ["SRTA"],
    pattern: /\b(strata|body corporate|owners corporation)\b/,
    category: CATEGORY.STRATA,
  },
  {
    id: "10-education",
    codes: ["EDUCP"],
    // Bare `fees` removed (ext-002 deviation 2).
    pattern: /\b(school|education|tuition|tafe|university|childcare|kindergarten)\b/,
    category: CATEGORY.EDUCATION,
  },
  {
    id: "11-subscriptions",
    codes: ["STRM"],
    pattern:
      /\b(netflix|spotify|stan|binge|kayo|disney|youtube premium|apple\.com\/bill|amazon prime|subscription|stream)\b/,
    category: CATEGORY.SUBSCRIPTIONS,
  },
  {
    id: "12-dining",
    codes: ["REST"],
    // hotel/bar stay in dining_entertainment (ext-002 deviation 4).
    pattern:
      /\b(restaurant|cafe|coffee|hotel|bar|pub|takeaway|doordash|uber eats|menulog|deliveroo|mcdonald|kfc|hungry jack|domino)\b/,
    category: CATEGORY.DINING_ENTERTAINMENT,
  },
  {
    id: "13-clothing",
    codes: ["CLTH"],
    pattern: /\b(clothing|fashion|myer|david jones|kmart|target|big w|uniqlo|cotton on)\b/,
    category: CATEGORY.CLOTHING,
  },
  {
    id: "14-healthcare",
    codes: ["HLTH"],
    pattern:
      /\b(medical|health|pharmacy|chemist|doctor|dental|dentist|physio|optometrist|terry white|priceline)\b/,
    category: CATEGORY.HEALTHCARE,
  },
];

export interface RuleHit {
  category: string;
  ruleId: string;
}

/**
 * Apply the rules chain. A rule matches on its source-category code OR its
 * description regex against the lowercased haystack (source_category_description
 * + the normalised merchant key). First match wins.
 */
export function applyRules(
  merchant: NormalisedMerchant,
  input: CategoriseInput,
): RuleHit | undefined {
  const code = input.source_category_code?.trim().toUpperCase();
  const haystack = `${input.source_category_description ?? ""} ${merchant.match_key}`
    .toLowerCase()
    .trim();

  for (const rule of RULES) {
    if (code && rule.codes && rule.codes.includes(code)) {
      return { category: rule.category, ruleId: rule.id };
    }
    if (rule.pattern && rule.pattern.test(haystack)) {
      return { category: rule.category, ruleId: rule.id };
    }
  }
  return undefined;
}
