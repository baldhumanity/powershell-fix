import test from "node:test";
import assert from "node:assert/strict";
import { hostPlatform, resolveShell, isWindowsShell, looksLikePowerShell, detectWindowsEngine, engineBinary } from "../lib/detect.js";

test("resolveShell: auto on win32 resolves a real windows engine", () => {
  const s = resolveShell("auto", "win32");
  assert.ok(["pwsh", "powershell51"].includes(s), `got ${s}`);
  assert.equal(resolveShell(undefined, "win32"), s);
});

test("detectWindowsEngine: stable cached result + binary mapping", () => {
  const e = detectWindowsEngine();
  assert.ok(["pwsh", "powershell51"].includes(e));
  assert.equal(detectWindowsEngine(), e);
  assert.ok(["pwsh", "powershell"].includes(engineBinary(e)));
});

test("resolveShell: auto maps linux/darwin to bash", () => {
  assert.equal(resolveShell("auto", "linux"), "bash");
  assert.equal(resolveShell(undefined, "darwin"), "bash");
});

test("resolveShell: explicit override wins", () => {
  assert.equal(resolveShell("powershell51", "win32"), "powershell51");
  assert.equal(resolveShell("pwsh", "linux"), "pwsh");
  assert.equal(resolveShell("bash", "win32"), "bash");
});

test("isWindowsShell", () => {
  assert.equal(isWindowsShell("pwsh"), true);
  assert.equal(isWindowsShell("powershell51"), true);
  assert.equal(isWindowsShell("bash"), false);
});

test("hostPlatform returns a node platform string", () => {
  assert.ok(["win32", "linux", "darwin"].includes(hostPlatform()));
});

test("looksLikePowerShell detects cmdlets/$env/params", () => {
  assert.equal(looksLikePowerShell("Get-ChildItem -Force"), true);
  assert.equal(looksLikePowerShell("$env:FOO = '1'"), true);
  assert.equal(looksLikePowerShell("Select-String -Pattern x -CaseSensitive"), true);
  assert.equal(looksLikePowerShell("export FOO=1"), false);
  assert.equal(looksLikePowerShell("ls -la"), false);
});
