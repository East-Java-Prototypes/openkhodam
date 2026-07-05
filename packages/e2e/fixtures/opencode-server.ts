import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

export type FakeOpenCodeServer = {
  url: string
  getPromptRequests: () => FakePromptRequest[]
  close: () => Promise<void>
}

export type FakePromptRequest = {
  sessionID: string
  text: string
  agent: string | null
  model: { providerID: string; modelID: string } | null
  variant: string | null
}

const directory = process.cwd()
const now = Date.now()
const sessions = new Map<string, FakeSession>()
const messages = new Map<string, unknown[]>()
const pendingPrompts = new Map<string, { id: string; text: string; fetches: number }[]>()
const promptRequests: FakePromptRequest[] = []
let promptIdSequence = 0
let newSessionSequence = 1
let stableMessageSequence = 0
let nativeOpenCodeTime = BigInt(Date.now() - 60_000) * BigInt(0x1000)
const project = {
  id: 'fake-project',
  name: 'Fake Project',
  worktree: directory,
  time: { created: now, updated: now },
  sandboxes: []
}
const connectedProviderID = 'fake-provider'
const connectedModelID = 'fake-connected-model'
const disconnectedProviderID = 'offline-provider'
const disconnectedModelID = 'offline-model'
const structuredUserPrompt = 'Structured fixture user prompt with **literal user markdown**'
const structuredAssistantMarkdownText = [
  'Inspecting project files.',
  '',
  'Assistant markdown fixture with **bold assistant phrase**, `inlineToken`, and [fixture docs](https://example.test/markdown).',
  '',
  '- first list item',
  '- second list item',
  '',
  '```ts',
  'const fenced = "assistant markdown"',
  'pnpm test:e2e',
  '```',
  '',
  '# unsupported assistant heading',
  '',
  '> unsupported assistant quote',
  '',
  '![unsupported assistant image](https://example.test/unsupported-image.png)',
  '',
  '| unsupported | table |',
  '| --- | --- |',
  '| alpha | beta |',
  '',
  '- [ ] unsupported task list item'
].join('\n')
const structuredReasoningText = 'Need **file context** before responding.'
const structuredToolOutput = 'V1 fixture tool output with **literal tool markdown**'
const providers = {
  all: [
    {
      id: connectedProviderID,
      name: 'Connected Fake Provider',
      env: [],
      models: {
        [connectedModelID]: createProviderModel(connectedModelID, 'Connected Fake Model', {
          low: {},
          high: {}
        }),
        'fake-alt-model': createProviderModel('fake-alt-model', 'Connected Alternate Model')
      }
    },
    {
      id: disconnectedProviderID,
      name: 'Disconnected Provider',
      env: [],
      models: {
        [disconnectedModelID]: createProviderModel(disconnectedModelID, 'Disconnected Hidden Model')
      }
    }
  ],
  connected: [connectedProviderID],
  default: { [connectedProviderID]: connectedModelID }
}
const agents = [
  createAgent('build', 'Primary fake build agent', 'primary'),
  createAgent('plan', 'All-mode fake planning agent', 'all'),
  createAgent('hidden', 'Hidden fake agent', 'primary', { hidden: true }),
  createAgent('subagent', 'Subagent-only fake agent', 'subagent')
]

type FakeSession = {
  id: string
  title: string
  parentID?: string
  directory: string
  time: { created: number; updated: number }
  location: { directory: string }
}

