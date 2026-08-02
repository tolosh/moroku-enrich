import { describe, expect, it } from "vitest";
import { InMemoryRepository, type AuthedEvent, type Config } from "@moroku-enrich/service-lib";
import { makeReadHandler } from "../src/handler.js";

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

function event(o: {
  method?: string;
  rawPath: string;
  pathParameters?: Record<string, string>;
  query?: Record<string, string>;
  tenant?: unknown;
}): AuthedEvent {
  const tenant =
    o.tenant === undefined
      ? { tenant_id: "tenant-1", plan: "standard", status: "active", name: "Kanopi" }
      : o.tenant;
  return {
    rawPath: o.rawPath,
    headers: {},
    pathParameters: o.pathParameters,
    queryStringParameters: o.query,
    isBase64Encoded: false,
    requestContext: {
      http: { method: o.method ?? "GET" },
      authorizer: tenant === null ? undefined : { lambda: tenant },
    },
  } as unknown as AuthedEvent;
}

describe("read endpoints (spec §3.3)", () => {
  it("GET /v1/health answers without auth", async () => {
    const res = await makeReadHandler(new InMemoryRepository(), cfg)(
      event({ rawPath: "/v1/health", tenant: null }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.status).toBe("ok");
    expect(body.taxonomy_version).toBe("1");
  });

  it("GET /v1/taxonomy serves the versioned taxonomy document", async () => {
    const res = await makeReadHandler(new InMemoryRepository(), cfg)(
      event({ rawPath: "/v1/taxonomy" }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.taxonomy_version).toBe("1");
    expect(Array.isArray(body.categories)).toBe(true);
  });

  it("GET /v1/merchants/{match_key} → 404 then 200", async () => {
    const repo = new InMemoryRepository();
    const handler = makeReadHandler(repo, cfg);
    const miss = await handler(
      event({ rawPath: "/v1/merchants/the%20daily%20grind", pathParameters: { match_key: "the%20daily%20grind" } }),
    );
    expect(miss.statusCode).toBe(404);

    repo.merchants.set("the daily grind", {
      match_key: "the daily grind",
      category: "dining_entertainment",
      confidence: 0.9,
    });
    const hit = await handler(
      event({ rawPath: "/v1/merchants/the%20daily%20grind", pathParameters: { match_key: "the%20daily%20grind" } }),
    );
    expect(hit.statusCode).toBe(200);
    expect(JSON.parse(hit.body as string).category).toBe("dining_entertainment");
  });

  it("GET /v1/overrides lists a user's overrides with delete ids", async () => {
    const repo = new InMemoryRepository();
    await repo.putUserOverride("tenant-1", "u1", "the daily grind", "dining_entertainment");
    const res = await makeReadHandler(repo, cfg)(
      event({ rawPath: "/v1/overrides", query: { user_ref: "u1" } }),
    );
    const body = JSON.parse(res.body as string);
    expect(body.overrides).toHaveLength(1);
    expect(body.overrides[0].id).toBe("u1~the%20daily%20grind");
  });

  it("DELETE /v1/overrides/{id} revokes and logs, keeping history", async () => {
    const repo = new InMemoryRepository();
    await repo.putUserOverride("tenant-1", "u1", "the daily grind", "dining_entertainment");
    const res = await makeReadHandler(repo, cfg)(
      event({
        method: "DELETE",
        rawPath: "/v1/overrides/u1~the%20daily%20grind",
        pathParameters: { id: "u1~the%20daily%20grind" },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(repo.overrides.size).toBe(0);
    expect(repo.log.at(-1)?.event_type).toBe("revocation");
  });
});
