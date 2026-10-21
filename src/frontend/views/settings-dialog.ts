/**
 * 设置对话框（FR-002/003、FR-110）：两个分区——「内置 agent」（提供方 / 模型 / Key / 权限）与「Agent CLI」。
 * Key 只进不出——输入框永远为空，已保存时只显示「已保存」。Base URL / 模型同理留空打开、留空保存不修改。
 */
import type { PermissionMode, ProviderId, SettingsUpdate } from '../../../contracts/ipc.ts';
import { api, errorText } from '../api.ts';
import { cliSaveState } from '../lib/cli-save-state.ts';
import { clear, h } from '../lib/dom.ts';
import { store } from '../store.ts';
import { mountAgentCliSettings } from './agent-cli-settings.ts';

const PROVIDER_LABELS: Readonly<Record<ProviderId, string>> = { openai: 'OpenAI 兼容（/chat/completions）', anthropic: 'Anthropic（Messages API）' };
/** 003：只给示例 placeholder，值一律为空、由用户填写（不预填任何服务商地址或模型名）。 */
const BASE_URL_PLACEHOLDER: Readonly<Record<ProviderId, string>> = { openai: '例：https://<你的服务地址>/v1', anthropic: '例：https://<你的服务地址>（会自动补 /v1/messages）' };
const MODEL_PLACEHOLDER: Readonly<Record<ProviderId, string>> = { openai: '例：服务商文档中的模型 ID', anthropic: '例：服务商文档中的模型 ID' };
import { MODE_LABELS } from './chat.ts';
export { MODE_LABELS };

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

export type SettingsTab = 'model' | 'cli';

/** T-052：CLI 页「保存」按钮刷新订阅的解绑函数。重渲染（切页签 / 重开）与对话框关闭时调用，不留悬挂监听。 */
let unbindCliSaveRefresh: (() => void) | null = null;
let settingsCloseHookInstalled = false;

