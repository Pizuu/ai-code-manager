import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadSpecTasks } from '../../../../src/backend/specs/tasks-parser.ts';
import { tempProject } from '../helpers/temp-project.ts';

const FIXTURES = path.resolve(import.meta.dirname, '../../../../contracts/fixtures');

test('loads specs/*/tasks.md from a project using the contract fixture', async (t) => {
  const sample = await fs.readFile(path.join(FIXTURES, 'tasks.sample.md'), 'utf8');
  const root = await tempProject(t, { 'specs/001-demo/tasks.md': sample, 'specs/002-empty/spec.md': '# no tasks' });
  const files = await loadSpecTasks(root);
  assert.equal(files.length, 1);
  assert.equal(files[0]?.relPath, 'specs/001-demo/tasks.md');
  assert.deepEqual(files[0]?.tasks.map((x) => x.id), ['T001', 'T002', 'T010', 'T011']);
});

test('returns an empty list when the project has no specs directory', async (t) => {
  assert.deepEqual(await loadSpecTasks(await tempProject(t)), []);
});
