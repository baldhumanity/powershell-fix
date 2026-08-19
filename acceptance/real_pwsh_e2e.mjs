/**
 * 真实 pwsh 回环验收:fix() 的产物直接交给真实 pwsh 执行,
 * 证明修复结果是合法可运行的 PowerShell(§8.6 的 E2E 补充)。
 *
 * 用法:node acceptance/real_pwsh_e2e.mjs
 */

import { spawnSync } from "node:child_process";
import { fix } from "../lib/fixer.js";
import { detectWindowsEngine, engineBinary } from "../lib/detect.js";

const engine = detectWindowsEngine();
const bin = engineBinary(engine);
console.log(`host engine: ${engine} (binary: ${bin})`);

const CASES = [
  // [原始坏命令, 期望 exit 0]
  "export SD_E2E=42 && echo got-it",                                  // export + && 链
  "PS C:\\> Get-ChildItem \\\r\nPS C:\\>     -Name",                  // 提示符 + CRLF + bash 续行
  "head -n 2 C:\\Windows\\win.ini",                                   // head → Get-Content
  "unset SD_E2E",                                                     // unset → Remove-Item Env:
  "mkdir -p ./sd_e2e_tmp/nested",                                     // mkdir -p → New-Item
];

let green = 0;
for (const cmd of CASES) {
  const r = fix(cmd, { platform: "win32" });
  const p = spawnSync(bin, ["-NoProfile", "-Command", r.fixed], { encoding: "utf-8" });
  const pass = p.status === 0;
  green += pass ? 1 : 0;
  const err = (p.stderr ?? "").trim().slice(0, 100);
  console.log(`${pass ? "PASS" : "FAIL"} ${JSON.stringify(cmd).slice(0, 55)} -> ${JSON.stringify(r.fixed).slice(0, 75)} | exit ${p.status}${err ? ` | ${err}` : ""}`);
}
// 清理 mkdir -p 用例残留
spawnSync(bin, ["-NoProfile", "-Command", "Remove-Item ./sd_e2e_tmp -Recurse -Force -ErrorAction SilentlyContinue"]);
console.log(`${green}/${CASES.length} real-pwsh E2E cases green`);
process.exit(green === CASES.length ? 0 : 1);
