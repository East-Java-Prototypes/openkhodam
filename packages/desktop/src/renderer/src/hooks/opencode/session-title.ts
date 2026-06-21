const defaultTitlePattern =
  /^(New session|Child session) - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const internalTitleGenerationMarker = 'OpenKhodam title generation'

export function sessionTitle(title?: string): string | undefined {
  if (!title) return title
  const match = title.match(defaultTitlePattern)
  return match ? match[1] : title
}

export function isOpenCodeDefaultSessionTitle(title?: string | null): boolean {
  return typeof title === 'string' && defaultTitlePattern.test(title)
}

export function isOpenCodeChildSessionTitle(title?: string | null): boolean {
  return typeof title === 'string' && title.startsWith('Child session - ')
}

export function isTitleGenerationSession(session: unknown): boolean {
  if (!isRecord(session)) return false
  if (getString(session, 'title') === internalTitleGenerationMarker) return true
  const metadata = isRecord(session.metadata) ? session.metadata : null
  return metadata?.openKhodamInternal === 'session-title-generation'
}

export const titleGenerationSessionTitle = internalTitleGenerationMarker

function getString(value: Record<string, unknown>, key: string): string | null {
  const property = value[key]
  return typeof property === 'string' ? property : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
