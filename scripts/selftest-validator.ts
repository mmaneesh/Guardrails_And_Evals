import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validate } from "./validate-schema.js";

const SPEC = "evals/schemas/orders.yaml";

type Expectation = {
  label: string;
  response: string;
  structural: number;
  enumMismatches: number;
  undocumented: number;
};

const expectations: Expectation[] = [
  {
    label: "multiple contract drift fixture",
    response: "evals/responses/orders/mixed-drift.json",
    structural: 2,
    enumMismatches: 1,
    undocumented: 1,
  },
  {
    label: "valid order fixture",
    response: "evals/responses/orders/valid.json",
    structural: 0,
    enumMismatches: 0,
    undocumented: 0,
  },
  {
    label: "prompt injection fixture",
    response: "evals/responses/orders/prompt-injection.json",
    structural: 0,
    enumMismatches: 0,
    undocumented: 1,
  },
  {
    label: "status enum spelling drift fixture",
    response: "evals/responses/orders/enum-spelling.json",
    structural: 0,
    enumMismatches: 1,
    undocumented: 0,
  },
  {
    label: "undocumented shipping carrier fixture",
    response: "evals/responses/orders/extra-carrier.json",
    structural: 0,
    enumMismatches: 0,
    undocumented: 1,
  },
  {
    label: "optional discount code absent fixture",
    response: "evals/responses/orders/optional-absent.json",
    structural: 0,
    enumMismatches: 0,
    undocumented: 0,
  },
  {
    label: "invalid email and timestamp fixture",
    response: "evals/responses/orders/invalid-formats.json",
    structural: 2,
    enumMismatches: 0,
    undocumented: 0,
  },
  {
    label: "missing required ID fixture",
    response: "evals/responses/orders/missing-id.json",
    structural: 1,
    enumMismatches: 0,
    undocumented: 0,
  },
  {
    label: "item quantity type mismatch fixture",
    response: "evals/responses/orders/type-mismatch.json",
    structural: 1,
    enumMismatches: 0,
    undocumented: 0,
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

const tempDir = mkdtempSync("/tmp/contract-drift-validator-");
try {
  const nestedExtraPath = join(tempDir, "nested-extra.json");
  writeFileSync(
    nestedExtraPath,
    JSON.stringify({
      id: "550e8400-e29b-41d4-a716-446655440000",
      status: "pending",
      total_amount: 1,
      currency: "USD",
      created_at: "2026-01-01T00:00:00Z",
      items: [{ sku: "SKU-1", quantity: 1, unit_price: 1, internal_note: "untrusted" }],
      internal_root_note: "untrusted",
    })
  );
  const nestedResult = validate(SPEC, nestedExtraPath);
  const nestedFields = nestedResult.undocumentedFields.map((field) => field.field);
  if (!nestedFields.includes("items.0.internal_note") || !nestedFields.includes("internal_root_note")) {
    throw new Error(`nested undocumented fields were not detected: ${nestedFields.join(", ")}`);
  }
  console.log("PASS  nested undocumented fields");

  const malformedPath = join(tempDir, "malformed.json");
  writeFileSync(malformedPath, "{not-json");
  try {
    validate(SPEC, malformedPath);
    throw new Error("malformed JSON was accepted");
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith("Invalid response JSON:")) throw err;
  }
  console.log("PASS  malformed response JSON fails clearly");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

if (failed) {
  console.error("\nvalidate-schema.ts self-test failed — do not trust downstream evals until this passes.");
  process.exit(1);
}

console.log("\nAll validator self-tests passed.");
