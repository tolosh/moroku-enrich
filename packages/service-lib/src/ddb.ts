/**
 * Repository — all DynamoDB / SQS I/O behind one interface so the handler logic
 * (and its tests) never touch the AWS SDK. The DynamoDB implementation batches
 * reads one tier at a time (spec §6). A single tenant can never write
 * merchants_global: there is deliberately no such method here (poisoning guard,
 * spec §3.2).
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  BatchGetCommand,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { SQSClient, SendMessageBatchCommand } from "@aws-sdk/client-sqs";
import type {
  DictionaryRecord,
  LlmCacheRecord,
  OverrideRecord,
} from "@moroku-enrich/engine";
import type { Config } from "./config.js";
import type { CorroborationItem } from "./learning.js";
import {
  agreementKey,
  llmCacheKey,
  tenantOverrideKey,
  userOverrideKey,
  userOverridePkForTenant,
} from "./keys.js";
import { keyStr, type BatchedLookups } from "./lookups.js";

export interface LookupRequestItem {
  matchKey: string;
  userRef?: string | undefined;
}

export interface CorrectionLogEntry {
  tenant: string;
  user_ref: string;
  match_key: string;
  description: string;
  previous_category?: string | undefined;
  corrected_category: string;
  corrected_classification?: string | undefined;
  actor: string;
  scope_hint: string;
  /** e.g. "revocation" for a DELETE /v1/overrides log entry. */
  event_type?: string | undefined;
}

export interface MerchantView extends DictionaryRecord {
  match_key: string;
  source?: string;
  correction_count?: number;
  updated_at?: string;
}

export interface OverrideListItem {
  match_key: string;
  category: string;
  classification?: string;
  updated_at?: string;
}

export interface Repository {
  batchGetLookups(
    tenant: string,
    items: readonly LookupRequestItem[],
    promptVersion: string,
  ): Promise<BatchedLookups>;
  enqueueUnknownMerchants(matchKeys: readonly string[]): Promise<void>;

  putUserOverride(
    tenant: string,
    userRef: string,
    matchKey: string,
    category: string,
    classification?: string,
  ): Promise<{ superseded: boolean }>;
  putTenantOverride(
    tenant: string,
    matchKey: string,
    category: string,
    classification?: string,
  ): Promise<void>;
  appendCorrectionLog(entry: CorrectionLogEntry): Promise<void>;
  recordAgreement(
    tenant: string,
    matchKey: string,
    category: string,
    userRef: string,
  ): Promise<number>;
  getCorroboration(matchKey: string): Promise<CorroborationItem | undefined>;
  putCorroboration(
    item: CorroborationItem,
    candidateCategory: string,
    status: string,
  ): Promise<void>;

  getMerchant(matchKey: string): Promise<MerchantView | undefined>;
  listUserOverrides(tenant: string, userRef: string): Promise<OverrideListItem[]>;
  deleteUserOverride(
    tenant: string,
    userRef: string,
    matchKey: string,
  ): Promise<{ existed: boolean; category?: string }>;

  getIdempotent(tenant: string, key: string): Promise<unknown | undefined>;
  putIdempotent(tenant: string, key: string, response: unknown): Promise<void>;
}

function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** DynamoDB + SQS implementation. */
export class DynamoRepository implements Repository {
  private readonly doc: DynamoDBDocumentClient;
  private readonly sqs: SQSClient;

  constructor(
    private readonly cfg: Config,
    doc?: DynamoDBDocumentClient,
    sqs?: SQSClient,
  ) {
    this.doc =
      doc ??
      DynamoDBDocumentClient.from(new DynamoDBClient({}), {
        marshallOptions: { removeUndefinedValues: true },
      });
    this.sqs = sqs ?? new SQSClient({});
  }

