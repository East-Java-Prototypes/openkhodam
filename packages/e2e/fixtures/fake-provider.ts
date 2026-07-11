import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

export const fakeProviderID = 'openkhodam-smoke-provider'
export const fakeProviderModelID = 'openkhodam-smoke-model'
export const fakeProviderName = 'Local Smoke Provider'
export const fakeProviderModelName = 'Smoke Test Model'
export const fakeAssistantResponse = 'Smoke test ready from the local fake provider.'

export type FakeProviderServer = {
  url: string
  getChatCompletionRequests: () => FakeChatCompletionRequest[]
  close: () => Promise<void>
}

export type FakeChatCompletionRequest = {
  body: unknown
  promptText: string
  stream: boolean
}

type FakeProviderOptions = {
  assistantResponse?: string
  modelID?: string
}

export async function startFakeProvider(
  options: FakeProviderOptions = {}
): Promise<FakeProviderServer> {
  const modelID = options.modelID ?? fakeProviderModelID
  const assistantResponse = options.assistantResponse ?? fakeAssistantResponse
  const chatCompletionRequests: FakeChatCompletionRequest[] = []

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'OPTIONS') return preflight(response)

    if (request.method === 'GET' && (url.pathname === '/models' || url.pathname === '/v1/models')) {
      return json(response, {
        object: 'list',
        data: [
          {
            id: modelID,
            object: 'model',
            created: 0,
            owned_by: 'openkhodam-e2e'
          }
        ]
      })
    }

    if (
      request.method === 'POST' &&
      (url.pathname === '/chat/completions' || url.pathname === '/v1/chat/completions')
    ) {
      const body = await readJson(request)
      const stream = isRecord(body) && body.stream === true
      chatCompletionRequests.push({ body, promptText: extractPromptText(body), stream })
      if (stream) return streamChatCompletion(response, modelID, assistantResponse)
      return json(response, createChatCompletion(modelID, assistantResponse))
    }

    return json(response, { error: { message: 'Not found' } }, 404)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (typeof address !== 'object' || !address) throw new Error('Fake provider did not start.')

  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    getChatCompletionRequests: () => [...chatCompletionRequests],
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : null
}

function streamChatCompletion(response: ServerResponse, modelID: string, text: string): void {
  response.writeHead(
    200,
    corsHeaders({
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'content-type': 'text/event-stream',
      'x-accel-buffering': 'no'
    })
  )

  writeSse(response, {
    id: 'chatcmpl-openkhodam-smoke',
    object: 'chat.completion.chunk',
    created: createdSeconds(),
    model: modelID,
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]
  })
  writeSse(response, {
    id: 'chatcmpl-openkhodam-smoke',
    object: 'chat.completion.chunk',
    created: createdSeconds(),
    model: modelID,
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }]
  })
  writeSse(response, {
    id: 'chatcmpl-openkhodam-smoke',
    object: 'chat.completion.chunk',
    created: createdSeconds(),
    model: modelID,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 4, completion_tokens: 8, total_tokens: 12 }
  })
  response.write('data: [DONE]\n\n')
  response.end()
}

function createChatCompletion(modelID: string, text: string): unknown {
  return {
    id: 'chatcmpl-openkhodam-smoke',
    object: 'chat.completion',
    created: createdSeconds(),
    model: modelID,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: 'stop'
      }
    ],
    usage: { prompt_tokens: 4, completion_tokens: 8, total_tokens: 12 }
  }
}

function writeSse(response: ServerResponse, value: unknown): void {
  response.write(`data: ${JSON.stringify(value)}\n\n`)
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
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-origin': '*'
  }
}

function createdSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function extractPromptText(body: unknown): string {
  if (!isRecord(body) || !Array.isArray(body.messages)) return ''
  return body.messages.map(extractMessageText).filter(Boolean).join('\n')
}

function extractMessageText(message: unknown): string {
  if (!isRecord(message)) return ''
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(extractContentPartText).filter(Boolean).join('\n')
}

function extractContentPartText(part: unknown): string {
  if (!isRecord(part)) return ''
  if (typeof part.text === 'string') return part.text
  if (typeof part.content === 'string') return part.content
  return ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
