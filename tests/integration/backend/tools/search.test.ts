import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSearchResult, searchFiles } from '../../../../src/backend/tools/search.ts';
import { tempProject } from '../helpers/temp-project.ts';

test('finds literal matches with path and line, skipping ignored dirs and binaries', async (t) => {
  const root = await tempProject(t, {
    'src/a.ts': 'const x = 1;\nconst needle = 2;\n',
    'docs/b.md': 'needle in docs\n',
    'node_modules/pkg/index.js': 'needle\n',
    'img.bin': Buffer.from([0, 1, 2, ...Buffer.from('needle')]),
  });
  const r = await searchFiles(root, { pattern: 'needle' });
  assert.deepEqual(r.matches.map((m) => `${m.path}:${m.line}`), ['docs/b.md:1', 'src/a.ts:2']);
});

test('supports regex, glob and sub-directory filters', async (t) => {
  const root = await tempProject(t, { 'src/a.ts': 'foo1\nfoo22\n', 'src/b.js': 'foo3\n', 'test/c.ts': 'foo4\n' });
  const r = await searchFiles(root, { pattern: 'foo\\d{2}', regex: true });
  assert.deepEqual(r.matches.map((m) => m.text), ['foo22']);
  const g = await searchFiles(root, { pattern: 'foo', glob: '*.ts', dir: 'src' });
  assert.deepEqual(g.matches.map((m) => m.path), ['src/a.ts', 'src/a.ts']);
});

test('truncates at max_results and reports invalid regex', async (t) => {
  const root = await tempProject(t, { 'a.txt': 'x\nx\nx\nx\n' });
  const r = await searchFiles(root, { pattern: 'x', maxResults: 2 });
  assert.equal(r.truncated, true);
  assert.match(formatSearchResult(r), /已截断/);
  await assert.rejects(searchFiles(root, { pattern: '(', regex: true }), /正则表达式无效/);
});

test('refuses to search outside the project root', async (t) => {
  const root = await tempProject(t);
  await assert.rejects(searchFiles(root, { pattern: 'x', dir: '..' }), /E_PATH_ESCAPE/);
});
