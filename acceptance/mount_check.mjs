/**
 * powershell-fix mount acceptance:
 * 1. resolve the bare package name from the profile base (host resolution rule)
 * 2. export integrity (name/inject/Config/apply)
 * 3. simulated ctx mount: tool + prompt section registered
 * 4. live execute: broken command -> fixed -> run through fake shell;
 *    dangerous command -> skipped-dangerous; dry-run honored
 *
 * usage: node acceptance/mount_check.mjs <profile_web_dir>
 */

import path from "node:path";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [, , profileWeb] = process.argv;
if (!profileWeb) {
  console.error("usage: mount_check.mjs <profile_web_dir>");
  process.exit(2);
}

const profileRequire = createRequire(path.join(profileWeb, "package.json"));
const pkgPath = profileRequire.resolve("powershell-fix/package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
if (pkg.dsh?.bundle?.patch === undefined) throw new Error("package does not declare dsh.bundle.patch");
console.log(`resolved: ${path.join(path.dirname(pkgPath), pkg.main)} | dsh.bundle.patch: ${pkg.dsh.bundle.patch}`);

const mod = await import(pathToFileURL(path.join(path.dirname(pkgPath), pkg.main)).href);
if (typeof mod.name !== "string") throw new Error("bad export name");
if (!Array.isArray(mod.inject)) throw new Error("bad export inject");
if (typeof mod.apply !== "function") throw new Error("bad export apply");
if (typeof mod.Config !== "function" && typeof mod.Config !== "object") throw new Error("bad export Config");
console.log(`exports: name=${mod.name} inject=${JSON.stringify(mod.inject)}`);

const tools = [];
const sections = [];
const shellLog = [];
const ctx = {
  tools: { register: (d) => tools.push(d) },
  systemPrompt: { section: (s) => sections.push(s.name) },
  shellEnv: { collect: () => ({}) },
  shell: {
    resolve: (req) => req,
    run: async (req) => {
      shellLog.push(req.command);
      return { exitCode: 0, stdout: "ok", stderr: "", aborted: false };
    },
  },
};
mod.apply(ctx, { autoExecute: true, timeoutMs: 60000 });

const names = tools.map((t) => t.name);
console.log(`registered tools: ${names.join(", ")}`);
console.log(`prompt sections: ${sections.join(", ")}`);
if (!names.includes("powershell_fix")) throw new Error("powershell_fix not registered");
if (!sections.includes("tool:powershell_fix")) throw new Error("prompt section missing");

const doctor = tools.find((t) => t.name === "powershell_fix");

// case 1: broken command -> fixed -> executed (chain handling depends on host engine)
const env1 = await doctor.execute({ command: "export PSFIX_PROBE=1 && echo fixed" }, { signal: new AbortController().signal });
if (!env1.ok || !env1.changed) throw new Error(`case1 not fixed: ${JSON.stringify(env1).slice(0, 300)}`);
if (!env1.fixed.startsWith("$env:PSFIX_PROBE='1'")) throw new Error(`case1 export not fixed: ${env1.fixed}`);
if (env1.execution?.mode !== "auto" || env1.execution.exitCode !== 0) throw new Error(`case1 execution failed: ${JSON.stringify(env1.execution)}`);
console.log(`case1: engine=${env1.shell} | fixed to ${JSON.stringify(env1.fixed)} | executed exit=${env1.execution.exitCode}`);
if (shellLog[0] !== env1.fixed) throw new Error("shell did not receive the FIXED command");

// case 2: dangerous command -> never executed
const env2 = await doctor.execute({ command: "rm -rf /" }, { signal: new AbortController().signal });
if (env2.execution?.mode !== "skipped-dangerous") throw new Error(`case2 not gated: ${JSON.stringify(env2.execution)}`);
console.log(`case2: dangerous command gated (${env2.execution.reason.slice(0, 60)}...)`);

// case 3: dry-run does not execute
const before = shellLog.length;
const env3 = await doctor.execute({ command: "Get-Process", execute: false }, { signal: new AbortController().signal });
if (env3.execution?.mode !== "dry-run" || shellLog.length !== before) throw new Error("case3 dry-run leaked execution");
console.log("case3: dry-run honored");

console.log("MOUNT CHECK PASSED");
