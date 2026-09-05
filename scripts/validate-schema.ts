import { Ajv, type ErrorObject } from "ajv";
import addFormatsImport from "ajv-formats";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { load } from "js-yaml";

const addFormats = addFormatsImport as unknown as (ajv: Ajv) => Ajv;

type JsonSchema = {
  type?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: unknown[];
  format?: string;
  [key: string]: unknown;
};

type OpenApiSpec = {
  components?: { schemas?: Record<string, JsonSchema> };
};

export type EnumMismatch = {
  field: string;
  actualValue: unknown;
  allowedValues: unknown[];
  note: string;
};

export type StructuralViolation = {
  field: string;
  issue: string;
  severity: "critical" | "medium";
};

export type UndocumentedField = {
  field: string;
  value: unknown;
};

export type ValidationResult = {
  structuralViolations: StructuralViolation[];
  enumMismatches: EnumMismatch[];
  undocumentedFields: UndocumentedField[];
};

/**
 * Loads one named component schema from an OpenAPI YAML file.
 */
function loadSchema(specPath: string, schemaName: string): JsonSchema {
  const raw = readFileSync(specPath, "utf-8");
  const spec = load(raw) as OpenApiSpec;
  const schema = spec.components?.schemas?.[schemaName];
  if (!schema || typeof schema !== "object") {
    throw new Error(`Unsupported OpenAPI spec: expected components.schemas.${schemaName}`);
  }
  return schema;
}

/**
 * Removes enum constraints recursively so Ajv reports structural facts while
 * enum mismatches remain a separate judgment input.
 */
function withoutEnums(schema: JsonSchema): JsonSchema {
  const clone: JsonSchema = { ...schema };
  delete clone.enum;
  if (schema.properties) {
    clone.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([field, property]) => [field, withoutEnums(property)])
    );
  }
  if (schema.items) clone.items = withoutEnums(schema.items);
  return clone;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findEnumMismatches(
  schema: JsonSchema,
  value: unknown,
  path: string[] = []
): EnumMismatch[] {
  const mismatches: EnumMismatch[] = [];
  if (schema.enum && !schema.enum.includes(value)) {
    mismatches.push({
      field: path.join(".") || "(root)",
      actualValue: value,
      allowedValues: schema.enum,
      note: "Value not in declared enum - requires judgment on client impact, not an automatic failure.",
    });
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => mismatches.push(...findEnumMismatches(schema.items!, item, [...path, String(index)])));
  } else if (isObject(value) && schema.properties) {
    for (const [field, property] of Object.entries(schema.properties)) {
      if (field in value) mismatches.push(...findEnumMismatches(property, value[field], [...path, field]));
    }
  }
  return mismatches;
}

function findUndocumentedFields(
  schema: JsonSchema,
  value: unknown,
  path: string[] = []
): UndocumentedField[] {
  if (Array.isArray(value) && schema.items) {
    return value.flatMap((item, index) => findUndocumentedFields(schema.items!, item, [...path, String(index)]));
  }
  if (!isObject(value) || !schema.properties) return [];

  const fields: UndocumentedField[] = [];
  for (const [field, fieldValue] of Object.entries(value)) {
    const fieldPath = [...path, field];
    const property = schema.properties[field];
    if (!property) {
      fields.push({ field: fieldPath.join("."), value: fieldValue });
      continue;
    }
    fields.push(...findUndocumentedFields(property, fieldValue, fieldPath));
  }
  return fields;
}

/**
 * Assigns 'critical' severity if a violated field is required, or 'medium' otherwise.
 */
function severityFor(
  errorPath: string[],
  keyword: string,
  rootRequired: Set<string>,
  itemRequired: Set<string>
): "critical" | "medium" {
  if (keyword === "required") return "critical";
  if (errorPath[0] === "items" && errorPath.length >= 3) {
    return itemRequired.has(errorPath[2]) ? "critical" : "medium";
  }
  if (errorPath.length && rootRequired.has(errorPath[0])) return "critical";
  return "medium";
}

/**
 * Converts an Ajv ErrorObject into a dot-separated property path.
 */
function pathFromAjvError(err: ErrorObject): string[] {
  const base = err.instancePath.split("/").filter(Boolean);
  if (err.keyword === "required") {
    return [...base, (err.params as any).missingProperty];
  }
  return base;
}

