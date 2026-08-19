import test from "node:test";
import assert from "node:assert/strict";
import { fix } from "../lib/fixer.js";
import { executionGate } from "../lib/gate.js";
import { FIX_RULES, WARN_RULES } from "../lib/rules.js";

const WIN = { platform: "win32" };
const WIN7 = { platform: "win32", shell: "pwsh" };
const WIN51 = { platform: "win32", shell: "powershell51" };

// ── 组合场景 ────────────────────────────────────────────────────────

test("combo: export + chain kept on pwsh7", () => {
  const r = fix("export A=1 && echo done", WIN7);
  assert.equal(r.fixed, "$env:A='1' && echo done");
  assert.ok(r.changed);
});

test("combo: export + chain split on powershell51", () => {
  const r = fix("export A=1 && echo done", WIN51);
  assert.equal(r.fixed, "$env:A='1'; if ($?) { echo done }");
});

test("combo: pasted multi-line with prompts, CRLF and bash continuation", () => {
  const input = "PS C:\\> Get-ChildItem \\\r\nPS C:\\>     -Force\r\n";
  const r = fix(input, WIN);
  assert.equal(r.fixed, "Get-ChildItem `\n    -Force\n");
  const ruleIds = r.fixes.map((f) => f.rule);
  assert.ok(ruleIds.includes("NORM_LINEENDINGS"));
  assert.ok(ruleIds.includes("STRIP_PROMPT"));
  assert.ok(ruleIds.includes("LC_BACKSLASH_TO_BACKTICK"));
});

test("combo: dev-null + grep together", () => {
  const r = fix("grep foo bar.txt > /dev/null", WIN);
  assert.equal(r.fixed, "Select-String -Pattern foo -Path bar.txt > $null");
});

test("BOM stripped", () => {
  const r = fix("\uFEFFGet-Process", WIN);
  assert.equal(r.fixed, "Get-Process");
});

// ── 幂等性:fix(fix(x)) == fix(x) ──────────────────────────────────

const IDEMPOTENCE_CASES = [
  "export FOO=bar",
  "unset FOO",
  "foo > /dev/null",
  "a && b",
  "ls -la C:\\x",
  "rm -rf ./build",
  "mkdir -p a/b/c",
  "touch f.txt",
  "grep -r foo src",
  "which node",
  "head -n 5 f.txt",
  "Get-ChildItem \\\n    -Force",
  "Get-ChildItem\n    -Force",
  "PS C:\\> Get-Process",
  "$ ls -la\n$ pwd",
  "Get-ChildItem `   \n    -Force",
  "export A=1 && echo $A",
  "export A=1 && unset A && echo ok",
];

test("idempotence across all fix cases (both explicit shells)", () => {
  for (const cmd of IDEMPOTENCE_CASES) {
    for (const opts of [WIN7, WIN51]) {
      const once = fix(cmd, opts);
      const twice = fix(once.fixed, opts);
      assert.equal(twice.fixed, once.fixed, `not idempotent: ${JSON.stringify(cmd)}`);
      assert.equal(twice.changed, false, `second pass must be no-op: ${JSON.stringify(cmd)}`);
    }
  }
});

// ── 执行闸 ──────────────────────────────────────────────────────────

test("gate blocks root-target recursion", () => {
  assert.notEqual(executionGate("Remove-Item C:\\ -Recurse"), null);
  assert.notEqual(executionGate("Remove-Item -Recurse C:\\"), null);
  assert.notEqual(executionGate("rm -rf /"), null);
  assert.notEqual(executionGate("rm -rf ~"), null);
  assert.notEqual(executionGate("Format-Volume -DriveLetter C"), null);
  assert.notEqual(executionGate("Set-ExecutionPolicy Unrestricted"), null);
  assert.notEqual(executionGate("del /s /q C:\\temp"), null);
});

test("gate blocks system/env persistence writes (experiment S12)", () => {
  assert.notEqual(executionGate("setx SDLAB_EVIL 1"), null);
  assert.notEqual(executionGate("[Environment]::SetEnvironmentVariable('User','X','1')"), null);
  assert.notEqual(executionGate("reg add HKCU\\Environment /v X /d 1"), null);
  assert.notEqual(executionGate("New-ItemProperty -Path Env: -Name X"), null);
});

test("gate allows ordinary commands", () => {
  assert.equal(executionGate("Remove-Item .\\build -Recurse -Force"), null);
  assert.equal(executionGate("Get-Process"), null);
  assert.equal(executionGate("rm -rf ./node_modules"), null);
  assert.equal(executionGate("New-Item -ItemType Directory a"), null);
});

// ── 规则表完整性 ────────────────────────────────────────────────────

test("rule tables: unique ids, severities consistent", () => {
  const all = [...FIX_RULES, ...WARN_RULES];
  const ids = all.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of FIX_RULES) assert.equal(r.severity, "fix");
  for (const r of WARN_RULES) assert.equal(r.severity, "warn");
});
