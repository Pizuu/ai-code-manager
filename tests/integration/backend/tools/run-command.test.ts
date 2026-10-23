import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { clampTimeout, runCommand, shellFor } from '../../../../src/backend/tools/run-command.ts';

const cwd = os.tmpdir();

test('uses PowerShell on Windows with a UTF-8 preamble and bash elsewhere', () => {
  const win = shellFor('win32', 'Get-ChildItem');
  assert.equal(win.file, 'powershell.exe');
  assert.ok(win.args.includes('-NonInteractive'));
  assert.ok((win.args[win.args.length - 1] ?? '').endsWith('Get-ChildItem'));
  assert.deepEqual(shellFor('linux', 'ls'), { file: 'bash', args: ['-lc', 'ls'], label: 'bash' });
});

test('clamps timeouts to the contract limits', () => {
  assert.equal(clampTimeout(undefined), 120_000);
  assert.equal(clampTimeout(-5), 120_000);
  assert.equal(clampTimeout(10_000_000), 600_000);
});

test('captures stdout, stderr and the exit code', { skip: process.platform === 'win32' }, async () => {
  const chunks: string[] = [];
  const r = await runCommand({ command: 'echo out; echo err 1>&2; exit 3', cwd, timeoutMs: 10_000, signal: new AbortController().signal, onData: (_s, d) => chunks.push(d) });
  assert.equal(r.exitCode, 3);
  assert.match(r.output, /out/);
  assert.match(r.output, /err/);
  assert.ok(chunks.length >= 1);
});

test('kills the process tree on timeout', { skip: process.platform === 'win32' }, async () => {
  const started = Date.now();
  const r = await runCommand({ command: 'sleep 5', cwd, timeoutMs: 200, signal: new AbortController().signal, onData: () => {} });
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - started < 4000);
});

test('stops when the signal aborts', { skip: process.platform === 'win32' }, async () => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 100);
  const r = await runCommand({ command: 'sleep 5', cwd, timeoutMs: 10_000, signal: ac.signal, onData: () => {} });
  assert.equal(r.aborted, true);
});
