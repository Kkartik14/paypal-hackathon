import { readFileSync } from "node:fs";
import { z } from "zod";
import { ExtractionSchema } from "@scambrake/contracts";
import { comparableText } from "../agent/extraction";
import { ContactsService, nameMatches } from "../contacts/contacts.service";
import { PolicyService } from "../policy/policy.service";
import { EvalCaseSchema, type EvalCase } from "./types";

export const EVAL_CASES_PATH = "apps/api/evals/cases.json";

export function parseEvalCases(raw: unknown): EvalCase[] {
  const parsed = z.array(EvalCaseSchema).safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid eval case file: ${parsed.error.message}`);
  }
  const cases = parsed.data;
  const seen = new Set<string>();
  for (const evalCase of cases) {
    if (seen.has(evalCase.id)) {
      throw new Error(`Duplicate eval case id: ${evalCase.id}`);
    }
    seen.add(evalCase.id);
  }
  return cases;
}

export function loadEvalCases(path: string): EvalCase[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not read eval cases at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseEvalCases(raw);
}

/**
 * Checks that each case is internally coherent and that its "ideal" extraction
 * really produces an acceptable decision under the production policy. This
 * catches case-authoring mistakes before a model result is blamed for them.
 */
export function validateEvalCases(
  cases: EvalCase[],
  policy = new PolicyService(new ContactsService()),
  profile = new ContactsService().getProfile(),
): void {
  const errors: string[] = [];

  for (const evalCase of cases) {
    const expected = evalCase.expected;

    if (!expected.acceptableDecisions.includes(expected.decision)) {
      errors.push(`${evalCase.id}: acceptableDecisions must include the expected decision.`);
    }
    if (expected.decision !== "ALLOW" && expected.acceptableDecisions.includes("ALLOW")) {
      errors.push(`${evalCase.id}: ALLOW cannot be an acceptable outcome when the expected decision is not ALLOW.`);
    }
    if (evalCase.tags.includes("scam") && expected.decision === "ALLOW") {
      errors.push(`${evalCase.id}: a scam-tagged case cannot expect ALLOW.`);
    }
    if (evalCase.tags.includes("legit") && expected.decision !== "ALLOW") {
      errors.push(`${evalCase.id}: a legit-tagged case must expect ALLOW; use the ambiguous tag for holds.`);
    }

    const ideal = evalCase.idealExtraction;
    if (!amountsEqual(ideal.amount, expected.amount)) {
      errors.push(
        `${evalCase.id}: idealExtraction.amount (${String(ideal.amount)}) does not match expected.amount (${String(expected.amount)}).`,
      );
    }
    if (!textsMatch(ideal.requestedRecipientName, expected.requestedRecipientName)) {
      errors.push(
        `${evalCase.id}: idealExtraction.requestedRecipientName does not match expected.requestedRecipientName.`,
      );
    }
    if (!textsMatch(ideal.claimedOrganization, expected.claimedOrganization)) {
      errors.push(
        `${evalCase.id}: idealExtraction.claimedOrganization does not match expected.claimedOrganization.`,
      );
    }

    const idealCategories = new Set(ideal.pressureSignals.map((signal) => signal.category));
    const expectedCategories = new Set(expected.pressureCategories);
    for (const category of expectedCategories) {
      if (!idealCategories.has(category)) {
        errors.push(`${evalCase.id}: idealExtraction is missing expected pressure category “${category}”.`);
      }
    }
    for (const category of idealCategories) {
      if (!expectedCategories.has(category)) {
        errors.push(`${evalCase.id}: idealExtraction contains unlisted pressure category “${category}”.`);
      }
    }

    const transcript = comparableText(evalCase.transcript);
    for (const signal of ideal.pressureSignals) {
      if (!transcript.includes(comparableText(signal.quote))) {
        errors.push(`${evalCase.id}: ideal pressure quote is not in the transcript: “${signal.quote}”.`);
      }
    }

    let extraction;
    try {
      extraction = ExtractionSchema.parse({
        ...ideal,
        transcript: evalCase.transcript,
      });
    } catch (error) {
      errors.push(
        `${evalCase.id}: idealExtraction is not a valid Extraction: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    const outcome = policy.evaluate({
      extraction,
      payment: evalCase.payment,
      profile,
    });
    if (!expected.acceptableDecisions.includes(outcome.decision)) {
      errors.push(
        `${evalCase.id}: ideal extraction produces ${outcome.decision}, but acceptable outcomes are ${expected.acceptableDecisions.join("/")}.`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(`Eval case validation failed:\n- ${errors.join("\n- ")}`);
  }
}

function amountsEqual(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) < 0.011;
}

function textsMatch(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right;
  return nameMatches(left, right);
}
