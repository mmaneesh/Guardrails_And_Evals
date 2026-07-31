import type { ExecutorResult, JudgeGrade, ProcessRule } from "./config.js";

function toolCalledBeforeAnyText(
  transcript: ExecutorResult["transcript"],
  toolName: string,
  inputMatches?: (input: unknown) => boolean
): boolean {
  for (const entry of transcript) {
    if (entry.type === "text") return false;
    if (entry.type === "tool_call" && entry.name === toolName) {
      if (!inputMatches || inputMatches(entry.input)) return true;
    }
  }
  return false;
}

function finalTextFieldNotSeverity(finalText: string, field: string, severity: string): boolean {
  const lines = finalText.split("\n");
  const fieldLines = lines.filter((l) => l.toLowerCase().includes(field.toLowerCase()));
  if (fieldLines.length === 0) return false;
  return !fieldLines.some((l) => l.toLowerCase().includes(severity.toLowerCase()));
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
          : `No ${rule.tool} tool call found before a text entry (or text appeared first)`,
      };
    }
    const passed = finalTextFieldNotSeverity(executorResult.finalText, rule.field, rule.severity);
    return {
      text: `Final output does not mark "${rule.field}" as "${rule.severity}"`,
      passed,
      evidence: passed
        ? `No line mentioning "${rule.field}" also contains "${rule.severity}"`
        : `A line mentioning "${rule.field}" also contains "${rule.severity}", or "${rule.field}" was never mentioned`,
    };
  });
}
