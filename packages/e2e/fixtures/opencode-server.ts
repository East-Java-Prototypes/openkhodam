import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

export type FakeOpenCodeServer = {
  url: string
  getPromptRequests: () => FakePromptRequest[]
  getRequestEvents: () => string[]
  getProviderManagementRequests: () => FakeProviderManagementRequest[]
  getConnectedProviders: () => string[]
  setConnectedProviders: (providerIDs: string[]) => void
  setProviderAuthMode: (mode: FakeProviderAuthMode) => void
  setProviderConnectMode: (mode: FakeProviderConnectMode) => void
  getProviderAuthRequests: () => FakeProviderAuthRequest[]
  getOAuthRequests: () => FakeOAuthRequest[]
  armOAuthAuthorizeGate: (providerID: string) => void
  waitForOAuthAuthorize: (providerID: string) => Promise<void>
  releaseOAuthAuthorize: (providerID: string) => void
  waitForOAuthAuthorizeSettlement: (providerID: string) => Promise<void>
  getAbortRequests: () => FakeAbortRequest[]
  armPromptGate: () => void
  waitForPrompt: () => Promise<void>
  releasePrompt: () => void
  armRevertGate: () => void
  waitForRevert: () => Promise<void>
  releaseRevert: () => void
  armAbortGate: () => void
  waitForAbort: () => Promise<void>
  releaseAbort: () => void
  setAbortFalseOnce: () => void
  emitSessionError: (options: FakeSessionErrorEvent) => void
  setSessionRetry: (options: FakeSessionRetryStatus) => void
  clearSessionStatus: (sessionID: string) => void
  close: () => Promise<void>
}

export type FakeProviderAuthMode = 'normal' | 'empty' | 'error'
export type FakeProviderConnectMode = 'normal' | 'fail-once' | 'delayed-oauth'

export type FakeProviderAuthRequest = {
  providerID: string
  key: string
  metadata: Record<string, string> | null
}

export type FakeProviderManagementRequest = {
  endpoint: 'list' | 'auth'
  directory: string | null
}

export type FakeOAuthRequest = { providerID: string; type: 'authorize' | 'callback' }

export type FakeAbortRequest = {
  sessionID: string
}

export type FakeSessionErrorEvent = {
  sessionID: string
  directory?: string
  name: string
  message: string
}

