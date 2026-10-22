/**
 * seed-merchants.ts (ext-007 / ENR-24) — seed `merchants_global` with the
 * curated high-risk-lending brand lists at dictionary strength.
 *
 *   npx tsx scripts/seed-merchants.ts [--stage dev] [--region …]
 *     [--apply]   (default is a DRY RUN — prints the plan, writes nothing)
 *
 * The P4–P7 priority cues (packages/engine/src/rules.ts) already catch these
 * brands at the rules tier (confidence 0.70). This seed lifts the canonical
 * brands to the dictionary tier (confidence 0.95, source "seed"), which sits
 * ABOVE rules in the chain — so a known SACC/wage-advance/debt-collector/fines
 * merchant resolves with dictionary confidence and a stable canonical name
 * rather than the 0.70 regex floor. Brands the seed does not list still fall to
 * the rule, so the two layers are complementary.
 *
 * Idempotent: a row is written under its normalised match_key, so re-running
 * overwrites in place. Seeded rows carry source "seed" and never a
 * correction_count, so promotion/learning treats them as authoritative floor,
 * not as corroborated user corrections. Requires DynamoDB PutItem on the
 * deploy identity.
 *
 * REPLACEABLE DATA: these are canonical AU brand seeds, not an exhaustive
 * register. Extend from real Kanopi/Odyssey traffic — keep this list and the
 * P4–P7 regexes in rules.ts in step.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { CATEGORY, normaliseMerchant } from "@moroku-enrich/engine";
import { parseArgs } from "./args.js";

/** Confidence for a seeded merchant — dictionary strength, above the rules floor. */
const SEED_CONFIDENCE = 0.95;

interface SeedGroup {
  category: string;
  /** Canonical brand display names; each is normalised to its match_key. */
  brands: readonly string[];
}

/**
 * Curated AU brands, grouped by category. The display name is what a human
 * reads; the normaliser derives the match_key the chain looks up. Keep each
 * group aligned with its P-rule in rules.ts.
 */
const SEED_GROUPS: readonly SeedGroup[] = [
  {
    // P4-sacc
    category: CATEGORY.SACC_LOAN,
    brands: [
      "Nimble",
      "Cash Converters",
      "Wallet Wizard",
      "MoneyMe",
      "Sunshine Loans",
      "Credit24",
      "Ferratum",
      "Cigno",
      "Jacaranda Finance",
      "Fair Go Finance",
      "Swoosh Finance",
      "Speckle",
      "Fundo",
      "Beyond Cash",
      "Good2Go",
    ],
  },
  {
    // P5-wage-advance
    category: CATEGORY.WAGE_ADVANCE,
    brands: [
      "Beforepay",
      "MyPayNow",
      "CommBank AdvancePay",
      "Earnd",
      "WageTap",
      "Payactiv",
      "Wagestream",
    ],
  },
  {
    // P6-debt-collection
    category: CATEGORY.DEBT_COLLECTION,
    brands: [
      "Baycorp",
      "Credit Corp",
      "Panthera",
      "Milton Graham",
      "Pioneer Credit",
      "Collection House",
      "Recoveries Corp",
      "Complete Credit Solutions",
      "Prushka",
      "Probe Group",
      "InDebted",
      "Lion Finance",
    ],
  },
  {
    // P7-fines
    category: CATEGORY.FINES_PENALTIES,
    brands: [
      "Revenue NSW",
      "Fines Victoria",
      "State Debt Recovery",
      "Revenue SA",
    ],
  },
];

type SeedRow = {
  match_key: string;
  category: string;
  canonical_name: string;
  confidence: number;
  source: "seed";
  updated_at: string;
};

/** Build the rows to write, de-duplicating any brands that collapse to one key. */
function buildRows(): SeedRow[] {
  const byKey = new Map<string, SeedRow>();
  const now = new Date().toISOString();
  for (const group of SEED_GROUPS) {
    for (const brand of group.brands) {
      const match_key = normaliseMerchant(brand).match_key;
      if (!match_key) {
        console.warn(`  (skipped "${brand}" — normalises to empty key)`);
        continue;
      }
      const existing = byKey.get(match_key);
      if (existing && existing.category !== group.category) {
        throw new Error(
          `seed collision on match_key "${match_key}": ${existing.category} vs ${group.category} (${brand})`,
        );
      }
      byKey.set(match_key, {
        match_key,
        category: group.category,
        canonical_name: brand,
        confidence: SEED_CONFIDENCE,
        source: "seed",
        updated_at: now,
      });
    }
  }
  return [...byKey.values()];
}

async function main(): Promise<void> {
  const { flags, bools } = parseArgs(process.argv.slice(2));
  const stage = flags["stage"] ?? "dev";
  const region = flags["region"] ?? process.env.AWS_REGION ?? "ap-southeast-2";
  const apply = bools.has("apply");
  const table = flags["merchants-table"] ?? `moroku-enrich-${stage}-merchants-global`;
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

  const rows = buildRows();
  console.log(`\n[${table}] seeding ${rows.length} merchant rows (source "seed", conf ${SEED_CONFIDENCE})`);
  for (const r of rows) {
    console.log(`  ${r.match_key.padEnd(28)} -> ${r.category}  (${r.canonical_name})`);
  }
  if (!apply) {
    console.log(`\n  (dry run — pass --apply to write)`);
    return;
  }
  for (const r of rows) {
    await doc.send(new PutCommand({ TableName: table, Item: r }));
  }
  console.log(`\n  applied ${rows.length} rows.`);
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
