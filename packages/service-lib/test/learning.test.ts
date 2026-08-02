import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLDS,
  mergeCorroboration,
  qualifiesForGlobalReview,
  tenantScopeReached,
  type CorroborationItem,
} from "../src/learning.js";

describe("tenant scope (spec §3.2 tier 2)", () => {
  it("needs ≥ N distinct users for a consumer", () => {
    expect(tenantScopeReached(2, "consumer", 3)).toBe(false);
    expect(tenantScopeReached(3, "consumer", 3)).toBe(true);
  });
  it("promotes on a single adviser/admin correction (dormant path)", () => {
    expect(tenantScopeReached(1, "adviser", 3)).toBe(true);
    expect(tenantScopeReached(1, "admin", 3)).toBe(true);
  });
});

describe("global corroboration (spec §3.2 tier 3)", () => {
  const obs = (tenant: string, user: string, category = "groceries") => ({
    match_key: "the daily grind",
    category,
    tenant,
    user_ref: user,
  });

  it("counts distinct tenants and cross-tenant users, no competition", () => {
    let item: CorroborationItem | undefined;
    let last = mergeCorroboration(item, obs("t1", "u1"));
    item = last.item;
    last = mergeCorroboration(item, obs("t2", "u1")); // same user id, different tenant
    const { metrics } = last;
    expect(metrics.leadingCategory).toBe("groceries");
    expect(metrics.distinctTenants).toBe(2);
    expect(metrics.distinctUsers).toBe(2); // namespaced by tenant
    expect(metrics.competingShare).toBe(0);
    expect(qualifiesForGlobalReview(metrics, DEFAULT_THRESHOLDS)).toBe(true); // ≥ 2 tenants
  });

  it("qualifies on ≥ 5 distinct users even within corroboration", () => {
    let item: CorroborationItem | undefined;
    for (let i = 1; i <= 5; i++) {
      item = mergeCorroboration(item, obs("t1", `u${i}`)).item;
    }
    const { metrics } = mergeCorroboration(item, obs("t1", "u5"));
    expect(metrics.distinctUsers).toBe(5);
    expect(qualifiesForGlobalReview(metrics, DEFAULT_THRESHOLDS)).toBe(true);
  });

  it("marks a genuinely split key ambiguous and refuses promotion", () => {
    let item: CorroborationItem | undefined;
    item = mergeCorroboration(item, obs("t1", "u1", "groceries")).item;
    item = mergeCorroboration(item, obs("t2", "u2", "groceries")).item;
    const { metrics } = mergeCorroboration(item, obs("t3", "u3", "shopping_retail"));
    // 1 of 3 corrections competes → 33% ≥ 30% → ambiguous.
    expect(metrics.ambiguous).toBe(true);
    expect(qualifiesForGlobalReview(metrics, DEFAULT_THRESHOLDS)).toBe(false);
  });
});