export function openSettings(tab: SettingsTab = 'model'): void {
  const dialog = document.getElementById('settings-dialog') as HTMLDialogElement;
  const s = store.state.settings;
  if (!s) return;
  unbindCliSaveRefresh?.();
  unbindCliSaveRefresh = null;
  if (!settingsCloseHookInstalled) {
    settingsCloseHookInstalled = true;
    dialog.addEventListener('close', () => {
      unbindCliSaveRefresh?.();
      unbindCliSaveRefresh = null;
    });
  }
  clear(dialog);
  // 标签排序仍按「使用中在前」：使用中 = 当前默认 agent（defaultAgent，缺省 'builtin'）所属类排到最左。
  // acc 只表示当前打开的页，与默认 agent 所属类相互独立；标签上不再渲染「使用中」标记。
  const da = s.defaultAgent ?? 'builtin';
  const tabBtn = (id: SettingsTab, label: string) => h('button', { class: `chip${id === tab ? ' acc' : ''}`, attrs: { type: 'button' }, on: { click: () => openSettings(id) } }, label);
  const modelTabBtn = tabBtn('model', 'API');
  const cliTabBtn = tabBtn('cli', 'Agent CLI');
  const tabs = h('div', { class: 'dtabs' }, ...(da === 'builtin'
    ? [modelTabBtn, cliTabBtn]
    : [cliTabBtn, modelTabBtn]));
  if (tab === 'cli') {
    const body = h('div', { class: 'field' });
    // 标题行：左 h3「设置」+ 右 headerSlot 空位，Agent CLI 分区把「自动检测」按钮填进去（同行两端对齐）。
    const headerSlot = h('span', {});
    const err = h('div', { class: 'error-text' });
    // 「保存」：确认使用 CLI——目标 CLI 在点击时按最新 settings 确定，当前默认已是某个仍存在的 CLI 则沿用它，否则取列表第一条。
    const saveCli = h('button', { class: 'btn pri', attrs: { type: 'button' } }, '保存');
    // T-052：按钮状态随 CLI 列表实时刷新——初始按当前状态算一次，再订阅 'settings' 在增删后重算；
    // 解绑走 openSettings 开头的重渲染清理与对话框 close 钩子（见 unbindCliSaveRefresh）。
    const refreshSaveCli = () => {
      const st = cliSaveState(store.state.settings?.agentClis);
      saveCli.disabled = st.disabled;
      if (st.title) saveCli.title = st.title;
      else saveCli.removeAttribute('title');
    };
    refreshSaveCli();
    store.on('settings', refreshSaveCli);
    unbindCliSaveRefresh = () => store.off('settings', refreshSaveCli);
    saveCli.addEventListener('click', async () => {
      const st = store.state.settings;
      const clis = st?.agentClis ?? [];
      const cur = st?.defaultAgent ?? 'builtin';
      const curId = cur.startsWith('cli:') ? cur.slice('cli:'.length) : null;
      const target = (curId && clis.find((c) => c.id === curId)) || clis[0];
      if (!target) return;
      err.textContent = '';
      try {
        store.state.settings = await api.invoke('settings:set', { defaultAgent: `cli:${target.id}` });
        store.emit('settings');
        dialog.close();
      } catch (e) {
        err.textContent = errorText(e);
      }
    });
    const form = h('form', { class: 'cfg-card', attrs: { method: 'dialog' } }, h('div', { class: 'dhead' }, h('h3', {}, '设置'), headerSlot), tabs, h('div', { class: 'cfg-panel' }, body), err,
      h('div', { class: 'actions' }, saveCli));
    form.addEventListener('submit', (ev) => ev.preventDefault());
    dialog.append(form);
    mountAgentCliSettings(body, headerSlot);
    if (!dialog.open) dialog.showModal();
    return;
  }

  const provider = options(PROVIDER_LABELS, s.provider);
  // Base URL / 模型与 Key 一样只进不出：输入框留空打开（只留 placeholder 示例），已保存值不回显；保存时留空 = 不修改。
  const baseUrl = h('input', { attrs: { type: 'url', spellcheck: 'false', placeholder: BASE_URL_PLACEHOLDER[s.provider] } });
  const model = h('input', { attrs: { type: 'text', spellcheck: 'false', placeholder: MODEL_PLACEHOLDER[s.provider] } });
  const key = h('input', { attrs: { type: 'password', autocomplete: 'off', placeholder: '' } });
  const mode = options(MODE_LABELS, s.permissionMode);
  const err = h('div', { class: 'error-text' });
  const keyHelp = h('div', { class: 'help' });
  const removeKey = h('button', { class: 'btn danger', attrs: { type: 'button' } }, '删除已保存的 Key');

  const refreshKeyState = () => {
    const p = provider.value as ProviderId;
    const saved = store.state.settings?.hasApiKey[p] ?? false;
    key.placeholder = saved ? '已加密保存（留空保持不变）' : '粘贴 API Key';
    keyHelp.textContent = store.state.settings?.encryptionAvailable
      ? 'Key 使用系统加密（Windows DPAPI）保存在本机，界面无法读取。'
      : '系统加密服务不可用，无法保存 Key。';
    removeKey.disabled = !saved;
  };
  provider.addEventListener('change', () => {
    const p = provider.value as ProviderId;
    baseUrl.placeholder = BASE_URL_PLACEHOLDER[p];
    model.placeholder = MODEL_PLACEHOLDER[p];
    refreshKeyState();
  });
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

  const form = h('form', { class: 'cfg-card', attrs: { method: 'dialog' } },
    // 标题区与 CLI 页统一形态：左 h3「设置」+ 右空槽位（CLI 页在此注入「自动检测」）。
    h('div', { class: 'dhead' }, h('h3', {}, '设置'), h('span', {})),
    tabs,
    h('div', { class: 'cfg-panel' },
      field('模型提供方', provider),
      field('Base URL', baseUrl, '必填，默认空白：填写你所用服务的接口地址（OpenAI 兼容端点或 Anthropic Messages API）。'),
      field('模型', model, '必填，默认空白：按服务商文档填写模型 ID。也可用 /model <模型名> 切换。'),
      h('div', { class: 'field' }, h('label', {}, 'API Key'), key, keyHelp, h('div', {}, removeKey)),
      field('权限模式', mode, '内置 agent：命令执行在任何模式下都需要逐条批准；「仅规划」禁止修改与执行。外部 CLI 的映射见「Agent CLI」分区。')),
    err,
    h('div', { class: 'actions' },
      h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: () => dialog.close() } }, '取消'),
      h('button', { class: 'btn pri', attrs: { type: 'submit' } }, '保存')),
  );

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    const p = provider.value as ProviderId;
    // 「保存」= 保存设置并确认使用 API：同一次 settings:set 带上 defaultAgent: 'builtin'。
    const update: SettingsUpdate = { provider: p, permissionMode: mode.value as PermissionMode, defaultAgent: 'builtin' };
    // 「空不修改」（同下方 Key）：Base URL / 模型留空时不提交该字段，保留已保存值，绝不用空串覆盖；填了才提交新值。
    if (baseUrl.value.trim() !== '') update.baseUrl = baseUrl.value.trim();
    if (model.value.trim() !== '') update.model = model.value.trim();
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
  if (!dialog.open) dialog.showModal();
}
