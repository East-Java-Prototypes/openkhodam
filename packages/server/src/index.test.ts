import { afterEach, describe, expect, it } from 'vitest'
import { createOpenKhodamApp, startOpenKhodamServer, type OpenKhodamListener } from './index.js'

const options = { token: 'test-token', version: '0.1.0' }

describe('OpenKhodam Hono app', () => {
  it('rejects requests without the shared token', async () => {
    const response = await createOpenKhodamApp(options).request('http://localhost/health')
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'unauthorized', message: 'Unauthorized' }
    })
  })

  it('exposes authenticated health, version, and capabilities', async () => {
    const app = createOpenKhodamApp({ ...options, capabilities: ['health'] })
    const headers = { authorization: 'Bearer test-token' }
    await expect(
      (await app.request('http://localhost/health', { headers })).json()
    ).resolves.toEqual({ status: 'ok' })
    await expect(
      (await app.request('http://localhost/version', { headers })).json()
    ).resolves.toEqual({ version: '0.1.0' })
    await expect(
      (await app.request('http://localhost/capabilities', { headers })).json()
    ).resolves.toEqual({
      protocolVersion: '1',
      capabilities: ['health']
    })
  })
})

describe('OpenKhodam listener', () => {
  let listener: OpenKhodamListener | undefined

  afterEach(async () => listener?.close())

  it('binds loopback, serves requests, and shuts down', async () => {
    listener = await startOpenKhodamServer(options)
    const response = await fetch(`http://127.0.0.1:${listener.port}/health`, {
      headers: { authorization: 'Bearer test-token' }
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok' })
    await listener.close()
    listener = undefined
    await expect(
      fetch(`http://127.0.0.1:${response.url.split(':')[2].split('/')[0]}/health`)
    ).rejects.toThrow()
  })
})
