/**
 * MCC tier (spec §4 step 3) — ISO 18245 Merchant Category Code → taxonomy.
 *
 * A static, versioned table shipped in code (MCC_TABLE_VERSION). MCC is the
 * strongest deterministic signal and carries priority cues as merchant-level
 * facts: fuel 5541/5542 → vehicle_running regardless of "Coles Express"
 * (kickoff). Confidence is a flat 0.95 (spec §4).
 *
 * Every target is a `CATEGORY.*` reference, not a literal, so the verbatim
 * Kanopi ids slot in with no change to this table's structure or logic
 * (decision §9.1). The set below is a representative, extensible cross-section
 * of ISO 18245 — organised by concept so filling it out to the full ~300 rows
 * is additive. `classification` is intentionally NOT stored here: it derives
 * from the taxonomy default for the resolved category, so it, too, becomes
 * correct automatically once EXPENSE_CATEGORIES lands.
 */
import { CATEGORY, type CategoryRef } from "./categories.js";
import { MCC_TABLE_VERSION } from "./version.js";

/** Flat confidence for an MCC hit (spec §4 step 3). */
export const MCC_CONFIDENCE = 0.95;

interface MccGroup {
  category: CategoryRef;
  /** ISO 18245 codes mapping to this category. */
  codes: readonly string[];
  /** Optional note (e.g. priority cue) for auditability. */
  note?: string;
}

const MCC_GROUPS: readonly MccGroup[] = [
  {
    category: CATEGORY.GROCERIES,
    codes: ["5411", "5422", "5441", "5451", "5462", "5499"],
  },
  {
    category: CATEGORY.DINING_ENTERTAINMENT,
    // Restaurants/bars/fast-food + entertainment MCCs (kickoff: → dining_entertainment).
    codes: [
      "5811", "5812", "5813", "5814", // eating & drinking places
      "7832", "7841", // cinemas / video
      "7922", "7929", "7911", // theatrical, bands, dance
      "7996", "7998", "7999", // amusement, aquariums, recreation
      "7933", "7992", // bowling, golf courses
    ],
  },
  {
    category: CATEGORY.VEHICLE_RUNNING,
    // Fuel is the canonical priority cue (kickoff: 5541/5542 → vehicle_running).
    codes: ["5172", "5541", "5542", "5983", "5533", "7538", "7549", "7523"],
    note: "fuel 5541/5542 override 'Coles Express'-style merchant names",
  },
  {
    category: CATEGORY.TRANSPORT,
    codes: ["4111", "4112", "4121", "4131", "4784", "4789"],
  },
  {
    category: CATEGORY.TRAVEL,
    codes: ["4511", "4722", "7011", "7512", "7513", "4411", "4457"],
  },
  {
    category: CATEGORY.UTILITIES,
    codes: ["4812", "4814", "4899", "4900"],
  },
  {
    category: CATEGORY.HEALTH_MEDICAL,
    codes: [
      "5122", "5912", // pharmacy / drugs
      "8011", "8021", "8031", "8041", "8042", "8043", "8049",
      "8062", "8071", "8099",
    ],
  },
  {
    category: CATEGORY.SHOPPING_RETAIL,
    codes: ["5300", "5310", "5311", "5331", "5399", "5722", "5732", "5734", "5735", "5942", "5945"],
  },
  {
    category: CATEGORY.CLOTHING,
    codes: ["5611", "5621", "5631", "5641", "5651", "5655", "5661", "5691", "5699", "5948"],
  },
  {
    category: CATEGORY.HOME_HARDWARE,
    codes: ["5200", "5211", "5231", "5251", "5261", "5712", "5713", "5714", "5719"],
  },
  {
    category: CATEGORY.PERSONAL_CARE,
    codes: ["5977", "7230", "7297", "7298"],
  },
  {
    category: CATEGORY.EDUCATION,
    codes: ["8211", "8220", "8241", "8244", "8249", "8299"],
  },
  {
    category: CATEGORY.INSURANCE,
    codes: ["5960", "6300", "6381"],
  },
  {
    category: CATEGORY.PROFESSIONAL_SERVICES,
    codes: ["7276", "7392", "7399", "8111", "8911", "8931", "8999"],
  },
  {
    category: CATEGORY.GOVERNMENT,
    codes: ["9211", "9222", "9223", "9311", "9399", "9402"],
  },
  {
    category: CATEGORY.CHARITY_GIFTS,
    codes: ["5947", "8398"],
  },
];

/** MCC → category id. Built once at module load. */
export const MCC_TABLE: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const group of MCC_GROUPS) {
    for (const code of group.codes) {
      if (map.has(code)) {
        throw new Error(`MCC ${code} mapped twice (${map.get(code)} vs ${group.category})`);
      }
      map.set(code, group.category);
    }
  }
  return map;
})();

/** Version of this table (rolls up into engine_version). */
export const mccTableVersion = MCC_TABLE_VERSION;

export interface MccHit {
  category: string;
  confidence: number;
}

/** Look up an MCC. Returns the mapped category at confidence 0.95, or undefined. */
export function lookupMcc(mcc: string | undefined): MccHit | undefined {
  if (!mcc) return undefined;
  const category = MCC_TABLE.get(mcc.trim());
  if (!category) return undefined;
  return { category, confidence: MCC_CONFIDENCE };
}
