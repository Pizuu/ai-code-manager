/** 集成测试辅助：创建带样例文件的临时项目目录，测试结束自动删除。 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function tempProject(
  t: { after: (fn: () => Promise<void>) => void },
  files: Record<string, string | Buffer> = {},
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-project-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
  return root;
}
