import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { stackContractBundle as bundle, stackP05Schemas as p05, stackManagedSchemas as managed } from "../../src/domains/lifecycle";

export function stackValidator(extraSchemas: object[] = [], formats: Record<string, (value: string) => boolean> = {}): (schema: string, value: unknown) => void {
  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
    allowUnionTypes: true,
  });
  addFormats(ajv);
  for (const [name, check] of Object.entries(formats)) ajv.addFormat(name, check);
  for (const schema of Object.values(bundle.schemas)) ajv.addSchema(schema);
  ajv.addSchema(p05);
  ajv.addSchema(managed);
  for (const schema of extraSchemas) ajv.addSchema(schema);
  return (schema, value) => {
    const check = ajv.getSchema(schema) ?? ajv.compile({ $ref: schema });
    if (!check(value))
      throw new Error(
        "stack contract refused: " + ajv.errorsText(check.errors),
      );
  };
}