export type FakeSessionRetryStatus = {
  sessionID: string
  message: string
  attempt: number
  next: number
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
const pendingPrompts = new Map<
  string,
  { id: string; text: string; fetches: number; projected: boolean; statusFetches: number }[]
>()
const sessionStatuses = new Map<
  string,
  { type: 'busy' } | { type: 'retry'; message: string; attempt: number; next: number }
>()
const promptRequests: FakePromptRequest[] = []
const requestEvents: string[] = []
const abortRequests: FakeAbortRequest[] = []
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
const rootProject = {
  id: 'global',
  name: 'Global',
  worktree: '/',
  time: { created: now, updated: now },
  sandboxes: []
}
const connectedProviderID = 'fake-provider'
const connectedModelID = 'fake-connected-model'
const disconnectedProviderID = 'offline-provider'
const disconnectedModelID = 'offline-model'
const oauthProviderID = 'oauth-provider'
const oauthModelID = 'oauth-model'
const environmentProviderID = 'environment-provider'
const environmentModelID = 'environment-model'
const singletonPromptProviderID = 'singleton-prompt-provider'
const singletonOAuthProviderID = 'singleton-oauth-provider'
const openCodeGoProviderID = 'opencode-go'
const openCodeGoModelID = 'opencode-go-model'
const emptyMethodsProviderID = 'empty-methods-provider'
const emptyMethodsModelID = 'empty-methods-model'
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
  '## Supported assistant heading',
  '',
  '> unsupported assistant quote',
  '',
  '<div data-raw-html-fixture="blocked">unsupported raw html block</div>',
  '',
  '![unsupported assistant image](https://example.test/unsupported-image.png)',
  '',
  '| supported | table | wide content |',
  '| --- | --- | --- |',
  '| alpha | beta | exceptionally-long-unbroken-table-value-for-overflow-handling-0123456789-abcdefghijklmnopqrstuvwxyz |',
  '',
  '- [ ] unsupported task list item'
].join('\n')
const structuredReasoningText = 'Need **file context** before responding.'
const structuredToolOutput = 'V1 fixture tool output with **literal tool markdown**'
const providerCatalog = [
  {
    id: connectedProviderID,
    name: 'Connected Fake Provider',
    source: 'api',
    env: [],
    options: {},
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
    source: 'api',
    env: [],
    options: {},
    models: {
      [disconnectedModelID]: createProviderModel(disconnectedModelID, 'Disconnected Hidden Model')
    }
  },
  {
    id: oauthProviderID,
    name: 'OAuth Provider',
    source: 'api',
    env: [],
    options: {},
    models: {
      [oauthModelID]: createProviderModel(oauthModelID, 'OAuth Fixture Model')
    }
  },
  {
    id: environmentProviderID,
    name: 'Environment Provider',
    source: 'env',
    env: ['ENVIRONMENT_PROVIDER_API_KEY'],
    options: {},
    models: {
      [environmentModelID]: createProviderModel(environmentModelID, 'Environment Fixture Model')
    }
  },
  {
    id: singletonPromptProviderID,
    name: 'Singleton Prompt Provider',
    source: 'api',
    env: [],
    options: {},
    models: {}
  },
  {
    id: singletonOAuthProviderID,
    name: 'Singleton OAuth Provider',
    source: 'api',
    env: [],
    options: {},
    models: {}
  },
  {
    id: openCodeGoProviderID,
    name: 'OpenCode Go',
    source: 'api',
    env: ['OPENCODE_GO_API_KEY'],
    options: {},
    models: {
      [openCodeGoModelID]: createProviderModel(openCodeGoModelID, 'OpenCode Go Fixture Model')
    }
  },
  {
    id: emptyMethodsProviderID,
    name: 'Empty Methods Provider',
    source: 'api',
    env: [],
    options: {},
    models: {
      [emptyMethodsModelID]: createProviderModel(emptyMethodsModelID, 'Empty Methods Fixture Model')
    }
  }
]
const providerAuthMethods = {
  [connectedProviderID]: [{ type: 'api', label: 'API key' }],
  [disconnectedProviderID]: [
    {
      type: 'api',
      label: 'API key',
      prompts: [
        {
          type: 'text',
          key: 'workspace',
          message: 'Workspace label',
          placeholder: 'Production workspace'
        },
        {
          type: 'select',
          key: 'region',
          message: 'Region',
          options: [
            { label: 'US', value: 'us', hint: 'United States' },
            { label: 'EU', value: 'eu', hint: 'Europe' }
          ]
        }
      ]
    }
  ],
  [oauthProviderID]: [
    { type: 'oauth', label: 'OAuth code' },
    { type: 'oauth', label: 'OAuth auto' }
  ],
  [singletonPromptProviderID]: [
    {
      type: 'api',
      label: 'Singleton API key',
      prompts: [
        {
          type: 'text',
          key: 'tenant',
          message: 'Tenant name',
          placeholder: 'Example tenant'
        }
      ]
    }
  ],
  [singletonOAuthProviderID]: [{ type: 'oauth', label: 'Singleton OAuth auto' }],
  [emptyMethodsProviderID]: []
}
const connectedProviderIDs = new Set<string>()
const pendingOAuth = new Map<string, { method: 'auto' | 'code'; methodIndex: number }>()
const providerAuthRequests: FakeProviderAuthRequest[] = []
const providerManagementRequests: FakeProviderManagementRequest[] = []
const oauthRequests: FakeOAuthRequest[] = []
let providerAuthMode: FakeProviderAuthMode = 'normal'
let providerConnectMode: FakeProviderConnectMode = 'normal'
let didFailProviderConnect = false
const oauthAuthorizeGates = new Map<string, DeferredGate>()
let promptGate: DeferredGate | null = null
let revertGate: DeferredGate | null = null
let abortGate: DeferredGate | null = null
let abortFalseOnce = false
const globalEventSubscribers = new Set<ServerResponse>()
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
  revert?: { messageID: string; partID?: string }
  directory: string
  time: { created: number; updated: number }
  location: { directory: string }
}

