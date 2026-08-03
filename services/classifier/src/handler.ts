/**
 * llm-classifier worker (spec §4 LLM tier, §6) — SQS-triggered.
 *
 * Batches of unknown merchant keys → one-time Claude Haiku classification on
 * Bedrock → llm_cache (keyed `match_key#prompt_version`). The model sees merchant
 * strings only (enforced by the queue payload + the prompt builder).
 *
 * ext-004 §3: the worker checks llm_cache BEFORE invoking Bedrock (append-once
 * per prompt_version) and dedupes within a single batch, so duplicate/known keys
 * never re-invoke the model. Results are cached with their confidence; the
 * categorise chain trusts a row only at confidence ≥ LLM_TRUST_THRESHOLD.
 * Failures return as batchItemFailures → SQS retries → DLQ.
 */
import type { SQSHandler } from "aws-lambda";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  buildUserPrompt,
  CLASSIFIER_SYSTEM,
  parseClassification,
} from "./classify.js";

export interface ModelClassification {
  category: string;
  confidence: number;
}

/** Injected side-effects so the batch/cache logic is unit-testable. */
export interface ClassifierDeps {
  /** True if this match_key is already cached for the current prompt_version. */
  isCached(matchKey: string): Promise<boolean>;
  /** Invoke the model for one merchant key (Bedrock). */
  classify(matchKey: string): Promise<ModelClassification | undefined>;
  /** Persist a classification to llm_cache. */
  writeCache(matchKey: string, cls: ModelClassification): Promise<void>;
  /** LLM tier flag (safety no-op when off). */
  enabled: boolean;
}

/** Build the SQS handler over injected deps (tests supply fakes). */
export function makeClassifierHandler(deps: ClassifierDeps): SQSHandler {
  return async (event) => {
    const batchItemFailures: { itemIdentifier: string }[] = [];
    const handledThisBatch = new Set<string>();

    for (const record of event.Records) {
      try {
        if (!deps.enabled) continue;
        const parsed = JSON.parse(record.body) as { match_key?: string };
        const matchKey = parsed.match_key?.trim();
        if (!matchKey) continue;

        // Intra-batch dedup: classify a given key at most once per batch.
        if (handledThisBatch.has(matchKey)) continue;
        handledThisBatch.add(matchKey);

        // Cache-check before Bedrock: append-once per prompt_version.
        if (await deps.isCached(matchKey)) continue;

        const cls = await deps.classify(matchKey);
        if (!cls) continue; // unparseable → nothing trustworthy to cache
        await deps.writeCache(matchKey, cls);
      } catch (err) {
        console.error("classify failed", record.messageId, err);
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}

// ---------------------------------------------------------------------------
// Live wiring (Bedrock + DynamoDB).
// ---------------------------------------------------------------------------
const bedrock = new BedrockRuntimeClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-3-haiku-20240307-v1:0";
const PROMPT_VERSION = process.env.PROMPT_VERSION ?? "1";
const TRUST = Number(process.env.LLM_TRUST_THRESHOLD ?? "0.6");
const CACHE_TABLE = process.env.TABLE_LLM_CACHE ?? "";
const ENABLED = (process.env.LLM_TIER_ENABLED ?? "false") === "true";

const cacheKey = (matchKey: string): string => `${matchKey}#${PROMPT_VERSION}`;

async function bedrockClassify(matchKey: string): Promise<ModelClassification | undefined> {
  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 100,
    temperature: 0,
    system: CLASSIFIER_SYSTEM,
    messages: [{ role: "user", content: buildUserPrompt(matchKey) }],
  };
  const res = await bedrock.send(
    new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(body),
    }),
  );
  const payload = JSON.parse(new TextDecoder().decode(res.body)) as {
    content?: { text?: string }[];
  };
  return parseClassification(payload.content?.[0]?.text ?? "");
}

export const handler = makeClassifierHandler({
  enabled: ENABLED,
  isCached: async (matchKey) => {
    const res = await ddb.send(
      new GetCommand({ TableName: CACHE_TABLE, Key: { cache_key: cacheKey(matchKey) } }),
    );
    return res.Item !== undefined;
  },
  classify: bedrockClassify,
  writeCache: async (matchKey, cls) => {
    await ddb.send(
      new PutCommand({
        TableName: CACHE_TABLE,
        Item: {
          cache_key: cacheKey(matchKey),
          match_key: matchKey,
          category: cls.category,
          confidence: cls.confidence,
          trusted: cls.confidence >= TRUST,
          model_id: MODEL_ID,
          prompt_version: PROMPT_VERSION,
          classified_at: new Date().toISOString(),
        },
      }),
    );
  },
});
