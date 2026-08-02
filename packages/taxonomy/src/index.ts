/**
 * Taxonomy v1 — @moroku-enrich/taxonomy (spec §2, decision §9.1).
 *
 * Structure only until the 16 Kanopi expense-category identifiers are lifted
 * verbatim from Kanopi's code. Per decision §9.1 and the build brief, category
 * NAMES must not be invented — EXPENSE_CATEGORIES is intentionally empty and
 * the build will fail its taxonomy completeness test until it is populated.
 *
 * The three classifications and the two additive non-expense outcomes
 * (`transfer`, `uncategorised_credit`) are named verbatim in the spec, so they
 * are defined here now.
 *
 * The taxonomy is versioned and served by GET /v1/taxonomy so consuming apps
 * never hard-code it. Changes are additive-only within a major version.
 */

export const TAXONOMY_VERSION = "1";

/** The three expense classifications (spec §2). Frozen for v1. */
export const CLASSIFICATIONS = ["essential", "discretionary", "financial_commitment"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

/**
 * A taxonomy category. `default_classification` is applied when a correction or
 * mapping does not specify one (spec §3.2). `excluded` marks non-expense
 * outcomes the caller may drop (transfers).
 */
export interface CategoryDef {
  /** Stable identifier used across the API and dictionary. */
  id: string;
  /** Human-facing label for UIs and docs. */
  label: string;
  /** Applied when no classification is supplied. */
  default_classification: Classification;
  /** True for transfer / atm / cash-advance style non-expense outcomes. */
  excluded: boolean;
  /** Non-expense credit/transfer outcomes are not real expense categories. */
  kind: "expense" | "non_expense";
}

/**
 * The 15 Kanopi expense categories, frozen verbatim as taxonomy v1
 * (decision §9.1, corrected to 15 by ext-002 §0). Identifiers are exactly as in
 * Kanopi's engine; default classifications are as that engine assigns them
 * (ext-002 §1). Labels are display strings only.
 *
 * Note: `other_expenses` defaults `discretionary` as a taxonomy default; the
 * conservative-fallback path still forces `essential` + `unverified` at
 * assignment time (kickoff ruling). Rule/dictionary hits on `other_expenses`
 * keep the discretionary default.
 */
export const EXPENSE_CATEGORIES: readonly CategoryDef[] = [
  cat("mortgage", "Mortgage", "financial_commitment"),
  cat("rent", "Rent", "financial_commitment"),
  cat("loan_repayment", "Loan Repayment", "financial_commitment"),
  cat("groceries", "Groceries", "essential"),
  cat("utilities", "Utilities", "essential"),
  cat("vehicle_running", "Vehicle Running", "essential"),
  cat("transport", "Transport", "essential"),
  cat("insurance", "Insurance", "essential"),
  cat("strata", "Strata", "essential"),
  cat("education", "Education", "essential"),
  cat("subscriptions", "Subscriptions", "discretionary"),
  cat("dining_entertainment", "Dining & Entertainment", "discretionary"),
  cat("clothing", "Clothing", "discretionary"),
  cat("healthcare", "Healthcare", "essential"),
  cat("other_expenses", "Other Expenses", "discretionary"),
];

function cat(
  id: string,
  label: string,
  default_classification: Classification,
): CategoryDef {
  return { id, label, default_classification, excluded: false, kind: "expense" };
}

/**
 * Additive non-expense outcomes today's Kanopi engine drops on the floor and
 * this service returns explicitly (spec §2). Named verbatim in the spec.
 */
export const NON_EXPENSE_OUTCOMES: readonly CategoryDef[] = [
  {
    id: "transfer",
    label: "Transfer",
    default_classification: "essential",
    excluded: true,
    kind: "non_expense",
  },
  {
    id: "uncategorised_credit",
    label: "Uncategorised Credit",
    default_classification: "essential",
    excluded: false,
    kind: "non_expense",
  },
];

/** Expected count of expense categories (decision §9.1, corrected to 15 by ext-002 §0). */
export const EXPECTED_EXPENSE_CATEGORY_COUNT = 15;

/** All categories (expense + non-expense). */
export function allCategories(): readonly CategoryDef[] {
  return [...EXPENSE_CATEGORIES, ...NON_EXPENSE_OUTCOMES];
}

const CATEGORY_INDEX: ReadonlyMap<string, CategoryDef> = new Map(
  allCategories().map((c) => [c.id, c]),
);

export function getCategory(id: string): CategoryDef | undefined {
  return CATEGORY_INDEX.get(id);
}

export function isValidCategory(id: string): boolean {
  return CATEGORY_INDEX.has(id);
}

export function isValidClassification(value: string): value is Classification {
  return (CLASSIFICATIONS as readonly string[]).includes(value);
}

/**
 * The default classification for a category id, or undefined if unknown.
 * Corrections that omit `corrected_classification` fall back to this (spec §3.2).
 */
export function defaultClassificationFor(id: string): Classification | undefined {
  return CATEGORY_INDEX.get(id)?.default_classification;
}

/** The full taxonomy document served by GET /v1/taxonomy. */
export interface TaxonomyDocument {
  taxonomy_version: string;
  classifications: readonly Classification[];
  categories: readonly CategoryDef[];
}

export function taxonomyDocument(): TaxonomyDocument {
  return {
    taxonomy_version: TAXONOMY_VERSION,
    classifications: CLASSIFICATIONS,
    categories: allCategories(),
  };
}
