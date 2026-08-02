/**
 * revoke-tenant-key.ts (ext-001 §2) — suspend a key or all of a tenant's keys.
 *
 *   npx tsx scripts/revoke-tenant-key.ts <key_hash|tenant_id>
 *     [--stage dev] [--region ap-southeast-2] [--table name]
 *
 * A 64-hex argument is treated as a `key_hash` (one row); anything else as a
 * `tenant_id` (all its rows via the GSI). Sets `status: suspended`. The
 * authorizer denies suspended tenants on any cache miss; a key revoked mid-
 * window stays valid until the ~5-min authorizer cache TTL expires (documented
 * lag — see services/authorizer/src/authorize.ts).
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { parseArgs } from "./args.js";

const IS_KEY_HASH = /^[0-9a-f]{64}$/;

async function suspend(
  doc: DynamoDBDocumentClient,
  table: string,
  keyHash: string,
): Promise<void> {
  await doc.send(
    new UpdateCommand({
      TableName: table,
      Key: { key_hash: keyHash },
      UpdateExpression: "SET #s = :suspended, revoked_at = :t",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":suspended": "suspended", ":t": new Date().toISOString() },
      ConditionExpression: "attribute_exists(key_hash)",
    }),
  );
}

async function main(): Promise<void> {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const target = positionals[0];
  if (!target) {
    console.error("usage: revoke-tenant-key <key_hash|tenant_id> [--stage] [--region] [--table]");
    process.exit(2);
  }

  const stage = flags["stage"] ?? "dev";
  const region = flags["region"] ?? process.env.AWS_REGION ?? "ap-southeast-2";
  const table = flags["table"] ?? process.env.TABLE_TENANTS ?? `moroku-enrich-${stage}-tenants`;

  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

  if (IS_KEY_HASH.test(target)) {
    await suspend(doc, table, target);
    console.error(JSON.stringify({ revoked: 1, key_hash: target }, null, 2));
    return;
  }

  // tenant_id → suspend every key row via the GSI.
  const res = await doc.send(
    new QueryCommand({
      TableName: table,
      IndexName: "tenant_id-index",
      KeyConditionExpression: "tenant_id = :tid",
      ExpressionAttributeValues: { ":tid": target },
    }),
  );
  const rows = res.Items ?? [];
  for (const row of rows) await suspend(doc, table, String(row["key_hash"]));
  console.error(JSON.stringify({ revoked: rows.length, tenant_id: target }, null, 2));
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
