import { describe, expect, it, vi } from 'vitest'
import { createOpenKhodamClient, OpenKhodamClientError } from './index.js'

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
})
