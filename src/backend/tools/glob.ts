/**
 * 简单 glob → RegExp：支持 `**`、`*`、`?`、`{a,b}`。
 * 不含 `/` 的 glob 匹配文件名（basename），否则匹配相对路径。
 */

const REGEX_SPECIAL = /[.+^$()|[\]\\]/;

export function globToRegExp(glob: string): RegExp {
  let re = '';
  let inBraces = false;
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i] as string;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // "**/" 匹配零个或多个目录
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else if (ch === '{') {
      inBraces = true;
      re += '(?:';
    } else if (ch === '}' && inBraces) {
      inBraces = false;
      re += ')';
    } else if (ch === ',' && inBraces) {
      re += '|';
    } else if (REGEX_SPECIAL.test(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }
  return new RegExp(`^${re}$`);
}

/** relPath 使用 / 分隔。 */
export function matchesGlob(relPath: string, glob: string): boolean {
  const re = globToRegExp(glob);
  const target = glob.includes('/') ? relPath : relPath.slice(relPath.lastIndexOf('/') + 1);
  return re.test(target);
}
