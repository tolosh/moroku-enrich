/**
 * migrate-normaliser-keys.ts (ext-004 §4) — one-time key migration after a
 * normaliser bump.
 *
 *   npx tsx scripts/migrate-normaliser-keys.ts [--stage dev] [--region …]
 *     [--apply]   (default is a DRY RUN — prints the plan, writes nothing)
 *
 * Re-normalises every key in `llm_cache` and `merchants_global`; rows whose key
 * changes are rewritten under the new key, and rows that collapse to the same
 * new key are merged keeping the highest confidence (losers deleted, merges
 * logged). Idempotent: a second run is a no-op. Requires DynamoDB
 * Scan/PutItem/DeleteItem on the deploy identity.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { normaliseMerchant } from "@moroku-enrich/engine";
import { planKeyMigration, type MigrationRow } from "@moroku-enrich/service-lib";
import { parseArgs } from "./args.js";

type Item = Record<string, unknown>;

async function scanAll(
  doc: DynamoDBDocumentClient,
  table: string,
): Promise<Item[]> {
  const items: Item[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new ScanCommand({ TableName: table, ExclusiveStartKey }),
    );
    items.push(...((res.Items as Item[]) ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

/** Build migration rows for one table given how to derive its key parts. */
function rowsFor(
  items: Item[],
  keyAttr: string,
  matchKeyAttr: string,
  rebuildKey: (newMatchKey: string, item: Item) => string,
): MigrationRow<Item>[] {
  return items.map((item) => {
    const oldMatchKey = String(item[matchKeyAttr] ?? "");
    const newMatchKey = normaliseMerchant(oldMatchKey).match_key;
    const newKey = rebuildKey(newMatchKey, item);
    return {
      key: String(item[keyAttr]),
      newKey,
      confidence: Number(item["confidence"] ?? 0),
      item: { ...item, [keyAttr]: newKey, [matchKeyAttr]: newMatchKey },
    };
  });
}

async function migrateTable(
  doc: DynamoDBDocumentClient,
  table: string,
  keyAttr: string,
  matchKeyAttr: string,
  rebuildKey: (newMatchKey: string, item: Item) => string,
  apply: boolean,
): Promise<void> {
  const items = await scanAll(doc, table);
  const plan = planKeyMigration(rowsFor(items, keyAttr, matchKeyAttr, rebuildKey));
  console.log(
    `\n[${table}] scanned ${items.length}; writes ${plan.writes.length}, deletes ${plan.deletes.length}, merges ${plan.merges.length}`,
  );
  for (const m of plan.merges) {
    console.log(`  merge -> ${m.newKey}: kept ${m.kept}, dropped [${m.dropped.join(", ")}]`);
  }
  if (!apply) {
    console.log(`  (dry run — pass --apply to write)`);
    return;
  }
  for (const w of plan.writes) {
    await doc.send(new PutCommand({ TableName: table, Item: w.item }));
  }
  for (const key of plan.deletes) {
    await doc.send(new DeleteCommand({ TableName: table, Key: { [keyAttr]: key } }));
  }
  console.log(`  applied.`);
}

async function main(): Promise<void> {
  const { flags, bools } = parseArgs(process.argv.slice(2));
  const stage = flags["stage"] ?? "dev";
  const region = flags["region"] ?? process.env.AWS_REGION ?? "ap-southeast-2";
  const apply = bools.has("apply");
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

  // llm_cache: cache_key = <match_key>#<prompt_version>; rebuild from the stored
  // prompt_version so the suffix is preserved.
  await migrateTable(
    doc,
    flags["llm-cache-table"] ?? `moroku-enrich-${stage}-llm-cache`,
    "cache_key",
    "match_key",
    (newMatchKey, item) => `${newMatchKey}#${String(item["prompt_version"] ?? "1")}`,
    apply,
  );

  // merchants_global: PK is match_key itself.
  await migrateTable(
    doc,
    flags["merchants-table"] ?? `moroku-enrich-${stage}-merchants-global`,
    "match_key",
    "match_key",
    (newMatchKey) => newMatchKey,
    apply,
  );
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
