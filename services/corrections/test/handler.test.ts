import { describe, expect, it } from "vitest";
import { InMemoryRepository, type AuthedEvent, type Config } from "@moroku-enrich/service-lib";
import { makeCorrectionsHandler } from "../src/handler.js";

const cfg: Config = {
  stage: "test",
  tables: {
    tenants: "t",
    merchantsGlobal: "m",
    overrides: "o",
    correctionsLog: "c",
    llmCache: "l",
    promotionQueue: "p",
  },
  unknownMerchantQueueUrl: "",
  metricNamespace: "TestNS",
  lowConfidenceThreshold: 0.8,
  llmTrustThreshold: 0.6,
  llmTierEnabled: false,
  promptVersion: "1",
  tenantPromotionMinUsers: 3,
  globalPromotionMinTenants: 2,
  globalPromotionMinUsers: 5,
};

function event(body: unknown, headers: Record<string, string> = {}): AuthedEvent {
  return {
    rawPath: "/v1/corrections",
    headers,
    body: JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: {
      http: { method: "POST" },
      authorizer: { lambda: { tenant_id: "tenant-1", plan: "standard", status: "active", name: "Kanopi" } },
    },
  } as unknown as AuthedEvent;
}

const correction = (userRef: string, extra: Record<string, unknown> = {}) => ({
  description: "THE DAILY GRIND",
  user_ref: userRef,
  corrected_category: "dining_entertainment",
  ...extra,
});

describe("POST /v1/corrections handler (spec §3.2)", () => {
  it("applies a user-scope override immediately", async () => {
    const repo = new InMemoryRepository();
    const res = await makeCorrectionsHandler(repo, cfg)(event({ corrections: [correction("u1")] }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.results[0].applied_scope).toBe("user");
    expect(body.results[0].match_key).toBe("the daily grind");
    // user override is present; nothing was written to the global dictionary.
    expect(repo.log).toHaveLength(1);
    expect(repo.merchants.size).toBe(0);
  });

  it("promotes to tenant scope once 3 distinct users agree", async () => {
    const repo = new InMemoryRepository();
    const handler = makeCorrectionsHandler(repo, cfg);
    const scopes: string[] = [];
    for (const u of ["u1", "u2", "u3"]) {
      const res = await handler(event({ corrections: [correction(u)] }));
      scopes.push(JSON.parse(res.body as string).results[0].applied_scope);
    }
    expect(scopes).toEqual(["user", "user", "tenant"]);
  });

  it("never writes the global dictionary (poisoning guard)", async () => {
    const repo = new InMemoryRepository();
    const handler = makeCorrectionsHandler(repo, cfg);
    for (const u of ["u1", "u2", "u3", "u4", "u5"]) {
      await handler(event({ corrections: [correction(u)] }));
    }
    // Even at high agreement, only promotion_queue candidates are written.
    expect(repo.merchants.size).toBe(0);
    expect(repo.corroboration.get("the daily grind")).toBeDefined();
  });

  it("logs one-off transaction-scope corrections without touching mappings", async () => {
    const repo = new InMemoryRepository();
    const res = await makeCorrectionsHandler(repo, cfg)(
      event({ corrections: [correction("u1", { scope_hint: "transaction" })] }),
    );
    const body = JSON.parse(res.body as string);
    expect(body.results[0].applied_scope).toBe("transaction");
    expect(repo.log).toHaveLength(1);
    expect(repo.overrides.size).toBe(0); // no mapping written
  });

  it("is idempotent under a replayed Idempotency-Key", async () => {
    const repo = new InMemoryRepository();
    const handler = makeCorrectionsHandler(repo, cfg);
    const headers = { "Idempotency-Key": "abc-123" };
    const first = await handler(event({ corrections: [correction("u1")] }, headers));
    const second = await handler(event({ corrections: [correction("u1")] }, headers));
    expect(second.headers?.["Idempotency-Replayed"]).toBe("true");
    expect(first.body).toBe(second.body);
    // The replay did not append a second log row.
    expect(repo.log).toHaveLength(1);
    // …nor double-count usage (metering runs only on the non-replayed path).
    const received = [...repo.usage.values()].reduce(
      (n, r) => n + (r["corrections_received"] ?? 0),
      0,
    );
    expect(received).toBe(1);
  });

  it("meters corrections_received (ext-001)", async () => {
    const repo = new InMemoryRepository();
    await makeCorrectionsHandler(repo, cfg)(
      event({ corrections: [correction("u1"), correction("u2")] }),
    );
    const received = [...repo.usage.values()].reduce(
      (n, r) => n + (r["corrections_received"] ?? 0),
      0,
    );
    expect(received).toBe(2);
  });
});
