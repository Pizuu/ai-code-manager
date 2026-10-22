import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';

const provider = createOpenAICompatible({
  name: 'inception',
  apiKey: process.env.INCEPTION_API_KEY,
  baseURL: 'https://api.inceptionlabs.ai/v1',
});
const { text } = await generateText({ model: provider('mercury-3'), prompt: '...' });