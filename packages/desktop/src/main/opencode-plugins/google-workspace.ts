import type {
  GoogleDocDocumentArtifact,
  GoogleSheetSpreadsheetArtifact
} from '../integrations/google-workspace-runtime'
import {
  createGoogleDocDocumentPreview,
  createGoogleSheetSpreadsheetPreview,
  editGoogleDocDocument,
  type GoogleDocsEditOperation,
  type GoogleDocsTextOccurrence,
  type GoogleSheetsValueRenderOption,
  readGoogleDocDocument,
  readGoogleSheetSpreadsheet,
  searchGoogleDriveFiles
} from '../integrations/google-workspace-runtime'
import {
  deleteGoogleDocDocumentArtifact,
  getOrCreateLinkedGoogleDoc,
  persistGoogleDocDocumentArtifact,
  persistGoogleSheetSpreadsheetArtifact
} from '../integrations/project-artifacts'

type GoogleDriveSearchFilesToolArgs = {
  limit?: number
  query?: string
}

type GoogleDocsReadToolArgs = {
  documentId?: string
}

type GoogleSheetsReadToolArgs = {
  ranges?: string[]
  spreadsheetId?: string
  valueRenderOption?: string
}

type GoogleDocsEditToolArgs = {
  documentId?: string
  operation?: {
    match?: string
    occurrence?: number | string
    text?: string
    type?: string
  }
}

type GoogleWorkspaceToolContext = {
  abort?: AbortSignal
  directory?: string
  sessionID?: string
  worktree?: string
}

type GoogleWorkspaceArtifactSessionContext = {
  projectDirectory: string
  sessionId: string
}

type PersistedReadGoogleWorkspaceArtifact = GoogleWorkspaceArtifactSessionContext & {
  artifactPath: string
  created: boolean
}

type GoogleDriveSearchFilesToolDefinition = {
  args: {
    limit: {
      default: 10
      description: string
      maximum: 20
      minimum: 1
      type: 'number'
    }
    query: {
      description: string
      type: 'string'
    }
  }
  description: string
  execute: (
    args: GoogleDriveSearchFilesToolArgs,
    context: GoogleWorkspaceToolContext
  ) => Promise<string>
}

type GoogleDocsReadToolDefinition = {
  args: {
    documentId: {
      description: string
      type: 'string'
    }
  }
  description: string
  execute: (args: GoogleDocsReadToolArgs, context: GoogleWorkspaceToolContext) => Promise<string>
}

type GoogleSheetsReadToolDefinition = {
  args: {
    ranges: {
      description: string
      items: { type: 'string' }
      maxItems: 5
      type: 'array'
    }
    spreadsheetId: {
      description: string
      type: 'string'
    }
    valueRenderOption: {
      default: 'FORMATTED_VALUE'
      description: string
      enum: ['FORMATTED_VALUE', 'UNFORMATTED_VALUE', 'FORMULA']
      type: 'string'
    }
  }
  description: string
  execute: (args: GoogleSheetsReadToolArgs, context: GoogleWorkspaceToolContext) => Promise<string>
}

type GoogleDocsEditToolDefinition = {
  args: {
    documentId: {
      description: string
      type: 'string'
    }
    operation: {
      additionalProperties: boolean
      description: string
      properties: Record<string, unknown>
      required: string[]
      type: 'object'
    }
  }
  description: string
  execute: (args: GoogleDocsEditToolArgs, context: GoogleWorkspaceToolContext) => Promise<string>
}

type GoogleWorkspaceHooks = {
  tool: {
    google_docs_edit: GoogleDocsEditToolDefinition
    google_docs_read: GoogleDocsReadToolDefinition
    google_drive_search_files: GoogleDriveSearchFilesToolDefinition
    google_sheets_read: GoogleSheetsReadToolDefinition
  }
}

