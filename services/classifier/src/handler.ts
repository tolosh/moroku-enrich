/**
 * llm-classifier worker (spec §4 LLM tier, §6) — SQS-triggered.
 *
 * Batches of unknown merchant keys → one-time Claude Haiku classification on
 * Bedrock → llm_cache (keyed `match_key#prompt_version`). The model sees merchant
 * strings only (enforced by the queue payload + the prompt builder). Results are
 * cached with their confidence; the categorise chain trusts a row only at
 * confidence ≥ LLM_TRUST_THRESHOLD, so below-threshold rows are cached (to avoid
 * re-invoking) but never used. Failures return as batchItemFailures → SQS retries
 * → DLQ after maxReceiveCount.
 */
import type { SQSHandler } from "aws-lambda";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  buildUserPrompt,
  CLASSIFIER_SYSTEM,
  parseClassification,
} from "./classify.js";

const bedrock = new BedrockRuntimeClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-3-haiku-20240307-v1:0";
const PROMPT_VERSION = process.env.PROMPT_VERSION ?? "1";
const TRUST = Number(process.env.LLM_TRUST_THRESHOLD ?? "0.6");
const CACHE_TABLE = process.env.TABLE_LLM_CACHE ?? "";
const ENABLED = (process.env.LLM_TIER_ENABLED ?? "false") === "true";

async function classifyOne(
  matchKey: string,
): Promise<{ category: string; confidence: number } | undefined> {
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
  const text = payload.content?.[0]?.text ?? "";
  return parseClassification(text);
}

export const handler: SQSHandler = async (event) => {
  const batchItemFailures: { itemIdentifier: string }[] = [];
  for (const record of event.Records) {
    try {
      if (!ENABLED) continue; // safety: no-op if the tier flag is off
      const parsed = JSON.parse(record.body) as { match_key?: string };
      const matchKey = parsed.match_key?.trim();
      if (!matchKey) continue;

      const cls = await classifyOne(matchKey);
      if (!cls) {
        console.log(JSON.stringify({ at: "classify.unparseable", match_key: matchKey }));
        continue; // drop (deleted); nothing trustworthy to cache
      }

      await ddb.send(
        new PutCommand({
          TableName: CACHE_TABLE,
          Item: {
            cache_key: `${matchKey}#${PROMPT_VERSION}`,
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
      console.log(
        JSON.stringify({
          at: "classify.cached",
          match_key: matchKey,
          category: cls.category,
          confidence: cls.confidence,
          trusted: cls.confidence >= TRUST,
        }),
      );
    } catch (err) {
      console.error("classify failed", record.messageId, err);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
};
