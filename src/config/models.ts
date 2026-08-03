import type { Model } from '../types';

export const CHAT_MODELS: Model[] = [
  // Anthropic（旗舰 → 小模型）
  {
    id: 'claude-fable-5',
    name: 'Claude Fable 5',
    provider: 'Anthropic',
    type: 'chat',
    maxTokens: 128000,
    contextLength: 200000,
    inputCapabilities: ['text', 'image'],
    outputCapabilities: ['text'],
    price: { input: '$1.5/百万tokens', output: '$7.5/百万tokens' },
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    provider: 'Anthropic',
    type: 'chat',
    maxTokens: 64000,
    contextLength: 20000,
    inputCapabilities: ['text', 'image'],
    outputCapabilities: ['text'],
    price: { input: '$1/百万tokens', output: '$5/百万tokens' },
  },
  {
    id: 'claude-opus-5',
    name: 'Claude Opus 5',
    provider: 'Anthropic',
    type: 'chat',
    maxTokens: 128000,
    contextLength: 1000000,
    inputCapabilities: ['text', 'image'],
    outputCapabilities: ['text'],
    price: { input: '$5/百万tokens', output: '$25/百万tokens' },
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    provider: 'Anthropic',
    type: 'chat',
    maxTokens: 128000,
    contextLength: 1000000,
    inputCapabilities: ['text', 'image'],
    outputCapabilities: ['text'],
    price: { input: '$2/百万tokens', output: '$10/百万tokens' },
  },
  // OpenAI
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
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6-Sol',
    provider: 'OpenAI',
    type: 'chat',
    maxTokens: 128000,
    contextLength: 1050000,
    inputCapabilities: ['text', 'image'],
    outputCapabilities: ['text'],
    price: { input: '$5/百万tokens', output: '$30/百万tokens' },
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6-Terra',
    provider: 'OpenAI',
    type: 'chat',
    maxTokens: 128000,
    contextLength: 1050000,
    inputCapabilities: ['text', 'image'],
    outputCapabilities: ['text'],
    price: { input: '$2.5/百万tokens', output: '$15/百万tokens' },
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT-5.6-Luna',
    provider: 'OpenAI',
    type: 'chat',
    maxTokens: 128000,
    contextLength: 1050000,
    inputCapabilities: ['text', 'image'],
    outputCapabilities: ['text'],
    price: { input: '$1/百万tokens', output: '$6/百万tokens' },
  },
  // Google
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
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    provider: 'Google',
    type: 'chat',
    maxTokens: 65536,
    contextLength: 1048576,
    inputCapabilities: ['text', 'image', 'video', 'audio'],
    outputCapabilities: ['text'],

    price: { input: '$1.425/百万tokens', output: '$8.55/百万tokens' },
  },
  // xAI
  {
    id: 'grok-4.20-0309-reasoning',
    name: 'Grok 4.20',
    provider: 'xAI',
    type: 'chat',
    maxTokens: 2000000,
    contextLength: 2000000,
    inputCapabilities: ['text', 'image'],
    outputCapabilities: ['text'],

    price: { input: '$1.9/百万tokens', output: '$5.7/百万tokens' },
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
  // DeepSeek
  {
    id: 'deepseek/deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    provider: 'DeepSeek',
    type: 'chat',
    maxTokens: 393216,
    contextLength: 1048576,
    inputCapabilities: ['text'],
    outputCapabilities: ['text'],

    price: { input: '$1.74/百万tokens', output: '$3.48/百万tokens' },
  },
  {
    id: 'deepseek/deepseek-v4-flash-0731',
    name: 'DeepSeek V4 Flash 0731',
    provider: 'DeepSeek',
    type: 'chat',
    maxTokens: 393216,
    contextLength: 1048576,
    inputCapabilities: ['text'],
    outputCapabilities: ['text'],

    price: { input: '$0.14/百万tokens', output: '$0.28/百万tokens' },
  },
  // 智谱 GLM
  {
    id: 'zai-org/glm-5-turbo',
    name: 'GLM-5-Turbo',
    provider: '智谱',
    type: 'chat',
    maxTokens: 131072,
    contextLength: 202800,
    inputCapabilities: ['text'],
    outputCapabilities: ['text'],

    price: { input: '$1.2/百万tokens', output: '$4/百万tokens' },
  },
  // Moonshot
  {
    id: 'moonshotai/kimi-k3',
    name: 'Kimi K3',
    provider: 'Moonshot',
    type: 'chat',
    maxTokens: 1048576,
    contextLength: 1048576,
    inputCapabilities: ['text', 'image', 'video'],
    outputCapabilities: ['text'],

    price: { input: '$3/百万tokens', output: '$15/百万tokens' },
  },
  // Alibaba Qwen
  {
    id: 'qwen/qwen3.5-27b',
    name: 'Qwen 3.5 27B',
    provider: 'Alibaba',
    type: 'chat',
    maxTokens: 65500,
    contextLength: 262144,
    inputCapabilities: ['text', 'image', 'video'],
    outputCapabilities: ['text'],

    price: { input: '$0.3/百万tokens', output: '$2.4/百万tokens' },
  },
  // ByteDance Doubao
  {
    id: 'doubao-1-5-pro-32k-250115',
    name: 'Doubao 1.5 Pro',
    provider: 'ByteDance',
    type: 'chat',
    maxTokens: 12000,
    contextLength: 128000,
    inputCapabilities: ['text', 'image'],
    outputCapabilities: ['text'],

    price: { input: '$0.11/百万tokens', output: '$0.275/百万tokens' },
  },
  // Xiaomi MiMo
  {
    id: 'xiaomimimo/mimo-v2-flash',
    name: 'MiMo V2 Flash',
    provider: 'Xiaomi',
    type: 'chat',
    maxTokens: 131072,
    contextLength: 262144,
    inputCapabilities: ['text'],
    outputCapabilities: ['text'],

    price: { input: '$0.1/百万tokens', output: '$0.3/百万tokens' },
  },
];

export const IMAGE_MODELS: Model[] = [
  {
    id: 'gpt-image-2',
    name: 'GPT Image 2',
    provider: 'OpenAI',
    type: 'image',
    maxTokens: 0,
    contextLength: 0,
    inputCapabilities: ['text', 'image'],
    outputCapabilities: ['image'],
    price: { input: '按张计费', output: '按张计费' },
  },
  {
    id: 'gemini-3.1-flash',
    name: 'Nanobanana 2',
    provider: 'Google',
    type: 'image',
    maxTokens: 0,
    contextLength: 0,
    inputCapabilities: ['text', 'image'],
    outputCapabilities: ['image'],
    price: { input: '按张计费', output: '按张计费' },
  },
  {
    id: 'gemini-3-pro',
    name: 'Nanobanana Pro',
    provider: 'Google',
    type: 'image',
    maxTokens: 0,
    contextLength: 0,
    inputCapabilities: ['text', 'image'],
    outputCapabilities: ['image'],
    price: { input: '按张计费', output: '按张计费' },
  },
];
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
