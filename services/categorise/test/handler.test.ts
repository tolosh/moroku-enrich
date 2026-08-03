import { describe, expect, it } from "vitest";
import { InMemoryRepository, type AuthedEvent, type Config } from "@moroku-enrich/service-lib";
import { makeCategoriseHandler } from "../src/handler.js";

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
  unknownMerchantQueueUrl: "https://sqs.test/queue",
  metricNamespace: "TestNS",
  lowConfidenceThreshold: 0.8,
  llmTrustThreshold: 0.6,
  llmTierEnabled: true,
  promptVersion: "1",
  tenantPromotionMinUsers: 3,
  globalPromotionMinTenants: 2,
  globalPromotionMinUsers: 5,
};

function event(body: unknown, tenant: unknown = { tenant_id: "tenant-1", plan: "standard", status: "active", name: "Kanopi" }): AuthedEvent {
  return {
    rawPath: "/v1/categorise",
    headers: {},
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: {
      http: { method: "POST" },
      authorizer: tenant === null ? undefined : { lambda: tenant },
    },
  } as unknown as AuthedEvent;
}

describe("POST /v1/categorise handler", () => {
  it("categorises via MCC and echoes the id", async () => {
    const repo = new InMemoryRepository();
    const res = await makeCategoriseHandler(repo, cfg)(
      event({ transactions: [{ id: "abc", description: "COLES EXPRESS 123", amount: -50, mcc: "5541" }] }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.results[0].id).toBe("abc");
    expect(body.results[0].source).toBe("mcc");
    expect(body.results[0].category).toBe("vehicle_running");
    expect(body.summary.count).toBe(1);
  });

  it("falls back on an unknown merchant and enqueues it for the LLM tier", async () => {
    const repo = new InMemoryRepository();
    const res = await makeCategoriseHandler(repo, cfg)(
      event({ transactions: [{ id: "1", description: "ZZZ MYSTERY SHOP", amount: -9 }] }),
    );
    const body = JSON.parse(res.body as string);
    expect(body.results[0].source).toBe("fallback");
    expect(body.results[0].flags).toEqual(["unverified"]);
    expect(repo.enqueued).toContain("zzz mystery shop");
  });

  it("does not enqueue an excluded transfer, but does enqueue a genuine unknown (ext-004 §2)", async () => {
    const repo = new InMemoryRepository();
    await makeCategoriseHandler(repo, cfg)(
      event({
        transactions: [
          { id: "t", description: "PAYPAL TRANSFER", amount: -40 },
          { id: "u", description: "ZZZ TOTALLY UNKNOWN VENDOR", amount: -9 },
        ],
      }),
    );
    expect(repo.enqueued).not.toContain("paypal transfer");
    expect(repo.enqueued).toContain("zzz totally unknown vendor");
  });

  it("enqueues unknown merchants even when the LLM tier is off (spec §4)", async () => {
    const repo = new InMemoryRepository();
    const offCfg = { ...cfg, llmTierEnabled: false };
    await makeCategoriseHandler(repo, offCfg)(
      event({ transactions: [{ id: "1", description: "ZZZ MYSTERY SHOP", amount: -9 }] }),
    );
    // Enqueue is unconditional; the classifier's event source is what's gated.
    expect(repo.enqueued).toContain("zzz mystery shop");
  });

  it("prefers a user override over MCC", async () => {
    const repo = new InMemoryRepository();
    await repo.putUserOverride("tenant-1", "u1", "coles express", "groceries");
    const res = await makeCategoriseHandler(repo, cfg)(
      event({
        transactions: [
          { id: "1", description: "COLES EXPRESS", amount: -50, mcc: "5541", user_ref: "u1" },
        ],
      }),
    );
    const body = JSON.parse(res.body as string);
    expect(body.results[0].source).toBe("user_override");
    expect(body.results[0].category).toBe("groceries");
  });

  it("returns a credit as excluded and does not enqueue it", async () => {
    const repo = new InMemoryRepository();
    const res = await makeCategoriseHandler(repo, cfg)(
      event({
        transactions: [
          { id: "1", description: "PAYROLL ACME", amount: 5000 },
          { id: "2", description: "ZZZ MYSTERY SHOP", amount: -9 },
        ],
      }),
    );
    const body = JSON.parse(res.body as string);
    const credit = body.results.find((r: { id: string }) => r.id === "1");
    expect(credit.source).toBe("credit");
    expect(credit.category).toBe("uncategorised_credit");
    expect(credit.excluded).toBe(true);
    // confident_pct denominator is spend only: the lone debit fell back → 0%.
    expect(body.summary.confident_pct).toBe(0);
    // only the unknown debit is queued, never the credit.
    expect(repo.enqueued).toEqual(["zzz mystery shop"]);
  });

  it("401s without tenant context", async () => {
    const repo = new InMemoryRepository();
    const res = await makeCategoriseHandler(repo, cfg)(event({ transactions: [] }, null));
    expect(res.statusCode).toBe(401);
  });

  it("meters transactions_categorised by exactly N, incl. concurrently (acceptance 4)", async () => {
    const repo = new InMemoryRepository();
    const handler = makeCategoriseHandler(repo, cfg);
    const body = {
      transactions: [
        { id: "1", description: "A", amount: -1, mcc: "5411" },
        { id: "2", description: "B", amount: -2, mcc: "5541" },
        { id: "3", description: "C", amount: -3 },
      ],
    };
    await Promise.all([handler(event(body)), handler(event(body))]);
    const total = [...repo.usage.values()].reduce(
      (n, r) => n + (r["transactions_categorised"] ?? 0),
      0,
    );
    expect(total).toBe(6); // 2 calls × 3 transactions, atomic ADD
    const row = [...repo.usage.values()][0]!;
    expect(row["by_source_mcc"]).toBeGreaterThan(0);
  });

  it("meters test and live usage as distinct rows (acceptance 3)", async () => {
    const repo = new InMemoryRepository();
    const handler = makeCategoriseHandler(repo, cfg);
    const body = { transactions: [{ id: "1", description: "A", amount: -1, mcc: "5411" }] };
    await handler(event(body, { tenant_id: "kanopi", environment: "test", status: "active", plan: "internal", name: "Kanopi" }));
    await handler(event(body, { tenant_id: "kanopi", environment: "live", status: "active", plan: "internal", name: "Kanopi" }));
    const keys = [...repo.usage.keys()];
    expect(keys.some((k) => k.includes("test#"))).toBe(true);
    expect(keys.some((k) => k.includes("live#"))).toBe(true);
  });

  it("400s on an invalid body", async () => {
    const repo = new InMemoryRepository();
    const res = await makeCategoriseHandler(repo, cfg)(event({ transactions: [] }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body as string).error).toBe("validation_error");
  });
});
