import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bashPatternToRegExp, laneCheck, owningLane, parseAgentsConfig, parseLaneOwners, parseLanesConf } from '../../../../src/backend/workspace/lanes.ts';

const CONF = fs.readFileSync(new URL('../../../../.agents/lanes.conf', import.meta.url), 'utf8');

test('parses lanes.conf of this repository including @shared', () => {
  const cfg = parseLanesConf(CONF);
  assert.deepEqual(cfg.lanes.map((l) => l.name), ['contracts', 'frontend', 'backend', 'docs', 'infra']);
  assert.ok(cfg.shared.includes('AGENTS.md'));
  assert.ok(cfg.shared.includes('package.json'));
});

test('bash pattern semantics: * crosses directories, ? one char, classes', () => {
  assert.ok(bashPatternToRegExp('src/backend/*').test('src/backend/a/b/c.ts'));
  assert.ok(bashPatternToRegExp('tests/*/backend/*').test('tests/unit/backend/x.test.ts'));
  assert.equal(bashPatternToRegExp('docs/*').test('docsx/a'), false);
  assert.ok(bashPatternToRegExp('a?.md').test('ab.md'));
  assert.ok(bashPatternToRegExp('[ab].txt').test('b.txt'));
  assert.equal(bashPatternToRegExp('a.md').test('aXmd'), false);
});

test('laneCheck mirrors scripts/check-lane.sh (shared first, ! exclusions)', () => {
  const cfg = parseLanesConf(CONF);
  assert.equal(laneCheck(cfg, 'src/frontend/main.ts', 'frontend').ok, true);
  assert.equal(laneCheck(cfg, 'src/backend/main.ts', 'frontend').ok, false);
  assert.match(laneCheck(cfg, 'package.json', 'infra').why, /共享热点/);
  assert.equal(laneCheck(cfg, 'docs/testing/test-matrix.md', 'docs').ok, true);
  assert.equal(laneCheck(cfg, 'docs/architecture/overview.md', 'docs').ok, false);
  assert.equal(laneCheck(cfg, 'docs/architecture/overview.md', 'contracts').ok, true);
  assert.equal(laneCheck(cfg, 'docs/tasks/BOARD.md', 'docs').ok, false);
  assert.equal(owningLane(cfg, 'docs/tasks/BOARD.md'), null);
  assert.equal(owningLane(cfg, 'AGENTS.md'), '@shared');
  assert.equal(owningLane(cfg, '.specify/memory/constitution.md'), 'contracts');
});

test('parses config.sh and lane owners table', () => {
  const c = parseAgentsConfig('MAIN_BRANCH="main"\nINTEGRATION_BRANCH="hark-dev"\nMAX_PARALLEL=4\nBRANCH_PREFIX="feat"\n');
  assert.deepEqual(c, { mainBranch: 'main', integrationBranch: 'hark-dev', branchPrefix: 'feat', maxParallel: 4 });
  assert.deepEqual(parseAgentsConfig(null), { mainBranch: 'main', integrationBranch: 'dev', branchPrefix: 'feat', maxParallel: null });
  assert.deepEqual(parseLaneOwners('| `frontend` | worker | x |\n| `infra` | coordinator | y |'), { frontend: 'worker', infra: 'coordinator' });
});
