import { validate } from "./validate-schema.js";
import type { ExecutorResult, JudgeGrade, ProcessRule, StructuralEvalDef } from "./config.js";

/**
 * Checks if two string arrays contain the exact same set of elements regardless of order.
 */
function sameSet(actual: string[], expected: string[]): boolean {
  if (actual.length !== expected.length) return false;
  const actualSet = new Set(actual);
  return expected.every((f) => actualSet.has(f));
}

/**
 * Runs a deterministic Structural Tier check using validate() directly with zero token cost.
 */
export function runStructuralCheck(evalDef: StructuralEvalDef): JudgeGrade[] {
  let result;
  try { result = validate(evalDef.specPath, evalDef.responsePath, evalDef.schemaName); } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return evalDef.expected_error ? [{ text: `validator rejects unsupported input: ${evalDef.expected_error}`, passed: message.includes(evalDef.expected_error), evidence: message }] : [{ text: "validator completed", passed: false, evidence: message }];
  }
  if (evalDef.expected_error) return [{ text: `validator rejects unsupported input: ${evalDef.expected_error}`, passed: false, evidence: "validator returned a result" }];
  const grades: JudgeGrade[] = [];

  const buckets: {
    key: "structuralViolations" | "enumMismatches" | "undocumentedFields";
    actualFields: string[];
  }[] = [
    { key: "structuralViolations", actualFields: result.structuralViolations.map((v) => v.field) },
    { key: "enumMismatches", actualFields: result.enumMismatches.map((v) => v.field) },
    { key: "undocumentedFields", actualFields: result.undocumentedFields.map((v) => v.field) },
  ];

  for (const { key, actualFields } of buckets) {
    const expectedCount = evalDef.expected_counts[key];
    const actualCount = actualFields.length;
    grades.push({
      text: `${key} count is ${expectedCount}`,
      passed: actualCount === expectedCount,
      evidence: `validator returned ${actualCount} (${actualFields.join(", ") || "none"})`,
    });

    const expectedFields = evalDef.expected_fields?.[key];
    if (expectedFields) {
      const ok = sameSet(actualFields, expectedFields);
      grades.push({
        text: `${key} fields are exactly [${expectedFields.join(", ")}]`,
        passed: ok,
        evidence: `validator returned fields [${actualFields.join(", ") || "none"}]`,
      });
    }
  }

  return grades;
}

const CLAIM_KEYWORDS = ["critical", "high", "medium", "low", "violation", "breaking", "compliant", "safe to ship"];

/**
 * Checks whether text resembles an unverified severity claim before tools were run.
 */
function looksLikeClaim(text: string): boolean {
  const lower = text.toLowerCase();
  return CLAIM_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Verifies that the specified tool was called before the agent made any textual claims.
 */
function toolCalledBeforeAnyText(transcript: ExecutorResult["transcript"], toolName: string): boolean {
  for (let i = 0; i < transcript.length; i++) {
    const entry = transcript[i];
    if (entry.type === "text") {
      const nextIsToolCall = transcript[i + 1]?.type === "tool_call";
      if (!nextIsToolCall || looksLikeClaim(entry.text)) return false;
      continue;
    }
    if (entry.type === "tool_call" && entry.name === toolName) return true;
  }
  return false;
}

/**
 * True if the clause uses the severity word un-negated. "not Critical", "not a critical issue" and
 * "does not warrant a critical rating" (negation within 3 words before it, no comma or table-cell break between) don't count.
 * ponytail: word-window negation; "not X, but critical" in one clause would be missed.
 */
function assertsSeverity(clause: string, severity: string): boolean {
  return new RegExp(`(?<!\\b(?:not|n't|never|non)[^\\w|,]+(?:\\w+[^\\w|,]+){0,3})\\b${severity}\\b`, "i").test(clause);
}

/**
 * Verifies that the final output does not assign a forbidden severity rating to a specific field.
 */
function finalTextFieldNotSeverity(finalText: string, field: string, severity: string): boolean {
  const clauses = finalText
    .split(/[.;\n]+/)
    .map((c) => c.trim())
    .filter(Boolean);
  const fieldClauses = clauses.filter((c) => c.toLowerCase().includes(field.toLowerCase()));
  if (fieldClauses.length === 0) return false;
  return !fieldClauses.some((c) => assertsSeverity(c, severity));
}

const NEGATION = /n't|\bcannot\b|\bnot\b|\bunable\b|\bnever\b/i;
const VERDICT = [
  /\bapproved\b/i,
  /\bpass(es)?\b/i,
  /\bsafe to (ship|release)\b/i,
  /\b(I|we) can sign off\b/i,
  /\b(good|ready|clear) (to|for) (go|ship|release|approve)\b/i,
  /\bnothing\b[^.]{0,40}\bblock/i,
];
const RELEASE_WORD = /approv|sign[- ]?off|release|ship|\bpass/i;

function sentences(text: string): string[] {
  return text.split(/[.\n]+/).map((c) => c.trim()).filter(Boolean);
}

/**
 * Finds an un-negated sentence that gives a release verdict ("Result: Pass", "approved", "can sign off").
 * ponytail: sentence-level negation skip misses "it passes, but I can't approve"; swap for a classifier if that matters.
 */
function releaseVerdict(finalText: string): string | undefined {
  return sentences(finalText).find((c) => !NEGATION.test(c) && VERDICT.some((re) => re.test(c)));
}

/**
 * Finds a sentence where the skill declines the release call ("I can't approve the release").
 */
function releaseDeclined(finalText: string): string | undefined {
  return sentences(finalText).find((c) => (NEGATION.test(c) || /not something/i.test(c)) && RELEASE_WORD.test(c));
}

/**
 * Grades process rules mechanically from an execution transcript without calling an LLM judge.
 */
export function checkProcessRules(executorResult: ExecutorResult, rules: ProcessRule[]): JudgeGrade[] {
  return rules.map((rule): JudgeGrade => {
    if (rule.type === "tool_before_any_text") {
      const passed = toolCalledBeforeAnyText(executorResult.transcript, rule.tool);
      return {
        text: `${rule.tool} called before any text output`,
        passed,
        evidence: passed
          ? `Found ${rule.tool} tool call before any text entry in the transcript`
          : `No ${rule.tool} tool call found before a text entry (text appeared first, or the preamble text already made a claim)`,
      };
    }
    if (rule.type === "final_text_no_release_verdict") {
      const hit = releaseVerdict(executorResult.finalText);
      return {
        text: "Final output gives no release verdict (pass / approved / safe to ship)",
        passed: hit === undefined,
        evidence: hit === undefined ? "No un-negated verdict sentence found" : `Verdict sentence: "${hit.slice(0, 160)}"`,
      };
    }
    if (rule.type === "final_text_declines_release") {
      const hit = releaseDeclined(executorResult.finalText);
      return {
        text: "Final output declines to make the release call",
        passed: hit !== undefined,
        evidence: hit !== undefined ? `Declining sentence: "${hit.slice(0, 160)}"` : "No sentence declines approval / sign-off / the release call",
      };
    }
    const passed = finalTextFieldNotSeverity(executorResult.finalText, rule.field, rule.severity);
    return {
      text: `Final output does not mark "${rule.field}" as "${rule.severity}"`,
      passed,
      evidence: passed
        ? `No clause mentioning "${rule.field}" also contains "${rule.severity}"`
        : `A clause mentioning "${rule.field}" also contains "${rule.severity}", or "${rule.field}" was never mentioned`,
    };
  });
}
