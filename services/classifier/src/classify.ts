/**
 * Classifier prompt + response parsing (spec §4 LLM tier). Pure and testable.
 *
 * The model sees ONLY a normalised merchant string — never amounts, dates, or
 * user identifiers. That constraint is enforced structurally: the SQS message
 * carries just `{ match_key }`, and this module builds the prompt from that
 * alone. The model must answer with one of the verbatim expense-category ids.
 */
import { EXPENSE_CATEGORIES } from "@moroku-enrich/taxonomy";

/** Expense category ids the classifier may choose from (non-expense excluded). */
const EXPENSE_IDS: ReadonlySet<string> = new Set(EXPENSE_CATEGORIES.map((c) => c.id));

export function isExpenseCategory(id: string): boolean {
  return EXPENSE_IDS.has(id);
}

export const CLASSIFIER_SYSTEM =
  "You are a merchant classifier for Australian personal-finance transactions. " +
  "You receive ONLY a normalised merchant name — no amounts, no dates, no personal " +
  "data. Classify it into exactly one category id from the provided list. If you are " +
  "not reasonably sure, return a low confidence. Respond with STRICT JSON only, no " +
  'prose: {"category":"<id>","confidence":<number 0..1>}.';

/** The category menu injected into the prompt (ids + labels + default class). */
export function categoryMenu(): string {
  return EXPENSE_CATEGORIES.map(
    (c) => `- ${c.id} (${c.label}, ${c.default_classification})`,
  ).join("\n");
}

export function buildUserPrompt(matchKey: string): string {
  return (
    `Categories:\n${categoryMenu()}\n\n` +
    `Merchant: "${matchKey}"\n` +
    `Return JSON {"category","confidence"} choosing the single best category id.`
  );
}

export interface ModelClassification {
  category: string;
  confidence: number;
}

/**
 * Parse the model's text into a classification, or undefined if it is
 * unparseable or names a category that is not a real expense id (hallucination
 * guard). Confidence is clamped to [0,1].
 */
export function parseClassification(text: string): ModelClassification | undefined {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return undefined;
  let obj: unknown;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return undefined;
  }
  if (typeof obj !== "object" || obj === null) return undefined;
  const rec = obj as Record<string, unknown>;
  const category = String(rec["category"] ?? "").trim();
  const confidence = Number(rec["confidence"]);
  if (!category || !Number.isFinite(confidence)) return undefined;
  if (!isExpenseCategory(category)) return undefined;
  return { category, confidence: Math.max(0, Math.min(1, confidence)) };
}