export async function startFakeOpenCodeServer(): Promise<FakeOpenCodeServer> {
  resetState()
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'OPTIONS') return preflight(response)
    const body = request.method === 'POST' ? await readJson(request) : null

    if (request.method === 'GET' && url.pathname === '/global/health') {
      return json(response, { healthy: true, version: 'fake-stable' })
    }
    if (request.method === 'GET' && url.pathname === '/project') {
      return json(response, [project])
    }
    if (request.method === 'GET' && url.pathname === '/project/current') {
      return json(response, project)
    }
    if (request.method === 'GET' && url.pathname === '/provider') {
      return json(response, providers)
    }
    if (request.method === 'GET' && url.pathname === '/api/agent') {
      return json(response, { location: { directory }, data: agents })
    }
    if (request.method === 'GET' && url.pathname === '/session') {
      return json(response, [...sessions.values()])
    }
    if (request.method === 'POST' && url.pathname === '/session') {
      const id = `new-session-${++newSessionSequence}`
      const session = createSession(id, 'New deterministic chat', body?.directory ?? directory)
      sessions.set(id, session)
      messages.set(id, [])
      return json(response, session)
    }

    const sessionMatch = url.pathname.match(/^\/session\/([^/]+)$/)
    if (request.method === 'GET' && sessionMatch) {
      const session = sessions.get(sessionMatch[1])
      return json(
        response,
        session ? session : { _tag: 'SessionNotFoundError', message: 'Session not found.' },
        session ? 200 : 404
      )
    }
    const promptMatch = url.pathname.match(/^\/session\/([^/]+)\/prompt_async$/)
    if (request.method === 'POST' && promptMatch) {
      const sessionID = promptMatch[1]
      const text = getPromptText(body)
      const id =
        typeof body?.messageID === 'string' ? body.messageID : `input-${++promptIdSequence}`
      if (!isOpenCodeID(id, 'msg')) {
        return json(response, { message: 'messageID must be OpenCode-compatible' }, 400)
      }
      if (!hasValidPartIDs(body)) {
        return json(response, { message: 'part ids must start with prt' }, 400)
      }
      if (!isConnectedModel(body?.model)) {
        return json(response, { message: 'prompt model must be connected' }, 400)
      }
      if (!isVisibleAgent(body?.agent)) {
        return json(response, { message: 'prompt agent must be a visible primary/all agent' }, 400)
      }
      if (!isValidVariant(body?.model, body?.variant)) {
        return json(response, { message: 'prompt variant must belong to the selected model' }, 400)
      }
      promptRequests.push({
        sessionID,
        text,
        agent: typeof body?.agent === 'string' ? body.agent : null,
        model: isConnectedModel(body?.model)
          ? { providerID: body.model.providerID, modelID: body.model.modelID }
          : null,
        variant: typeof body?.variant === 'string' ? body.variant : null
      })
      pendingPrompts.set(sessionID, [
        ...(pendingPrompts.get(sessionID) ?? []),
        { id, text, fetches: 0 }
      ])
      return json(response, {})
    }
    const messagesMatch = url.pathname.match(/^\/session\/([^/]+)\/message$/)
    if (request.method === 'GET' && messagesMatch) {
      projectPendingMessages(messagesMatch[1])
      response.setHeader('x-next-cursor', '')
      return json(response, messages.get(messagesMatch[1]) ?? [])
    }

    return json(response, { message: 'Not found' }, 404)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (typeof address !== 'object' || !address)
    throw new Error('Fake OpenCode server did not start.')
  return {
    url: `http://127.0.0.1:${address.port}`,
    getPromptRequests: () => [...promptRequests],
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}

function resetState(): void {
  sessions.clear()
  messages.clear()
  pendingPrompts.clear()
  promptRequests.length = 0
  promptIdSequence = 0
  newSessionSequence = 1
  stableMessageSequence = 0
  nativeOpenCodeTime = BigInt(Date.now() - 60_000) * BigInt(0x1000)
  const seeded = createSession('seeded-session', 'Seeded deterministic chat', directory)
  const structured = createSession('structured-session', 'Structured fixture chat', directory)
  const child = createSession('child-subagent-session', 'Hidden subagent child chat', directory, {
    parentID: seeded.id
  })
  sessions.set(seeded.id, seeded)
  const seededUserID = stableMessageID()
  messages.set(seeded.id, [
    userMessage(seededUserID, 'Seeded user prompt'),
    assistantMessage(stableMessageID(), 'Seeded assistant response', seededUserID)
  ])
  sessions.set(structured.id, structured)
  const structuredUserID = stableMessageID()
  messages.set(structured.id, [
    userMessage(structuredUserID, structuredUserPrompt),
    structuredV1AssistantMessage(stableMessageID(), structuredUserID),
    patchOnlyAssistantMessage(stableMessageID(), structuredUserID),
    emptyAssistantMessage(stableMessageID(), structuredUserID),
    longCollapsedToolMessage(stableMessageID(), structuredUserID),
    structuredV2AssistantMessage(stableMessageID(), structuredUserID)
  ])
  sessions.set(child.id, child)
  const childUserID = stableMessageID()
  messages.set(child.id, [
    userMessage(childUserID, 'Hidden subagent user prompt'),
    assistantMessage(stableMessageID(), 'Hidden subagent assistant response', childUserID)
  ])
}

