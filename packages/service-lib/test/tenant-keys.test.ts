import { describe, expect, it } from "vitest";
import {
  assertPlanAllowed,
  buildTenantRecord,
  hashTenantKey,
  newTenantKey,
} from "../src/tenant-keys.js";

describe("tenant key issuance (ext-001 §2/§3)", () => {
  it("refuses external plans without --allow-external (acceptance 1)", () => {
    expect(() => assertPlanAllowed("trial", false)).toThrow(/allow-external/);
    expect(() => assertPlanAllowed("commercial", false)).toThrow(/allow-external/);
    expect(assertPlanAllowed("internal", false)).toBe("internal");
    expect(assertPlanAllowed("trial", true)).toBe("trial");
  });

  it("generates environment-prefixed keys", () => {
    expect(newTenantKey("test").key.startsWith("mk_test_")).toBe(true);
    expect(newTenantKey("live").key.startsWith("mk_live_")).toBe(true);
  });

  it("stores only the hash — the plaintext key never appears at rest (acceptance 2)", () => {
    const { key, key_hash } = newTenantKey("live");
    expect(key_hash).toBe(hashTenantKey(key));
    const record = buildTenantRecord({
      key_hash,
      tenant_id: "kanopi",
      name: "Kanopi",
      plan: "internal",
      environment: "live",
      quota: 1_000_000,
      created_at: "2026-08-02T00:00:00.000Z",
    });
    const serialised = JSON.stringify(record);
    expect(serialised).toContain(key_hash);
    expect(serialised).not.toContain(key); // the plaintext secret is never persisted
    expect(record.status).toBe("active");
    expect("key" in record).toBe(false);
  });
});
