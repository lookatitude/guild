// Writes the project's .guild/wiki tree on first run.
const target = process.env.GUILD_TARGET;
if (require.main === module) require("node:fs").mkdirSync(target, { recursive: true });
