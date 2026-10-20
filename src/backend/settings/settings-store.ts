/**
 * 设置存储（FR-002、FR-003，宪法 十）。
 * Key 以加密器（生产为 Electron safeStorage）加密后 base64 落盘；对外只暴露 PublicSettings。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PermissionMode, ProviderId, PublicSettings, SettingsUpdate } from '../../../contracts/ipc.ts';
import { ipcError } from '../ipc/validate.ts';

/** 可注入的加密器：生产实现包装 safeStorage，测试中用假实现。 */
export interface KeyCipher {
  isAvailable(): boolean;
  /** 返回 base64 密文。 */
  encrypt(plain: string): string;
  decrypt(cipherBase64: string): string;
}

export const DEFAULT_BASE_URLS: Readonly<Record<ProviderId, string>> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
};

export const DEFAULT_MODELS: Readonly<Record<ProviderId, string>> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-5',
};

interface StoredSettings {
  provider: ProviderId;
  baseUrl: string;
  model: string;
  permissionMode: PermissionMode;
  encryptedKeys: Partial<Record<ProviderId, string>>;
  lastProjectPath: string | null;
}

/** 主进程内部使用的非敏感设置。 */
export type ActiveSettings = Omit<StoredSettings, 'encryptedKeys'>;

function defaults(): StoredSettings {
  return {
    provider: 'openai',
    baseUrl: DEFAULT_BASE_URLS.openai,
    model: DEFAULT_MODELS.openai,
    permissionMode: 'ask',
    encryptedKeys: {},
    lastProjectPath: null,
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
      this.data = { ...defaults(), ...(JSON.parse(raw) as Partial<StoredSettings>) };
    } catch {
      await fs.rename(this.file, `${this.file}.corrupt-${Date.now()}`);
      this.data = defaults();
      throw new Error(`设置文件 ${this.file} 已损坏，已备份并恢复默认设置。`);
    }
  }

  getPublic(): PublicSettings {
    const { encryptedKeys, ...rest } = this.data;
    return {
      ...rest,
      hasApiKey: { openai: Boolean(encryptedKeys.openai), anthropic: Boolean(encryptedKeys.anthropic) },
      encryptionAvailable: this.cipher.isAvailable(),
    };
  }

  getActive(): ActiveSettings {
    const { provider, baseUrl, model, permissionMode, lastProjectPath } = this.data;
    return { provider, baseUrl, model, permissionMode, lastProjectPath };
  }

  /** 仅供主进程发起模型请求时调用；返回值不得进入 IPC 或日志。 */
  getApiKey(provider: ProviderId): string | null {
    const enc = this.data.encryptedKeys[provider];
    return enc ? this.cipher.decrypt(enc) : null;
  }

  async update(update: SettingsUpdate): Promise<PublicSettings> {
    const next: StoredSettings = { ...this.data, encryptedKeys: { ...this.data.encryptedKeys } };
    if (update.provider && update.provider !== next.provider) {
      // 仍是旧 provider 的默认值时，跟随切换到新 provider 的默认值
      if (next.baseUrl === DEFAULT_BASE_URLS[next.provider]) next.baseUrl = DEFAULT_BASE_URLS[update.provider];
      if (next.model === DEFAULT_MODELS[next.provider]) next.model = DEFAULT_MODELS[update.provider];
      next.provider = update.provider;
    }
    if (update.baseUrl !== undefined) next.baseUrl = update.baseUrl;
    if (update.model !== undefined && update.model !== '') next.model = update.model;
    if (update.permissionMode !== undefined) next.permissionMode = update.permissionMode;
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
