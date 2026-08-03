import { describe, expect, it, vi } from "vitest";
import type { SQSEvent } from "aws-lambda";
import { makeClassifierHandler, type ClassifierDeps } from "../src/handler.js";

function event(matchKeys: string[]): SQSEvent {
  return {
    Records: matchKeys.map((mk, i) => ({
      messageId: String(i),
      body: JSON.stringify({ match_key: mk }),
    })),
  } as unknown as SQSEvent;
}

const ctx = {} as never;
const cb = (() => {}) as never;

function deps(over: Partial<ClassifierDeps>): ClassifierDeps {
  return {
    enabled: true,
    isCached: async () => false,
    classify: async () => ({ category: "groceries", confidence: 0.9 }),
    writeCache: async () => {},
    ...over,
  };
}

describe("classifier batch/cache logic (ext-004 §3)", () => {
  it("dedupes within a batch — the same key is classified once", async () => {
    const classify = vi.fn(async () => ({ category: "groceries", confidence: 0.9 }));
    const writeCache = vi.fn(async () => {});
    const handler = makeClassifierHandler(deps({ classify, writeCache }));
    await handler(event(["coles metro", "coles metro", "coles metro"]), ctx, cb);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(writeCache).toHaveBeenCalledTimes(1);
  });

  it("skips the invoke entirely when the key is already cached", async () => {
    const classify = vi.fn(async () => ({ category: "groceries", confidence: 0.9 }));
    const handler = makeClassifierHandler(deps({ isCached: async () => true, classify }));
    await handler(event(["woolworths metro"]), ctx, cb);
    expect(classify).toHaveBeenCalledTimes(0);
  });

  it("classifies a genuine unknown once and caches it", async () => {
    const classify = vi.fn(async () => ({ category: "other_expenses", confidence: 0.7 }));
    const writeCache = vi.fn(async () => {});
    const handler = makeClassifierHandler(deps({ classify, writeCache }));
    await handler(event(["some brand new merchant"]), ctx, cb);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(writeCache).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the tier is disabled", async () => {
    const classify = vi.fn(async () => ({ category: "groceries", confidence: 0.9 }));
    const handler = makeClassifierHandler(deps({ enabled: false, classify }));
    await handler(event(["anything"]), ctx, cb);
    expect(classify).toHaveBeenCalledTimes(0);
  });
});
