# powershell-fix

A **host-layer plugin** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) that detects and **auto-fixes Windows PowerShell command syntax mistakes** before they burn a tool-call round-trip — then executes the corrected command through the host shell seam, under the **normal sandbox/approval policy**.

AI agents (and humans) frequently paste bash-flavored commands into a Windows terminal. This plugin gives the agent one tool — `powershell_fix` — that checks, repairs, and runs such commands safely.

## What it fixes

**Line hygiene (the most frequent real-world breakage)**

| problem | fix |
|---|---|
| CRLF / stray `\r` from copy-paste | normalized to LF |
| pasted shell prompts (`PS C:\> `, `C:\> `, `$ ` on every line) | stripped |
| trailing whitespace after a continuation char (invisible breakage) | removed |
| bash `\` line continuation | PowerShell backtick |
| missing continuation before a `-Parameter` line | backtick inserted |
| dangling backtick before an empty line | removed |
| unbalanced quotes | warned (never blindly rewritten) |

**bash → PowerShell semantics**

| bash | PowerShell |
|---|---|
| `export NAME=value` | `$env:NAME='value'` (same-command `$NAME` refs rewritten to `$env:NAME`) |
| `unset NAME` | `if (Test-Path Env:NAME) { Remove-Item Env:NAME }` (guarded; inline-in-chain supported) |
| `> /dev/null`, `2> /dev/null`, `&> /dev/null` | `> $null`, `2> $null`, `*> $null` |
| `a && b` / `a || b` | kept on PowerShell 7+; split into `if ($?) { … }` on Windows PowerShell 5.1 (engine auto-detected) |
| `ls -la path` | `Get-ChildItem path -Force` |
| `rm -rf x` | `Remove-Item x -Recurse -Force` |
| `mkdir -p a/b/c` | `New-Item -ItemType Directory -Force …` |
| `touch f` | timestamp update or `New-Item -ItemType File` |
| `grep [-r] [-v] pat f…` | `Select-String` (recursion via `Get-ChildItem -Recurse`) |
| `which x` / `command -v x` | `(Get-Command x -ErrorAction SilentlyContinue).Source` |
| `head -n N f` / `tail -n N f` / `tail -f f` | `Get-Content -TotalCount N` / `-Tail N` / `-Wait` |
| `sed`, `awk`, `chmod`, bare `$PATH`-style env refs | warned with PowerShell equivalents (never blindly rewritten) |

Correct PowerShell passes through **unchanged** (no-op guarantee, covered by regression tests). The fixer is idempotent: `fix(fix(x)) === fix(x)`.

## Safety

- Execution goes through the host `ctx.shell` seam — **the same sandbox, approval, and timeout policy as the built-in pwsh tool**. This plugin adds no privilege.
- A built-in execution gate refuses to auto-execute semantically destructive commands even after fixing them: root-target recursive deletes (`rm -rf /`, `Remove-Item C:\ -Recurse`), `Format-Volume`, `Clear-Disk`, `Set-ExecutionPolicy`, `del /s|/q`, and environment/system persistence writes (`setx`, `[Environment]::Set*`, `New-ItemProperty`, `Set-ItemProperty`, `reg add`).
- `execute: false` (or `autoExecute: false` config) gives a dry-run: fix only, no execution.

## Install (host layer — available to every session)

The package declares `dsh.bundle.patch`, so installing it into a profile adds it to the profile's layer stack automatically — no agent-preset line needed:

```sh
dsh plugin --profile web add file:/path/to/powershell-fix
```

Reconciling notices the `dsh.bundle` declaration and appends `powershell-fix` to `dsh.profile.bundles`; the bundled `cordis.patch.yml` inserts the plugin row at the host layer. Restart the harness, and **every session** on that profile gets:

- tool `powershell_fix`
- a system-prompt section teaching native PowerShell syntax and when to call the tool

> Note: `pnpm` file: dependencies copy `lib/*.js` — after editing the source, delete `node_modules/powershell-fix` in the profile and re-run the `add` command ("Already up to date" is misleading).

## Tool contract

```jsonc
// powershell_fix({ command, shell?, execute?, description? })
{
  "ok": true,
  "platform": "win32",
  "shell": "powershell51",          // auto-detected engine: pwsh | powershell51
  "original": "export A=1 && echo $A",
  "fixed": "$env:A='1'; if ($?) { echo $env:A }",
  "changed": true,
  "fixes": [{ "rule": "ENV_EXPORT", "notes": ["…"] }],
  "warnings": [{ "rule": "BARE_VAR", "note": "…" }],
  "execution": { "mode": "auto", "exitCode": 0, "stdout": "…", "stderr": "…" }
  // execution.mode: auto | dry-run | skipped-dangerous | aborted
}
```

Config (cordis row / `dsh.bundle` defaults): `autoExecute` (default `true`), `timeoutMs` (default `60000`).

## Development

Zero runtime dependencies (engine is pure JS); peer deps `@deepseek-ai/dsh-tools` and `@deepseek-ai/schemastery` resolve from the host.

```sh
node --test                          # unit tests (engine, 57 assertions)
node acceptance/mount_check.mjs <profile_web_dir>   # mount + live-path check
node acceptance/real_pwsh_e2e.mjs    # fixed commands executed by the real engine
```

## 中文说明

DSH host 层插件:在 Windows 终端上自动检测并修复 PowerShell 命令语法错误(bash 语法、续行符错误、粘贴带入的提示符与 CRLF),修复后经宿主 shell 缝隙执行——沙箱/审批策略与内置 pwsh 工具完全一致,危险命令只修复不执行。声明 `dsh.bundle.patch`,装入 profile 即对所有会话生效,无需改任何 preset。

## License

MIT
