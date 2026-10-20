import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OPENCODE_PRESET } from '../../../../src/backend/agent-cli/presets.ts';
import { SettingsStore, type KeyCipher } from '../../../../src/backend/settings/settings-store.ts';

const cipher = (available: boolean): KeyCipher => ({
  isAvailable: () => available,
  encrypt: (p) => Buffer.from(p).toString('hex'),
  decrypt: (e) => Buffer.from(e, 'hex').toString(),
});

async function file(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-cli-settings-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'settings.json');
}

const preset = () => ({ ...OPENCODE_PRESET, args: [...OPENCODE_PRESET.args], resumeArgs: [...OPENCODE_PRESET.resumeArgs], modelArgs: [...OPENCODE_PRESET.modelArgs], env: [] as Array<{ name: string; secret: boolean; value?: string }> });

test('secret env is encrypted at rest, decrypted only for the runtime, removable', async (t) => {
  const f = await file(t);
  const store = new SettingsStore(f, cipher(true));
  await store.load();
  const pub = await store.saveAgentCli({ ...preset(), env: [{ name: 'ANTHROPIC_API_KEY', secret: true, value: 'sk-ant-xyz' }] });
  const id = pub.agentClis?.[0]?.id ?? '';
  assert.match(id, /^opencode-[0-9a-f]{6}$/);
  assert.equal((await fs.readFile(f, 'utf8')).includes('sk-ant-xyz'), false);
  assert.equal(store.getAgentCliRuntime(id)?.env.ANTHROPIC_API_KEY, 'sk-ant-xyz');
  // 重新加载后仍可解密
  const again = new SettingsStore(f, cipher(true));
  await again.load();
  assert.equal(again.getAgentCliRuntime(id)?.env.ANTHROPIC_API_KEY, 'sk-ant-xyz');
  const cleared = await again.saveAgentCli({ ...preset(), id, env: [{ name: 'ANTHROPIC_API_KEY', secret: true, value: '' }] });
  assert.equal(cleared.agentClis?.[0]?.env[0]?.hasValue, false);
  assert.equal(again.getAgentCliRuntime(id)?.env.ANTHROPIC_API_KEY, undefined);
});

test('refuses to store secret env when safeStorage is unavailable; plain env still allowed', async (t) => {
  const store = new SettingsStore(await file(t), cipher(false));
  await store.load();
  await assert.rejects(store.saveAgentCli({ ...preset(), env: [{ name: 'K', secret: true, value: 'v' }] }), /E_ENCRYPTION/);
  const ok = await store.saveAgentCli({ ...preset(), env: [{ name: 'OPENCODE_DISABLE_AUTOUPDATE', secret: false, value: '1' }] });
  assert.equal(ok.agentClis?.[0]?.env[0]?.value, '1');
  await assert.rejects(store.saveAgentCli({ ...preset(), id: 'missing-000000' }), /E_NOT_FOUND/);
});
