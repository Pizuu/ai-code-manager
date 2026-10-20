/**
 * 设置对话框（FR-002/003）：Key 只进不出——输入框永远为空，已保存时只显示「已保存」。
 */
import type { PermissionMode, ProviderId, SettingsUpdate } from '../../../contracts/ipc.ts';
import { api, errorText } from '../api.ts';
import { clear, h } from '../lib/dom.ts';
import { store } from '../store.ts';

const PROVIDER_LABELS: Readonly<Record<ProviderId, string>> = { openai: 'OpenAI 兼容（/chat/completions）', anthropic: 'Anthropic（Messages API）' };
export const MODE_LABELS: Readonly<Record<PermissionMode, string>> = { ask: '每次询问', 'auto-edits': '自动批准编辑', plan: '仅规划（只读）' };

function field(label: string, control: HTMLElement, help?: string): HTMLElement {
  return h('div', { class: 'field' }, h('label', {}, label), control, help ? h('div', { class: 'help' }, help) : null);
}

function options<T extends string>(labels: Readonly<Record<T, string>>, current: T): HTMLSelectElement {
  const sel = h('select');
  for (const [value, label] of Object.entries(labels) as Array<[T, string]>) {
    const opt = h('option', { attrs: { value } }, label);
    opt.selected = value === current;
    sel.append(opt);
  }
  return sel;
}

export function openSettings(): void {
  const dialog = document.getElementById('settings-dialog') as HTMLDialogElement;
  const s = store.state.settings;
  if (!s) return;
  clear(dialog);

  const provider = options(PROVIDER_LABELS, s.provider);
  const baseUrl = h('input', { attrs: { type: 'url', value: s.baseUrl, spellcheck: 'false' } });
  const model = h('input', { attrs: { type: 'text', value: s.model, spellcheck: 'false' } });
  const key = h('input', { attrs: { type: 'password', autocomplete: 'off', placeholder: '' } });
  const mode = options(MODE_LABELS, s.permissionMode);
  const err = h('div', { class: 'error-text' });
  const keyHelp = h('div', { class: 'help' });
  const removeKey = h('button', { class: 'danger', attrs: { type: 'button' } }, '删除已保存的 Key');

  const refreshKeyState = () => {
    const p = provider.value as ProviderId;
    const saved = store.state.settings?.hasApiKey[p] ?? false;
    key.placeholder = saved ? '已加密保存（留空保持不变）' : '粘贴 API Key';
    keyHelp.textContent = store.state.settings?.encryptionAvailable
      ? 'Key 使用系统加密（Windows DPAPI）保存在本机，界面无法读取。'
      : '系统加密服务不可用，无法保存 Key。';
    removeKey.disabled = !saved;
  };
  provider.addEventListener('change', refreshKeyState);
  refreshKeyState();

  removeKey.addEventListener('click', async () => {
    try {
      store.state.settings = await api.invoke('settings:set', { apiKey: { provider: provider.value as ProviderId, value: '' } });
      store.emit('settings');
      refreshKeyState();
    } catch (e) {
      err.textContent = errorText(e);
    }
  });

  const form = h('form', { attrs: { method: 'dialog' } },
    h('h3', {}, '设置'),
    field('模型提供方', provider),
    field('Base URL', baseUrl, '切换提供方时若仍为默认地址会自动更新；兼容端点可填写自定义地址。'),
    field('模型', model),
    h('div', { class: 'field' }, h('label', {}, 'API Key'), key, keyHelp, h('div', {}, removeKey)),
    field('权限模式', mode, '命令执行在任何模式下都需要逐条批准；「仅规划」禁止修改与执行。'),
    err,
    h('div', { class: 'actions' },
      h('button', { attrs: { type: 'button' }, on: { click: () => dialog.close() } }, '取消'),
      h('button', { class: 'primary', attrs: { type: 'submit' } }, '保存')),
  );

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    const p = provider.value as ProviderId;
    const update: SettingsUpdate = { provider: p, permissionMode: mode.value as PermissionMode, model: model.value.trim() };
    // 切换提供方且 Base URL 未改动时交给主进程换成新默认值
    if (p === s.provider || baseUrl.value.trim() !== s.baseUrl) update.baseUrl = baseUrl.value.trim();
    if (key.value.trim() !== '') update.apiKey = { provider: p, value: key.value.trim() };
    try {
      store.state.settings = await api.invoke('settings:set', update);
      key.value = '';
      store.emit('settings');
      dialog.close();
    } catch (e) {
      err.textContent = errorText(e);
    }
  });

  dialog.append(form);
  dialog.showModal();
}
