import { Ajv, type ErrorObject } from "ajv";
import addFormatsImport from "ajv-formats";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { load } from "js-yaml";

// ajv-formats' CJS types don't resolve as callable under NodeNext's
// esModuleInterop — this is an upstream typing gap, not a runtime issue.
const addFormats = addFormatsImport as unknown as (ajv: Ajv) => Ajv;

type JsonSchema = {
  type: string;
  required?: string[];
  properties?: Record<string, any>;
};

type OpenApiSpec = {
  components: { schemas: { Order: JsonSchema } };
};

type EnumMismatch = {
  field: string;
  actualValue: unknown;
  allowedValues: unknown[];
  note: string;
};

type StructuralViolation = {
  field: string;
  issue: string;
  severity: "critical" | "medium";
};

type ValidationResult = {
  structuralViolations: StructuralViolation[];
  enumMismatches: EnumMismatch[];
  undocumentedFields: { field: string; value: unknown }[];
};

function loadOrderSchema(specPath: string): JsonSchema {
  const raw = readFileSync(specPath, "utf-8");
  const spec = load(raw) as OpenApiSpec;
  return spec.components.schemas.Order;
}

function splitEnumFromSchema(
  schema: JsonSchema
): [JsonSchema, Record<string, unknown[]>] {
  const clone: JsonSchema = JSON.parse(JSON.stringify(schema));
  const enumFields: Record<string, unknown[]> = {};
  for (const [field, prop] of Object.entries(clone.properties ?? {})) {
    if (prop.enum) {
      enumFields[field] = prop.enum;
      delete prop.enum;
    }
  }
  return [clone, enumFields];
}

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

function pathFromAjvError(err: ErrorObject): string[] {
  const base = err.instancePath.split("/").filter(Boolean);
  if (err.keyword === "required") {
    return [...base, (err.params as any).missingProperty];
  }
  return base;
}

export function validate(specPath: string, responsePath: string): ValidationResult {
  const orderSchema = loadOrderSchema(specPath);
  const [schemaNoEnum, enumFields] = splitEnumFromSchema(orderSchema);
  const response = JSON.parse(readFileSync(responsePath, "utf-8"));

  const rootRequired = new Set(schemaNoEnum.required ?? []);
  const itemSchema: { required?: string[] } = schemaNoEnum.properties?.items?.items ?? {};
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

  const enumMismatches: EnumMismatch[] = [];
  for (const [field, allowed] of Object.entries(enumFields)) {
    if (field in response && !allowed.includes(response[field])) {
      enumMismatches.push({
        field,
        actualValue: response[field],
        allowedValues: allowed,
        note: "Value not in declared enum - requires judgment on client impact, not an automatic failure.",
      });
    }
  }

  const declaredFields = new Set(Object.keys(orderSchema.properties ?? {}));
  const undocumentedFields = Object.keys(response)
    .filter((k) => !declaredFields.has(k))
    .map((k) => ({ field: k, value: response[k] }));

  return { structuralViolations, enumMismatches, undocumentedFields };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , specPath, responsePath] = process.argv;
  if (!specPath || !responsePath) {
    console.error("Usage: tsx validate-schema.ts <spec.yaml> <response.json>");
    process.exit(1);
  }
  console.log(JSON.stringify(validate(specPath, responsePath), null, 2));
}
