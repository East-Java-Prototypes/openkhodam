export const protocolVersion = '1' as const

export interface ConnectionInfo {
  baseUrl: string
  token: string
}

export interface HealthResponse {
  status: 'ok'
}

export interface CapabilitiesResponse {
  protocolVersion: typeof protocolVersion
  capabilities: string[]
}

export interface VersionResponse {
  version: string
}

export type ErrorCode = 'unauthorized' | 'not_found' | 'validation_error' | 'internal_error'

export interface ApiError {
  error: {
    code: ErrorCode
    message: string
  }
}

export class ProtocolValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProtocolValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function expectRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ProtocolValidationError(`${name} must be an object`)
  return value
}

function expectString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new ProtocolValidationError(`${name} must be a string`)
  return value
}

export function parseHealthResponse(value: unknown): HealthResponse {
  const record = expectRecord(value, 'health response')
  if (record.status !== 'ok') throw new ProtocolValidationError('health response status must be ok')
  return { status: 'ok' }
}

export function parseVersionResponse(value: unknown): VersionResponse {
  const record = expectRecord(value, 'version response')
  return { version: expectString(record.version, 'version') }
}

export function parseCapabilitiesResponse(value: unknown): CapabilitiesResponse {
  const record = expectRecord(value, 'capabilities response')
  if (record.protocolVersion !== protocolVersion) {
    throw new ProtocolValidationError(`protocolVersion must be ${protocolVersion}`)
  }
  if (
    !Array.isArray(record.capabilities) ||
    !record.capabilities.every((item) => typeof item === 'string')
  ) {
    throw new ProtocolValidationError('capabilities must be an array of strings')
  }
  return { protocolVersion, capabilities: record.capabilities }
}

export function parseApiError(value: unknown): ApiError {
  const record = expectRecord(value, 'error response')
  const error = expectRecord(record.error, 'error')
  const codes: ErrorCode[] = ['unauthorized', 'not_found', 'validation_error', 'internal_error']
  if (!codes.includes(error.code as ErrorCode)) {
    throw new ProtocolValidationError('error.code is not recognized')
  }
  return {
    error: {
      code: error.code as ErrorCode,
      message: expectString(error.message, 'error.message')
    }
  }
}
