/**
 * Request validation at the handler boundary (spec §6: HTTP APIs have no
 * built-in model validation, so zod does it — with better error messages).
 */
import { z } from "zod";
import {
  CLASSIFICATIONS,
  EXPENSE_CATEGORIES,
  isValidCategory,
} from "@moroku-enrich/taxonomy";

const classification = z.enum(
  CLASSIFICATIONS as unknown as [string, ...string[]],
);

const mcc = z
  .string()
  .regex(/^\d{4}$/, "mcc must be a 4-digit ISO 18245 code");

/**
 * A category id supplied by a caller. While EXPENSE_CATEGORIES is empty (the
 * verbatim 16-list is a blocked input) any non-empty string is accepted; once
 * the taxonomy is populated this refine enforces membership automatically.
 */
const categoryId = z
  .string()
  .min(1)
  .refine((id) => EXPENSE_CATEGORIES.length === 0 || isValidCategory(id), {
    message: "unknown category id",
  });

// -------------------------------------------------------------------------
// POST /v1/categorise (spec §3.1)
// -------------------------------------------------------------------------
export const TransactionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  mcc: mcc.optional(),
  amount: z.number(),
  currency: z.string().length(3).optional(),
  date: z.string().optional(),
  source_category_code: z.string().optional(),
  source_category_description: z.string().optional(),
  account_type: z.enum(["transaction", "credit_card", "savings"]).optional(),
  user_ref: z.string().optional(),
});

export const CategoriseRequestSchema = z.object({
  transactions: z.array(TransactionSchema).min(1).max(1000),
});
export type CategoriseRequest = z.infer<typeof CategoriseRequestSchema>;

// -------------------------------------------------------------------------
// POST /v1/corrections (spec §3.2)
// -------------------------------------------------------------------------
export const CorrectionSchema = z.object({
  transaction_id: z.string().optional(),
  description: z.string().min(1),
  mcc: mcc.optional(),
  amount: z.number().optional(),
  date: z.string().optional(),
  user_ref: z.string().min(1),
  previous_category: z.string().optional(),
  corrected_category: categoryId,
  corrected_classification: classification.optional(),
  scope_hint: z.enum(["merchant", "transaction"]).default("merchant"),
  actor: z.enum(["consumer", "adviser", "admin"]).default("consumer"),
});
export type Correction = z.infer<typeof CorrectionSchema>;

export const CorrectionsRequestSchema = z.object({
  corrections: z.array(CorrectionSchema).min(1).max(1000),
});
export type CorrectionsRequest = z.infer<typeof CorrectionsRequestSchema>;
