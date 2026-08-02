/**
 * issue-tenant-key.ts (ext-001 §2) — create a tenant key.
 *
 *   npx tsx scripts/issue-tenant-key.ts <name> [--plan internal|trial|commercial]
 *     [--env test|live] [--allow-external] [--tenant-id id] [--quota n]
 *     [--contact email] [--stage dev] [--region ap-southeast-2] [--table name]
 *
 * Stores the SHA-256 hash only; prints the plaintext key to stdout exactly once
 * (not recoverable). Defaults to `--plan internal --env live`; refuses
 * trial/commercial plans unless `--allow-external` is passed (the MVP gate).
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  assertPlanAllowed,
  buildTenantRecord,
  newTenantKey,
  ENVIRONMENTS,
  PLANS,
  type Environment,
  type Plan,
} from "@moroku-enrich/service-lib";
import { parseArgs, slug } from "./args.js";

async function main(): Promise<void> {
  const { positionals, flags, bools } = parseArgs(process.argv.slice(2));
  const name = positionals[0];
  if (!name) {
    console.error("usage: issue-tenant-key <name> [--plan] [--env] [--allow-external] …");
    process.exit(2);
  }

  const plan = (flags["plan"] ?? "internal") as Plan;
  const environment = (flags["env"] ?? "live") as Environment;
  if (!PLANS.includes(plan)) throw new Error(`invalid --plan '${plan}'`);
  if (!ENVIRONMENTS.includes(environment)) throw new Error(`invalid --env '${environment}'`);

  // MVP access gate — refuses external plans unless explicitly allowed.
  assertPlanAllowed(plan, bools.has("allow-external"));

  const stage = flags["stage"] ?? "dev";
  const region = flags["region"] ?? process.env.AWS_REGION ?? "ap-southeast-2";
  const table = flags["table"] ?? process.env.TABLE_TENANTS ?? `moroku-enrich-${stage}-tenants`;
  const tenant_id = flags["tenant-id"] ?? slug(name);
  const quota = Number(flags["quota"] ?? "1000000");

  const { key, key_hash } = newTenantKey(environment);
  const record = buildTenantRecord({
    key_hash,
    tenant_id,
    name,
    plan,
    environment,
    quota,
    created_at: new Date().toISOString(),
    ...(flags["contact"] ? { contact_email: flags["contact"] } : {}),
  });

  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  await doc.send(
    new PutCommand({
      TableName: table,
      Item: record,
      ConditionExpression: "attribute_not_exists(key_hash)",
    }),
  );

  console.error("⚠  Store this key now — it is NOT recoverable (only its hash is stored):");
  console.log(key);
  console.error(
    JSON.stringify(
      { tenant_id, plan, environment, key_hash, table, region, status: "active" },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
