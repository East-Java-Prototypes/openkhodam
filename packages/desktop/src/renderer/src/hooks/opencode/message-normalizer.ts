import type { ChatMessagePart, GoogleDocDocumentArtifact } from '../useChatInterfaceData'

export type NormalizedOpenCodeMessage = {
  id: string | null
  author: 'user' | 'assistant'
  createdAt: string | number | null
  content: string
  parts: ChatMessagePart[]
}

const NON_RENDERABLE_PART_TYPES = new Set(['step-start', 'step-finish'])

export function normalizeOpenCodeMessage(message: unknown): NormalizedOpenCodeMessage {
  const parts = normalizeParts(message)
  const content = partsToText(parts) || getDirectText(message) || 'No text content.'
  return {
    id: getMessageId(message),
    author: getMessageRole(message) === 'user' ? 'user' : 'assistant',
    createdAt: getMessageTime(message),
    content,
    parts: parts.length ? parts : [{ id: 'fallback-text', type: 'text', text: content }]
  }
}

function normalizeParts(message: unknown): ChatMessagePart[] {
  const v2 = normalizeV2Message(message)
  if (v2) return v2
  const parts =
    getArrayProperty(message, 'parts') ??
    getArrayProperty(getRecordProperty(message, 'info'), 'parts')
  return compactParts((parts ?? []).map((part, index) => normalizePart(part, `part-${index}`)))
}

function normalizeV2Message(message: unknown): ChatMessagePart[] | null {
  const type = getStringFromRecord(message, 'type')
  if (!type) return null
  if (type === 'user' || type === 'synthetic' || type === 'system')
    return textParts(getStringFromRecord(message, 'text'), type)
  if (type === 'assistant')
    return compactParts(
      (getArrayProperty(message, 'content') ?? []).map((part, index) =>
        normalizePart(part, `content-${index}`)
      )
    )
  if (type === 'shell' && isRecord(message)) return [normalizeTool(message, 'shell')]
  if (type === 'compaction')
    return [
      {
        id: 'status-compaction',
        type: 'status',
        title: 'Session compacted',
        text: getStringFromRecord(message, 'summary') ?? undefined
      }
    ]
  if (type === 'agent-switched')
    return [
      {
        id: 'status-agent',
        type: 'status',
        title: 'Agent switched',
        text: getStringFromRecord(message, 'agent') ?? undefined
      }
    ]
  if (type === 'model-switched')
    return [
      {
        id: 'status-model',
        type: 'status',
        title: 'Model switched',
        text: stringify(getRecordProperty(message, 'model'))
      }
    ]
  return [{ id: 'status-unknown', type: 'unknown', label: type, text: stringify(message) }]
}

function normalizePart(part: unknown, fallbackId: string): ChatMessagePart | null {
  if (typeof part === 'string') return { id: fallbackId, type: 'text', text: part }
  if (!isRecord(part))
    return { id: fallbackId, type: 'unknown', label: 'part', text: stringify(part) }
  const id = getStringFromRecord(part, 'id') ?? fallbackId
  const type = getStringFromRecord(part, 'type') ?? 'part'
  if (NON_RENDERABLE_PART_TYPES.has(type)) return null
  if (type === 'text')
    return {
      id,
      type: 'text',
      text: getStringFromRecord(part, 'text') ?? getStringFromRecord(part, 'content') ?? ''
    }
  if (type === 'reasoning')
    return {
      id,
      type: 'reasoning',
      text:
        getStringFromRecord(part, 'text') ??
        getStringFromRecord(part, 'content') ??
        'Reasoning updated.'
    }
  if (type === 'tool' || getStringFromRecord(part, 'tool') || getStringFromRecord(part, 'name'))
    return normalizeTool(part, id)
  return {
    id,
    type: 'unknown',
    label: type,
    text:
      getStringFromRecord(part, 'text') ?? getStringFromRecord(part, 'content') ?? stringify(part)
  }
}

function compactParts(parts: Array<ChatMessagePart | null>): ChatMessagePart[] {
  return parts.filter((part): part is ChatMessagePart => part !== null)
}

function normalizeTool(value: Record<string, unknown>, id: string): ChatMessagePart {
  const state = getRecordProperty(value, 'state')
  const input = firstPresent(
    getProperty(value, 'input'),
    getProperty(state, 'input'),
    getProperty(value, 'parameters'),
    getProperty(state, 'parameters')
  )
  const output =
    valueToText(getProperty(value, 'output')) ??
    valueToText(getProperty(state, 'output')) ??
    contentItemsText(getArrayProperty(state, 'content'))
  const error = valueToText(getProperty(value, 'error')) ?? valueToText(getProperty(state, 'error'))
  const artifact = extractGoogleDocDocumentArtifact(output)
  return {
    id: getStringFromRecord(value, 'id') ?? id,
    type: 'tool',
    name:
      getStringFromRecord(value, 'name') ??
      getStringFromRecord(value, 'tool') ??
      getStringFromRecord(value, 'command') ??
      'tool',
    status:
      getStringFromRecord(value, 'status') ?? getStringFromRecord(state, 'status') ?? 'updated',
    title: getStringFromRecord(value, 'title') ?? undefined,
    input: valueToText(input) ?? undefined,
    output: output ?? undefined,
    error: error ?? undefined,
    artifact
  }
}

