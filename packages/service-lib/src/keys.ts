/**
 * DynamoDB key encoding for the overloaded single-table designs (spec §5). One
 * place so the read path and write path can never disagree on a key.
 *
 * `overrides` table (PK `pk`, SK `sk`):
 *   - user scope:   pk = `T#<tenant>#U#<user_ref>`, sk = `M#<match_key>`
 *   - tenant scope: pk = `T#<tenant>`,              sk = `TENANT#<match_key>`
 *   - agreement aggregate (who has corrected a key → category, for promotion):
 *                   pk = `AGG#<tenant>`,            sk = `<match_key>#<category>`
 *
 * `corrections_log` (PK `tenant`, SK `sk` = `ts#uuid`) is append-only.
 * `llm_cache` (PK `cache_key` = `<match_key>#<prompt_version>`).
 */

export interface Key {
  pk: string;
  sk: string;
}

export function userOverrideKey(tenant: string, userRef: string, matchKey: string): Key {
  return { pk: `T#${tenant}#U#${userRef}`, sk: `M#${matchKey}` };
}

export function tenantOverrideKey(tenant: string, matchKey: string): Key {
  return { pk: `T#${tenant}`, sk: `TENANT#${matchKey}` };
}

export function agreementKey(tenant: string, matchKey: string, category: string): Key {
  return { pk: `AGG#${tenant}`, sk: `${matchKey}#${category}` };
}

export function userOverridePkForTenant(tenant: string): string {
  return `T#${tenant}#U#`;
}

export function llmCacheKey(matchKey: string, promptVersion: string): string {
  return `${matchKey}#${promptVersion}`;
}

export function correctionLogSk(ts: string, uuid: string): string {
  return `${ts}#${uuid}`;
}

/**
 * `usage` table SK (ext-001 §1). Environment is folded into the sort key so a
 * tenant's test and live counters are distinct rows under one tenant_id
 * (ext-001 §3 test 3), while staying per-month.
 */
export function usageSortKey(environment: string, month: string): string {
  return `${environment}#${month}`;
}
