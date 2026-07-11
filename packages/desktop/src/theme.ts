export const themeModes = ['system', 'light', 'dark'] as const
export type ThemeMode = (typeof themeModes)[number]

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && themeModes.includes(value as ThemeMode)
}
