/**
 * 列出 API 服务商可用模型（契约 v1.16 `settings:models`）。
 * - openai（含 OpenAI 兼容服务）：GET {baseUrl}/models，Bearer 鉴权，取 data[].id；
 * - anthropic：GET {baseUrl}/v1/models?limit=1000（baseUrl 已含 /v1 时不重复），x-api-key 鉴权，取 data[].id。
 * 结果去重排序；HTTP 非 2xx 或响应不是预期形状时抛错（错误信息不含 Key）。
 */
import { ANTHROPIC_VERSION } from './anthropic.ts';
import { joinUrl } from './types.ts';

export async function listProviderModels(opts: {
  provider: 'openai' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<string[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const anthropic = opts.provider === 'anthropic';
  const url = anthropic
    ? `${/\/v1\/?$/.test(opts.baseUrl) ? joinUrl(opts.baseUrl, 'models') : joinUrl(opts.baseUrl, 'v1/models')}?limit=1000`
    : joinUrl(opts.baseUrl, 'models');
  const headers: Record<string, string> = anthropic
    ? { 'x-api-key': opts.apiKey, 'anthropic-version': ANTHROPIC_VERSION }
    : { authorization: `Bearer ${opts.apiKey}` };
  const res = await doFetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 15000) });
  if (!res.ok) throw new Error(`模型列表请求失败（HTTP ${res.status}）`);
  const body = (await res.json().catch(() => null)) as { data?: unknown } | null;
  const data = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? (body as unknown[]) : null;
  if (!data) throw new Error('模型列表响应格式无法识别');
  const ids = data
    .map((m) => (typeof m === 'string' ? m : (m as { id?: unknown } | null)?.id))
    .filter((id): id is string => typeof id === 'string' && id.trim() !== '')
    .map((id) => id.trim());
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}
