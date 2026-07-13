import { describe, expect, it } from 'vitest'
import {
  ProtocolValidationError,
  parseApiError,
  parseCapabilitiesResponse,
  parseHealthResponse,
  parseVersionResponse
} from './index.js'

describe('protocol validators', () => {
  it('parses the initial endpoint responses', () => {
    expect(parseHealthResponse({ status: 'ok' })).toEqual({ status: 'ok' })
    expect(parseVersionResponse({ version: '0.1.0' })).toEqual({ version: '0.1.0' })
    expect(parseCapabilitiesResponse({ protocolVersion: '1', capabilities: ['health'] })).toEqual({
      protocolVersion: '1',
      capabilities: ['health']
    })
  })

  it('rejects malformed payloads and parses stable errors', () => {
    expect(() => parseHealthResponse({ status: 'bad' })).toThrow(ProtocolValidationError)
    expect(() => parseCapabilitiesResponse({ protocolVersion: '2', capabilities: [] })).toThrow(
      ProtocolValidationError
    )
    expect(parseApiError({ error: { code: 'unauthorized', message: 'Missing token' } })).toEqual({
      error: { code: 'unauthorized', message: 'Missing token' }
    })
  })
})
