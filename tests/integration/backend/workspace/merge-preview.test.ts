import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConflictFiles, previewMerge } from '../../../../src/backend/workspace/merge-preview.ts';
import { createGitRunner } from '../../../../src/backend/workspace/git.ts';
import { tempProject } from '../helpers/temp-project.ts';
import { gitIn } from '../helpers/temp-repo.ts';

test('parseConflictFiles picks up both CONFLICT lines and stage lines', () => {
  const out = [
    '3dcd37679c823c614c924e50bda7c4c5aa5c0684',
    '100644 c0d0fb45c382919737f8d0c20aaf57cf89b74af8 1\ta.txt',
    '100644 438e5f357f2bd75de72be483385e9f601541a8a9 2\ta.txt',
    '100644 536313deb11ce0e9f885594d8eaaa889f9115b3f 3\ta.txt',
    '',
    'Auto-merging a.txt',
    'CONFLICT (content): Merge conflict in a.txt',
  ].join('\n');
  assert.deepEqual(parseConflictFiles(out), ['a.txt']);
  assert.deepEqual(parseConflictFiles('CONFLICT (add/add): Merge conflict in dir/b.txt'), ['dir/b.txt']);
  assert.deepEqual(parseConflictFiles('no conflicts here'), []);
});

test('previewMerge reports clean when the branches touch different files', async (t) => {
  const root = await tempProject(t, { 'base.txt': 'base\n' });
  const git = gitIn(root);
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  git('checkout', '-q', '-b', 'feature');
  await (await import('node:fs/promises')).writeFile(`${root}/feat.txt`, 'f\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'feature');
  git('checkout', '-q', 'main');
  await (await import('node:fs/promises')).writeFile(`${root}/mast.txt`, 'm\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'main');

  const r = await previewMerge(createGitRunner(root), 'main', 'feature');
  assert.equal(r.result, 'clean');
  assert.deepEqual(r.files, []);
});

test('previewMerge reports the conflicting files when the same file changed on both sides', async (t) => {
  const root = await tempProject(t, { 'a.txt': 'line1\nline2\n' });
  const git = gitIn(root);
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  git('checkout', '-q', '-b', 'feature');
  await (await import('node:fs/promises')).writeFile(`${root}/a.txt`, 'line1\nFEATURE\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'feature');
  git('checkout', '-q', 'main');
  await (await import('node:fs/promises')).writeFile(`${root}/a.txt`, 'line1\nMASTER\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'main');

  const r = await previewMerge(createGitRunner(root), 'main', 'feature');
  assert.equal(r.result, 'conflict');
  assert.deepEqual(r.files, ['a.txt']);
});

test('previewMerge says "unknown" instead of pretending clean when the ref is missing', async (t) => {
  const root = await tempProject(t, { 'a.txt': 'x\n' });
  const git = gitIn(root);
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  const r = await previewMerge(createGitRunner(root), 'main', 'no-such-branch');
  assert.equal(r.result, 'unknown');
  assert.ok(r.reason);
});
