/**
 * 打包产物 asar 内容核对（T041 / T214，卡片 T-012）。
 *
 *   node scripts/check-asar.ts                 # 自动查找 release/**\/app.asar 并逐个核对
 *   node scripts/check-asar.ts <app.asar> ...  # 核对指定的 asar
 *   node scripts/check-asar.ts --list <asar>   # 只列出 asar 内文件
 *   node scripts/check-asar.ts --self-test     # 生成合成 asar 自测解析与规则（不依赖打包）
 *
 * 规则：
 * - 禁止：任何以 `src/frontend/web/`、`scripts/` 开头的路径（T214：Web 预览与开发脚本不得进入打包），
 *   以及它们的编译产物 `dist/src/frontend/web/`、`dist/scripts/` 和 `dist/tests/`、`tests/`
 *   （与 package.json build.files 的排除项对应）。
 * - 必需：主进程入口、preload、渲染层入口、契约、index.html / styles.css、package.json
 *   （与 package.json `main` 与 build.files 对应）。
 *
 * 不引入依赖：直接解析 asar 头。asar 格式 = Pickle(uint32 4, uint32 headerPickleSize)
 * + Pickle(uint32 payloadSize, uint32 jsonLength, JSON 字符串) + 文件数据。只读取头部，不读整个文件。
 * 全部通过退出 0；任一违规、找不到 asar 或头部损坏退出 1。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_ROOT = path.resolve(import.meta.dirname, '..');

export const FORBIDDEN_PREFIXES = [
  'src/frontend/web/',
  'scripts/',
  'dist/src/frontend/web/',
  'dist/scripts/',
  'dist/tests/',
  'tests/',
] as const;

export const REQUIRED_ENTRIES = [
  'package.json',
  'dist/src/backend/main.js',
  'dist/src/backend/preload.cjs',
  'dist/src/frontend/main.js',
  'dist/contracts/ipc.js',
  'src/frontend/index.html',
  'src/frontend/styles.css',
] as const;

interface AsarFileNode {
  size?: number;
  offset?: string;
  unpacked?: boolean;
  link?: string;
}
interface AsarDirNode {
  files: Record<string, AsarNode>;
}
type AsarNode = AsarDirNode | AsarFileNode;

/** 读取 asar 头部 JSON，返回全部文件（不含目录）的 posix 相对路径，已排序。 */
export function listAsar(asarPath: string): string[] {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const pre = Buffer.alloc(16);
    if (size < 16 || fs.readSync(fd, pre, 0, 16, 0) !== 16) throw new Error('文件过短，不是 asar');
    const sizePickleLen = pre.readUInt32LE(0);
    const headerPickleSize = pre.readUInt32LE(4);
    const jsonLen = pre.readUInt32LE(12);
    if (sizePickleLen !== 4 || jsonLen === 0 || 16 + jsonLen > size || jsonLen + 8 > headerPickleSize) {
      throw new Error('asar 头部格式不符');
    }
    const json = Buffer.alloc(jsonLen);
    fs.readSync(fd, json, 0, jsonLen, 16);
    const header = JSON.parse(json.toString('utf8')) as AsarNode;
    if (!('files' in header)) throw new Error('asar 头部缺少 files');
    const out: string[] = [];
    const walk = (node: AsarDirNode, prefix: string): void => {
      for (const [name, child] of Object.entries(node.files)) {
        const p = prefix ? `${prefix}/${name}` : name;
        if ('files' in child) walk(child, p);
        else out.push(p);
      }
    };
    walk(header, '');
    return out.sort();
  } finally {
    fs.closeSync(fd);
  }
}

/** 按规则核对文件列表，返回违规描述（空数组 = 通过）。 */
export function checkEntries(entries: readonly string[]): string[] {
  const problems: string[] = [];
  for (const e of entries) {
    const bad = FORBIDDEN_PREFIXES.find((p) => e.startsWith(p));
    if (bad) problems.push(`禁止进入打包: ${e}（前缀 ${bad}）`);
  }
  const set = new Set(entries);
  for (const r of REQUIRED_ENTRIES) {
    if (!set.has(r)) problems.push(`缺少必需文件: ${r}`);
  }
  return problems;
}

function findAsars(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const found: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) found.push(...findAsars(p));
    else if (ent.isFile() && ent.name === 'app.asar') found.push(p);
  }
  return found;
}

