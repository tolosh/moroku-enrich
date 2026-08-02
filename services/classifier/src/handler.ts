/**
 * llm-classifier worker (spec §4 LLM tier, §6) — SQS-triggered.
 *
 * Stub for the CDK build (task 1). Phase 2 batches unique unknown merchant keys,
 * classifies each once with Claude Haiku on Bedrock (merchant strings only —
 * never amounts or user identifiers), rejects confidence < 0.6, and writes
 * llm_cache keyed `match_key#prompt_version`. Gated by LLM_TIER_ENABLED.
 */
import type { SQSHandler } from "aws-lambda";

export const handler: SQSHandler = async (event) => {
  console.log(
    JSON.stringify({
      at: "classifier.stub",
      records: event.Records?.length ?? 0,
      llm_tier_enabled: process.env.LLM_TIER_ENABLED,
    }),
  );
  // No-op until phase 2. Returning normally acks the batch.
};
