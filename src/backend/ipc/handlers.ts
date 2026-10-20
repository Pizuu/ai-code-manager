/**
 * IPC invoke 通道注册。每个通道一个 handler，类型来自 contracts/ipc.ts 的 IpcInvokeMap；
 * handlers 对象的映射类型保证契约中的每个通道都被实现（漏一个即编译失败）。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentEvent, IpcInvokeChannel, IpcInvokeMap, ProjectInfo } from '../../../contracts/ipc.ts';
import { runAgentTurn } from '../agent/agent-loop.ts';
import { createAnthropicProvider } from '../agent/providers/anthropic.ts';
import { createOpenAIProvider } from '../agent/providers/openai.ts';
import type { Provider, ProviderConfig } from '../agent/providers/types.ts';
import { buildSystemPrompt } from '../agent/system-prompt.ts';
import type { AppState } from '../app-state.ts';
import { listTree } from '../fs/file-tree.ts';
import type { SessionStore } from '../sessions/session-store.ts';
import type { SettingsStore } from '../settings/settings-store.ts';
import { loadSpecTasks } from '../specs/tasks-parser.ts';
import {
  asRelDir,
  asSessionId,
  ipcError,
  validateApprovalDecision,
  validateSendRequest,
  validateSettingsUpdate,
} from './validate.ts';

type HandlerMap = {
  [C in IpcInvokeChannel]: (...args: unknown[]) => Promise<IpcInvokeMap[C]['result']>;
};

export interface HandlerDeps {
  settings: SettingsStore;
  sessions: SessionStore;
  state: AppState;
  emit(event: AgentEvent): void;
  /** 打开系统目录选择框，返回绝对路径或 null。 */
  pickDirectory(): Promise<string | null>;
  platform: NodeJS.Platform;
  providerFactory?: (id: 'openai' | 'anthropic', config: ProviderConfig) => Provider;
}

function defaultProviderFactory(id: 'openai' | 'anthropic', config: ProviderConfig): Provider {
  return id === 'anthropic' ? createAnthropicProvider(config) : createOpenAIProvider(config);
}

async function readAgentsMd(root: string | null): Promise<string | null> {
  if (!root) return null;
  try {
    return await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function requireProject(state: AppState): ProjectInfo {
  if (!state.project) throw ipcError('E_NO_PROJECT', '请先打开项目文件夹。');
  return state.project;
}

/** 去掉内部错误码以外的细节，保证不会把 Key 等敏感值带到界面。 */
function publicErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 1000 ? `${msg.slice(0, 1000)}…` : msg;
}

export function createHandlers(deps: HandlerDeps): HandlerMap {
  const { settings, sessions, state, emit } = deps;
  const makeProvider = deps.providerFactory ?? defaultProviderFactory;

  const startTurn = async (sessionId: string, text: string): Promise<void> => {
    if (state.running.has(sessionId)) throw ipcError('E_BUSY', '该会话正在运行，请等待完成或先停止。');
    const active = settings.getActive();
    const apiKey = settings.getApiKey(active.provider);
    if (!apiKey) throw ipcError('E_NO_API_KEY', '当前提供方尚未配置 API Key，请在设置中填写。');
    const session = await sessions.get(sessionId);
    const root = state.project?.root ?? null;
    const provider = makeProvider(active.provider, { baseUrl: active.baseUrl, apiKey });
    const system = buildSystemPrompt({
      projectRoot: root,
      platform: deps.platform,
      mode: active.permissionMode,
      today: new Date().toISOString().slice(0, 10),
      agentsMd: await readAgentsMd(root),
    });
    if (state.running.has(sessionId)) throw ipcError('E_BUSY', '该会话正在运行，请等待完成或先停止。');
    const controller = new AbortController();
    state.running.set(sessionId, controller);
    emit({ type: 'status', sessionId, running: true });

    // 不 await：增量通过 agent:event 推送，invoke 立即返回
    void runAgentTurn(session, text, {
      provider,
      model: active.model,
      mode: active.permissionMode,
      projectRoot: root,
      system,
      signal: controller.signal,
      platform: deps.platform,
      emit,
      requestApproval: (req) => {
        emit({ type: 'approval-request', sessionId, approval: req });
        return state.approvals.request(req);
      },
      persist: (s) => sessions.save(s),
      newId: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
    })
      .catch(async (err: unknown) => {
        if (controller.signal.aborted) return;
        emit({ type: 'error', sessionId, message: publicErrorMessage(err) });
        await sessions.save(session);
      })
      .finally(() => {
        state.running.delete(sessionId);
        emit({ type: 'status', sessionId, running: false });
      });
  };

  return {
    'settings:get': async () => settings.getPublic(),
    'settings:set': async (update) => settings.update(validateSettingsUpdate(update)),
    'project:pick': async () => {
      const dir = await deps.pickDirectory();
      if (!dir) return null;
      const info = state.setProject(dir);
      await settings.setLastProject(dir);
      return info;
    },
    'project:current': async () => state.project,
    'fs:tree': async (relDir) => listTree(requireProject(state).root, asRelDir(relDir)),
    'sessions:list': async () => sessions.list(),
    'sessions:create': async () => sessions.create(state.project?.root ?? null),
    'sessions:get': async (id) => sessions.get(asSessionId(id)),
    'sessions:delete': async (id) => {
      const sid = asSessionId(id);
      state.stop(sid);
      await sessions.delete(sid);
    },
    'sessions:clear': async (id) => {
      const sid = asSessionId(id);
      if (state.running.has(sid)) throw ipcError('E_BUSY', '会话运行中，不能清空。请先停止。');
      return sessions.clear(sid);
    },
    'agent:send': async (req) => {
      const { sessionId, text } = validateSendRequest(req);
      await startTurn(sessionId, text);
    },
    'agent:stop': async (id) => {
      const sid = asSessionId(id);
      for (const approvalId of state.stop(sid)) emit({ type: 'approval-resolved', sessionId: sid, approvalId, approved: false });
    },
    'agent:approve': async (decision) => {
      const { approvalId, approved } = validateApprovalDecision(decision);
      const sessionId = state.approvals.resolve(approvalId, approved);
      if (sessionId) emit({ type: 'approval-resolved', sessionId, approvalId, approved });
    },
    'tasks:list': async () => (state.project ? loadSpecTasks(state.project.root) : []),
  };
}
