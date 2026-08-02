/**
 * Tenant key issuance — pure logic shared by the admin scripts (ext-001 §2).
 *
 * Keys are only ever stored SHA-256-hashed; the plaintext is returned once to
 * the caller and never persisted (ext-001 §3 test 2). The plan gate
 * (`assertPlanAllowed`) is the MVP access control: only `internal` tenants can
 * be created unless `--allow-external` is explicitly passed (ext-001 §2).
 */
import { createHash, randomBytes } from "node:crypto";

export type Plan = "internal" | "trial" | "commercial";
export type Environment = "test" | "live";
export type TenantStatus = "active" | "suspended";

export const PLANS: readonly Plan[] = ["internal", "trial", "commercial"];
export const ENVIRONMENTS: readonly Environment[] = ["test", "live"];

/** SHA-256 hex of a bearer key. Never store or log the plaintext. */
export function hashTenantKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Generate a fresh key with the environment-correct prefix + its hash. */
export function newTenantKey(environment: Environment): { key: string; key_hash: string } {
  const secret = randomBytes(24).toString("base64url");
  const key = `mk_${environment}_${secret}`;
  return { key, key_hash: hashTenantKey(key) };
}

/**
 * MVP access gate: refuse non-internal plans unless external issuance is
 * explicitly allowed. Throws (never returns) on a disallowed plan.
 */
export function assertPlanAllowed(plan: Plan, allowExternal: boolean): Plan {
  if (plan !== "internal" && !allowExternal) {
    throw new Error(
      `plan '${plan}' is external; pass --allow-external to issue non-internal keys`,
    );
  }
  return plan;
}

export interface TenantRecordInput {
  key_hash: string;
  tenant_id: string;
  name: string;
  plan: Plan;
  environment: Environment;
  quota: number;
  contact_email?: string;
  created_at: string;
  agreement_version?: string;
  agreement_signed_at?: string;
}

export interface TenantRecord {
  key_hash: string;
  tenant_id: string;
  name: string;
  status: TenantStatus;
  plan: Plan;
  environment: Environment;
  quota: number;
  created_at: string;
  contact_email?: string;
  agreement_version?: string;
  agreement_signed_at?: string;
}

/**
 * Build the `tenants` row for a new key. Contains the hash only — NEVER the
 * plaintext key. New tenants start `active`.
 */
export function buildTenantRecord(input: TenantRecordInput): TenantRecord {
  return {
    key_hash: input.key_hash,
    tenant_id: input.tenant_id,
    name: input.name,
    status: "active",
    plan: input.plan,
    environment: input.environment,
    quota: input.quota,
    created_at: input.created_at,
    ...(input.contact_email ? { contact_email: input.contact_email } : {}),
    ...(input.agreement_version ? { agreement_version: input.agreement_version } : {}),
    ...(input.agreement_signed_at ? { agreement_signed_at: input.agreement_signed_at } : {}),
  };
}
