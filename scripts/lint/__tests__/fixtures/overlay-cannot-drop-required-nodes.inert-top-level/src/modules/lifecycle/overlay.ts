const REQUIRED_NODES = ["D5", "product.qa", "ops.first-run", "D8"];
const missing = REQUIRED_NODES.filter((n) => !n);
export const summary = `required: ${missing.length}`;
