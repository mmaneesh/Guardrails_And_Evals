import { checkProcessRules } from "./process-check.js";
import { emptyUsage, type ExecutorResult, type ProcessRule } from "./config.js";

function fakeResult(transcript: ExecutorResult["transcript"], finalText: string): ExecutorResult {
  return {
    evalId: 999,
    model: "test",
    toolCalls: {},
    totalToolCalls: 0,
    totalSteps: 0,
    outputChars: finalText.length,
    transcriptChars: 0,
    errorsEncountered: 0,
    incomplete: false,
    durationMs: 0,
    usage: emptyUsage(),
    finalText,
    transcript,
  };
}

let failed = false;
function expect(label: string, actual: boolean, expected: boolean) {
  if (actual !== expected) {
    failed = true;
    console.error(`FAIL  ${label} — expected ${expected}, got ${actual}`);
  } else {
    console.log(`PASS  ${label}`);
  }
}

// Rule: tool_before_any_text — validator called before any text
const validatorRules: ProcessRule[] = [{ type: "tool_before_any_text", tool: "run_validator" }];

const goodOrder = fakeResult(
  [
    { type: "tool_call", name: "run_validator", input: {}, output: {}, isError: false },
    { type: "text", text: "Here's what I found." },
  ],
  "Here's what I found."
);
expect(
  "validator called before text — passes",
  checkProcessRules(goodOrder, validatorRules).every((g) => g.passed),
  true
);

const badOrder = fakeResult(
  [
    { type: "text", text: "This looks fine." },
    { type: "tool_call", name: "run_validator", input: {}, output: {}, isError: false },
  ],
  "This looks fine."
);
expect(
  "text before validator call — fails",
  checkProcessRules(badOrder, validatorRules).every((g) => g.passed),
  false
);

// Rule: tool_before_any_text with input_path — reads the judgment doc before text
const readDocRules: ProcessRule[] = [
  { type: "tool_before_any_text", tool: "read_file", input_path: "references/breaking_change_judgment.md" },
];

const readDocFirst = fakeResult(
  [
    { type: "tool_call", name: "run_validator", input: {}, output: {}, isError: false },
    {
      type: "tool_call",
      name: "read_file",
      input: { path: "references/breaking_change_judgment.md" },
      output: "doc contents",
      isError: false,
    },
    { type: "text", text: "The status field is medium severity." },
  ],
  "The status field is medium severity."
);
expect(
  "reads judgment doc before text — passes",
  checkProcessRules(readDocFirst, readDocRules).every((g) => g.passed),
  true
);

const wrongFileRead = fakeResult(
  [
    { type: "tool_call", name: "read_file", input: { path: "SKILL.md" }, output: "doc contents", isError: false },
    { type: "text", text: "The status field is medium severity." },
  ],
  "The status field is medium severity."
);
expect(
  "reads a different file, not the judgment doc — fails",
  checkProcessRules(wrongFileRead, readDocRules).every((g) => g.passed),
  false
);

// Rule: final_text_field_not_severity
const severityRules: ProcessRule[] = [
  { type: "final_text_field_not_severity", field: "status", severity: "critical" },
];

const statusMedium = fakeResult(
  [],
  "field: status — severity: medium — a strict client would break.\nfield: total_amount — severity: critical — wrong type."
);
expect(
  "status marked medium even though total_amount is critical — passes (only checks status's own line)",
  checkProcessRules(statusMedium, severityRules).every((g) => g.passed),
  true
);

const statusCritical = fakeResult([], "field: status — severity: critical — this breaks everything.");
expect(
  "status itself marked critical — fails",
  checkProcessRules(statusCritical, severityRules).every((g) => g.passed),
  false
);

if (failed) {
  console.error("\nprocess-check self-test failed.");
  process.exit(1);
}
console.log("\nAll process-check self-tests passed.");
