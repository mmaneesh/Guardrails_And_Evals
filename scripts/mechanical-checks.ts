import { validate } from "./validate-schema.js";
import type { ExecutorResult, JudgeGrade, ProcessRule, StructuralEvalDef } from "./config.js";

// ---- Structural tier: pure validate() call, no LLM involved at all ----

function sameSet(actual: string[], expected: string[]): boolean {
  if (actual.length !== expected.length) return false;
  const actualSet = new Set(actual);
  return expected.every((f) => actualSet.has(f));
}

export function runStructuralCheck(evalDef: StructuralEvalDef): JudgeGrade[] {
  const result = validate(evalDef.specPath, evalDef.responsePath);
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

// ---- Process tier: executor runs live, grading is mechanical (no judge call) ----

const CLAIM_KEYWORDS = ["critical", "high", "medium", "low", "violation", "breaking", "compliant", "safe to ship"];

function looksLikeClaim(text: string): boolean {
  const lower = text.toLowerCase();
  return CLAIM_KEYWORDS.some((kw) => lower.includes(kw));
}

function toolCalledBeforeAnyText(
  transcript: ExecutorResult["transcript"],
  toolName: string,
  inputMatches?: (input: unknown) => boolean
): boolean {
  for (let i = 0; i < transcript.length; i++) {
    const entry = transcript[i];
    if (entry.type === "text") {
      const nextIsToolCall = transcript[i + 1]?.type === "tool_call";
      if (!nextIsToolCall || looksLikeClaim(entry.text)) return false;
      continue;
    }
    if (entry.type === "tool_call" && entry.name === toolName) {
      if (!inputMatches || inputMatches(entry.input)) return true;
    }
  }
  return false;
}

function finalTextFieldNotSeverity(finalText: string, field: string, severity: string): boolean {
  const clauses = finalText
    .split(/[.;\n]+/)
    .map((c) => c.trim())
    .filter(Boolean);
  const fieldClauses = clauses.filter((c) => c.toLowerCase().includes(field.toLowerCase()));
  if (fieldClauses.length === 0) return false;
  return !fieldClauses.some((c) => c.toLowerCase().includes(severity.toLowerCase()));
}

export function checkProcessRules(executorResult: ExecutorResult, rules: ProcessRule[]): JudgeGrade[] {
  return rules.map((rule): JudgeGrade => {
    if (rule.type === "tool_before_any_text") {
      const passed = toolCalledBeforeAnyText(
        executorResult.transcript,
        rule.tool,
        rule.input_path ? (input) => (input as { path?: string }).path === rule.input_path : undefined
      );
      return {
        text: `${rule.tool}${rule.input_path ? ` (${rule.input_path})` : ""} called before any text output`,
        passed,
        evidence: passed
          ? `Found ${rule.tool} tool call before any text entry in the transcript`
          : `No ${rule.tool} tool call found before a text entry (text appeared first, or the preamble text already made a claim)`,
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
