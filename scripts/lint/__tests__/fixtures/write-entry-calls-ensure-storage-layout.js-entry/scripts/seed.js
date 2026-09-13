const { writeFileSync } = require("node:fs");
writeFileSync(`${process.cwd()}/.guild/wiki/glossary.md`, "# glossary\n");
