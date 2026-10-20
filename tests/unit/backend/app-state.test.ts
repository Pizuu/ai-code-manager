import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppState, ApprovalRegistry } from '../../../src/backend/app-state.ts';

const req = (id: string, sessionId: string) => ({ id, sessionId, toolCallId: 't', kind: 'edit' as const });

test('resolves a pending approval with the user decision', async () => {
  const r = new ApprovalRegistry();
  const p = r.request(req('a1', 's1'));
  assert.equal(r.resolve('a1', true), 's1');
  assert.equal(await p, true);
  assert.equal(r.resolve('a1', true), null);
});

test('stopping a session rejects only its own pending approvals (FR-010)', async () => {
  const state = new AppState();
  const ac = new AbortController();
  state.running.set('s1', ac);
  const p1 = state.approvals.request(req('a1', 's1'));
  state.approvals.request(req('a2', 's2'));
  assert.deepEqual(state.stop('s1'), ['a1']);
  assert.equal(await p1, false);
  assert.equal(ac.signal.aborted, true);
  assert.equal(state.approvals.pendingFor('s2').length, 1);
});

test('setProject derives a display name', () => {
  const state = new AppState();
  assert.equal(state.setProject('/home/me/demo')?.name, 'demo');
  assert.equal(state.setProject(null), null);
});