function projectPendingMessages(sessionID: string): void {
  const pending = pendingPrompts.get(sessionID) ?? []
  if (pending.length === 0) return
  for (const prompt of pending) prompt.fetches += 1
  const ready = pending.filter((prompt) => prompt.fetches >= 5)
  if (ready.length === 0) return

  const existing = messages.get(sessionID) ?? []
  for (const prompt of ready) {
    existing.push(
      userMessage(prompt.id, prompt.text),
      assistantMessage(
        assistantMessageIDAfterPrompt(prompt.id),
        `Fake response for: ${prompt.text}`,
        prompt.id
      )
    )
  }
  messages.set(sessionID, existing)
  const readyIds = new Set(ready.map((prompt) => prompt.id))
  const remaining = pending.filter((prompt) => !readyIds.has(prompt.id))
  if (remaining.length) pendingPrompts.set(sessionID, remaining)
  else pendingPrompts.delete(sessionID)
}

function stableMessageID(): string {
  return openCodeID('msg', nextNativeOpenCodeSortable())
}

function assistantMessageIDAfterPrompt(promptID: string): string {
  return openCodeID('msg', BigInt(`0x${promptID.slice(4, 16)}`) + BigInt(1))
}

function nextNativeOpenCodeSortable(): bigint {
  nativeOpenCodeTime += BigInt(0x1000)
  stableMessageSequence += 1
  return nativeOpenCodeTime
}

function openCodeID(prefix: 'msg' | 'prt', sortable: bigint): string {
  return `${prefix}_${encodeNativeSortable(sortable)}${stableMessageSequence.toString(36).padStart(14, '0')}`
}

function encodeNativeSortable(value: bigint): string {
  let result = ''
  for (let i = 0; i < 6; i++) {
    const shift = BigInt(40 - 8 * i)
    const byte = Number((value >> shift) & BigInt(0xff))
    result += byte.toString(16).padStart(2, '0')
  }
  return result
}

function isOpenCodeID(id: string, prefix: 'msg' | 'prt'): boolean {
  return new RegExp(`^${prefix}_[0-9a-f]{12}[0-9A-Za-z]{14}$`).test(id)
}

function createSession(
  id: string,
  title: string,
  sessionDirectory: string,
  options: { parentID?: string } = {}
): FakeSession {
  return {
    id,
    slug: id,
    projectID: 'fake-project',
    title,
    ...options,
    directory: sessionDirectory,
    location: { directory: sessionDirectory },
    version: 'fake-stable',
    time: { created: now, updated: Date.now() }
  } as FakeSession
}

function createProviderModel(id: string, name: string, variants?: Record<string, unknown>) {
  return {
    id,
    name,
    release_date: '2026-01-01',
    attachment: false,
    reasoning: false,
    temperature: true,
    tool_call: true,
    limit: { context: 1000, output: 1000 },
    ...(variants ? { variants } : {}),
    options: {}
  }
}

function createAgent(
  id: string,
  description: string,
  mode: 'primary' | 'all' | 'subagent',
  options: { hidden?: boolean } = {}
): unknown {
  return {
    id,
    description,
    mode,
    hidden: options.hidden ?? false,
    request: { headers: {}, body: {} },
    permissions: []
  }
}

function userMessage(id: string, text: string): unknown {
  return {
    info: { id, role: 'user', time: { created: Date.now() } },
    parts: [{ id: `${id}-text`, type: 'text', text }]
  }
}

function assistantMessage(id: string, text: string, parentID: string): unknown {
  return {
    info: {
      id,
      role: 'assistant',
      parentID,
      agent: 'test',
      model: { id: 'fake', providerID: 'fake' },
      time: { created: Date.now() }
    },
    parts: [{ id: `${id}-text`, type: 'text', text }]
  }
}

function structuredV1AssistantMessage(id: string, parentID: string): unknown {
  return {
    info: { id, role: 'assistant', parentID, time: { created: Date.now() } },
    parts: [
      { id: `${id}-step-start`, type: 'step-start', text: 'Hidden v1 step start marker' },
      {
        id: `${id}-text`,
        type: 'text',
        text: structuredAssistantMarkdownText
      },
      {
        id: `${id}-reasoning`,
        type: 'reasoning',
        text: structuredReasoningText
      },
      {
        id: `${id}-tool`,
        type: 'tool',
        name: 'read',
        status: 'completed',
        input: { filePath: 'README.md' },
        output: structuredToolOutput
      },
      { id: `${id}-step-finish`, type: 'step-finish', text: 'Hidden v1 step finish marker' },
      { id: `${id}-unknown`, type: 'future-part', detail: 'V1 unknown fixture' }
    ]
  }
}

