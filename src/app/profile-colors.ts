export const DEFAULT_PROFILE_COLOR = 'white';

export const PROFILE_COLORS = [
  { name: 'slate', value: '#8896a6' },
  { name: 'steel', value: '#6f8fb0' },
  { name: 'teal', value: '#5e9b9b' },
  { name: 'sage', value: '#8aa37b' },
  { name: 'moss', value: '#6f8f5f' },
  { name: 'olive', value: '#9a9b5f' },
  { name: 'sand', value: '#c2a36b' },
  { name: 'clay', value: '#bd8a6a' },
  { name: 'rose', value: '#c08497' },
  { name: 'mauve', value: '#a18fb0' },
  { name: 'plum', value: '#8c7aa0' },
  { name: 'dusk', value: '#7c83b0' },
  { name: 'gray', value: '#9ca3af' }
] as const;

export type ProfileColorName = (typeof PROFILE_COLORS)[number]['name'];

const PROFILE_COLOR_VALUES = new Map<string, string>(
  PROFILE_COLORS.map((color) => [color.name, color.value])
);

export function isProfileColorName(value: string): value is ProfileColorName | typeof DEFAULT_PROFILE_COLOR {
  return value === DEFAULT_PROFILE_COLOR || PROFILE_COLOR_VALUES.has(value);
}

export function resolveProfileColor(color: string | undefined): string {
  if (!color || color === DEFAULT_PROFILE_COLOR) {
    return DEFAULT_PROFILE_COLOR;
  }

  return PROFILE_COLOR_VALUES.get(color) ?? DEFAULT_PROFILE_COLOR;
}

export function formatProfileColorList(): string {
  return PROFILE_COLORS.map((color, index) => `${index + 1}:${color.name}`).join(' ');
}