function extractGoogleDocDocumentArtifact(
  output: string | null
): GoogleDocDocumentArtifact | undefined {
  if (!output) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    return undefined
  }

  const candidate = findGoogleDocDocumentArtifactRecord(parsed)
  if (!candidate) return undefined
  const id = getStringFromRecord(candidate, 'id') ?? getStringFromRecord(candidate, 'documentId')
  if (!id) return undefined

  return {
    type: 'google.doc.document',
    id,
    title: getStringFromRecord(candidate, 'title'),
    revision:
      getStringFromRecord(candidate, 'revision') ?? getStringFromRecord(candidate, 'revisionId'),
    text: getStringFromRecord(candidate, 'text') ?? '',
    link: getStringFromRecord(candidate, 'link') ?? getStringFromRecord(candidate, 'url')
  }
}

function findGoogleDocDocumentArtifactRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  if (isGoogleDocDocumentArtifactRecord(value)) return value

  const nestedRecordKeys = ['artifact', 'data', 'document', 'result']
  for (const key of nestedRecordKeys) {
    const nested = findGoogleDocDocumentArtifactRecord(getProperty(value, key))
    if (nested) return nested
  }

  const artifacts = getArrayProperty(value, 'artifacts')
  return artifacts?.map(findGoogleDocDocumentArtifactRecord).find(Boolean) ?? null
}

function isGoogleDocDocumentArtifactRecord(value: Record<string, unknown>): boolean {
  return (
    getStringFromRecord(value, 'type') === 'google.doc.document' ||
    getStringFromRecord(value, 'kind') === 'google.doc.document'
  )
}

function textParts(text: string | null, id: string): ChatMessagePart[] {
  return text ? [{ id, type: 'text', text }] : []
}
function contentItemsText(items: unknown[] | null): string | null {
  return (
    items
      ?.map((item) =>
        typeof item === 'string'
          ? item
          : isRecord(item)
            ? (getStringFromRecord(item, 'text') ?? getStringFromRecord(item, 'url') ?? '')
            : ''
      )
      .filter(Boolean)
      .join('\n') || null
  )
}
function partsToText(parts: ChatMessagePart[]): string {
  return parts
    .map((part) =>
      part.type === 'text' || part.type === 'reasoning'
        ? part.text
        : part.type === 'tool'
          ? [part.title ?? part.name, part.output, part.error].filter(Boolean).join('\n')
          : part.type === 'status'
            ? [part.title, part.text].filter(Boolean).join(': ')
            : part.text
    )
    .filter(Boolean)
    .join('\n')
}
function getDirectText(message: unknown): string | null {
  return getStringFromRecord(message, 'text') ?? getStringFromRecord(message, 'content')
}
function getMessageId(message: unknown): string | null {
  const info = getRecordProperty(message, 'info')
  return (
    getStringFromRecord(info, 'id') ??
    getStringFromRecord(info, 'messageID') ??
    getStringFromRecord(message, 'id') ??
    getStringFromRecord(message, 'messageID')
  )
}
function getMessageRole(message: unknown): string | null {
  const info = getRecordProperty(message, 'info')
  return (
    getStringFromRecord(info, 'role') ??
    getStringFromRecord(message, 'role') ??
    getStringFromRecord(message, 'type')
  )
}
function getMessageTime(message: unknown): string | number | null {
  const info = getRecordProperty(message, 'info')
  const infoTime = getRecordProperty(info, 'time')
  const time = getRecordProperty(message, 'time')
  return (
    getTimeFromRecord(infoTime, 'created') ??
    getTimeFromRecord(infoTime, 'updated') ??
    getTimeFromRecord(info, 'time') ??
    getTimeFromRecord(info, 'createdAt') ??
    getTimeFromRecord(time, 'created') ??
    getTimeFromRecord(message, 'time')
  )
}
function getTimeFromRecord(value: unknown, property: string): string | number | null {
  if (!isRecord(value) || !(property in value)) return null
  const propertyValue = value[property]
  if (typeof propertyValue === 'string' && propertyValue.length > 0) return propertyValue
  if (typeof propertyValue === 'number') return propertyValue
  return null
}
function getStringFromRecord(value: unknown, property: string): string | null {
  if (!isRecord(value) || !(property in value)) return null
  const propertyValue = value[property]
  return typeof propertyValue === 'string' && propertyValue.length > 0 ? propertyValue : null
}
function getProperty(value: unknown, property: string): unknown {
  return isRecord(value) ? value[property] : undefined
}
function getRecordProperty(value: unknown, property: string): Record<string, unknown> | null {
  return isRecord(value) && isRecord(value[property]) ? value[property] : null
}
function getArrayProperty(value: unknown, property: string): unknown[] | null {
  return isRecord(value) && Array.isArray(value[property]) ? value[property] : null
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
function firstPresent(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null)
}
function valueToText(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value.length > 0 ? value : null
  if (isRecord(value))
    return (
      getStringFromRecord(value, 'message') ??
      getStringFromRecord(value, 'text') ??
      stringify(value)
    )
  return stringify(value)
}
