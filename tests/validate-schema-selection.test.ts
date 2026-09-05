import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { validate } from "../scripts/validate-schema.js";

test("validates an explicitly named component schema", () => {
  const dir = mkdtempSync(join(tmpdir(), "contract-drift-schema-"));
  try {
    const spec = join(dir, "users.yaml");
    const response = join(dir, "user.json");
    writeFileSync(spec, "components:\n  schemas:\n    User:\n      type: object\n      required: [id]\n      properties:\n        id: { type: string }\n");
    writeFileSync(response, '{"id":"u-1"}');

    assert.deepEqual(validate(spec, response, "User"), {
      structuralViolations: [],
      enumMismatches: [],
      undocumentedFields: [],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
