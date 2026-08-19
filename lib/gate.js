/**
 * 自动执行闸:命中即拒绝自动执行(修复结果照常返回)。
 * 沙箱/审批由宿主 ctx.shell 负责;此闸只拦"语义上就危险"的命令,
 * 避免 agent 拿修复结果做破坏性操作。
 */

const SIMPLE_PATTERNS = [
  /\bFormat-Volume\b/i,
  /\bClear-Disk\b/i,
  /\bRemove-Partition\b/i,
  /\bSet-ExecutionPolicy\b/i,
  /\bdel\s+\/[sq]\b/i,
  /\brmdir\s+\/[sq]\b/i,
  /\brm\s+-[A-Za-z]*r[A-Za-z]*\s+["']?(?:\/|~|\*|\$HOME)["']?(?:\s|$|;|&|\|)/,
  // 系统/环境持久化写入(实验 S12 暴露:setx 等绕过修复规则直达执行)
  /\bsetx\b/i,
  /\[Environment\]::Set/i,
  /\bNew-ItemProperty\b/i,
  /\bSet-ItemProperty\b/i,
  /\breg\s+add\b/i,
];

/** 根目标:`/`、`\`、`~`、`*`、`$HOME`、`X:`、`X:\`(可带引号)。 */
const ROOT_TARGET = /^(?:["']?)(?:[A-Za-z]:\\?|\\|\/|~|\*|\$HOME)(?:["']?)$/i;

function firstPathTokenAfter(command, cmdRe) {
  const tokens = command.split(/\s+/);
  const idx = tokens.findIndex((t) => cmdRe.test(t));
  if (idx < 0) return null;
  for (const t of tokens.slice(idx + 1)) {
    if (t.startsWith("-")) continue;
    return t.replace(/[|;&].*$/, "").replace(/^["']|["']$/g, "");
  }
  return null;
}

/** 返回拒绝原因;null = 放行。 */
export function executionGate(command) {
  for (const re of SIMPLE_PATTERNS) {
    if (re.test(command)) return `matches dangerous pattern: ${re.source}`;
  }
  if (/\bRemove-Item\b/i.test(command) && /-Recurse\b/i.test(command)) {
    const target = firstPathTokenAfter(command, /^Remove-Item$/i);
    if (target !== null && ROOT_TARGET.test(target)) {
      return `Remove-Item -Recurse on root target '${target}'`;
    }
  }
  return null;
}
