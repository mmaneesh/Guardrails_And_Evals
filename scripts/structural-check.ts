import { validate } from "./validate-schema.js";
import type { JudgeGrade, StructuralEvalDef } from "./config.js";

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