  async batchGetLookups(
    tenant: string,
    items: readonly LookupRequestItem[],
    promptVersion: string,
  ): Promise<BatchedLookups> {
    const overrideKeys = new Map<string, { pk: string; sk: string }>();
    const merchantKeys = new Set<string>();
    const cacheKeys = new Set<string>();
    for (const { matchKey, userRef } of items) {
      const to = tenantOverrideKey(tenant, matchKey);
      overrideKeys.set(keyStr(to.pk, to.sk), to);
      if (userRef) {
        const uo = userOverrideKey(tenant, userRef, matchKey);
        overrideKeys.set(keyStr(uo.pk, uo.sk), uo);
      }
      merchantKeys.add(matchKey);
      cacheKeys.add(llmCacheKey(matchKey, promptVersion));
    }

    const result: BatchedLookups = {
      overrides: new Map<string, OverrideRecord>(),
      merchants: new Map<string, DictionaryRecord>(),
      llmCache: new Map<string, LlmCacheRecord>(),
    };

    // overrides
    for (const group of chunk([...overrideKeys.values()], 100)) {
      const res = await this.doc.send(
        new BatchGetCommand({ RequestItems: { [this.cfg.tables.overrides]: { Keys: group } } }),
      );
      for (const it of res.Responses?.[this.cfg.tables.overrides] ?? []) {
        result.overrides.set(keyStr(String(it["pk"]), String(it["sk"])), {
          category: String(it["category"]),
          ...(it["classification"] ? { classification: it["classification"] } : {}),
        });
      }
    }
    // merchants_global
    for (const group of chunk([...merchantKeys], 100)) {
      const res = await this.doc.send(
        new BatchGetCommand({
          RequestItems: {
            [this.cfg.tables.merchantsGlobal]: { Keys: group.map((m) => ({ match_key: m })) },
          },
        }),
      );
      for (const it of res.Responses?.[this.cfg.tables.merchantsGlobal] ?? []) {
        result.merchants.set(String(it["match_key"]), {
          category: String(it["category"]),
          confidence: Number(it["confidence"] ?? 0.85),
          ...(it["classification"] ? { classification: it["classification"] } : {}),
          ...(it["canonical_name"] ? { canonical_name: String(it["canonical_name"]) } : {}),
          ...(it["ambiguous"] !== undefined ? { ambiguous: Boolean(it["ambiguous"]) } : {}),
        });
      }
    }
    // llm_cache
    for (const group of chunk([...cacheKeys], 100)) {
      const res = await this.doc.send(
        new BatchGetCommand({
          RequestItems: {
            [this.cfg.tables.llmCache]: { Keys: group.map((c) => ({ cache_key: c })) },
          },
        }),
      );
      for (const it of res.Responses?.[this.cfg.tables.llmCache] ?? []) {
        result.llmCache.set(String(it["cache_key"]), {
          category: String(it["category"]),
          confidence: Number(it["confidence"] ?? 0),
          ...(it["classification"] ? { classification: it["classification"] } : {}),
        });
      }
    }
    return result;
  }

  async enqueueUnknownMerchants(matchKeys: readonly string[]): Promise<void> {
    const unique = [...new Set(matchKeys)].filter((k) => k.length > 0);
    if (unique.length === 0 || !this.cfg.unknownMerchantQueueUrl) return;
    for (const group of chunk(unique, 10)) {
      await this.sqs.send(
        new SendMessageBatchCommand({
          QueueUrl: this.cfg.unknownMerchantQueueUrl,
          Entries: group.map((matchKey, i) => ({
            Id: String(i),
            MessageBody: JSON.stringify({ match_key: matchKey }),
            MessageGroupId: "unknown-merchant",
          })),
        }),
      );
    }
  }

  async putUserOverride(
    tenant: string,
    userRef: string,
    matchKey: string,
    category: string,
    classification?: string,
  ): Promise<{ superseded: boolean }> {
    const key = userOverrideKey(tenant, userRef, matchKey);
    const res = await this.doc.send(
      new PutCommand({
        TableName: this.cfg.tables.overrides,
        Item: {
          ...key,
          scope: "user",
          tenant,
          user_ref: userRef,
          match_key: matchKey,
          category,
          classification,
          updated_at: nowIso(),
        },
        ReturnValues: "ALL_OLD",
      }),
    );
    return { superseded: res.Attributes !== undefined };
  }

  async putTenantOverride(
    tenant: string,
    matchKey: string,
    category: string,
    classification?: string,
  ): Promise<void> {
    const key = tenantOverrideKey(tenant, matchKey);
    await this.doc.send(
      new PutCommand({
        TableName: this.cfg.tables.overrides,
        Item: {
          ...key,
          scope: "tenant",
          tenant,
          match_key: matchKey,
          category,
          classification,
          updated_at: nowIso(),
        },
      }),
    );
  }

  async appendCorrectionLog(entry: CorrectionLogEntry): Promise<void> {
    const ts = nowIso();
    const uuid = randomId();
    await this.doc.send(
      new PutCommand({
        TableName: this.cfg.tables.correctionsLog,
        Item: { ...entry, sk: `${ts}#${uuid}`, ts },
        ConditionExpression: "attribute_not_exists(sk)",
      }),
    );
  }