export const GoogleWorkspace = async (): Promise<GoogleWorkspaceHooks> => ({
  tool: {
    google_drive_search_files: {
      description:
        'Search Google Drive files by name using the Google Workspace account connected in OpenKhodam Settings. Returns file metadata only.',
      args: {
        query: {
          description:
            'File name text to search for. Leave empty to list recently modified non-trashed files.',
          type: 'string'
        },
        limit: {
          default: 10,
          description: 'Maximum number of files to return. Defaults to 10 and is capped at 20.',
          maximum: 20,
          minimum: 1,
          type: 'number'
        }
      },
      async execute(args, context) {
        const query = typeof args.query === 'string' ? args.query : ''
        const result = await searchGoogleDriveFiles({
          limit: args.limit,
          query,
          signal: context.abort
        })

        return JSON.stringify(result)
      }
    },
    google_docs_read: {
      description:
        'Read a Google Docs document using the Google Workspace account connected in OpenKhodam Settings. Returns a safe google.doc.document artifact with a bounded head preview.',
      args: {
        documentId: {
          description: 'The Google Docs document ID to read.',
          type: 'string'
        }
      },
      async execute(args, context) {
        const documentId = stringArg(args.documentId)
        const result = await readGoogleDocDocument({
          documentId,
          signal: context.abort
        })
        await recordReadGoogleDocArtifact(context, result.document)

        return JSON.stringify({
          document: createGoogleDocDocumentPreview(result.document)
        })
      }
    },
    google_sheets_read: {
      description:
        'Read a Google Sheets spreadsheet using the Google Workspace account connected in OpenKhodam Settings. Returns a safe google.sheet.spreadsheet artifact with bounded A1 range previews. Read-only; does not edit spreadsheets.',
      args: {
        spreadsheetId: {
          description: 'The Google Sheets spreadsheet ID to read.',
          type: 'string'
        },
        ranges: {
          description:
            'Optional A1 notation ranges to read. If omitted, the first visible sheets are read with bounded A1:Z200 preview ranges. At most 5 ranges are used.',
          items: { type: 'string' },
          maxItems: 5,
          type: 'array'
        },
        valueRenderOption: {
          default: 'FORMATTED_VALUE',
          description:
            'How Sheets should render cell values: FORMATTED_VALUE, UNFORMATTED_VALUE, or FORMULA. Defaults to FORMATTED_VALUE.',
          enum: ['FORMATTED_VALUE', 'UNFORMATTED_VALUE', 'FORMULA'],
          type: 'string'
        }
      },
      async execute(args, context) {
        const spreadsheetId = stringArg(args.spreadsheetId)
        const result = await readGoogleSheetSpreadsheet({
          ranges: rangesArg(args.ranges),
          signal: context.abort,
          spreadsheetId,
          valueRenderOption: valueRenderOptionArg(args.valueRenderOption)
        })
        await recordReadGoogleSheetArtifact(context, result.spreadsheet)

        return JSON.stringify({
          spreadsheet: createGoogleSheetSpreadsheetPreview(result.spreadsheet)
        })
      }
    },
    google_docs_edit: {
      description:
        'Edit a Google Docs document using semantic operations with the Google Workspace account connected in OpenKhodam Settings. Supports append_text, insert_after_text, insert_before_text, replace_text, and delete_text; writes directly with the connected account after resolving semantic targets; and returns a bounded updated-document preview.',
      args: {
        documentId: {
          description: 'The Google Docs document ID to edit.',
          type: 'string'
        },
        operation: {
          additionalProperties: false,
          description:
            'One semantic edit operation. Use append_text with text; insert_after_text or insert_before_text with match, optional occurrence (defaults to last), and text; replace_text with match, optional occurrence, and replacement text; or delete_text with match and optional occurrence. Do not provide raw Google Docs indexes.',
          properties: {
            type: {
              description:
                'Operation type: append_text, insert_after_text, insert_before_text, replace_text, or delete_text.',
              enum: [
                'append_text',
                'insert_after_text',
                'insert_before_text',
                'replace_text',
                'delete_text'
              ],
              type: 'string'
            },
            match: {
              description:
                'Text to find for insert_after_text, insert_before_text, replace_text, and delete_text.',
              type: 'string'
            },
            occurrence: {
              description:
                'Optional match occurrence for match-based edits: first, last, or a 1-based number. Defaults to last.',
              type: ['number', 'string']
            },
            text: {
              description:
                'Text to append, insert, or use as replacement text. Literal newline escapes like \\n are normalized before writing. Not required for delete_text.',
              type: 'string'
            }
          },
          required: ['type'],
          type: 'object'
        }
      },
      async execute(args, context) {
        const documentId = stringArg(args.documentId)
        const result = await editGoogleDocDocument({
          documentId,
          operation: toGoogleDocsEditOperation(args.operation),
          signal: context.abort
        })
        await recordReadGoogleDocArtifact(context, result.document)

        return JSON.stringify({
          edit: result.edit,
          document: createGoogleDocDocumentPreview(result.document)
        })
      }
    }
  }
})

function stringArg(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function rangesArg(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) return undefined
  return value.map((range) => stringArg(range))
}

function valueRenderOptionArg(value: unknown): GoogleSheetsValueRenderOption | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value === 'FORMATTED_VALUE' || value === 'UNFORMATTED_VALUE' || value === 'FORMULA') {
    return value
  }

  return value as GoogleSheetsValueRenderOption
}

