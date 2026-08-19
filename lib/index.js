/**
 * powershell-fix — PowerShell command syntax checker & auto-fixer (DSH plugin).
 *
 * HOST-layer plugin: declares `dsh.bundle.patch` (see package.json), so once
 * installed into a profile it joins the profile's layer stack and mounts for
 * EVERY session on that profile — no preset line needed.
 *
 * Engine is pure-function and dependency-free (./fixer.js); this file only
 * registers the tool and the prompt section.
 *
 * Execution safety: fixed commands run through the host `ctx.shell` seam —
 * the same sandbox/approval/timeout policy as the built-in pwsh tool. The
 * plugin adds no privilege. Semantically destructive commands (see ./gate.js)
 * are fixed but never auto-executed.
 */

import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { hostPlatform } from "./detect.js";
import { fix } from "./fixer.js";
import { executionGate } from "./gate.js";

export const name = "powershell-fix";
export const inject = ["tools", "shell", "systemPrompt", "shellEnv"];

export const Config = z.object({
  /** Whether to auto-execute the fixed command (false = fix only, dry-run). */
  autoExecute: z.boolean().default(true),
  /** Cooperative tool-call timeout budget (ms). */
  timeoutMs: z.number().default(60000),
});

const MAX_OUTPUT_CHARS = 8000;

function toText(v) {
  if (typeof v === "string") return v;
  if (v && typeof v.text === "string") return v.text;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
  properties: {
    ok: { type: "boolean", required: true },
    platform: { type: "string" },
    shell: { type: "string" },
    original: { type: "string" },
    fixed: { type: "string" },
    changed: { type: "boolean" },
    fixes: { type: "array", items: { type: "object", additionalProperties: true } },
    warnings: { type: "array", items: { type: "object", additionalProperties: true } },
    execution: { type: "object", additionalProperties: true },
  },
};

export function apply(ctx, config) {
  const onWindows = process.platform === "win32";

  ctx.systemPrompt.section({
    name: "tool:powershell_fix",
    order: 216,
    text: onWindows
      ? "This host terminal is Windows PowerShell. Write native PowerShell syntax: $env:NAME for environment variables, backtick for line continuation, Get-ChildItem/Remove-Item/Select-String/Get-Content instead of ls flags/rm/grep/head/tail, $null instead of /dev/null; ';' or if ($?) {} instead of '&&' on Windows PowerShell 5.1. Never paste shell prompts or bash constructs into commands. When unsure about a command — especially multi-line commands, line continuations, or anything copied from bash/documentation — call powershell_fix first: it detects PowerShell syntax mistakes, auto-fixes them, and executes the corrected command through the normal sandbox/approval policy, returning exit code, stdout, and stderr. It never bypasses the sandbox or approval, and refuses to auto-execute destructive commands."
      : "The powershell_fix tool checks and fixes Windows PowerShell command syntax. This host is not Windows, so use it only when composing commands intended for a Windows PowerShell target.",
  });

  ctx.tools.register(defineTool({
    name: "powershell_fix",
    description: "Check a command for Windows PowerShell syntax mistakes (bash constructs like export/&&//dev/null/grep, wrong or missing line continuations, pasted shell prompts, CRLF pollution), auto-fix it to valid PowerShell, and execute the corrected command under the normal sandbox/approval policy. Use BEFORE hand-running a command you are unsure about, especially multi-line commands. Returns original/fixed/fixes/warnings plus execution results. Destructive commands are fixed but NOT auto-executed.",
    parameters: {
      command: { type: "string", required: true, description: "The command to check; may be multi-line." },
      shell: { type: "string", description: "Engine override: auto (default, detected), pwsh (7+), powershell51." },
      execute: { type: "boolean", description: "Whether to execute the (fixed) command; defaults to the plugin's autoExecute config. false = dry-run." },
      description: { type: "string", description: "Short description of what the command does (shown in the UI)." },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }],
    },
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (typeof args.command !== "string" || args.command.trim().length === 0) {
        throw new Error("command must be a non-empty string");
      }
      const platform = hostPlatform();
      const res = fix(args.command, { platform, shell: args.shell });
      const out = {
        ok: true,
        platform,
        shell: res.shell,
        original: args.command,
        fixed: res.fixed,
        changed: res.changed,
        fixes: res.fixes,
        warnings: res.warnings,
        execution: null,
      };

      const shouldRun = args.execute ?? config.autoExecute;
      if (!shouldRun) {
        out.execution = { mode: "dry-run" };
        return out;
      }

      const toRun = res.fixed;
      const gate = executionGate(toRun);
      if (gate !== null) {
        out.execution = { mode: "skipped-dangerous", reason: gate };
        return out;
      }

      const result = await ctx.shell.run(ctx.shell.resolve({
        command: toRun,
        dshEnv: ctx.shellEnv.collect(exec),
        ...(exec?.signal !== undefined ? { signal: exec.signal } : {}),
      }));
      if (result.aborted) {
        out.execution = { mode: "aborted" };
        return out;
      }
      out.execution = {
        mode: "auto",
        exitCode: result.exitCode ?? null,
        stdout: toText(result.stdout).slice(0, MAX_OUTPUT_CHARS),
        stderr: toText(result.stderr).slice(0, MAX_OUTPUT_CHARS),
      };
      return out;
    },
  }));
}
