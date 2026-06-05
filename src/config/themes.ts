export interface ThemeConfig {
  id: string;
  name: string;
  previewColor: string;
}

export const THEMES: ThemeConfig[] = [
  { id: 'purple', name: '暗夜紫', previewColor: 'rgb(127, 96, 255)' },
  { id: 'green', name: '终端绿', previewColor: 'rgb(42, 219, 92)' },
];

export const DEFAULT_THEME = 'purple';