/**
 * Deterministically validates an API response against an OpenAPI spec.
 * Partitions results into 3 buckets: structural violations, enum mismatches, and undocumented fields.
 */
export function validate(specPath: string, responsePath: string, schemaName = "Order"): ValidationResult {
  const componentSchema = loadSchema(specPath, schemaName);
  const schemaNoEnum = withoutEnums(componentSchema);
  let response: unknown;
  try {
    response = JSON.parse(readFileSync(responsePath, "utf-8"));
  } catch (err) {
    throw new Error(`Invalid response JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  const rootRequired = new Set(schemaNoEnum.required ?? []);
  const itemSchema = schemaNoEnum.properties?.items?.items ?? {};
  const itemRequired = new Set(itemSchema.required ?? []);

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateFn = ajv.compile(schemaNoEnum);
  validateFn(response);

  const structuralViolations: StructuralViolation[] = (validateFn.errors ?? []).map(
    (err: ErrorObject) => {
      const path = pathFromAjvError(err);
      return {
        field: path.join(".") || "(root)",
        issue: `${err.instancePath || "(root)"} ${err.message}`,
        severity: severityFor(path, err.keyword, rootRequired, itemRequired),
      };
    }
  );

  const enumMismatches = findEnumMismatches(componentSchema, response);
  const undocumentedFields = findUndocumentedFields(componentSchema, response);

  return { structuralViolations, enumMismatches, undocumentedFields };
}

/**
 * Formats validation results into a structured human-readable terminal report.
 */
function printValidationReport(specPath: string, responsePath: string, result: ValidationResult): void {
  console.log("\n============================================================");
  console.log("              CONTRACT VALIDATION REPORT");
  console.log("============================================================");
  console.log(`Spec:     ${specPath}`);
  console.log(`Response: ${responsePath}`);
  console.log("Engine:   Deterministic Ajv Validator ($0.00 • Instant)");
  console.log("------------------------------------------------------------");

  // 1. Structural Violations
  console.log(`\n[1] Structural Violations: ${result.structuralViolations.length} found`);
  if (result.structuralViolations.length === 0) {
    console.log("    ✓ None (all required fields and types match spec)");
  } else {
    for (const v of result.structuralViolations) {
      console.log(`    ✗ [${v.severity.toUpperCase()}] ${v.field}: ${v.issue}`);
    }
  }

  // 2. Enum Mismatches
  console.log(`\n[2] Enum Mismatches: ${result.enumMismatches.length} found`);
  if (result.enumMismatches.length === 0) {
    console.log("    ✓ None (all enum values match declared spec)");
  } else {
    for (const m of result.enumMismatches) {
      console.log(`    ⚠️  ${m.field}: received "${String(m.actualValue)}"`);
      console.log(`       Allowed values: [${m.allowedValues.join(", ")}]`);
      console.log(`       Note: Factual mismatch — requires downstream judgment`);
    }
  }

  // 3. Undocumented Fields
  console.log(`\n[3] Undocumented Fields: ${result.undocumentedFields.length} found`);
  if (result.undocumentedFields.length === 0) {
    console.log("    ✓ None (no unlisted additive fields)");
  } else {
    for (const u of result.undocumentedFields) {
      console.log(`    ℹ  ${u.field}: ${JSON.stringify(u.value)} (additive field)`);
    }
  }

  console.log("\n============================================================");
  console.log(
    `Summary: ${result.structuralViolations.length} Structural, ` +
    `${result.enumMismatches.length} Enum Mismatches, ` +
    `${result.undocumentedFields.length} Undocumented Fields`
  );
  console.log("============================================================\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const schemaFlag = args.indexOf("--schema");
  const schemaName = schemaFlag >= 0 ? args[schemaFlag + 1] : "Order";
  const filtered = args.filter((a, index) => a !== "--json" && index !== schemaFlag && index !== schemaFlag + 1);
  const [specPath, responsePath] = filtered;

  if (!specPath || !responsePath) {
    console.error("Usage: tsx validate-schema.ts <spec.yaml> <response.json> [--schema ComponentName] [--json]");
    process.exit(1);
  }

  const result = validate(specPath, responsePath, schemaName);
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printValidationReport(specPath, responsePath, result);
  }
}
