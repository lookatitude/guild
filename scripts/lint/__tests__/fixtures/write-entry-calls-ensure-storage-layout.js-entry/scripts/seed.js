const { writeFileSync } = require("node:fs");
if (require.main === module) {
  writeFileSync(`${process.cwd()}/.guild/wiki/glossary.md`, "# glossary\n");
}
