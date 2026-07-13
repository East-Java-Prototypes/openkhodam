import { afterEach, describe, expect, it } from 'vitest'
import { createOpenKhodamApp, startOpenKhodamServer, type OpenKhodamListener } from './index.js'

const options = { tokens: ['renderer-token', 'plugin-token'], version: '0.1.0' }

describe('OpenKhodam Hono app', () => {
  it('rejects requests without an accepted token', async () => {
    const response = await createOpenKhodamApp(options).request('http://localhost/health')
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'unauthorized', message: 'Unauthorized' }
    })
  })

  it('accepts each configured token and rejects unknown tokens', async () => {
    const app = createOpenKhodamApp(options)
    await expect(
      app.request('http://localhost/health', {
        headers: { authorization: 'Bearer renderer-token' }
      })
    ).resolves.toMatchObject({ status: 200 })
    await expect(
      app.request('http://localhost/health', { headers: { authorization: 'Bearer plugin-token' } })
    ).resolves.toMatchObject({ status: 200 })
    await expect(
      app.request('http://localhost/health', { headers: { authorization: 'Bearer unknown' } })
    ).resolves.toMatchObject({ status: 401 })
  })

  it('permits only configured renderer origins while preserving bearer authentication', async () => {
    const app = createOpenKhodamApp({
      ...options,
      corsOrigins: ['file://', 'http://127.0.0.1:5173']
    })
    const packaged = await app.request('http://localhost/health', {
      headers: { authorization: 'Bearer renderer-token', origin: 'file://' }
    })
    expect(packaged.headers.get('access-control-allow-origin')).toBe('file://')
    expect(packaged.status).toBe(200)
    const devPreflight = await app.request('http://localhost/health', {
      method: 'OPTIONS',
      headers: { origin: 'http://127.0.0.1:5173' }
    })
    expect(devPreflight.status).toBe(204)
    expect(devPreflight.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173')
    const foreign = await app.request('http://localhost/health', {
      headers: { authorization: 'Bearer renderer-token', origin: 'https://evil.example' }
    })
    expect(foreign.status).toBe(200)
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull()
    await expect(
      app.request('http://localhost/health', { headers: { origin: 'file://' } })
    ).resolves.toMatchObject({ status: 401 })
  })

  it('exposes authenticated health, version, and capabilities', async () => {
    const app = createOpenKhodamApp({ ...options, capabilities: ['health'] })
    const headers = { authorization: 'Bearer renderer-token' }
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
      headers: { authorization: 'Bearer plugin-token' }
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
