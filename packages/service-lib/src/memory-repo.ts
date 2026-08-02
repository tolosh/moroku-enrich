/**
 * In-memory Repository — a full, dependency-free implementation used by the
 * handler tests (and handy for local runs). Mirrors DynamoRepository's key
 * encoding so tests exercise the same lookup logic the real repo does.
 */
import type { LlmCacheRecord, OverrideRecord } from "@moroku-enrich/engine";
import type { Classification } from "@moroku-enrich/taxonomy";
import type { CorroborationItem } from "./learning.js";
import {
  agreementKey,
  llmCacheKey,
  tenantOverrideKey,
  userOverrideKey,
  usageSortKey,
} from "./keys.js";
import { emptyBatchedLookups, keyStr, type BatchedLookups } from "./lookups.js";
import type {
  CorrectionLogEntry,
  LookupRequestItem,
  MerchantView,
  OverrideListItem,
  Repository,
} from "./ddb.js";

interface StoredOverride extends OverrideRecord {
  scope: "user" | "tenant";
  match_key: string;
  user_ref?: string;
  updated_at: string;
}

export class InMemoryRepository implements Repository {
  readonly overrides = new Map<string, StoredOverride>();
  readonly merchants = new Map<string, MerchantView>();
  readonly llmCache = new Map<string, LlmCacheRecord>();
  readonly agreements = new Map<string, Set<string>>();
  readonly corroboration = new Map<string, CorroborationItem>();
  readonly log: (CorrectionLogEntry & { ts: string })[] = [];
  readonly enqueued: string[] = [];
  readonly usage = new Map<string, Record<string, number>>();
  private readonly idempotency = new Map<string, unknown>();

  async batchGetLookups(
    tenant: string,
    items: readonly LookupRequestItem[],
    promptVersion: string,
  ): Promise<BatchedLookups> {
    const out = emptyBatchedLookups();
    for (const { matchKey, userRef } of items) {
      const to = tenantOverrideKey(tenant, matchKey);
      const toRec = this.overrides.get(keyStr(to.pk, to.sk));
      if (toRec) out.overrides.set(keyStr(to.pk, to.sk), project(toRec));
      if (userRef) {
        const uo = userOverrideKey(tenant, userRef, matchKey);
        const uoRec = this.overrides.get(keyStr(uo.pk, uo.sk));
        if (uoRec) out.overrides.set(keyStr(uo.pk, uo.sk), project(uoRec));
      }
      const m = this.merchants.get(matchKey);
      if (m) out.merchants.set(matchKey, m);
      const cacheKey = llmCacheKey(matchKey, promptVersion);
      const c = this.llmCache.get(cacheKey);
      if (c) out.llmCache.set(cacheKey, c);
    }
    return out;
  }

  async enqueueUnknownMerchants(matchKeys: readonly string[]): Promise<void> {
    for (const k of matchKeys) if (k) this.enqueued.push(k);
  }

  async putUserOverride(
    tenant: string,
    userRef: string,
    matchKey: string,
    category: string,
    classification?: string,
  ): Promise<{ superseded: boolean }> {
    const key = userOverrideKey(tenant, userRef, matchKey);
    const id = keyStr(key.pk, key.sk);
    const superseded = this.overrides.has(id);
    this.overrides.set(id, {
      category,
      ...(classification ? { classification: classification as Classification } : {}),
      scope: "user",
      match_key: matchKey,
      user_ref: userRef,
      updated_at: new Date().toISOString(),
    });
    return { superseded };
  }

  async putTenantOverride(
    tenant: string,
    matchKey: string,
    category: string,
    classification?: string,
  ): Promise<void> {
    const key = tenantOverrideKey(tenant, matchKey);
    this.overrides.set(keyStr(key.pk, key.sk), {
      category,
      ...(classification ? { classification: classification as Classification } : {}),
      scope: "tenant",
      match_key: matchKey,
      updated_at: new Date().toISOString(),
    });
  }

  async appendCorrectionLog(entry: CorrectionLogEntry): Promise<void> {
    this.log.push({ ...entry, ts: new Date().toISOString() });
  }

  async recordAgreement(
    tenant: string,
    matchKey: string,
    category: string,
    userRef: string,
  ): Promise<number> {
    const id = `${agreementKey(tenant, matchKey, category).pk}|${matchKey}#${category}`;
    const set = this.agreements.get(id) ?? new Set<string>();
    set.add(userRef);
    this.agreements.set(id, set);
    return set.size;
  }

  async getCorroboration(matchKey: string): Promise<CorroborationItem | undefined> {
    return this.corroboration.get(matchKey);
  }

  async putCorroboration(item: CorroborationItem): Promise<void> {
    this.corroboration.set(item.match_key, item);
  }

  async getMerchant(matchKey: string): Promise<MerchantView | undefined> {
    return this.merchants.get(matchKey);
  }

  async listUserOverrides(tenant: string, userRef: string): Promise<OverrideListItem[]> {
    const prefix = userOverrideKey(tenant, userRef, "").pk;
    const out: OverrideListItem[] = [];
    for (const rec of this.overrides.values()) {
      if (rec.scope === "user" && rec.user_ref === userRef) {
        void prefix;
        out.push({
          match_key: rec.match_key,
          category: rec.category,
          ...(rec.classification ? { classification: rec.classification } : {}),
          updated_at: rec.updated_at,
        });
      }
    }
    return out;
  }

  async deleteUserOverride(
    tenant: string,
    userRef: string,
    matchKey: string,
  ): Promise<{ existed: boolean; category?: string }> {
    const key = userOverrideKey(tenant, userRef, matchKey);
    const id = keyStr(key.pk, key.sk);
    const rec = this.overrides.get(id);
    if (!rec) return { existed: false };
    this.overrides.delete(id);
    return { existed: true, category: rec.category };
  }

  async getIdempotent(tenant: string, key: string): Promise<unknown | undefined> {
    return this.idempotency.get(`${tenant}|${key}`);
  }

  async putIdempotent(tenant: string, key: string, response: unknown): Promise<void> {
    this.idempotency.set(`${tenant}|${key}`, response);
  }

  async incrementUsage(
    tenantId: string,
    environment: string,
    month: string,
    increments: Readonly<Record<string, number>>,
  ): Promise<void> {
    const id = `${tenantId}|${usageSortKey(environment, month)}`;
    const row = this.usage.get(id) ?? {};
    for (const [attr, delta] of Object.entries(increments)) {
      if (delta === 0) continue;
      row[attr] = (row[attr] ?? 0) + delta;
    }
    this.usage.set(id, row);
  }
}

function project(rec: StoredOverride): OverrideRecord {
  return {
    category: rec.category,
    ...(rec.classification ? { classification: rec.classification } : {}),
  };
}
