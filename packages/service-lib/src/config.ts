/**
 * Runtime config read from the Lambda environment (populated by the CDK stack
 * from SSM /moroku-enrich/<stage>/config/*). Table names + thresholds + flags.
 */
export interface Config {
  stage: string;
  tables: {
    tenants: string;
    merchantsGlobal: string;
    overrides: string;
    correctionsLog: string;
    llmCache: string;
    promotionQueue: string;
    usage: string;
  };
  unknownMerchantQueueUrl: string;
  metricNamespace: string;
  lowConfidenceThreshold: number;
  llmTrustThreshold: number;
  llmTierEnabled: boolean;
  /** ext-006 income recognition + savings subtyping. Defaults ON. */
  incomeSavingsEnabled: boolean;
  promptVersion: string;
  tenantPromotionMinUsers: number;
  globalPromotionMinTenants: number;
  globalPromotionMinUsers: number;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Read config from env once. Missing table names surface as empty strings. */
export function loadConfig(): Config {
  return {
    stage: process.env.STAGE ?? "dev",
    tables: {
      tenants: process.env.TABLE_TENANTS ?? "",
      merchantsGlobal: process.env.TABLE_MERCHANTS_GLOBAL ?? "",
      overrides: process.env.TABLE_OVERRIDES ?? "",
      correctionsLog: process.env.TABLE_CORRECTIONS_LOG ?? "",
      llmCache: process.env.TABLE_LLM_CACHE ?? "",
      promotionQueue: process.env.TABLE_PROMOTION_QUEUE ?? "",
      usage: process.env.TABLE_USAGE ?? "",
    },
    unknownMerchantQueueUrl: process.env.UNKNOWN_MERCHANT_QUEUE_URL ?? "",
    metricNamespace: process.env.METRIC_NAMESPACE ?? "MorokuEnrich",
    lowConfidenceThreshold: num("LOW_CONFIDENCE_THRESHOLD", 0.8),
    llmTrustThreshold: num("LLM_TRUST_THRESHOLD", 0.6),
    llmTierEnabled: (process.env.LLM_TIER_ENABLED ?? "false") === "true",
    // Defaults ON (note the inverted default vs LLM_TIER_ENABLED): ext-006 is
    // part of the engine, and the env var exists only as a kill switch.
    incomeSavingsEnabled: (process.env.INCOME_SAVINGS_ENABLED ?? "true") === "true",
    promptVersion: process.env.PROMPT_VERSION ?? "1",
    tenantPromotionMinUsers: num("TENANT_PROMOTION_MIN_USERS", 3),
    globalPromotionMinTenants: num("GLOBAL_PROMOTION_MIN_TENANTS", 2),
    globalPromotionMinUsers: num("GLOBAL_PROMOTION_MIN_USERS", 5),
  };
}
