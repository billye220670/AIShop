import type { Model } from '../types';

export const CHAT_MODELS: Model[] = [
  {
    id: 'claude-opus-4-7',
    name: 'Claude Sonnet 4.7',
    provider: 'Anthropic',
    type: 'chat',
    maxTokens: 128000,
    contextLength: 1000000,
    inputCapabilities: ['text', 'image'],
    outputCapabilities: ['text'],
    price: { input: '$2.85/百万tokens', output: '$14.25/百万tokens' },
  },
  {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    provider: 'Anthropic',
    type: 'chat',
    maxTokens: 128000,
    contextLength: 1000000,
    inputCapabilities: ['text', 'image'],
    outputCapabilities: ['text'],
    price: { input: '$5/百万tokens', output: '$25/百万tokens' },
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    provider: 'Google',
    type: 'chat',
    maxTokens: 65536,
    contextLength: 1048576,
    inputCapabilities: ['text', 'image', 'video', 'audio'],
    outputCapabilities: ['text'],
    price: { input: '$1.9/百万tokens', output: '$11.4/百万tokens' },
  },
  {
    id: 'gemini-3.1-flash-lite-preview',
    name: 'Gemini 3.1 Flash Lite',
    provider: 'Google',
    type: 'chat',
    maxTokens: 65536,
    contextLength: 1048576,
    inputCapabilities: ['text', 'image', 'video', 'audio'],
    outputCapabilities: ['text'],
    price: { input: '$0.2375/百万tokens', output: '$1.425/百万tokens' },
  },
  {
    id: 'gpt-5.5',
    name: 'GPT 5.5',
    provider: 'OpenAI',
    type: 'chat',
    maxTokens: 128000,
    contextLength: 1050000,
    inputCapabilities: ['text', 'image'],
    outputCapabilities: ['text'],
    price: { input: '$5/百万tokens', output: '$30/百万tokens' },
  },
  {
    id: 'gpt-5.4-nano',
    name: 'GPT-5.4-Nano',
    provider: 'OpenAI',
    type: 'chat',
    maxTokens: 128000,
    contextLength: 1050000,
    inputCapabilities: ['text', 'image'],
    outputCapabilities: ['text'],
    price: { input: '$0.19/百万tokens', output: '$1.1875/百万tokens' },
  },
  {
    id: 'grok-4.3',
    name: 'Grok 4.3',
    provider: 'xAI',
    type: 'chat',
    maxTokens: 1000000,
    contextLength: 1000000,
    inputCapabilities: ['text', 'image'],
    outputCapabilities: ['text'],
    price: { input: '$1.25/百万tokens', output: '$2.5/百万tokens' },
  },
];

export const IMAGE_MODELS: Model[] = [];
export const VIDEO_MODELS: Model[] = [];
export const MUSIC_MODELS: Model[] = [];

export function getModelsByType(type: Model['type']): Model[] {
  switch (type) {
    case 'chat': return CHAT_MODELS;
    case 'image': return IMAGE_MODELS;
    case 'video': return VIDEO_MODELS;
    case 'music': return MUSIC_MODELS;
    default: return [];
  }
}
