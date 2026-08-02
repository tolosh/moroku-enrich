/**
 * CloudWatch metrics via Embedded Metric Format (EMF) — structured logs the
 * CloudWatch agent turns into metrics with no PutMetricData call on the hot
 * path. Feeds the dashboard + fallback-rate alarm (spec §6): ConfidentPct,
 * FallbackRate, SourceCount (per tier), CorrectionVolume.
 */
import type { EnrichResult } from "@moroku-enrich/engine";
import type { CategoriseSummary } from "./summary.js";

interface MetricDef {
  Name: string;
  Unit: string;
}

function emit(
  namespace: string,
  dimensions: Record<string, string>,
  metrics: MetricDef[],
  values: Record<string, number>,
): void {
  const dimensionNames = Object.keys(dimensions);
  const record = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: namespace,
          Dimensions: [dimensionNames],
          Metrics: metrics,
        },
      ],
    },
    ...dimensions,
    ...values,
  };
  console.log(JSON.stringify(record));
}

/** Emit categorise batch metrics: confident %, fallback %, and per-tier counts. */
export function emitCategoriseMetrics(
  namespace: string,
  stage: string,
  summary: CategoriseSummary,
  results: readonly EnrichResult[],
): void {
  const count = summary.count || 1;
  const fallback = summary.by_source.fallback ?? 0;
  emit(
    namespace,
    { Stage: stage },
    [
      { Name: "ConfidentPct", Unit: "Percent" },
      { Name: "FallbackRate", Unit: "Percent" },
      { Name: "Categorised", Unit: "Count" },
    ],
    {
      ConfidentPct: Number((summary.confident_pct * 100).toFixed(2)),
      FallbackRate: Number(((fallback / count) * 100).toFixed(2)),
      Categorised: summary.count,
    },
  );
  // Per-source counts as a separate metric with a Source dimension.
  for (const [source, n] of Object.entries(summary.by_source)) {
    emit(
      namespace,
      { Stage: stage, Source: source },
      [{ Name: "SourceCount", Unit: "Count" }],
      { SourceCount: n ?? 0 },
    );
  }
  void results;
}

/** Emit correction volume (spec §6 dashboard). */
export function emitCorrectionMetrics(
  namespace: string,
  stage: string,
  accepted: number,
): void {
  emit(
    namespace,
    { Stage: stage },
    [{ Name: "CorrectionVolume", Unit: "Count" }],
    { CorrectionVolume: accepted },
  );
}