function patchOnlyAssistantMessage(id: string, parentID: string): unknown {
  return {
    info: { id, role: 'assistant', parentID, time: { created: Date.now() } },
    parts: [
      {
        id: `${id}-patch`,
        type: 'patch',
        text: 'Hidden patch fixture marker',
        patch: 'diff --git a/README.md b/README.md'
      }
    ]
  }
}

function emptyAssistantMessage(id: string, parentID: string): unknown {
  return {
    info: { id, role: 'assistant', parentID, time: { created: Date.now() } },
    parts: []
  }
}

function longCollapsedToolMessage(id: string, parentID: string): unknown {
  return {
    info: { id, role: 'assistant', parentID, time: { created: Date.now() } },
    parts: [
      {
        id: `${id}-text`,
        type: 'text',
        text: 'A collapsed tool should stay anchored when opened.'
      },
      {
        id: `${id}-tool`,
        type: 'tool',
        name: 'plan',
        status: 'completed',
        input: { topic: 'scroll stability' },
        output: Array.from({ length: 80 }, (_, index) => `Long tool output line ${index + 1}`).join(
          '\n'
        )
      }
    ]
  }
}

function structuredV2AssistantMessage(id: string, parentID: string): unknown {
  return {
    id,
    type: 'assistant',
    parentID,
    time: { created: Date.now() },
    content: [
      { type: 'step-start', text: 'Hidden v2 step start marker' },
      { type: 'text', text: 'Running the v2 shell check.' },
      {
        type: 'tool',
        name: 'bash',
        state: {
          status: 'error',
          input: { command: 'pnpm test' },
          content: [{ text: 'V2 fixture tool output' }],
          error: { message: 'V2 fixture tool error' }
        }
      },
      { type: 'step-finish', text: 'Hidden v2 step finish marker' },
      { type: 'future-content', text: 'V2 unknown fixture' }
    ]
  }
}

function getPromptText(body: any): string {
  const textPart = Array.isArray(body?.parts)
    ? body.parts.find((part: any) => part?.type === 'text' && typeof part?.text === 'string')
    : null
  return textPart?.text ?? ''
}

function hasValidPartIDs(body: any): boolean {
  return (
    Array.isArray(body?.parts) &&
    body.parts.length > 0 &&
    body.parts.every((part: any) => typeof part?.id === 'string' && isOpenCodeID(part.id, 'prt'))
  )
}

function isConnectedModel(model: any): boolean {
  if (!model || typeof model !== 'object' || Array.isArray(model)) return false
  const keys = Object.keys(model)
  if (keys.length !== 2 || !keys.includes('providerID') || !keys.includes('modelID')) return false
  return model.providerID === connectedProviderID && model.modelID in providers.all[0].models
}

function isVisibleAgent(agentID: any): boolean {
  if (agentID === undefined || agentID === null) return true
  if (typeof agentID !== 'string') return false
  return agents.some(
    (agent: any) =>
      agent.id === agentID &&
      agent.hidden !== true &&
      (agent.mode === 'primary' || agent.mode === 'all')
  )
}

function isValidVariant(model: any, variant: any): boolean {
  if (variant === undefined || variant === null) return true
  if (typeof variant !== 'string') return false
  if (!isConnectedModel(model)) return false
  const providerModel = (
    providers.all[0].models as Record<string, { variants?: Record<string, unknown> }>
  )[model.modelID]
  return Boolean(providerModel.variants && variant in providerModel.variants)
}

async function readJson(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : null
}

function json(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, corsHeaders({ 'content-type': 'application/json' }))
  response.end(JSON.stringify(value))
}

function preflight(response: ServerResponse): void {
  response.writeHead(204, corsHeaders())
  response.end()
}

function corsHeaders(headers: Record<string, string> = {}): Record<string, string> {
  return {
    ...headers,
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization, x-requested-with',
    'access-control-allow-methods': 'GET, POST, OPTIONS'
  }
}