type DeferredGate = {
  arrive: Deferred<void>
  release: Deferred<void>
  settled: Deferred<void>
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void }

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function getOAuthAuthorizeGate(providerID: string): DeferredGate {
  let gate = oauthAuthorizeGates.get(providerID)
  if (!gate) {
    gate = {
      arrive: createDeferred<void>(),
      release: createDeferred<void>(),
      settled: createDeferred<void>()
    }
    oauthAuthorizeGates.set(providerID, gate)
  }
  return gate
}

export async function startFakeOpenCodeServer(): Promise<FakeOpenCodeServer> {
  resetState()
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'OPTIONS') return preflight(response)
    const body =
      request.method === 'POST' || request.method === 'PUT' ? await readJson(request) : null

    if (request.method === 'GET' && url.pathname === '/global/health') {
      return json(response, { healthy: true, version: 'fake-stable' })
    }
    if (request.method === 'GET' && url.pathname === '/global/event') {
      response.writeHead(
        200,
        corsHeaders({
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive'
        })
      )
      response.write(': connected\n\n')
      globalEventSubscribers.add(response)
      request.on('close', () => globalEventSubscribers.delete(response))
      return
    }
    if (request.method === 'GET' && url.pathname === '/project') {
      return json(response, [project, rootProject])
    }
    if (request.method === 'GET' && url.pathname === '/project/current') {
      return json(response, projectForDirectory(url.searchParams.get('directory') ?? directory))
    }
    if (request.method === 'GET' && url.pathname === '/provider') {
      providerManagementRequests.push({
        endpoint: 'list',
        directory: url.searchParams.get('directory')
      })
      return json(response, currentProviders())
    }
    if (request.method === 'GET' && url.pathname === '/provider/auth') {
      providerManagementRequests.push({
        endpoint: 'auth',
        directory: url.searchParams.get('directory')
      })
      if (providerAuthMode === 'error') {
        return json(response, { message: 'Fixture provider auth is unavailable.' }, 500)
      }
      if (providerAuthMode === 'empty') return json(response, {})
      return json(response, providerAuthMethods)
    }
    const authorizeMatch = url.pathname.match(/^\/provider\/([^/]+)\/oauth\/authorize$/)
    if (request.method === 'POST' && authorizeMatch) {
      const providerID = authorizeMatch[1]
      const methodIndex = typeof body?.method === 'number' ? body.method : 0
      const method =
        providerAuthMethods[providerID as keyof typeof providerAuthMethods]?.[methodIndex]
      if (!method || method.type !== 'oauth') {
        return json(response, { message: 'OAuth method not found.' }, 400)
      }
      oauthRequests.push({ providerID, type: 'authorize' })
      const authorizationMethod =
        methodIndex === 1 || providerID === singletonOAuthProviderID ? 'auto' : 'code'
      pendingOAuth.set(providerID, { method: authorizationMethod, methodIndex })
      const gate = oauthAuthorizeGates.get(providerID)
      if (gate) {
        gate.arrive.resolve()
        await gate.release.promise
      }
      json(response, {
        url: `https://auth.example.test/${providerID}?method=${methodIndex}`,
        method: authorizationMethod,
        instructions:
          authorizationMethod === 'auto'
            ? 'Confirm this OAuth code: OAUTH-AUTO-CODE'
            : 'Open the OAuth fixture and paste the returned code.'
      })
      gate?.settled.resolve()
      return
    }
    const callbackMatch = url.pathname.match(/^\/provider\/([^/]+)\/oauth\/callback$/)
    if (request.method === 'POST' && callbackMatch) {
      const providerID = callbackMatch[1]
      oauthRequests.push({ providerID, type: 'callback' })
      const pending = pendingOAuth.get(providerID)
      if (!pending) return json(response, { message: 'OAuth authorization was not started.' }, 400)
      if (pending.method === 'code' && typeof body?.code !== 'string') {
        return json(response, { message: 'OAuth code is required.' }, 400)
      }
      pendingOAuth.delete(providerID)
      connectedProviderIDs.add(providerID)
      return json(response, true)
    }
    const authMatch = url.pathname.match(/^\/auth\/([^/]+)$/)
    if (request.method === 'PUT' && authMatch) {
      const providerID = authMatch[1]
      if (!providerCatalog.some((provider) => provider.id === providerID)) {
        return json(response, { message: 'Provider not found.' }, 404)
      }
      if (body?.type !== 'api' || typeof body?.key !== 'string' || body.key.length === 0) {
        return json(response, { message: 'API key auth is required.' }, 400)
      }
      providerAuthRequests.push({
        providerID,
        key: body.key,
        metadata: isStringRecord(body.metadata) ? body.metadata : null
      })
      if (providerConnectMode === 'fail-once' && !didFailProviderConnect) {
        didFailProviderConnect = true
        return json(response, { message: 'Fixture provider connection failed.' }, 400)
      }
      connectedProviderIDs.add(providerID)
      return json(response, true)
    }
    if (request.method === 'DELETE' && authMatch) {
      if (authMatch[1] === environmentProviderID) {
        return json(
          response,
          { message: 'Environment provider credentials are managed externally.' },
          400
        )
      }
      connectedProviderIDs.delete(authMatch[1])
      pendingOAuth.delete(authMatch[1])
      return json(response, true)
    }
    if (request.method === 'POST' && url.pathname === '/global/dispose') {
      return json(response, true)
    }
    if (request.method === 'GET' && url.pathname === '/api/agent') {
      return json(response, { location: { directory }, data: agents })
    }
    if (request.method === 'GET' && url.pathname === '/session') {
      return json(response, [...sessions.values()])
    }
    if (request.method === 'GET' && url.pathname === '/session/status') {
      for (const pending of pendingPrompts.values()) {
        for (const prompt of pending) prompt.statusFetches += 1
      }
      for (const [sessionID, pending] of pendingPrompts) {
        if (pending.every((prompt) => prompt.projected && prompt.statusFetches >= 4)) {
          pendingPrompts.delete(sessionID)
          sessionStatuses.delete(sessionID)
        }
      }
      return json(response, Object.fromEntries(sessionStatuses))
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
      cleanupSessionRevert(sessionID)
      requestEvents.push(`prompt:${sessionID}`)
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
        { id, text, fetches: 0, projected: false, statusFetches: 0 }
      ])
      sessionStatuses.set(sessionID, { type: 'busy' })
      await waitForGateOnce('prompt')
      return json(response, {})
    }
    const abortMatch = url.pathname.match(/^\/session\/([^/]+)\/abort$/)
    if (request.method === 'POST' && abortMatch) {
      const sessionID = abortMatch[1]
      const session = sessions.get(sessionID)
      if (!session) {
        return json(response, { _tag: 'SessionNotFoundError', message: 'Session not found.' }, 404)
      }

      requestEvents.push(`abort:${sessionID}`)
      abortRequests.push({ sessionID })
      if (abortFalseOnce) {
        abortFalseOnce = false
        return json(response, false)
      }
      await waitForGateOnce('abort')
      pendingPrompts.delete(sessionID)
      sessionStatuses.delete(sessionID)
      session.time.updated = Date.now()
      return json(response, true)
    }
    const revertMatch = url.pathname.match(/^\/session\/([^/]+)\/revert$/)
    if (request.method === 'POST' && revertMatch) {
      const sessionID = revertMatch[1]
      const session = sessions.get(sessionID)
      if (!session) {
        return json(response, { _tag: 'SessionNotFoundError', message: 'Session not found.' }, 404)
      }
      if (typeof body?.messageID !== 'string' || body.messageID.length === 0) {
        return json(response, { message: 'messageID is required' }, 400)
      }

      requestEvents.push(`revert:${sessionID}`)
      await waitForGateOnce('revert')
      setSessionRevertMarker(session, body.messageID, body?.partID)
      session.time.updated = Date.now()
      return json(response, session)
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
    getRequestEvents: () => [...requestEvents],
    getAbortRequests: () => [...abortRequests],
    armPromptGate: () => {
      promptGate = createGate()
    },
    waitForPrompt: () => getRequiredGate(promptGate, 'prompt').arrive.promise,
    releasePrompt: () => getRequiredGate(promptGate, 'prompt').release.resolve(),
    armRevertGate: () => {
      revertGate = createGate()
    },
    waitForRevert: () => getRequiredGate(revertGate, 'revert').arrive.promise,
    releaseRevert: () => getRequiredGate(revertGate, 'revert').release.resolve(),
    armAbortGate: () => {
      abortGate = createGate()
    },
    waitForAbort: () => getRequiredGate(abortGate, 'abort').arrive.promise,
    releaseAbort: () => getRequiredGate(abortGate, 'abort').release.resolve(),
    setAbortFalseOnce: () => {
      abortFalseOnce = true
    },
    emitSessionError: ({ sessionID, directory: eventDirectory = directory, name, message }) => {
      emitGlobalEvent({
        directory: eventDirectory,
        payload: { type: 'session.error', properties: { sessionID, error: { name, message } } }
      })
    },
    setSessionRetry: ({ sessionID, message, attempt, next }) => {
      sessionStatuses.set(sessionID, { type: 'retry', message, attempt, next })
      emitGlobalEvent({ directory, payload: { type: 'session.status', properties: { sessionID } } })
    },
    clearSessionStatus: (sessionID) => {
      sessionStatuses.delete(sessionID)
      emitGlobalEvent({ directory, payload: { type: 'session.status', properties: { sessionID } } })
    },
    getProviderManagementRequests: () =>
      providerManagementRequests.map((request) => ({ ...request })),
    getProviderAuthRequests: () => providerAuthRequests.map((request) => ({ ...request })),
    getOAuthRequests: () => oauthRequests.map((request) => ({ ...request })),
    armOAuthAuthorizeGate: (providerID) => {
      getOAuthAuthorizeGate(providerID)
    },
    waitForOAuthAuthorize: (providerID) => getOAuthAuthorizeGate(providerID).arrive.promise,
    releaseOAuthAuthorize: (providerID) => getOAuthAuthorizeGate(providerID).release.resolve(),
    waitForOAuthAuthorizeSettlement: (providerID) =>
      getOAuthAuthorizeGate(providerID).settled.promise,
    getConnectedProviders: () => [...connectedProviderIDs],
    setConnectedProviders: (providerIDs) => {
      connectedProviderIDs.clear()
      for (const providerID of providerIDs) {
        if (providerCatalog.some((provider) => provider.id === providerID)) {
          connectedProviderIDs.add(providerID)
        }
      }
    },
    setProviderAuthMode: (mode) => {
      providerAuthMode = mode
    },
    setProviderConnectMode: (mode) => {
      providerConnectMode = mode
      didFailProviderConnect = false
    },
    close: async () => {
      releaseOAuthAuthorizeGates()
      releaseMutationGates()
      for (const subscriber of globalEventSubscribers) subscriber.end()
      globalEventSubscribers.clear()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

function setSessionRevertMarker(session: FakeSession, messageID: string, partID: unknown): void {
  session.revert = {
    messageID,
    ...(typeof partID === 'string' && partID.length > 0 ? { partID } : {})
  }
}

function cleanupSessionRevert(sessionID: string): void {
  const session = sessions.get(sessionID)
  if (!session?.revert) return
  const revertMessageID = session.revert.messageID

  const existing = messages.get(sessionID) ?? []
  messages.set(
    sessionID,
    existing.filter((message) => {
      const messageID = getMessageID(message)
      return messageID ? messageID.localeCompare(revertMessageID) < 0 : true
    })
  )

  const pending = pendingPrompts.get(sessionID) ?? []
  const remaining = pending.filter((prompt) => prompt.id.localeCompare(revertMessageID) < 0)
  if (remaining.length) pendingPrompts.set(sessionID, remaining)
  else pendingPrompts.delete(sessionID)

  delete session.revert
  session.time.updated = Date.now()
}

function projectForDirectory(projectDirectory: string): typeof project {
  if (projectDirectory === directory) return project

  return {
    ...project,
    id: 'global',
    name: 'Global',
    worktree: projectDirectory
  }
}

function currentProviders(): {
  all: typeof providerCatalog
  connected: string[]
  default: Record<string, string>
} {
  return {
    all: providerCatalog,
    connected: [...connectedProviderIDs],
    default: currentProviderDefaults()
  }
}

function currentProviderDefaults(): Record<string, string> {
  const defaults: Record<string, string> = {}
  if (connectedProviderIDs.has(connectedProviderID))
    defaults[connectedProviderID] = connectedModelID
  if (connectedProviderIDs.has(disconnectedProviderID))
    defaults[disconnectedProviderID] = disconnectedModelID
  if (connectedProviderIDs.has(oauthProviderID)) defaults[oauthProviderID] = oauthModelID
  if (connectedProviderIDs.has(environmentProviderID)) {
    defaults[environmentProviderID] = environmentModelID
  }
  return defaults
}

function resetState(): void {
  sessions.clear()
  messages.clear()
  pendingPrompts.clear()
  sessionStatuses.clear()
  pendingOAuth.clear()
  connectedProviderIDs.clear()
  connectedProviderIDs.add(connectedProviderID)
  connectedProviderIDs.add(environmentProviderID)
  providerAuthRequests.length = 0
  providerManagementRequests.length = 0
  oauthRequests.length = 0
  releaseOAuthAuthorizeGates()
  releaseMutationGates()
  abortFalseOnce = false
  providerAuthMode = 'normal'
  providerConnectMode = 'normal'
  didFailProviderConnect = false
  promptRequests.length = 0
  requestEvents.length = 0
  abortRequests.length = 0
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

function releaseOAuthAuthorizeGates(): void {
  for (const gate of oauthAuthorizeGates.values()) {
    gate.release.resolve()
    gate.settled.resolve()
  }
  oauthAuthorizeGates.clear()
}

function createGate(): DeferredGate {
  return {
    arrive: createDeferred<void>(),
    release: createDeferred<void>(),
    settled: createDeferred<void>()
  }
}

function getRequiredGate(gate: DeferredGate | null, name: string): DeferredGate {
  if (!gate) throw new Error(`No ${name} gate is armed.`)
  return gate
}

async function waitForGateOnce(name: 'prompt' | 'revert' | 'abort'): Promise<void> {
  const gate = name === 'prompt' ? promptGate : name === 'revert' ? revertGate : abortGate
  if (!gate) return
  gate.arrive.resolve()
  await gate.release.promise
  gate.settled.resolve()
  if (name === 'prompt') promptGate = null
  else if (name === 'revert') revertGate = null
  else abortGate = null
}

function releaseMutationGates(): void {
  for (const gate of [promptGate, revertGate, abortGate]) {
    gate?.release.resolve()
    gate?.settled.resolve()
  }
  promptGate = null
  revertGate = null
  abortGate = null
}

function emitGlobalEvent(event: unknown): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`
  for (const subscriber of globalEventSubscribers) subscriber.write(payload)
}

function projectPendingMessages(sessionID: string): void {
  const pending = pendingPrompts.get(sessionID) ?? []
  if (pending.length === 0) return
  for (const prompt of pending) prompt.fetches += 1
  const ready = pending.filter((prompt) => prompt.fetches >= 5 && !prompt.projected)
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
  for (const prompt of ready) prompt.projected = true
  pendingPrompts.set(sessionID, pending)
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
        id: `${id}-empty-reasoning`,
        type: 'reasoning'
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

function getMessageID(message: unknown): string | null {
  if (!isRecord(message)) return null
  const info = isRecord(message.info) ? message.info : null
  return getString(info, 'id') ?? getString(message, 'id')
}

function getString(value: Record<string, unknown> | null, property: string): string | null {
  if (!value) return null
  const propertyValue = value[property]
  return typeof propertyValue === 'string' && propertyValue.length > 0 ? propertyValue : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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
  if (!connectedProviderIDs.has(model.providerID)) return false
  const provider = providerCatalog.find((provider) => provider.id === model.providerID)
  return Boolean(provider && model.modelID in provider.models)
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
  const provider = providerCatalog.find((provider) => provider.id === model.providerID)
  const providerModel = provider?.models[model.modelID] as
    | { variants?: Record<string, unknown> }
    | undefined
  return Boolean(providerModel.variants && variant in providerModel.variants)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  )
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
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS'
  }
}
