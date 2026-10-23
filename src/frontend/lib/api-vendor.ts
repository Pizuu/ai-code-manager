/**
 * 根据 API 设置推断模型服务的提供公司名（用于切换 API / CLI 菜单中「API」项的说明）。
 * 优先按 baseUrl 的主机名匹配已知服务商；匹配不到时退回主机名；未填 baseUrl 时按 provider 协议给出。
 */
import type { ProviderId } from '../../../contracts/ipc.ts';

const VENDORS: Array<[RegExp, string]> = [
  [/(^|\.)openai\.com$/, 'OpenAI'],
  [/(^|\.)openai\.azure\.com$|(^|\.)azure\.com$/, 'Microsoft Azure'],
  [/(^|\.)anthropic\.com$/, 'Anthropic'],
  [/(^|\.)openrouter\.ai$/, 'OpenRouter'],
  [/(^|\.)deepseek\.com$/, 'DeepSeek'],
  [/(^|\.)moonshot\.(cn|ai)$/, 'Moonshot AI（Kimi）'],
  [/(^|\.)dashscope(-intl)?\.aliyuncs\.com$|(^|\.)aliyuncs\.com$/, '阿里云百炼'],
  [/(^|\.)bigmodel\.cn$|(^|\.)z\.ai$/, '智谱 AI'],
  [/(^|\.)siliconflow\.(cn|com)$/, '硅基流动'],
  [/(^|\.)volces\.com$|(^|\.)volcengine\.com$/, '火山引擎'],
  [/(^|\.)minimax(i)?\.(chat|com|io)$/, 'MiniMax'],
  [/(^|\.)baidubce\.com$/, '百度智能云'],
  [/(^|\.)hunyuan\.cloud\.tencent\.com$|(^|\.)tencentcloudapi\.com$/, '腾讯混元'],
  [/(^|\.)x\.ai$/, 'xAI'],
  [/(^|\.)googleapis\.com$/, 'Google'],
  [/(^|\.)mistral\.ai$/, 'Mistral AI'],
  [/(^|\.)groq\.com$/, 'Groq'],
  [/(^|\.)together\.(ai|xyz)$/, 'Together AI'],
  [/(^|\.)fireworks\.ai$/, 'Fireworks AI'],
  [/(^|\.)perplexity\.ai$/, 'Perplexity'],
  [/(^|\.)cohere\.(ai|com)$/, 'Cohere'],
  [/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/, '本机服务'],
];

export function apiVendor(provider: ProviderId, baseUrl: string): string {
  const raw = baseUrl.trim();
  if (raw) {
    const host = (() => {
      try {
        return new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
      } catch {
        return '';
      }
    })();
    if (host) {
      if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(host) || host === '[::1]') return '本机服务';
      for (const [re, name] of VENDORS) if (re.test(host)) return name;
      return host;
    }
  }
  return provider === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容服务';
}