function toGoogleDocsEditOperation(
  value: GoogleDocsEditToolArgs['operation']
): GoogleDocsEditOperation {
  if (!value || typeof value !== 'object') {
    throw new Error('Google Docs edit operation is required.')
  }

  if (value.type === 'append_text') {
    return {
      text: stringArg(value.text),
      type: 'append_text'
    }
  }

  if (
    value.type === 'insert_after_text' ||
    value.type === 'insert_before_text' ||
    value.type === 'replace_text'
  ) {
    return {
      match: stringArg(value.match),
      occurrence: occurrenceArg(value.occurrence),
      text: stringArg(value.text),
      type: value.type
    }
  }

  if (value.type === 'delete_text') {
    return {
      match: stringArg(value.match),
      occurrence: occurrenceArg(value.occurrence),
      type: 'delete_text'
    }
  }

  throw new Error(
    'Google Docs edit operation type must be append_text, insert_after_text, insert_before_text, replace_text, or delete_text.'
  )
}

function occurrenceArg(value: unknown): GoogleDocsTextOccurrence | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value === 'first' || value === 'last') return value
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value.trim())
  return Number.NaN
}

async function recordReadGoogleDocArtifact(
  context: GoogleWorkspaceToolContext,
  document: GoogleDocDocumentArtifact
): Promise<void> {
  const persisted = await persistReadGoogleWorkspaceArtifact({
    context,
    failureDetails: {
      docId: document.id,
      reason: 'artifact_persist_failed'
    },
    failureMessage: 'Failed to persist Google Doc artifact',
    persist: (projectDirectory) =>
      persistGoogleDocDocumentArtifact({
        document,
        projectDirectory
      })
  })
  if (!persisted) return

  try {
    await getOrCreateLinkedGoogleDoc({
      doc: {
        artifactPath: persisted.artifactPath,
        id: document.id,
        title: document.title,
        url: document.link
      },
      projectDirectory: persisted.projectDirectory,
      sessionId: persisted.sessionId
    })
  } catch {
    const artifactCleanedUp = await cleanupCreatedGoogleDocArtifact({
      artifactPath: persisted.artifactPath,
      createdArtifact: persisted.created,
      docId: document.id,
      projectDirectory: persisted.projectDirectory,
      sessionId: persisted.sessionId
    })
    console.warn('Failed to record linked Google Doc artifact', {
      artifactCleanedUp,
      docId: document.id,
      reason: 'artifact_record_failed',
      sessionId: persisted.sessionId
    })
  }
}

async function recordReadGoogleSheetArtifact(
  context: GoogleWorkspaceToolContext,
  spreadsheet: GoogleSheetSpreadsheetArtifact
): Promise<void> {
  await persistReadGoogleWorkspaceArtifact({
    context,
    failureDetails: {
      reason: 'artifact_persist_failed',
      spreadsheetId: spreadsheet.id
    },
    failureMessage: 'Failed to persist Google Sheet artifact',
    persist: (projectDirectory) =>
      persistGoogleSheetSpreadsheetArtifact({
        projectDirectory,
        spreadsheet
      })
  })
}

async function persistReadGoogleWorkspaceArtifact(input: {
  context: GoogleWorkspaceToolContext
  failureDetails: Record<string, string>
  failureMessage: string
  persist: (projectDirectory: string) => Promise<{ artifactPath: string; created: boolean }>
}): Promise<PersistedReadGoogleWorkspaceArtifact | null> {
  const artifactContext = getGoogleWorkspaceArtifactSessionContext(input.context)
  if (!artifactContext) return null

  try {
    const persisted = await input.persist(artifactContext.projectDirectory)
    return {
      ...artifactContext,
      ...persisted
    }
  } catch {
    console.warn(input.failureMessage, input.failureDetails)
    return null
  }
}

function getGoogleWorkspaceArtifactSessionContext(
  context: GoogleWorkspaceToolContext
): GoogleWorkspaceArtifactSessionContext | null {
  const projectDirectory = nonEmptyString(context.directory)
  const sessionId = nonEmptyString(context.sessionID)
  if (!projectDirectory || !sessionId) return null

  return { projectDirectory, sessionId }
}

async function cleanupCreatedGoogleDocArtifact({
  artifactPath,
  createdArtifact,
  docId,
  projectDirectory,
  sessionId
}: {
  artifactPath: string
  createdArtifact: boolean
  docId: string
  projectDirectory: string
  sessionId: string
}): Promise<boolean | null> {
  if (!createdArtifact) return null

  try {
    const result = await deleteGoogleDocDocumentArtifact({
      artifactPath,
      projectDirectory
    })
    return result.deleted
  } catch {
    console.warn('Failed to clean up Google Doc artifact after record failure', {
      docId,
      reason: 'artifact_cleanup_failed',
      sessionId
    })
    return false
  }
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
