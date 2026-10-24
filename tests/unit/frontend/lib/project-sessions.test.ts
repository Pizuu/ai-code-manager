import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameProject, sessionsOfProject } from '../../../../src/frontend/lib/project-sessions.ts';

test('按项目过滤会话；无项目只留 projectPath 为 null 的会话', () => {
  const list = [
    { id: 'a', projectPath: 'C:\\code\\one' },
    { id: 'b', projectPath: 'C:\\code\\two' },
    { id: 'c', projectPath: null },
  ];
  assert.deepEqual(sessionsOfProject(list, 'C:\\code\\one').map((s) => s.id), ['a']);
  assert.deepEqual(sessionsOfProject(list, null).map((s) => s.id), ['c']);
  assert.deepEqual(sessionsOfProject(list, 'D:\\none'), []);
});

test('路径归一：分隔符、末尾分隔符、Windows 盘符大小写', () => {
  assert.equal(sameProject('C:\\Code\\One\\', 'c:/code/one'), true);
  assert.equal(sameProject('/home/u/Proj', '/home/u/proj'), false);
  assert.equal(sameProject('/home/u/proj/', '/home/u/proj'), true);
  assert.equal(sameProject(null, undefined), true);
  assert.equal(sameProject(null, '/x'), false);
});
