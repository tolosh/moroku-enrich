/**
 * Normaliser-version key migration (ext-004 §4). Pure planning logic: given rows
 * with their current key, the key they re-normalise to, and a confidence, decide
 * which rows to rewrite under the new key and which to delete — merging rows that
 * collapse to the same new key by keeping the highest confidence.
 *
 * The DynamoDB I/O lives in scripts/migrate-normaliser-keys.ts; this stays pure
 * and unit-tested.
 */
export interface MigrationRow<T> {
  /** Current primary key (cache_key or match_key). */
  key: string;
  /** Key after re-normalisation. */
  newKey: string;
  /** Confidence used to pick a winner on collision (0 if not applicable). */
  confidence: number;
  /** The full row, rewritten under newKey when it wins. */
  item: T;
}

export interface MigrationPlan<T> {
  /** Winner item to (re)write under `newKey`. */
  writes: { newKey: string; item: T }[];
  /** Old keys to delete (moved winners + merged losers). */
  deletes: string[];
  /** Merge audit — several old keys collapsed into one new key. */
  merges: { newKey: string; kept: string; dropped: string[] }[];
}

/**
 * Plan the migration. Rows whose key is unchanged and unique are left alone.
 * Rows that move (key !== newKey) or collide (multiple → one newKey) produce
 * writes/deletes; on collision the highest-confidence row wins.
 */
export function planKeyMigration<T>(rows: readonly MigrationRow<T>[]): MigrationPlan<T> {
  const groups = new Map<string, MigrationRow<T>[]>();
  for (const row of rows) {
    const g = groups.get(row.newKey);
    if (g) g.push(row);
    else groups.set(row.newKey, [row]);
  }

  const plan: MigrationPlan<T> = { writes: [], deletes: [], merges: [] };

  for (const [newKey, group] of groups) {
    const unchanged = group.length === 1 && group[0]!.key === newKey;
    if (unchanged) continue; // nothing to do

    // Highest confidence wins; ties keep the first seen.
    const winner = group.reduce((best, r) => (r.confidence > best.confidence ? r : best));
    const losers = group.filter((r) => r !== winner);

    if (winner.key !== newKey) {
      plan.writes.push({ newKey, item: winner.item });
      plan.deletes.push(winner.key);
    }
    // A loser already sitting at newKey is overwritten by the winner's write —
    // never delete it, or the just-written winner would be removed.
    for (const loser of losers) {
      if (loser.key !== newKey) plan.deletes.push(loser.key);
    }

    if (group.length > 1) {
      plan.merges.push({ newKey, kept: winner.key, dropped: losers.map((l) => l.key) });
    }
  }
  return plan;
}
