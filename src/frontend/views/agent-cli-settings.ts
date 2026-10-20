/**
 * 设置 ›「Agent CLI」分区（FR-110、FR-114、FR-115）：增删改外部 CLI agent，内置 opencode 预设，检查可用性。
 * 敏感环境变量只进不出：输入框永远为空，已保存时只显示「已保存」（宪法 十）。
 */
import type { AgentCliConfig, AgentCliDetection, AgentCliOutputFormat } from '../../../contracts/ipc.ts';
import { api, errorText } from '../api.ts';
import { configToForm, detectedToForm, formToInput, OPENCODE_FORM_EXAMPLE, previewCommand, type AgentCliForm, type EnvRow } from '../lib/agent-cli-form.ts';
import { clear, h } from '../lib/dom.ts';
import { store } from '../store.ts';

const FORMAT_LABELS: Readonly<Record<AgentCliOutputFormat, string>> = { 'opencode-json': 'opencode JSON 事件流（run --format json）', text: '纯文本 stdout' };

function field(label: string, control: HTMLElement, help?: string): HTMLElement {
  return h('div', { class: 'field' }, h('label', {}, label), control, help ? h('div', { class: 'help' }, help) : null);
}

export function mountAgentCliSettings(container: HTMLElement): void {
  let editing: AgentCliForm | null = null;

  const renderList = () => {
    clear(container);
    const st = store.state.settings;
    const clis: AgentCliConfig[] = st?.agentClis ?? [];
    const err = h('div', { class: 'error-text' });
    const list = h('div', { class: 'cli-list' });
    for (const c of clis) {
      const out = h('div', { class: 'check-out', attrs: { hidden: '' } });
      const check = h('button', { class: 'btn', attrs: { type: 'button' } }, '检查');
      check.addEventListener('click', async () => {
        check.disabled = true;
        out.hidden = false;
        out.className = 'check-out';
        out.textContent = '检查中…';
        try {
          const r = await api.invoke('agentCli:check', c.id);
          out.className = `check-out ${r.ok ? 'ok' : 'bad'}`;
          out.textContent = r.ok ? `可用 · ${r.version ?? ''}\n${r.resolvedPath ?? ''}` : r.message;
        } catch (e) {
          out.className = 'check-out bad';
          out.textContent = errorText(e);
        } finally {
          check.disabled = false;
        }
      });
      const del = h('button', { class: 'btn danger', attrs: { type: 'button' } }, '删除');
      del.addEventListener('click', async () => {
        if (!confirm(`删除 Agent CLI「${c.name}」？使用它的会话将无法继续发送，需切换 agent。`)) return;
        try {
          store.state.settings = await api.invoke('agentCli:delete', c.id);
          store.emit('settings');
          renderList();
        } catch (e) {
          err.textContent = errorText(e);
        }
      });
      list.append(h('div', {},
        h('div', { class: 'cli-item' },
          h('div', { class: 'grow0' }, h('b', {}, c.name), h('div', { class: 'mono' }, previewCommand(configToForm(c), { session: true }))),
          check,
          h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: () => { editing = configToForm(c); renderEdit(); } } }, '编辑'),
          del),
        out));
    }
    const detectOut = h('div', { class: 'detect-out' });
    const detect = h('button', { class: 'btn', attrs: { type: 'button' } }, '自动检测');
    detect.addEventListener('click', async () => {
      detect.disabled = true;
      detect.textContent = '检测中…';
      err.textContent = '';
      clear(detectOut);
      try {
        const found: AgentCliDetection[] = await api.invoke('agentCli:detect');
        if (!found.length) detectOut.append(h('div', { class: 'mute' }, '未检测到已安装的热门 CLI'));
        for (const d of found) {
          const add = h('button', { class: 'btn', attrs: { type: 'button' } }, '添加');
          add.addEventListener('click', async () => {
            add.disabled = true;
            try {
              store.state.settings = await api.invoke('agentCli:save', formToInput(detectedToForm(d)));
              store.emit('settings');
              renderList();
            } catch (e) {
              err.textContent = errorText(e);
              add.disabled = false;
            }
          });
          detectOut.append(h('div', { class: 'cli-item' },
            h('div', { class: 'grow0' }, h('b', {}, d.name), h('div', { class: 'mono' }, `${d.command} · ${d.resolvedPath}${d.version ? ` · ${d.version}` : ''}`)),
            add));
        }
      } catch (e) {
        err.textContent = errorText(e);
      } finally {
        detect.disabled = false;
        detect.textContent = '自动检测';
      }
    });
    container.append(list,
      h('div', { class: 'fx8' },
        h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: () => { editing = { name: '', preset: 'custom', command: '', args: '{prompt}', resumeArgs: '', modelArgs: '', model: '', outputFormat: 'text', env: [] }; renderEdit(); } } }, '添加自定义 CLI'),
        h('span', { class: 'flex1' }),
        detect),
      detectOut,
      h('div', { class: 'help' }, '外部 CLI 以当前项目根为工作目录、以参数数组启动（不经 shell）。权限：仅规划 = 禁止编辑与命令；自动批准编辑 = 允许编辑、禁止命令；每次询问 = 每轮先批准命令行（ADR 0006）。'),
      err);
  };

  const renderEdit = () => {
    if (!editing) return renderList();
    const f = editing;
    clear(container);
    const isOc = f.preset === 'opencode';
    const ex = (k: keyof typeof OPENCODE_FORM_EXAMPLE) => (isOc ? `例：${OPENCODE_FORM_EXAMPLE[k].split('\n').join(' ')}` : '');
    const input = (value: string, placeholder = '', type = 'text') => h('input', { attrs: { type, value, spellcheck: 'false', placeholder } });
    const area = (value: string, rows = 4, placeholder = '') => {
      const t = h('textarea', { attrs: { rows: String(rows), spellcheck: 'false', placeholder } });
      t.value = value;
      return t;
    };
    const name = input(f.name);
    const command = input(f.command, isOc ? '例：opencode（或 opencode.exe 完整路径）' : '可执行文件名或绝对路径');
    const args = area(f.args, 5, isOc ? '每行一个，例：\nrun\n--format\njson\n--dir\n{cwd}' : '每行一个参数');
    const resume = area(f.resumeArgs, 2, ex('resumeArgs'));
    const modelArgs = area(f.modelArgs, 2, ex('modelArgs'));
    const model = input(f.model, isOc ? '例：<provider>/<model>；留空使用 CLI 自身默认' : '');
    const format = h('select');
    for (const [v, l] of Object.entries(FORMAT_LABELS)) format.append(h('option', { attrs: { value: v } }, l));
    format.value = f.outputFormat;
    const preview = h('div', { class: 'check-out mono' });
    const envBox = h('div', { class: 'cli-list' });
    const rows: Array<{ row: EnvRow; name: HTMLInputElement; value: HTMLInputElement; secret: HTMLInputElement }> = [];
    const addEnvRow = (row: EnvRow) => {
      const n = h('input', { attrs: { type: 'text', value: row.name, placeholder: '变量名，如 ANTHROPIC_API_KEY', spellcheck: 'false' } });
      const v = h('input', { attrs: { type: row.secret ? 'password' : 'text', value: row.secret ? '' : (row.value ?? ''), placeholder: row.secret ? (row.hasValue ? '已加密保存（留空保持不变）' : '值（加密保存）') : '值', autocomplete: 'off' } });
      const s = h('input', { attrs: { type: 'checkbox', title: '敏感：加密保存，界面不回显' } });
      s.checked = row.secret;
      s.addEventListener('change', () => {
        v.type = s.checked ? 'password' : 'text';
      });
      const rm = h('button', { class: 'btn danger', attrs: { type: 'button' } }, '移除');
      const el = h('div', { class: 'env-row' }, n, v, h('label', { class: 'fx8' }, s, '敏感'), rm);
      const entry = { row, name: n, value: v, secret: s };
      rows.push(entry);
      rm.addEventListener('click', () => {
        rows.splice(rows.indexOf(entry), 1);
        el.remove();
      });
      envBox.append(el);
    };
    for (const r of f.env) addEnvRow(r);
    const collect = (): AgentCliForm => ({
      ...f, name: name.value, command: command.value, args: args.value, resumeArgs: resume.value, modelArgs: modelArgs.value, model: model.value,
      outputFormat: format.value as AgentCliOutputFormat,
      env: rows.map(({ row, name: n, value: v, secret: s }) => {
        if (!s.checked) return { name: n.value, secret: false, value: v.value };
        // 敏感：留空 = 保持原值（已保存时），否则写入新值
        if (v.value === '') return row.secret && row.hasValue ? { name: n.value, secret: true } : { name: n.value, secret: true, value: '' };
        return { name: n.value, secret: true, value: v.value };
      }),
    });
    const updatePreview = () => {
      preview.textContent = `首轮：${previewCommand(collect())}\n续接：${previewCommand(collect(), { session: true })}`;
    };
    for (const el of [name, command, args, resume, modelArgs, model, format]) el.addEventListener('input', updatePreview);
    updatePreview();
    // 用户显式点击才填入 opencode 文档示例（不作为默认值；模型保持空白）
    const fillExample = isOc ? h('button', { class: 'btn', attrs: { type: 'button' }, title: '把 opencode 官方文档的示例参数填入空白字段（模型仍留空）', on: { click: () => {
      if (!command.value.trim()) command.value = OPENCODE_FORM_EXAMPLE.command;
      if (!args.value.trim()) args.value = OPENCODE_FORM_EXAMPLE.args;
      if (!resume.value.trim()) resume.value = OPENCODE_FORM_EXAMPLE.resumeArgs;
      if (!modelArgs.value.trim()) modelArgs.value = OPENCODE_FORM_EXAMPLE.modelArgs;
      updatePreview();
    } } }, '按示例填写') : null;
    const err = h('div', { class: 'error-text' });
    const save = h('button', { class: 'btn pri', attrs: { type: 'button' } }, '保存');
    save.addEventListener('click', async () => {
      err.textContent = '';
      try {
        store.state.settings = await api.invoke('agentCli:save', formToInput(collect()));
        store.emit('settings');
        editing = null;
        renderList();
      } catch (e) {
        err.textContent = errorText(e);
      }
    });
    container.append(
      field('名称', name),
      field('可执行文件', command, window.api.platform === 'win32' ? 'Windows 建议填写 opencode.exe 完整路径；填「opencode」时会在 PATH 中查找，npm 安装的 opencode.cmd 会自动定位到其 opencode.exe（不经 shell 执行 .cmd）。' : '名称（在 PATH 中查找）或绝对路径。'),
      field('参数模板（每行一个参数）', args, '占位符：{cwd} 项目根、{model} 模型、{session} CLI 会话 ID、{prompt} 消息。未使用 {prompt} 时消息以 `--` 分隔追加在末尾。'),
      field('续接参数（已有 CLI 会话时追加）', resume),
      field('模型参数（模型非空时追加）', modelArgs),
      field('模型', model, 'opencode 格式：<provider>/<model>；留空使用 CLI 自身默认（opencode models 可列出）。'),
      field('输出格式', format),
      h('div', { class: 'field' }, h('label', {}, '环境变量（只注入该 CLI 子进程）'), envBox, h('div', {}, h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: () => addEnvRow({ name: '', secret: true }) } }, '＋ 添加变量'))),
      field('命令行预览', preview),
      err,
      h('div', { class: 'actions' }, fillExample, h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: () => { editing = null; renderList(); } } }, '返回'), save));
  };

  renderList();
}
