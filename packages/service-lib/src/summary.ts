/**
 * Response summary (spec §3.1): `count`, `confident_pct` (the report-level trust
 * number — share with confidence ≥ 0.8) and the `by_source` tier mix. Pure.
 */
import type { EnrichResult, Source } from "@moroku-enrich/engine";

export interface CategoriseSummary {
  count: number;
  confident_pct: number;
  by_source: Partial<Record<Source, number>>;
}

/** confident_pct uses ≥ 0.8 by default (spec §3.1), overridable to match config. */
export function summarise(
  results: readonly EnrichResult[],
  confidentThreshold = 0.8,
): CategoriseSummary {
  const by_source: Partial<Record<Source, number>> = {};
  let confident = 0;
  for (const r of results) {
    by_source[r.source] = (by_source[r.source] ?? 0) + 1;
    if (r.confidence >= confidentThreshold) confident++;
  }
  const count = results.length;
  const confident_pct = count === 0 ? 0 : Number((confident / count).toFixed(4));
  return { count, confident_pct, by_source };
}
