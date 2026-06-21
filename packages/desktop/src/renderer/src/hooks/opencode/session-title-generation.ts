import type { QueryClient } from '@tanstack/react-query'

import type { createOpenCodeClient } from './client'
import { Identifier } from './id'
import {
  isOpenCodeChildSessionTitle,
  isOpenCodeDefaultSessionTitle,
  isTitleGenerationSession,
  titleGenerationSessionTitle
} from './session-title'
import { openCodeSessionQueryKey, projectSessionsQueryKey } from '../useOpenCodeSessions'
import type { OpenCodeModelSelection } from '../useOpenCodeModels'

type OpenCodeClient = ReturnType<typeof createOpenCodeClient>

type GenerateSessionTitleInput = {
  client: OpenCodeClient
  queryClient: QueryClient
  status: { url: string | null; pid: number | null; updatedAt: number }
  directory: string
  sessionID: string
  promptText: string
  model: OpenCodeModelSelection
}

const titlePrompt =
  'Generate a concise title for this chat. Reply with only the title, 3-6 words, no quotes, no punctuation.'
const fallbackSystemPrompt =
  'You generate concise chat titles. Reply with only one short title. Do not explain. Do not use tools.'

export async function generateOpenCodeSessionTitle({
  client,
  queryClient,
  status,
  directory,
  sessionID,
  promptText,
  model
}: GenerateSessionTitleInput): Promise<void> {
  let transientSessionID: string | null = null
  try {
    const original = await client.session.get({ sessionID })
    if (original.error || !original.data) return
    if (isTitleGenerationSession(original.data)) return
    if (isOpenCodeChildSessionTitle(getTitle(original.data))) return
    if (!isOpenCodeDefaultSessionTitle(getTitle(original.data))) return

    const transient = await client.session.create({
      directory,
      title: titleGenerationSessionTitle,
      metadata: { openKhodamInternal: 'session-title-generation', sourceSessionID: sessionID }
    } as never)
    if (transient.error || !transient.data?.id) return
    transientSessionID = transient.data.id

    const title = await promptForTitle(client, transientSessionID, model, promptText)
    if (!title) return

    const latest = await client.session.get({ sessionID })
    if (latest.error || !isOpenCodeDefaultSessionTitle(getTitle(latest.data))) return

    const updated = await client.session.update({ sessionID, title })
    if (updated.error) return

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: projectSessionsQueryKey(status, directory) }),
      queryClient.invalidateQueries({ queryKey: openCodeSessionQueryKey(status, directory, sessionID) })
    ])
  } catch (error) {
    console.debug('[opencode] Session title generation skipped', error)
  } finally {
    if (transientSessionID) {
      try {
        await client.session.delete({ sessionID: transientSessionID })
      } catch (error) {
        console.debug('[opencode] Failed to delete transient title session', error)
      }
      await queryClient.invalidateQueries({ queryKey: projectSessionsQueryKey(status, directory) })
    }
  }
}

async function promptForTitle(
  client: OpenCodeClient,
  sessionID: string,
  model: OpenCodeModelSelection,
  promptText: string
): Promise<string | null> {
  const contextualPrompt = `${titlePrompt}\n\nUser prompt:\n${promptText}`
  const first = await client.session.prompt({
    sessionID,
    model,
    agent: 'title',
    tools: {},
    parts: [textPart(contextualPrompt)]
  })
  const firstTitle = first.error ? null : extractTitle(first.data)
  if (firstTitle) return firstTitle

  const fallback = await client.session.prompt({
    sessionID,
    model,
    system: fallbackSystemPrompt,
    tools: {},
    parts: [textPart(contextualPrompt)]
  })
  return fallback.error ? null : extractTitle(fallback.data)
}

function textPart(text: string) {
  return { id: Identifier.ascending('part'), type: 'text' as const, text }
}

function extractTitle(value: unknown): string | null {
  const text = collectText(value).join('\n')
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^["'“”‘’`]+|["'“”‘’`.!?:;]+$/g, '')
    .trim()
  if (!cleaned) return null
  return cleaned.slice(0, 80)
}

function collectText(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(collectText)
  if (!isRecord(value)) return []
  const direct = typeof value.text === 'string' ? [value.text] : []
  return [...direct, ...collectText(value.parts), ...collectText(value.content), ...collectText(value.message)]
}

function getTitle(value: unknown): string | null {
  return isRecord(value) && typeof value.title === 'string' ? value.title : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