  async recordAgreement(
    tenant: string,
    matchKey: string,
    category: string,
    userRef: string,
  ): Promise<number> {
    const key = agreementKey(tenant, matchKey, category);
    const res = await this.doc.send(
      new UpdateCommand({
        TableName: this.cfg.tables.overrides,
        Key: key,
        UpdateExpression: "ADD #users :u SET updated_at = :t",
        ExpressionAttributeNames: { "#users": "users" },
        ExpressionAttributeValues: { ":u": new Set([userRef]), ":t": nowIso() },
        ReturnValues: "UPDATED_NEW",
      }),
    );
    const users = res.Attributes?.["users"] as Set<string> | undefined;
    return users ? users.size : 1;
  }

  async getCorroboration(matchKey: string): Promise<CorroborationItem | undefined> {
    const res = await this.doc.send(
      new GetCommand({ TableName: this.cfg.tables.promotionQueue, Key: { match_key: matchKey } }),
    );
    if (!res.Item?.["categories"]) return undefined;
    return { match_key: matchKey, categories: res.Item["categories"] };
  }

  async putCorroboration(
    item: CorroborationItem,
    candidateCategory: string,
    status: string,
  ): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.cfg.tables.promotionQueue,
        Item: {
          match_key: item.match_key,
          categories: item.categories,
          candidate_category: candidateCategory,
          status,
          updated_at: nowIso(),
        },
      }),
    );
  }

  async getMerchant(matchKey: string): Promise<MerchantView | undefined> {
    const res = await this.doc.send(
      new GetCommand({ TableName: this.cfg.tables.merchantsGlobal, Key: { match_key: matchKey } }),
    );
    const it = res.Item;
    if (!it) return undefined;
    return {
      match_key: String(it["match_key"]),
      category: String(it["category"]),
      confidence: Number(it["confidence"] ?? 0.85),
      ...(it["classification"] ? { classification: it["classification"] } : {}),
      ...(it["canonical_name"] ? { canonical_name: String(it["canonical_name"]) } : {}),
      ...(it["ambiguous"] !== undefined ? { ambiguous: Boolean(it["ambiguous"]) } : {}),
      ...(it["source"] ? { source: String(it["source"]) } : {}),
      ...(it["correction_count"] !== undefined
        ? { correction_count: Number(it["correction_count"]) }
        : {}),
      ...(it["updated_at"] ? { updated_at: String(it["updated_at"]) } : {}),
    };
  }

  async listUserOverrides(tenant: string, userRef: string): Promise<OverrideListItem[]> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.cfg.tables.overrides,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": userOverridePkForTenant(tenant) + userRef },
      }),
    );
    return (res.Items ?? []).map((it) => ({
      match_key: String(it["match_key"]),
      category: String(it["category"]),
      ...(it["classification"] ? { classification: String(it["classification"]) } : {}),
      ...(it["updated_at"] ? { updated_at: String(it["updated_at"]) } : {}),
    }));
  }

  async deleteUserOverride(
    tenant: string,
    userRef: string,
    matchKey: string,
  ): Promise<{ existed: boolean; category?: string }> {
    const key = userOverrideKey(tenant, userRef, matchKey);
    const res = await this.doc.send(
      new DeleteCommand({
        TableName: this.cfg.tables.overrides,
        Key: key,
        ReturnValues: "ALL_OLD",
      }),
    );
    if (!res.Attributes) return { existed: false };
    return { existed: true, category: String(res.Attributes["category"]) };
  }

  async getIdempotent(tenant: string, key: string): Promise<unknown | undefined> {
    const res = await this.doc.send(
      new GetCommand({
        TableName: this.cfg.tables.correctionsLog,
        Key: { tenant: `IDEMP#${tenant}`, sk: key },
      }),
    );
    return res.Item?.["response"];
  }

  async putIdempotent(tenant: string, key: string, response: unknown): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.cfg.tables.correctionsLog,
        Item: {
          tenant: `IDEMP#${tenant}`,
          sk: key,
          response,
          expires_at: Math.floor(Date.now() / 1000) + 86_400,
        },
      }),
    );
  }
}

/** Small random id without pulling in a uuid dependency. */
function randomId(): string {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10)
  );
}
