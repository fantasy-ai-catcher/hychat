export const DEFAULT_PROFILE_COLOR = 'white';

export const PROFILE_COLORS = [
  { name: 'red', value: '#ef4444' },
  { name: 'orange', value: '#f97316' },
  { name: 'amber', value: '#f59e0b' },
  { name: 'yellow', value: '#eab308' },
  { name: 'lime', value: '#84cc16' },
  { name: 'green', value: '#22c55e' },
  { name: 'mint', value: '#34d399' },
  { name: 'teal', value: '#14b8a6' },
  { name: 'cyan', value: '#06b6d4' },
  { name: 'sky', value: '#0ea5e9' },
  { name: 'blue', value: '#3b82f6' },
  { name: 'indigo', value: '#6366f1' },
  { name: 'violet', value: '#8b5cf6' },
  { name: 'purple', value: '#a855f7' },
  { name: 'magenta', value: '#d946ef' },
  { name: 'pink', value: '#ec4899' },
  { name: 'rose', value: '#f43f5e' },
  { name: 'coral', value: '#fb7185' },
  { name: 'brown', value: '#a16207' },
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
