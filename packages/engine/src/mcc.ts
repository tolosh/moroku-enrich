/**
 * MCC tier (spec §4 step 3) — ISO 18245 Merchant Category Code → taxonomy.
 *
 * A static, versioned table shipped in code (MCC_TABLE_VERSION). MCC is the
 * strongest deterministic signal and carries priority cues as merchant-level
 * facts: fuel 5541/5542 → vehicle_running regardless of "Coles Express"
 * (kickoff). Confidence is a flat 0.95 (spec §4).
 *
 * Completed against the verbatim 15-category taxonomy (ext-002 §5). Every target
 * is a real taxonomy id via `CATEGORY.*`. `classification` is NOT stored here: it
 * derives from the taxonomy default for the resolved category. Taxonomy v1 has no
 * travel/retail/personal-care categories, so those ISO groups map to
 * `other_expenses` (e.g. lodging 7011 → other_expenses, ext-002 deviation 4).
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
    // Eating/drinking + entertainment (kickoff: entertainment MCCs → dining_entertainment).
    codes: [
      "5811", "5812", "5813", "5814",
      "7832", "7841", "7829",
      "7922", "7929", "7911", "7997",
      "7996", "7998", "7999", "7933", "7992", "7941",
    ],
  },
  {
    category: CATEGORY.VEHICLE_RUNNING,
    // Fuel is the canonical priority cue (kickoff: 5541/5542 → vehicle_running).
    codes: ["5172", "5541", "5542", "5983", "5533", "5531", "5532", "7538", "7549", "7534", "7523"],
    note: "fuel 5541/5542 override 'Coles Express'-style merchant names",
  },
  {
    category: CATEGORY.TRANSPORT,
    codes: ["4111", "4112", "4121", "4131", "4784", "4789", "4011", "4304", "7512", "7513", "7519"],
  },
  {
    // 4900 is utilities proper. 4899 (cable/satellite/pay-TV/streaming) moved to
    // subscriptions below — real traffic (NETFLIX.COM, SPOTIFY AU) arrives on
    // 4899 and must NOT inflate essential spend (compliance: conservative posture).
    category: CATEGORY.UTILITIES,
    codes: ["4812", "4814", "4821", "4900"],
  },
  {
    // Digital subscriptions / streaming / continuity (discretionary). Shadow-mode
    // fix: 4899 streaming was classifying as utilities/essential at 0.95.
    category: CATEGORY.SUBSCRIPTIONS,
    codes: ["4899", "5815", "5816", "5817", "5818", "5968"],
  },
  {
    category: CATEGORY.INSURANCE,
    codes: ["5960", "6300", "6381", "6399"],
  },
  {
    category: CATEGORY.HEALTHCARE,
    codes: [
      "5122", "5292", "5295", "5912", "5975", "5976",
      "8011", "8021", "8031", "8041", "8042", "8043", "8049",
      "8050", "8062", "8071", "8099",
    ],
  },
  {
    category: CATEGORY.CLOTHING,
    codes: ["5611", "5621", "5631", "5641", "5651", "5655", "5661", "5681", "5691", "5697", "5698", "5699", "5948", "5949"],
  },
  {
    category: CATEGORY.EDUCATION,
    codes: ["8211", "8220", "8241", "8244", "8249", "8299", "8351"],
  },
  {
    category: CATEGORY.RENT,
    // Real-estate agents / property managers — rent (ext-002 §5 anchor 6513).
    codes: ["6513"],
  },
  {
    // ext-006: general retail / department / electronics / homewares / hobby —
    // lifted out of the other_expenses catch-all into a category of its own.
    // Classification is unchanged (both default `discretionary`), so no
    // affordability number moves; what changes is that `other_expenses` now
    // means "genuinely unclassified" rather than "retail plus everything else".
    category: CATEGORY.GENERAL_RETAIL,
    codes: [
      "5200", "5211", "5231", "5251", "5261", "5300", "5309", "5310", "5311", "5331",
      "5399", "5712", "5713", "5714", "5718", "5719", "5722", "5732", "5733", "5734",
      "5735", "5931", "5940", "5941", "5942", "5943", "5944", "5945", "5946", "5947",
      "5970", "5992", "5999",
    ],
  },
  {
    // Taxonomy still has no travel/personal-care/services/government categories
    // — these ISO groups fall to the discretionary catch-all.
    category: CATEGORY.OTHER_EXPENSES,
    codes: [
      // travel & lodging (deviation 4: lodging → other_expenses)
      "3000", "3501", "4411", "4457", "4511", "4722", "4723", "7011", "7012", "7032", "7033",
      // personal care & services
      "5977", "7230", "7297", "7298", "7210", "7211", "7216", "7251", "7261",
      // professional / business services
      "7276", "7277", "7311", "7333", "7338", "7339", "7372", "7392", "7393", "7399",
      "8111", "8911", "8931", "8999",
      // government / non-profit / misc
      "8398", "8641", "8651", "8661", "8675", "8699", "9211", "9222", "9223", "9311",
      "9399", "9402", "9405",
    ],
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
