import { describe, expect, it, vi } from 'vitest'
import {
  createOpenKhodamClient,
  getOpenKhodamPluginConnection,
  OpenKhodamClientError
} from './index.js'

describe('getOpenKhodamPluginConnection', () => {
  it('returns only a validated plugin connection', () => {
    expect(
      getOpenKhodamPluginConnection({
        OPENKHODAM_PLUGIN_URL: 'http://127.0.0.1:4567/',
        OPENKHODAM_PLUGIN_TOKEN: 'plugin-token'
      })
    ).toEqual({ baseUrl: 'http://127.0.0.1:4567', token: 'plugin-token' })
  })

  it('rejects malformed, credential-bearing, and incomplete bootstrap values', () => {
    for (const env of [
      {},
      { OPENKHODAM_PLUGIN_URL: 'not-a-url', OPENKHODAM_PLUGIN_TOKEN: 'plugin-token' },
      {
        OPENKHODAM_PLUGIN_URL: 'http://user:pass@127.0.0.1',
        OPENKHODAM_PLUGIN_TOKEN: 'plugin-token'
      },
      { OPENKHODAM_PLUGIN_URL: 'http://127.0.0.1', OPENKHODAM_PLUGIN_TOKEN: ' plugin-token ' }
    ]) {
      expect(getOpenKhodamPluginConnection(env)).toBeUndefined()
    }
  })
})

describe('createOpenKhodamClient', () => {
  it('sends authenticated headers and validates responses', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ status: 'ok' }))
    const client = createOpenKhodamClient({
      baseUrl: 'http://127.0.0.1:3333',
      token: 'secret',
      fetch
    })

    await expect(client.health()).resolves.toEqual({ status: 'ok' })
    expect(fetch).toHaveBeenCalledWith(expect.any(URL), {
      headers: { authorization: 'Bearer secret', accept: 'application/json' },
      signal: undefined
    })
  })

  it('normalizes malformed and API error responses', async () => {
    const malformed = createOpenKhodamClient({
      baseUrl: 'http://127.0.0.1',
      token: 'secret',
      fetch: vi.fn().mockResolvedValue(Response.json({ status: 'bad' }))
    })
    await expect(malformed.health()).rejects.toMatchObject({ code: 'invalid_response' })

    const rejected = createOpenKhodamClient({
      baseUrl: 'http://127.0.0.1',
      token: 'secret',
      fetch: vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: 'unauthorized', message: 'Invalid token' } },
            { status: 401 }
          )
        )
    })
    await expect(rejected.health()).rejects.toEqual(
      new OpenKhodamClientError('Invalid token', 'unauthorized', 401)
    )
  })

  it('forwards cancellation', async () => {
    const controller = new AbortController()
    const fetch = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'))
    const client = createOpenKhodamClient({ baseUrl: 'http://127.0.0.1', token: 'secret', fetch })
    controller.abort()
    await expect(client.health({ signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal)
  })

  it('preserves cancellation while consuming a response body after headers', async () => {
    const controller = new AbortController()
    let cancelBody!: () => void
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        cancelBody = () => controller.error(new DOMException('Aborted', 'AbortError'))
      }
    })
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(body, { headers: { 'content-type': 'application/json' } }))
    const client = createOpenKhodamClient({ baseUrl: 'http://127.0.0.1', token: 'secret', fetch })

    const health = client.health({ signal: controller.signal })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    controller.abort()
    cancelBody()

    await expect(health).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('sends artifact requests and normalizes artifact response validation errors', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ version: 1, sessions: {} }))
      .mockResolvedValueOnce(Response.json({ id: 'missing-fields' }))
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: 'validation_error', message: 'Invalid artifact' } },
          { status: 400 }
        )
      )
    const client = createOpenKhodamClient({ baseUrl: 'http://127.0.0.1', token: 'secret', fetch })
    await expect(client.listProjectArtifacts({ projectDirectory: '/project' })).resolves.toEqual({
      version: 1,
      sessions: {}
    })
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: '{"projectDirectory":"/project"}'
    })
    await expect(
      client.recordLinkedGoogleArtifact({
        projectDirectory: '/project',
        sessionId: 'session',
        artifact: { id: 'doc' }
      })
    ).rejects.toMatchObject({ code: 'invalid_response', status: 200 })
    await expect(
      client.snapshotGoogleDocDocument({
        projectDirectory: '/project',
        sessionId: 'session',
        document: {
          type: 'google.doc.document',
          id: 'doc',
          title: null,
          revision: null,
          text: '',
          link: null,
          body: { blocks: [] }
        }
      })
    ).rejects.toEqual(new OpenKhodamClientError('Invalid artifact', 'validation_error', 400))
  })
})
