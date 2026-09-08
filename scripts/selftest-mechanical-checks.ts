import { checkProcessRules, runStructuralCheck } from "./mechanical-checks.js";
import { emptyUsage, type ExecutorResult, type ProcessRule, type StructuralEvalDef } from "./config.js";

let failed = false;

function check(label: string, grades: { passed: boolean; text: string; evidence: string }[], expectAllPass: boolean) {
  const allPass = grades.every((g) => g.passed);
  if (allPass !== expectAllPass) {
    failed = true;
    console.error(`FAIL  ${label} — expected allPass=${expectAllPass}, got ${allPass}`);
    for (const g of grades) console.error(`  [${g.passed ? "PASS" : "FAIL"}] ${g.text} — ${g.evidence}`);
  } else {
    console.log(`PASS  ${label}`);
  }
}

// ==================== structural tier ====================

const cleanEval: StructuralEvalDef = {
  id: 901,
  tier: "structural",
  prompt: "test",
  expected_output: "test",
  specPath: "evals/schemas/orders.yaml",
  responsePath: "evals/responses/orders/valid.json",
  expected_counts: { structuralViolations: 0, enumMismatches: 0, undocumentedFields: 0 },
};

const enumOnlyEval: StructuralEvalDef = {
  id: 902,
  tier: "structural",
  prompt: "test",
  expected_output: "test",
  specPath: "evals/schemas/orders.yaml",
  responsePath: "evals/responses/orders/enum-spelling.json",
  expected_counts: { structuralViolations: 0, enumMismatches: 1, undocumentedFields: 0 },
  expected_fields: { enumMismatches: ["status"] },
};

const deliberatelyWrongEval: StructuralEvalDef = {
  ...cleanEval,
  id: 903,
  expected_counts: { structuralViolations: 1, enumMismatches: 0, undocumentedFields: 0 },
};

check("structural: clean fixture, correct expectations", runStructuralCheck(cleanEval), true);
check("structural: enum-only fixture, correct expectations", runStructuralCheck(enumOnlyEval), true);
check(
  "structural: clean fixture, deliberately wrong expected count",
  runStructuralCheck(deliberatelyWrongEval),
  false
);

// ==================== process tier ====================

/**
 * Creates synthetic executor results for testing mechanical transcript rules.
 */
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

// Rule: tool_before_any_text — validator called before any text
const validatorRules: ProcessRule[] = [{ type: "tool_before_any_text", tool: "run_validator" }];

const goodOrder = fakeResult(
  [
    { type: "tool_call", name: "run_validator", input: {}, output: {}, isError: false },
    { type: "text", text: "Here's what I found." },
  ],
  "Here's what I found."
);
check("process: validator called before text — passes", checkProcessRules(goodOrder, validatorRules), true);

const badOrder = fakeResult([{ type: "text", text: "This looks fine." }], "This looks fine.");
check("process: text before validator call — fails", checkProcessRules(badOrder, validatorRules), false);

const sameTurnPreamble = fakeResult(
  [
    { type: "text", text: "I'll check this against the schema." },
    { type: "tool_call", name: "run_validator", input: {}, output: {}, isError: false },
    { type: "text", text: "Here's what I found." },
  ],
  "Here's what I found."
);
check(
  "process: same-turn preamble text immediately followed by validator call — passes",
  checkProcessRules(sameTurnPreamble, validatorRules),
  true
);

const sameTurnClaim = fakeResult(
  [
    { type: "text", text: "total_amount is a CRITICAL type violation and unit_price is missing." },
    { type: "tool_call", name: "run_validator", input: {}, output: {}, isError: false },
    { type: "text", text: "done" },
  ],
  "done"
);
check(
  "process: same-turn text stating a severity claim before the validator call — fails",
  checkProcessRules(sameTurnClaim, validatorRules),
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
check(
  "process: status marked medium even though total_amount is critical — passes (only checks status's own clause)",
  checkProcessRules(statusMedium, severityRules),
  true
);

const statusCritical = fakeResult([], "field: status — severity: critical — this breaks everything.");
check("process: status itself marked critical — fails", checkProcessRules(statusCritical, severityRules), false);

const statusMediumOneSentence = fakeResult(
  [],
  "The status enum mismatch is medium severity; separately total_amount is a critical type error."
);
check(
  "process: single sentence naming two fields — status is medium, total_amount critical — passes",
  checkProcessRules(statusMediumOneSentence, severityRules),
  true
);

const statusNeverMentioned = fakeResult([], "total_amount is a critical type error. Nothing else to report.");
check(
  "process: status never mentioned at all — fails",
  checkProcessRules(statusNeverMentioned, severityRules),
  false
);

// Rule: final_text_field_not_severity for shipping_carrier
const carrierRules: ProcessRule[] = [
  { type: "final_text_field_not_severity", field: "shipping_carrier", severity: "critical" },
];

const carrierNonBreaking = fakeResult(
  [],
  "field: shipping_carrier — this is an additive field and not a breaking change."
);
check(
  "process: shipping_carrier noted without critical severity — passes",
  checkProcessRules(carrierNonBreaking, carrierRules),
  true
);

const carrierCritical = fakeResult(
  [],
  "field: shipping_carrier — severity: critical violation because it was not in the spec."
);
check(
  "process: shipping_carrier marked critical — fails",
  checkProcessRules(carrierCritical, carrierRules),
  false
);

if (failed) {
  console.error("\nmechanical-checks self-test failed.");
  process.exit(1);
}
console.log("\nAll mechanical-checks self-tests passed.");
