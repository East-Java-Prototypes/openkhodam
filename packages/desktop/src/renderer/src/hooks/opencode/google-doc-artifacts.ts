import type {
  LinkedGoogleDoc,
  ProjectSessionLinkedDocsListInput,
  RecordLinkedGoogleDocInput
} from '@openkhodam/ui/types'

import type { ChatMessage, ChatMessagePart } from '../useChatInterfaceData'

const GOOGLE_DOC_DOCUMENT_TYPE = 'google.doc.document'
const ARTIFACT_WRAPPER_KEYS = ['document', 'artifact', 'data', 'result'] as const

export type GoogleDocDocumentArtifact = {
  id: string
  title: string | null
  url: string | null
}

export type GoogleDocDocumentArtifactCandidate = {
  messageId: string
  doc: GoogleDocDocumentArtifact
}

export type LinkedGoogleDocArtifactApi = {
  listSessionLinkedDocs: (
    input: ProjectSessionLinkedDocsListInput
  ) => Promise<Pick<LinkedGoogleDoc, 'id'>[]>
  recordLinkedGoogleDoc: (input: RecordLinkedGoogleDocInput) => Promise<LinkedGoogleDoc>
}

export type LinkedGoogleDocRecorder = {
  getOrCreateLinkedGoogleDoc: (
    input: GetOrCreateLinkedGoogleDocInput
  ) => Promise<LinkedGoogleDoc | null>
}

export type GetOrCreateLinkedGoogleDocInput = {
  projectDirectory: string
  sessionId: string
  messageId?: string | null
  doc: GoogleDocDocumentArtifact
}

type GoogleDocMessage = Pick<ChatMessage, 'id' | 'parts'>

export function extractGoogleDocDocumentArtifactsFromMessages(
  messages: readonly GoogleDocMessage[]
): GoogleDocDocumentArtifactCandidate[] {
  const candidates: GoogleDocDocumentArtifactCandidate[] = []
  const seen = new Set<string>()

  for (const message of messages) {
    const messageId = normalizeString(message.id)
    if (!messageId) continue

    for (const doc of extractGoogleDocDocumentArtifactsFromParts(message.parts)) {
      const key = `${messageId}:${doc.id}`
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push({ messageId, doc })
    }
  }

  return candidates
}

export function extractGoogleDocDocumentArtifactsFromToolOutput(
  output: unknown
): GoogleDocDocumentArtifact[] {
  const parsed = parseToolOutput(output)
  if (parsed === null) return []

  const docs: GoogleDocDocumentArtifact[] = []
  collectGoogleDocDocuments(parsed, docs, new WeakSet<object>())
  return dedupeDocsById(docs)
}

export function createLinkedGoogleDocRecorder(
  api: LinkedGoogleDocArtifactApi
): LinkedGoogleDocRecorder {
  const knownDocIdsByProjectSession = new Map<string, Promise<Set<string>>>()
  const pendingDocIdsByProjectSession = new Map<string, Set<string>>()

  return {
    async getOrCreateLinkedGoogleDoc(input) {
      const projectDirectory = normalizeRequiredString(input.projectDirectory, 'projectDirectory')
      const sessionId = normalizeRequiredString(input.sessionId, 'sessionId')
      const doc = normalizeGoogleDocArtifact(input.doc)
      const cacheKey = projectSessionCacheKey(projectDirectory, sessionId)
      const knownDocIds = await getKnownDocIds(projectDirectory, sessionId)
      const pendingDocIds = getPendingDocIds(cacheKey)

      if (knownDocIds.has(doc.id) || pendingDocIds.has(doc.id)) return null

      pendingDocIds.add(doc.id)

      try {
        const linkedDoc = await api.recordLinkedGoogleDoc({
          projectDirectory,
          sessionId,
          messageId: normalizeString(input.messageId) ?? null,
          doc
        })
        knownDocIds.add(doc.id)
        return linkedDoc
      } finally {
        pendingDocIds.delete(doc.id)
        if (pendingDocIds.size === 0) pendingDocIdsByProjectSession.delete(cacheKey)
      }
    }
  }

  async function getKnownDocIds(projectDirectory: string, sessionId: string): Promise<Set<string>> {
    const cacheKey = projectSessionCacheKey(projectDirectory, sessionId)
    const cached = knownDocIdsByProjectSession.get(cacheKey)
    if (cached) return cached

    const loaded = api
      .listSessionLinkedDocs({ projectDirectory, sessionId })
      .then((docs) => new Set(docs.map((doc) => doc.id)))
      .catch((error) => {
        knownDocIdsByProjectSession.delete(cacheKey)
        throw error
      })
    knownDocIdsByProjectSession.set(cacheKey, loaded)
    return loaded
  }

  function getPendingDocIds(cacheKey: string): Set<string> {
    const pendingDocIds = pendingDocIdsByProjectSession.get(cacheKey)
    if (pendingDocIds) return pendingDocIds

    const nextPendingDocIds = new Set<string>()
    pendingDocIdsByProjectSession.set(cacheKey, nextPendingDocIds)
    return nextPendingDocIds
  }
}

