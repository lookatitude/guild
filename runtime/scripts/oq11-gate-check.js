#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// scripts/oq11-gate-check.ts
var oq11_gate_check_exports = {};
__export(oq11_gate_check_exports, {
  checkGate: () => checkGate,
  hardFailMessage: () => hardFailMessage
});
module.exports = __toCommonJS(oq11_gate_check_exports);
function autoApproveCovers(autoApprove, gate) {
  return autoApprove.includes("all") || autoApprove.includes(gate);
}
function checkGate(input) {
  const covered = autoApproveCovers(input.auto_approve, input.gate);
  const hard_fail = input.interactive === false && !covered && input.named_phase === false;
  const autonomy_granted = !hard_fail && input.interactive === false;
  return { hard_fail, exit_code: hard_fail ? 1 : 0, autonomy_granted };
}
function hardFailMessage(gate) {
  return [
    `error: interactive gate '${gate}' reached in a non-interactive context`,
    `       (no TTY) with no --auto-approve covering it and no explicit phase verb.`,
    ``,
    `Guild will not implicitly grant autonomy. Fix \u2014 name the phase and`,
    `pre-approve the soft gate explicitly, e.g.:`,
    ``,
    `  /guild build --auto-approve=spec,plan,build`,
    `  /guild qa`,
    `  /guild ops <runbook>`,
    ``,
    `exit: non-zero  \xB7  no gate auto-satisfied  \xB7  no gated action taken`
  ].join("\n");
}
function parseFlag(argv, name) {
  const eq = `--${name}=`;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}` && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
    if (argv[i].startsWith(eq)) return argv[i].slice(eq.length);
  }
  return void 0;
}
function hasFlag(argv, name) {
  return argv.includes(`--${name}`);
}
function main() {
  const argv = process.argv.slice(2);
  const gate = parseFlag(argv, "gate") ?? "plan";
  let interactive;
  if (hasFlag(argv, "interactive")) interactive = true;
  else if (hasFlag(argv, "non-interactive")) interactive = false;
  else interactive = Boolean(process.stdout.isTTY);
  const aaRaw = parseFlag(argv, "auto-approve");
  const auto_approve = aaRaw ? aaRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const named_phase = hasFlag(argv, "named-phase");
  const res = checkGate({ interactive, auto_approve, named_phase, gate });
  process.stdout.write(JSON.stringify(res) + "\n");
  if (res.hard_fail) {
    process.stderr.write(hardFailMessage(gate) + "\n");
  }
  process.exit(res.exit_code);
}
if (require.main === module) main();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  checkGate,
  hardFailMessage
});
