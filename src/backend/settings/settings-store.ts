/**
 * 设置存储（FR-002、FR-003，宪法 十）。
 * Key 以加密器（生产为 Electron safeStorage）加密后 base64 落盘；对外只暴露 PublicSettings。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AgentCliConfig, AgentCliInput, AgentRef, PermissionMode, ProviderId, PublicSettings, SettingsUpdate } from '../../../contracts/ipc.ts';
import type { CliRuntimeConfig } from '../agent-cli/cli-runner.ts';
import { normalizeCliRuntimeFields } from '../agent-cli/normalize.ts';
import { resolveOpencodeMode, type OpencodeMode } from '../agent-cli/serve-runner.ts';
import { ipcError } from '../ipc/validate.ts';

/** 可注入的加密器：生产实现包装 safeStorage，测试中用假实现。 */
export interface KeyCipher {
  isAvailable(): boolean;
  /** 返回 base64 密文。 */
  encrypt(plain: string): string;
  decrypt(cipherBase64: string): string;
}

/**
 * 内置 agent 未配置时的中文说明；已配置返回 null（FR-308）。
 * 003 起 Base URL 与模型默认空白，不预填任何服务商地址或模型名（FR-307）。
 */
export function builtinConfigProblem(s: Pick<ActiveSettings, 'baseUrl' | 'model'>): string | null {
  const missing = [s.baseUrl.trim() === '' ? 'Base URL' : null, s.model.trim() === '' ? '模型' : null].filter((x): x is string => x !== null);
  if (!missing.length) return null;
  return `内置 agent 尚未填写 ${missing.join('、')}（设置 › 内置 agent）；也可在 设置 › Agent CLI 中配置外部 CLI 并在会话顶部切换。`;
}

/** 存盘形状：敏感环境变量只有密文 encrypted，非敏感变量为明文 value。 */
export interface StoredAgentCli extends Omit<AgentCliConfig, 'env'> {
  env: Array<{ name: string; secret: boolean; value?: string; encrypted?: string }>;
}

interface StoredSettings {
  provider: ProviderId;
  baseUrl: string;
  model: string;
  permissionMode: PermissionMode;
  encryptedKeys: Partial<Record<ProviderId, string>>;
  lastProjectPath: string | null;
  agentClis: StoredAgentCli[];
  defaultAgent: AgentRef;
  /**
   * 实验：opencode 接入方式（T127）。仅后端内部使用，不经 IPC、不进 PublicSettings
   * （需要 contracts v1.4：PublicSettings.agentCli.opencodeMode）。缺省 = acp。
   */
  opencodeMode?: OpencodeMode;
}

/** 主进程内部使用的非敏感设置。 */
export type ActiveSettings = Pick<StoredSettings, 'provider' | 'baseUrl' | 'model' | 'permissionMode' | 'lastProjectPath' | 'defaultAgent'>;

/** CLI 条目名 → id 前缀的 slug 化（newAgentCliId 与孤儿改绑匹配共用同一口径，避免两处漂移）。 */
export function cliNameSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'cli';
}

export function newAgentCliId(name: string): string {
  return `${cliNameSlug(name)}-${randomBytes(3).toString('hex')}`;
}

/** 条目 id → 其 slug 部分：去掉 newAgentCliId 追加的 `-<6 位 hex>` 随机后缀；无此后缀时原样返回。 */
export function cliIdSlug(id: string): string {
  return id.replace(/-[0-9a-f]{6}$/, '');
}

/**
 * 孤儿会话自动改绑（自愈）的候选查找：会话绑定的 CLI id 已不存在时，按 slug 找同名条目——
 * 条目被删除后重新添加（或在另一环境添加）会得到同 slug、不同随机后缀的新 id。
 * 候选 = 条目 id 的 slug 与缺失 id 的 slug 相同，或条目名的 slug 与缺失 id 的 slug 相同；
 * 恰好一条才返回其 id——零条无从恢复、多条无法判定，均返回 null（保持原 E_CLI 报错，不乱绑）。
 */
export function findCliRebindCandidate(missingId: string, clis: ReadonlyArray<{ id: string; name: string }>): string | null {
  const slug = cliIdSlug(missingId);
  const hits = clis.filter((c) => cliIdSlug(c.id) === slug || cliNameSlug(c.name) === slug);
  const [only] = hits;
  return hits.length === 1 && only ? only.id : null;
}

