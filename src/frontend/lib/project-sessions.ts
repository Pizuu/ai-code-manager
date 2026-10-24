/**
 * 会话与项目绑定：会话历史按 projectPath 归属项目，列表 / 待办 / 徽标只看当前项目的会话。
 * 未打开项目时只显示 projectPath 为 null 的会话。路径比较忽略分隔符差异、末尾分隔符与大小写
 * （Windows 盘符路径大小写不敏感；同一主进程写入的路径本应一致，这里只做兜底归一）。
 */
export function normalizeProjectPath(p: string | null | undefined): string | null {
  if (!p) return null;
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[A-Za-z]:/.test(s) ? s.toLowerCase() : s;
}

export function sameProject(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeProjectPath(a) === normalizeProjectPath(b);
}

export function sessionsOfProject<T extends { projectPath: string | null }>(sessions: readonly T[], projectRoot: string | null | undefined): T[] {
  return sessions.filter((s) => sameProject(s.projectPath, projectRoot));
}