/** 生成最小合法 asar（与 @electron/asar 相同的 Pickle 布局），仅供自测。 */
export function writeSyntheticAsar(file: string, files: Record<string, string>): void {
  const root: AsarDirNode = { files: {} };
  const chunks: Buffer[] = [];
  let offset = 0;
  for (const [p, content] of Object.entries(files)) {
    const parts = p.split('/');
    let dir = root;
    for (const seg of parts.slice(0, -1)) {
      dir.files[seg] ??= { files: {} };
      dir = dir.files[seg] as AsarDirNode;
    }
    const data = Buffer.from(content, 'utf8');
    dir.files[parts.at(-1) as string] = { size: data.length, offset: String(offset) };
    chunks.push(data);
    offset += data.length;
  }
  const json = Buffer.from(JSON.stringify(root), 'utf8');
  const pad = (4 - (json.length % 4)) % 4;
  const headerPickle = Buffer.alloc(8 + json.length + pad);
  headerPickle.writeUInt32LE(4 + json.length + pad, 0);
  headerPickle.writeUInt32LE(json.length, 4);
  json.copy(headerPickle, 8);
  const sizePickle = Buffer.alloc(8);
  sizePickle.writeUInt32LE(4, 0);
  sizePickle.writeUInt32LE(headerPickle.length, 4);
  fs.writeFileSync(file, Buffer.concat([sizePickle, headerPickle, ...chunks]));
}

function selfTest(): number {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-asar-'));
  const good = Object.fromEntries(REQUIRED_ENTRIES.map((r) => [r, `// ${r}`]));
  let failed = 0;
  const expect = (name: string, ok: boolean): void => {
    console.log(`${ok ? '✓' : '✗'} ${name}`);
    if (!ok) failed++;
  };
  try {
    const goodPath = path.join(tmp, 'good.asar');
    writeSyntheticAsar(goodPath, { ...good, 'dist/src/frontend/lib/dom.js': 'x' });
    const listed = listAsar(goodPath);
    expect('解析合成 asar 的嵌套目录', listed.includes('dist/src/frontend/lib/dom.js') && listed.length === REQUIRED_ENTRIES.length + 1);
    expect('合规 asar 通过', checkEntries(listed).length === 0);

    const badPath = path.join(tmp, 'bad.asar');
    writeSyntheticAsar(badPath, { ...good, 'src/frontend/web/boot.ts': 'x', 'scripts/web-dev.ts': 'y', 'dist/src/frontend/web/locator.js': 'z' });
    const badProblems = checkEntries(listAsar(badPath));
    expect('拦截 src/frontend/web/、scripts/、dist/src/frontend/web/', badProblems.length === 3);

    const missing: Record<string, string> = { ...good };
    delete missing['dist/src/backend/main.js'];
    const missPath = path.join(tmp, 'missing.asar');
    writeSyntheticAsar(missPath, missing);
    const missProblems = checkEntries(listAsar(missPath));
    expect('发现缺少主进程入口', missProblems.length === 1 && missProblems[0]?.includes('dist/src/backend/main.js') === true);

    expect('前缀匹配不误伤（src/frontend/webview.js、dist/src/frontend/scripts.js）', checkEntries([...REQUIRED_ENTRIES, 'src/frontend/webview.js', 'dist/src/frontend/scripts.js']).length === 0);

    const junk = path.join(tmp, 'junk.asar');
    fs.writeFileSync(junk, 'not an asar file at all');
    let threw = false;
    try {
      listAsar(junk);
    } catch {
      threw = true;
    }
    expect('损坏的 asar 抛错', threw);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failed === 0 ? '自测通过。' : `自测失败 ${failed} 项。`);
  return failed === 0 ? 0 : 1;
}

function main(argv: string[]): number {
  if (argv[0] === '--self-test') return selfTest();
  if (argv[0] === '--list') {
    for (const p of argv.slice(1)) for (const e of listAsar(p)) console.log(e);
    return 0;
  }
  const targets = argv.length > 0 ? argv.map((a) => path.resolve(a)) : findAsars(path.join(APP_ROOT, 'release'));
  if (targets.length === 0) {
    console.error('未找到 app.asar：请先 `npm run dist`，或传入 asar 路径。');
    return 1;
  }
  let bad = 0;
  for (const t of targets) {
    let problems: string[];
    let count = 0;
    try {
      const entries = listAsar(t);
      count = entries.length;
      problems = checkEntries(entries);
    } catch (err) {
      problems = [`无法读取: ${err instanceof Error ? err.message : String(err)}`];
    }
    if (problems.length === 0) {
      console.log(`✓ ${path.relative(APP_ROOT, t) || t}（${count} 个文件）`);
    } else {
      bad++;
      console.log(`✗ ${path.relative(APP_ROOT, t) || t}`);
      for (const p of problems) console.log(`    ${p}`);
    }
  }
  if (bad > 0) {
    console.error(`asar 核对失败：${bad} 个 asar 不合规。`);
    return 1;
  }
  console.log('asar 核对通过。');
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === import.meta.filename) {
  process.exitCode = main(process.argv.slice(2));
}
