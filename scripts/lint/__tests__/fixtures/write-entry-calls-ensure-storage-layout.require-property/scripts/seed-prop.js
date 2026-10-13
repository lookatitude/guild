const save = require("fs").writeFileSync;
if (require.main === module) save(".guild/wiki/a", "x");
