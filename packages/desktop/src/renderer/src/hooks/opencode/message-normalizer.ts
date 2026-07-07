import type { ChatMessagePart } from '../useChatInterfaceData'

export type NormalizedOpenCodeMessage = {
  id: string | null
  author: 'user' | 'assistant'
  parentID: string | null
  createdAt: string | number | null
  content: string
  parts: ChatMessagePart[]
}

const NON_RENDERABLE_PART_TYPES = new Set(['patch', 'step-start', 'step-finish'])

export function normalizeOpenCodeMessage(message: unknown): NormalizedOpenCodeMessage | null {
  const parts = normalizeParts(message)
  const content = partsToText(parts) || getDirectText(message) || ''
  if (parts.length === 0 && !content) return null
  return {
    id: getMessageId(message),
    author: getMessageRole(message) === 'user' ? 'user' : 'assistant',
    parentID: getMessageParentID(message),
    createdAt: getMessageTime(message),
    content,
    parts: parts.length ? parts : [{ id: 'fallback-text', type: 'text', text: content }]
  }
}

function normalizeParts(message: unknown): ChatMessagePart[] {
  const v2 = normalizeV2Message(message)
  if (v2) return v2
  const parts =
    readArrayProperty(message, 'parts') ??
    readArrayProperty(readObjectProperty(message, 'info'), 'parts')
  return compactParts((parts ?? []).map((part, index) => normalizePart(part, `part-${index}`)))
}

function normalizeV2Message(message: unknown): ChatMessagePart[] | null {
  const type = readStringProperty(message, 'type')
  if (!type) return null
  if (type === 'user' || type === 'synthetic' || type === 'system')
    return textParts(readStringProperty(message, 'text'), type)
  if (type === 'assistant')
    return compactParts(
      (readArrayProperty(message, 'content') ?? []).map((part, index) =>
        normalizePart(part, `content-${index}`)
      )
    )
  if (type === 'shell') return [normalizeTool(message, 'shell')]
  if (type === 'compaction')
    return [
      {
        id: 'status-compaction',
        type: 'status',
        title: 'Session compacted',
        text: readStringProperty(message, 'summary') ?? undefined
      }
    ]
  if (type === 'agent-switched')
    return [
      {
        id: 'status-agent',
        type: 'status',
        title: 'Agent switched',
        text: readStringProperty(message, 'agent') ?? undefined
      }
    ]
  if (type === 'model-switched')
    return [
      {
        id: 'status-model',
        type: 'status',
        title: 'Model switched',
        text: stringify(readObjectProperty(message, 'model'))
      }
    ]
  return [{ id: 'status-unknown', type: 'unknown', label: type, text: stringify(message) }]
}

function normalizePart(part: unknown, fallbackId: string): ChatMessagePart | null {
  if (typeof part === 'string') return { id: fallbackId, type: 'text', text: part }
  const id = readStringProperty(part, 'id') ?? fallbackId
  const type = readStringProperty(part, 'type') ?? 'part'
  if (NON_RENDERABLE_PART_TYPES.has(type)) return null
  if (type === 'text')
    return {
      id,
      type: 'text',
      text: readStringProperty(part, 'text') ?? readStringProperty(part, 'content') ?? ''
    }
  if (type === 'reasoning') {
    const text = readStringProperty(part, 'text') ?? readStringProperty(part, 'content')
    if (!text?.trim()) return null
    return {
      id,
      type: 'reasoning',
      text
    }
  }
  if (type === 'tool' || readStringProperty(part, 'tool') || readStringProperty(part, 'name'))
    return normalizeTool(part, id)
  return {
    id,
    type: 'unknown',
    label: type,
    text: readStringProperty(part, 'text') ?? readStringProperty(part, 'content') ?? stringify(part)
  }
}

function compactParts(parts: Array<ChatMessagePart | null>): ChatMessagePart[] {
  return parts.filter((part): part is ChatMessagePart => part !== null)
}

function normalizeTool(value: unknown, id: string): ChatMessagePart {
  const state = readObjectProperty(value, 'state')
  const input = firstPresent(
    readProperty(value, 'input'),
    readProperty(state, 'input'),
    readProperty(value, 'parameters'),
    readProperty(state, 'parameters')
  )
  const output =
    valueToText(readProperty(value, 'output')) ??
    valueToText(readProperty(state, 'output')) ??
    contentItemsText(readArrayProperty(state, 'content'))
  const error =
    valueToText(readProperty(value, 'error')) ?? valueToText(readProperty(state, 'error'))
  return {
    id: readStringProperty(value, 'id') ?? id,
    type: 'tool',
    name:
      readStringProperty(value, 'name') ??
      readStringProperty(value, 'tool') ??
      readStringProperty(value, 'command') ??
      'tool',
    status: readStringProperty(value, 'status') ?? readStringProperty(state, 'status') ?? 'updated',
    title: readStringProperty(value, 'title') ?? undefined,
    input: valueToText(input) ?? undefined,
    output: output ?? undefined,
    error: error ?? undefined
  }
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
          : (readStringProperty(item, 'text') ?? readStringProperty(item, 'url') ?? '')
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
  return readStringProperty(message, 'text') ?? readStringProperty(message, 'content')
}
function getMessageId(message: unknown): string | null {
  const info = readObjectProperty(message, 'info')
  return (
    readStringProperty(info, 'id') ??
    readStringProperty(info, 'messageID') ??
    readStringProperty(message, 'id') ??
    readStringProperty(message, 'messageID')
  )
}
function getMessageRole(message: unknown): string | null {
  const info = readObjectProperty(message, 'info')
  return (
    readStringProperty(info, 'role') ??
    readStringProperty(message, 'role') ??
    readStringProperty(message, 'type')
  )
}
function getMessageParentID(message: unknown): string | null {
  const info = readObjectProperty(message, 'info')
  return readStringProperty(info, 'parentID') ?? readStringProperty(message, 'parentID')
}
function getMessageTime(message: unknown): string | number | null {
  const info = readObjectProperty(message, 'info')
  const infoTime = readObjectProperty(info, 'time')
  const time = readObjectProperty(message, 'time')
  return (
    readTimeProperty(infoTime, 'created') ??
    readTimeProperty(infoTime, 'updated') ??
    readTimeProperty(info, 'time') ??
    readTimeProperty(info, 'createdAt') ??
    readTimeProperty(time, 'created') ??
    readTimeProperty(message, 'time')
  )
}
function readTimeProperty(value: unknown, property: string): string | number | null {
  const propertyValue = readProperty(value, property)
  if (typeof propertyValue === 'string' && propertyValue.length > 0) return propertyValue
  if (typeof propertyValue === 'number') return propertyValue
  return null
}
function readStringProperty(value: unknown, property: string): string | null {
  const propertyValue = readProperty(value, property)
  return typeof propertyValue === 'string' && propertyValue.length > 0 ? propertyValue : null
}
function readProperty(value: unknown, property: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  return (value as { [key: string]: unknown })[property]
}
function readObjectProperty(value: unknown, property: string): Record<string, unknown> | null {
  const propertyValue = readProperty(value, property)
  return typeof propertyValue === 'object' && propertyValue !== null
    ? (propertyValue as Record<string, unknown>)
    : null
}
function readArrayProperty(value: unknown, property: string): unknown[] | null {
  const propertyValue = readProperty(value, property)
  return Array.isArray(propertyValue) ? propertyValue : null
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
  return (
    readStringProperty(value, 'message') ?? readStringProperty(value, 'text') ?? stringify(value)
  )
}
