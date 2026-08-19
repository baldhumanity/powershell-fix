/**
 * 修复编排:预处理 → fix 规则按序应用 → warn 规则(对原文扫描)。
 * 纯函数,可单测;幂等:fix(fix(x)).fixed === fix(x).fixed。
 */

import { hostPlatform, resolveShell } from "./detect.js";
import { FIX_RULES, WARN_RULES } from "./rules.js";

export function fix(command, opts = {}) {
  const platform = opts.platform ?? hostPlatform();
  const shell = resolveShell(opts.shell, platform);
  const env = { platform, shell };

  let text = command;
  const fixes = [];
  if (text.startsWith("\uFEFF")) {
    text = text.slice(1);
    fixes.push({ rule: "NORM_BOM", notes: ["stripped UTF-8 BOM"] });
  }
  for (const rule of FIX_RULES) {
    if (!rule.applies(env)) continue;
    const res = rule.run(text, env);
    if (res.text !== text) {
      fixes.push({ rule: rule.id, notes: res.notes });
      text = res.text;
    }
  }

  // warn 规则扫描**原始**命令(修复可能已消除 bash 痕迹)
  const warnings = [];
  for (const rule of WARN_RULES) {
    if (!rule.applies(env)) continue;
    const res = rule.run(command, env);
    for (const note of res.notes) warnings.push({ rule: rule.id, note });
  }

  return { fixed: text, changed: text !== command, fixes, warnings, platform, shell };
}
