import type { ExecutorResult, JudgeGrade, ProcessRule } from "./config.js";

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
