import { isThemeMode, type ThemeMode } from '../../theme'

export type { ThemeMode } from '../../theme'
export type ResolvedThemeMode = Exclude<ThemeMode, 'system'>

const themePreferenceKey = 'openkhodam.theme-mode'
const mediaQuery = '(prefers-color-scheme: dark)'
const listeners = new Set<() => void>()

let currentMode: ThemeMode | null = null
let systemThemeCleanup: (() => void) | null = null

function getMediaQueryList(): MediaQueryList | null {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? null
    : window.matchMedia(mediaQuery)
}

function readStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system'

  try {
    const storedMode = window.localStorage.getItem(themePreferenceKey)
    return isThemeMode(storedMode) ? storedMode : 'system'
  } catch {
    return 'system'
  }
}

function getCurrentMode(): ThemeMode {
  currentMode ??= readStoredMode()
  return currentMode
}

function resolveMode(mode: ThemeMode): ResolvedThemeMode {
  return mode === 'system' ? (getMediaQueryList()?.matches ? 'dark' : 'light') : mode
}

function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return

  const resolvedMode = resolveMode(mode)
  document.documentElement.classList.toggle('dark', resolvedMode === 'dark')
  document.documentElement.style.colorScheme = resolvedMode
}

function syncNativeTheme(mode: ThemeMode): void {
  void window.api?.setNativeTheme(mode)
}

function emitThemeChange(): void {
  for (const listener of listeners) listener()
}

function handleSystemThemeChange(): void {
  if (getCurrentMode() !== 'system') return
  applyTheme('system')
  syncNativeTheme('system')
  emitThemeChange()
}

function ensureSystemThemeSubscription(): void {
  if (systemThemeCleanup || typeof window === 'undefined') return

  const queryList = getMediaQueryList()
  if (!queryList) return

  queryList.addEventListener('change', handleSystemThemeChange)
  systemThemeCleanup = () => queryList.removeEventListener('change', handleSystemThemeChange)
}

export function bootstrapTheme(): void {
  const mode = getCurrentMode()
  applyTheme(mode)
  syncNativeTheme(mode)
  ensureSystemThemeSubscription()
}

export function getThemeMode(): ThemeMode {
  return getCurrentMode()
}

export function getResolvedThemeMode(): ResolvedThemeMode {
  return resolveMode(getCurrentMode())
}

export function setThemeMode(mode: ThemeMode): void {
  currentMode = mode
  try {
    window.localStorage.setItem(themePreferenceKey, mode)
  } catch {
    // The in-memory selection still applies when storage is unavailable.
  }
  applyTheme(mode)
  syncNativeTheme(mode)
  ensureSystemThemeSubscription()
  emitThemeChange()
}

export function subscribeToTheme(listener: () => void): () => void {
  ensureSystemThemeSubscription()
  listeners.add(listener)
  return () => listeners.delete(listener)
}
