import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interactiveArgs, shellCommand, TerminalManager } from '../../../../src/backend/terminal/terminal-manager.ts';

test('shell command is PowerShell on Windows and bash elsewhere', () => {
  const win = shellCommand('win32');
  assert.equal(win.file, 'powershell.exe');
  assert.deepEqual(win.args, ['-NoLogo', '-NoProfile', '-Command', '-']);
  assert.equal(win.program, 'PowerShell');
  const posix = shellCommand('linux');
  assert.equal(posix.file, '/bin/bash');
  assert.deepEqual(posix.args, ['--noprofile', '--norc', '-s']);
  assert.equal(posix.program, 'bash');
});

test('interactiveArgs drops the JSON output flags and keeps the rest', () => {
  assert.deepEqual(interactiveArgs(['run', '--format', 'json', '--dir', '{cwd}']), ['run', '--dir', '{cwd}']);
  assert.deepEqual(interactiveArgs(['run', '--format=json', '--dir', 'x']), ['run', '--dir', 'x']);
  // 非 json 的 format 参数保留
  assert.deepEqual(interactiveArgs(['run', '--format', 'text']), ['run', '--format', 'text']);
  assert.deepEqual(interactiveArgs([]), []);
});

test('terminal manager spawns a process, streams output and reports exit', async () => {
  const chunks: string[] = [];
  let exit: number | null | undefined;
  const manager = new TerminalManager({
    platform: process.platform,
    newId: () => 't-1',
    now: () => '2026-10-21T00:00:00.000Z',
    onData: (_sid, _id, data) => chunks.push(data),
    onExit: (_sid, _id, code) => { exit = code; },
  });
  const handle = manager.open({
    sessionId: 's1',
    kind: 'shell',
    cwd: process.cwd(),
    file: process.execPath,
    args: ['-e', 'process.stdout.write("hello-from-term")'],
    program: 'node',
  });
  assert.equal(handle.alive, true);
  assert.equal(handle.id, 't-1');
  assert.equal(manager.get('s1')?.id, 't-1');

  await new Promise<void>((resolve) => {
    const started = Date.now();
    const tick = (): void => {
      if (exit !== undefined || Date.now() - started > 8000) resolve();
      else setTimeout(tick, 20);
    };
    tick();
  });

  assert.match(chunks.join(''), /hello-from-term/);
  assert.equal(exit, 0);
  assert.equal(handle.alive, false);
  assert.equal(manager.get('s1'), null);
  manager.closeAll();
});

test('opening the same session twice reuses the live terminal; restart replaces it', async () => {
  const manager = new TerminalManager({
    platform: process.platform,
    newId: (() => {
      let n = 0;
      return () => `t-${++n}`;
    })(),
  });
  const spec = {
    sessionId: 's2',
    kind: 'shell' as const,
    cwd: process.cwd(),
    file: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 5000)'],
    program: 'node',
  };
  const first = manager.open(spec);
  const again = manager.open(spec);
  assert.equal(again.id, first.id);
  const restarted = manager.open(spec, true);
  assert.notEqual(restarted.id, first.id);
  manager.closeAll();
});

test('write on a missing terminal returns false; close is idempotent', () => {
  const manager = new TerminalManager({ platform: process.platform });
  assert.equal(manager.write('nope', 'ls\n'), false);
  manager.close('nope');
  assert.equal(manager.size, 0);
});
