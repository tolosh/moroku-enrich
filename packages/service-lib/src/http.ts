/**
 * Small HTTP helpers for the HTTP API v2 proxy integration: JSON responses,
 * body parsing, header access (case-insensitive), and zod error shaping.
 */
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { z } from "zod";

export function json(
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

export function error(
  statusCode: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): APIGatewayProxyStructuredResultV2 {
  return json(statusCode, { error: code, message, ...extra });
}

/** Parse a JSON body (handling base64) into an unknown, or throw BadRequest. */
export function parseJsonBody(event: {
  body?: string | undefined;
  isBase64Encoded?: boolean | undefined;
}): unknown {
  const raw = event.body ?? "";
  const text = event.isBase64Encoded
    ? Buffer.from(raw, "base64").toString("utf8")
    : raw;
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequest("invalid JSON body");
  }
}

/** Case-insensitive header lookup. */
export function header(
  headers: Record<string, string | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) return v;
  }
  return undefined;
}

export class BadRequest extends Error {}

/** Validate `data` with a zod schema, throwing a shaped 400 on failure. */
export function validate<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    throw new ValidationError(issues);
  }
  return result.data;
}

export class ValidationError extends Error {
  constructor(public readonly issues: { path: string; message: string }[]) {
    super("validation failed");
  }
}

/** Turn a thrown handler error into an HTTP response. */
export function toErrorResponse(err: unknown): APIGatewayProxyStructuredResultV2 {
  if (err instanceof ValidationError) {
    return error(400, "validation_error", "request failed validation", {
      issues: err.issues,
    });
  }
  if (err instanceof BadRequest) {
    return error(400, "bad_request", err.message);
  }
  console.error("unhandled handler error", err);
  return error(500, "internal_error", "unexpected error");
}