function extractGoogleDocDocumentArtifactsFromParts(
  parts: readonly ChatMessagePart[]
): GoogleDocDocumentArtifact[] {
  return parts.flatMap((part) =>
    part.type === 'tool' && part.output
      ? extractGoogleDocDocumentArtifactsFromToolOutput(part.output)
      : []
  )
}

function parseToolOutput(output: unknown): unknown | null {
  if (typeof output !== 'string') return output

  const trimmed = output.trim()
  if (!trimmed) return null

  const directJson = parseJson(trimmed)
  if (directJson.ok) return directJson.value

  const fencedJson = getFencedJsonText(trimmed)
  if (!fencedJson) return null

  const parsedFence = parseJson(fencedJson)
  return parsedFence.ok ? parsedFence.value : null
}

function collectGoogleDocDocuments(
  value: unknown,
  docs: GoogleDocDocumentArtifact[],
  seenObjects: WeakSet<object>
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectGoogleDocDocuments(item, docs, seenObjects)
    return
  }

  if (!isRecord(value) || seenObjects.has(value)) return
  seenObjects.add(value)

  const doc = toGoogleDocDocumentArtifact(value)
  if (doc) docs.push(doc)

  for (const key of ARTIFACT_WRAPPER_KEYS) {
    collectGoogleDocDocuments(value[key], docs, seenObjects)
  }

  collectGoogleDocDocuments(value.artifacts, docs, seenObjects)
}

function toGoogleDocDocumentArtifact(
  value: Record<string, unknown>
): GoogleDocDocumentArtifact | null {
  if (getString(value, 'type') !== GOOGLE_DOC_DOCUMENT_TYPE) return null

  const id = firstString(
    value.id,
    value.documentId,
    value.documentID,
    value.revisionId,
    value.revisionID
  )
  if (!id) return null

  return {
    id,
    title: firstString(value.title) ?? null,
    url: firstString(value.link, value.url) ?? null
  }
}

function dedupeDocsById(docs: GoogleDocDocumentArtifact[]): GoogleDocDocumentArtifact[] {
  const seen = new Set<string>()
  const deduped: GoogleDocDocumentArtifact[] = []

  for (const doc of docs) {
    if (seen.has(doc.id)) continue
    seen.add(doc.id)
    deduped.push(doc)
  }

  return deduped
}

function normalizeGoogleDocArtifact(doc: GoogleDocDocumentArtifact): GoogleDocDocumentArtifact {
  return {
    id: normalizeRequiredString(doc.id, 'doc.id'),
    title: normalizeString(doc.title) ?? null,
    url: normalizeString(doc.url) ?? null
  }
}

function projectSessionCacheKey(projectDirectory: string, sessionId: string): string {
  return `${projectDirectory}\0${sessionId}`
}

function getFencedJsonText(value: string): string | null {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(value)
  return match?.[1] ?? null
}

function parseJson(value: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) }
  } catch {
    return { ok: false }
  }
}

function normalizeRequiredString(value: unknown, label: string): string {
  const normalized = normalizeString(value)
  if (!normalized) throw new Error(`${label} must be a non-empty string.`)
  return normalized
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = normalizeString(value)
    if (normalized) return normalized
  }

  return null
}

function getString(value: Record<string, unknown>, key: string): string | null {
  return normalizeString(value[key])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
