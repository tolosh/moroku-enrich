import { describe, expect, it } from "vitest";
import { parseBearer, hashToken, tenantContextFrom } from "../src/authorize.js";

describe("authorizer helpers (ext-001)", () => {
  it("accepts mk_test_ and mk_live_ tokens, rejects others (acceptance 3)", () => {
    expect(parseBearer("Bearer mk_test_abc.DEF-123")).toBe("mk_test_abc.DEF-123");
    expect(parseBearer("Bearer mk_live_xyz")).toBe("mk_live_xyz");
    expect(parseBearer("Bearer sk_live_nope")).toBeUndefined();
    expect(parseBearer("Bearer mk_prod_x")).toBeUndefined();
    expect(parseBearer(undefined)).toBeUndefined();
    expect(parseBearer("mk_live_missing_scheme")).toBeUndefined();
  });

  it("hashes deterministically (SHA-256 hex)", () => {
    expect(hashToken("mk_live_x")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("mk_live_x")).toBe(hashToken("mk_live_x"));
  });

  it("passes plan + environment through for an active tenant", () => {
    const ctx = tenantContextFrom({
      tenant_id: "kanopi",
      plan: "internal",
      environment: "test",
      status: "active",
      name: "Kanopi",
    });
    expect(ctx).toEqual({
      tenant_id: "kanopi",
      plan: "internal",
      environment: "test",
      status: "active",
      name: "Kanopi",
    });
  });

  it("denies a revoked (suspended) tenant and a missing row (acceptance 5)", () => {
    // Cache-lag is documented on tenantContextFrom: a cached ALLOW survives until
    // the authorizer TTL, but on any cache miss a suspended tenant is denied.
    expect(tenantContextFrom({ tenant_id: "kanopi", status: "suspended" })).toBeNull();
    expect(tenantContextFrom(undefined)).toBeNull();
  });
});
