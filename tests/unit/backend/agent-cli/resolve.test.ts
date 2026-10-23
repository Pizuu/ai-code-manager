import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exeFromCmdShim, resolveExecutable, type ResolveDeps } from '../../../../src/backend/agent-cli/resolve.ts';
import path from 'node:path';

function deps(platform: NodeJS.Platform, files: Record<string, string>, pathEnv: string): ResolveDeps {
  return { platform, pathEnv, pathExt: '.COM;.EXE;.BAT;.CMD', isFile: async (p) => p in files, readText: async (p) => files[p] ?? null };
}

const NPM_SHIM = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe"   %*\r\n';

test('posix: finds the command on PATH', async () => {
  const r = await resolveExecutable('opencode', deps('linux', { '/usr/local/bin/opencode': '' }, '/usr/bin:/usr/local/bin'));
  assert.deepEqual(r, { ok: true, path: '/usr/local/bin/opencode' });
});

test('win32: prefers .exe via PATHEXT', async () => {
  const r = await resolveExecutable('opencode', deps('win32', { 'C:\\tools\\opencode.exe': '' }, 'C:\\Windows;C:\\tools'));
  assert.deepEqual(r, { ok: true, path: 'C:\\tools\\opencode.exe' });
});

test('win32: npm opencode.cmd shim is resolved to the real exe, never run through a shell', async () => {
  const npm = 'C:\\Users\\me\\AppData\\Roaming\\npm';
  const files = { [`${npm}\\opencode.cmd`]: NPM_SHIM, [`${npm}\\opencode`]: '#!/bin/sh', [`${npm}\\node_modules\\opencode-ai\\bin\\opencode.exe`]: '' };
  const r = await resolveExecutable('opencode', deps('win32', files, `C:\\Windows;${npm}`));
  assert.deepEqual(r, { ok: true, path: `${npm}\\node_modules\\opencode-ai\\bin\\opencode.exe` });
  assert.equal(exeFromCmdShim(`${npm}\\opencode.cmd`, NPM_SHIM, path.win32), `${npm}\\node_modules\\opencode-ai\\bin\\opencode.exe`);
});

test('win32: shim without a locatable exe is refused with guidance', async () => {
  const r = await resolveExecutable('tool', deps('win32', { 'C:\\x\\tool.cmd': 'echo hi' }, 'C:\\x'));
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /不经 shell 执行/);
});

test('missing command and explicit missing path', async () => {
  const a = await resolveExecutable('opencode', deps('linux', {}, '/usr/bin'));
  assert.match(a.ok ? '' : a.reason, /PATH 中找不到/);
  const b = await resolveExecutable('/opt/oc/opencode', deps('linux', {}, '/usr/bin'));
  assert.match(b.ok ? '' : b.reason, /不存在/);
  const c = await resolveExecutable('  ', deps('linux', {}, ''));
  assert.equal(c.ok, false);
});