function defaults(): StoredSettings {
  return {
    // provider 只是协议类型（OpenAI 兼容 / Anthropic）；地址与模型由用户填写
    provider: 'openai',
    baseUrl: '',
    model: '',
    permissionMode: 'ask',
    encryptedKeys: {},
    lastProjectPath: null,
    agentClis: [],
    defaultAgent: 'builtin',
  };
}

export class SettingsStore {
  private readonly file: string;
  private readonly cipher: KeyCipher;
  private data: StoredSettings = defaults();

  constructor(file: string, cipher: KeyCipher) {
    this.file = file;
    this.cipher = cipher;
  }

  /** 读取设置文件；不存在时使用默认值，损坏时备份后重置并抛出说明。 */
  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<StoredSettings> & Record<string, unknown>;
      // 已移除的提醒功能（功能 005）曾落盘 notify 偏好键：旧设置文件带此多余键时忽略并丢弃，
      // 不报错、不回投影（沿用未知键忽略口径），下次保存即不再写回。
      delete parsed.notify;
      this.data = { ...defaults(), ...parsed, agentClis: Array.isArray(parsed.agentClis) ? parsed.agentClis : [] };
    } catch {
      await fs.rename(this.file, `${this.file}.corrupt-${Date.now()}`);
      this.data = defaults();
      throw new Error(`设置文件 ${this.file} 已损坏，已备份并恢复默认设置。`);
    }
  }

  getPublic(): PublicSettings {
    const { encryptedKeys, agentClis, opencodeMode: _internal, ...rest } = this.data;
    void _internal;
    return {
      ...rest,
      hasApiKey: { openai: Boolean(encryptedKeys.openai), anthropic: Boolean(encryptedKeys.anthropic) },
      encryptionAvailable: this.cipher.isAvailable(),
      agentClis: agentClis.map((c) => ({
        ...c,
        args: [...c.args], resumeArgs: [...c.resumeArgs], modelArgs: [...c.modelArgs],
        // 敏感值永不回传（宪法 十）
        env: c.env.map((e) => (e.secret ? { name: e.name, secret: true, hasValue: Boolean(e.encrypted) } : { name: e.name, secret: false, value: e.value ?? '', hasValue: Boolean(e.value) })),
      })),
    };
  }

  getActive(): ActiveSettings {
    const { provider, baseUrl, model, permissionMode, lastProjectPath, defaultAgent } = this.data;
    return { provider, baseUrl, model, permissionMode, lastProjectPath, defaultAgent };
  }

  /** 实验开关：环境变量 AICM_OPENCODE_MODE（run / serve / acp）优先，其次内部设置，默认 acp。 */
  getOpencodeMode(env: NodeJS.ProcessEnv = process.env): OpencodeMode {
    return resolveOpencodeMode(env, this.data.opencodeMode);
  }

  /** 仅后端内部（契约 v1.4 前不经 IPC）：持久化 opencode 接入方式。 */
  async setOpencodeMode(mode: OpencodeMode): Promise<void> {
    this.data = { ...this.data, opencodeMode: mode };
    await this.save();
  }

  hasAgentCli(id: string): boolean {
    return this.data.agentClis.some((c) => c.id === id);
  }

  /** 仅供主进程启动 CLI 时调用：返回解密后的 env，结果不得进入 IPC 或日志。 */
  getAgentCliRuntime(id: string): CliRuntimeConfig | null {
    const c = this.data.agentClis.find((x) => x.id === id);
    if (!c) return null;
    const env: Record<string, string> = {};
    for (const e of c.env) {
      if (e.secret) {
        if (e.encrypted) env[e.name] = this.cipher.decrypt(e.encrypted);
      } else if (e.value !== undefined) env[e.name] = e.value;
    }
    // 存量归一化：检测添加存成通用格式的 opencode 在运行时升级为 opencode-json（不改存盘数据）
    const n = normalizeCliRuntimeFields(c);
    return { id: c.id, name: c.name, preset: n.preset, args: n.args, resumeArgs: n.resumeArgs, modelArgs: n.modelArgs, model: c.model, outputFormat: n.outputFormat, env };
  }

  getAgentCliCommand(id: string): { command: string; preset: string; name: string } | null {
    const c = this.data.agentClis.find((x) => x.id === id);
    return c ? { command: c.command, preset: c.preset, name: c.name } : null;
  }

  async saveAgentCli(input: AgentCliInput): Promise<PublicSettings> {
    const existing = input.id ? this.data.agentClis.find((c) => c.id === input.id) : undefined;
    if (input.id && !existing) throw ipcError('E_NOT_FOUND', `Agent CLI ${input.id} 不存在`);
    const env: StoredAgentCli['env'] = [];
    for (const e of input.env) {
      if (!e.secret) {
        env.push({ name: e.name, secret: false, value: e.value ?? '' });
        continue;
      }
      const prev = existing?.env.find((x) => x.name === e.name && x.secret);
      if (e.value === undefined) {
        if (prev?.encrypted) env.push({ name: e.name, secret: true, encrypted: prev.encrypted });
        else env.push({ name: e.name, secret: true });
      } else if (e.value === '') {
        env.push({ name: e.name, secret: true });
      } else {
        if (!this.cipher.isAvailable()) throw ipcError('E_ENCRYPTION', '系统加密服务（safeStorage）不可用，出于安全考虑拒绝保存敏感环境变量。');
        env.push({ name: e.name, secret: true, encrypted: this.cipher.encrypt(e.value) });
      }
    }
    const stored: StoredAgentCli = {
      id: existing?.id ?? newAgentCliId(input.name),
      name: input.name, preset: input.preset, command: input.command,
      args: [...input.args], resumeArgs: [...input.resumeArgs], modelArgs: [...input.modelArgs],
      model: input.model, outputFormat: input.outputFormat, env,
    };
    const list = existing ? this.data.agentClis.map((c) => (c.id === stored.id ? stored : c)) : [...this.data.agentClis, stored];
    this.data = { ...this.data, agentClis: list };
    await this.save();
    return this.getPublic();
  }

  async deleteAgentCli(id: string): Promise<PublicSettings> {
    if (!this.hasAgentCli(id)) throw ipcError('E_NOT_FOUND', `Agent CLI ${id} 不存在`);
    this.data = {
      ...this.data,
      agentClis: this.data.agentClis.filter((c) => c.id !== id),
      defaultAgent: this.data.defaultAgent === `cli:${id}` ? 'builtin' : this.data.defaultAgent,
    };
    await this.save();
    return this.getPublic();
  }

  /** 仅供主进程发起模型请求时调用；返回值不得进入 IPC 或日志。 */
  getApiKey(provider: ProviderId): string | null {
    const enc = this.data.encryptedKeys[provider];
    return enc ? this.cipher.decrypt(enc) : null;
  }

  async update(update: SettingsUpdate): Promise<PublicSettings> {
    const next: StoredSettings = { ...this.data, encryptedKeys: { ...this.data.encryptedKeys } };
    // 切换提供方不回填任何地址或模型（FR-307）
    if (update.provider) next.provider = update.provider;
    if (update.baseUrl !== undefined) next.baseUrl = update.baseUrl;
    if (update.model !== undefined) next.model = update.model;
    if (update.permissionMode !== undefined) next.permissionMode = update.permissionMode;
    if (update.defaultAgent !== undefined) {
      if (update.defaultAgent !== 'builtin' && !next.agentClis.some((c) => `cli:${c.id}` === update.defaultAgent)) {
        throw ipcError('E_VALIDATION', `未知的 agent：${update.defaultAgent}`);
      }
      next.defaultAgent = update.defaultAgent;
    }
    if (update.apiKey) {
      const { provider, value } = update.apiKey;
      if (value === '') {
        delete next.encryptedKeys[provider];
      } else {
        if (!this.cipher.isAvailable()) {
          throw ipcError('E_ENCRYPTION', '系统加密服务（safeStorage）不可用，出于安全考虑拒绝保存 API Key。');
        }
        next.encryptedKeys[provider] = this.cipher.encrypt(value);
      }
    }
    this.data = next;
    await this.save();
    return this.getPublic();
  }

  async setLastProject(projectPath: string | null): Promise<void> {
    this.data = { ...this.data, lastProjectPath: projectPath };
    await this.save();
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    await fs.rename(tmp, this.file);
  }
}
