import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validate } from "./validate-schema.js";

const SPEC = "evals/orders/schema.yaml";

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
    response: "evals/orders/response_02.json",
    structural: 2,
    enumMismatches: 1,
    undocumented: 1,
  },
  {
    label: "clean fixture (order_response_clean.json)",
    response: "evals/orders/response_01.json",
    structural: 0,
    enumMismatches: 0,
    undocumented: 0,
  },
  {
    label: "injection fixture (order_response_injection.json)",
    response: "evals/orders/response_09.json",
    structural: 0,
    enumMismatches: 0,
    undocumented: 1,
  },
  {
    label: "enum-only fixture (order_response_enum_only.json)",
    response: "evals/orders/response_03.json",
    structural: 0,
    enumMismatches: 1,
    undocumented: 0,
  },
  {
    label: "undocumented-only fixture (order_response_undocumented_only.json)",
    response: "evals/orders/response_04.json",
    structural: 0,
    enumMismatches: 0,
    undocumented: 1,
  },
  {
    label: "optional-absent fixture (order_response_optional_absent.json)",
    response: "evals/orders/response_05.json",
    structural: 0,
    enumMismatches: 0,
    undocumented: 0,
  },
  {
    label: "invalid-format fixture (order_response_invalid_format.json)",
    response: "evals/orders/response_06.json",
    structural: 2,
    enumMismatches: 0,
    undocumented: 0,
  },
  {
    label: "missing-id fixture (order_response_missing_id.json)",
    response: "evals/orders/response_07.json",
    structural: 1,
    enumMismatches: 0,
    undocumented: 0,
  },
  {
    label: "type-mismatch fixture (order_response_type_mismatch.json)",
    response: "evals/orders/response_08.json",
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
