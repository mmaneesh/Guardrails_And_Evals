import { runStructuralCheck } from "./structural-check.js";
import type { StructuralEvalDef } from "./config.js";

const cleanEval: StructuralEvalDef = {
  id: 901,
  tier: "structural",
  prompt: "test",
  expected_output: "test",
  files: [],
  specPath: "evals/files/order_schema.yaml",
  responsePath: "evals/files/order_response_clean.json",
  expected_counts: { structuralViolations: 0, enumMismatches: 0, undocumentedFields: 0 },
};

const enumOnlyEval: StructuralEvalDef = {
  id: 902,
  tier: "structural",
  prompt: "test",
  expected_output: "test",
  files: [],
  specPath: "evals/files/order_schema.yaml",
  responsePath: "evals/files/order_response_enum_only.json",
  expected_counts: { structuralViolations: 0, enumMismatches: 1, undocumentedFields: 0 },
  expected_fields: { enumMismatches: ["status"] },
};

const deliberatelyWrongEval: StructuralEvalDef = {
  ...cleanEval,
  id: 903,
  expected_counts: { structuralViolations: 1, enumMismatches: 0, undocumentedFields: 0 },
};

let failed = false;

function check(label: string, evalDef: StructuralEvalDef, expectAllPass: boolean) {
  const grades = runStructuralCheck(evalDef);
  const allPass = grades.every((g) => g.passed);
  if (allPass !== expectAllPass) {
    failed = true;
    console.error(`FAIL  ${label} — expected allPass=${expectAllPass}, got ${allPass}`);
    for (const g of grades) console.error(`  [${g.passed ? "PASS" : "FAIL"}] ${g.text} — ${g.evidence}`);
  } else {
    console.log(`PASS  ${label}`);
  }
}

check("clean fixture, correct expectations", cleanEval, true);
check("enum-only fixture, correct expectations", enumOnlyEval, true);
check("clean fixture, deliberately wrong expected count", deliberatelyWrongEval, false);

if (failed) {
  console.error("\nstructural-check self-test failed.");
  process.exit(1);
}
console.log("\nAll structural-check self-tests passed.");
