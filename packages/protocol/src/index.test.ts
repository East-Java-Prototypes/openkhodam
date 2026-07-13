import { describe, expect, it } from 'vitest'
import {
  ProtocolValidationError,
  parseApiError,
  parseCapabilitiesResponse,
  parseHealthResponse,
  parseSnapshotGoogleDocDocumentInput,
  parseSnapshotGoogleSheetSpreadsheetInput,
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

  it('rejects malformed nested Google Doc and Sheet snapshots', () => {
    expect(() =>
      parseSnapshotGoogleDocDocumentInput({
        projectDirectory: '/tmp',
        sessionId: 's',
        document: {
          type: 'google.doc.document',
          id: 'd',
          title: null,
          revision: null,
          text: '',
          link: null,
          body: { blocks: [{ id: 'x', ordinal: 0, type: 'table', text: '' }] }
        }
      })
    ).toThrow(ProtocolValidationError)
    expect(() =>
      parseSnapshotGoogleSheetSpreadsheetInput({
        projectDirectory: '/tmp',
        sessionId: 's',
        spreadsheet: {
          type: 'google.sheet.spreadsheet',
          id: 's',
          title: null,
          link: null,
          sheets: [
            {
              id: null,
              title: 'A',
              index: null,
              hidden: false,
              sheetType: null,
              rowCount: null,
              columnCount: null
            }
          ],
          ranges: [
            {
              range: 'A1',
              majorDimension: null,
              values: [[{}]],
              rowCount: 1,
              columnCount: 1,
              cellCount: 1,
              truncated: false
            }
          ]
        }
      })
    ).toThrow(ProtocolValidationError)
  })
})
