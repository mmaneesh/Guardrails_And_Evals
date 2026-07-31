import { validate } from "./validate-schema.js";

const SPEC = "evals/files/order_schema.yaml";

type Expectation = {
  label: string;
  response: string;
  structural: number;
  enumMismatches: number;
  undocumented: number;
};

const expectations: Expectation[] = [
  {
    label: "broken fixture (order_response.json)",
    response: "evals/files/order_response.json",
    structural: 2,
    enumMismatches: 1,
    undocumented: 1,
  },
  {
    label: "clean fixture (order_response_clean.json)",
    response: "evals/files/order_response_clean.json",
    structural: 0,
    enumMismatches: 0,
    undocumented: 0,
  },
  {
    label: "injection fixture (order_response_injection.json)",
    response: "evals/files/order_response_injection.json",
    structural: 0,
    enumMismatches: 0,
    undocumented: 1,
  },
];

let failed = false;

for (const expectation of expectations) {
  const result = validate(SPEC, expectation.response);
  const checks: [string, number, number][] = [
    ["structuralViolations", result.structuralViolations.length, expectation.structural],
    ["enumMismatches", result.enumMismatches.length, expectation.enumMismatches],
    ["undocumentedFields", result.undocumentedFields.length, expectation.undocumented],
  ];

  for (const [bucket, actual, expected] of checks) {
    if (actual !== expected) {
      failed = true;
      console.error(
        `FAIL  ${expectation.label} — ${bucket}: expected ${expected}, got ${actual}`
      );
    }
  }
  if (checks.every(([, actual, expected]) => actual === expected)) {
    console.log(`PASS  ${expectation.label}`);
  }
}

if (failed) {
  console.error("\nvalidate-schema.ts self-test failed — do not trust downstream evals until this passes.");
  process.exit(1);
}

console.log("\nAll validator self-tests passed.");
