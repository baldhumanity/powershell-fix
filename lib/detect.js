/**
 * 平台与 shell 识别。
 *
 * shell 取值:
 * - `pwsh`          PowerShell 7+(&& / || 原生可用)
 * - `powershell51`  Windows PowerShell 5.1(需拆 && / || 链)
 * - `bash`          Linux/macOS 默认
 *
 * 重要:win32 宿主上"pwsh 工具"实际可能跑的是 powershell.exe 5.1
 * (本机即如此——无 pwsh 7 安装)。因此 auto 解析必须探测真实引擎,
 * 不能默认 7+。
 */

import { spawnSync } from "node:child_process";

export function hostPlatform() {
  return process.platform === "win32" ? "win32" : process.platform;
}

let _engineCache = null;

/** 探测本机 Windows PowerShell 引擎:'pwsh'(7+)或 'powershell51'。结果缓存。 */
export function detectWindowsEngine() {
  if (_engineCache !== null) return _engineCache;
  try {
    const p = spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
      encoding: "utf-8",
      timeout: 5000,
      windowsHide: true,
    });
    const major = p.status === 0 ? parseInt((p.stdout ?? "").trim(), 10) : NaN;
    _engineCache = Number.isFinite(major) && major >= 7 ? "pwsh" : "powershell51";
  } catch {
    _engineCache = "powershell51";
  }
  return _engineCache;
}

/** 引擎对应的可执行文件名(E2E/诊断用)。 */
export function engineBinary(engine) {
  return engine === "pwsh" ? "pwsh" : "powershell";
}

/** explicit: 'auto' | 'pwsh' | 'powershell51' | 'bash' */
export function resolveShell(explicit, platform) {
  if (explicit && explicit !== "auto") return explicit;
  if (platform === "win32") return detectWindowsEngine();
  return "bash";
}

export function isWindowsShell(shell) {
  return shell === "pwsh" || shell === "powershell51";
}

/** PowerShell 特征探测(用于"已是正确 PS 命令"的放行判断)。 */
const POWERSHELL_HINTS = [
  /^\s*[A-Z][a-z]+-[A-Z][A-Za-z]*\b/m,   // Verb-Noun cmdlet 前缀
  /\$env:[A-Za-z_]/,                      // 环境变量正确写法
  /\|\s*(?:Out-|Select-|Where-|ForEach-|Sort-|Group-|Measure-)/, // cmdlet 管道
  /`\s*$/m,                               // 反引号续行
  /-(?:ErrorAction|Recurse|Force|ItemType|TotalCount|Tail)\b/, // 常见 PS 参数
];

export function looksLikePowerShell(text) {
  return POWERSHELL_HINTS.some((re) => re.test(text));
}
