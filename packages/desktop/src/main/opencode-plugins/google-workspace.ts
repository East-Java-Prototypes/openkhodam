import type { GoogleDocDocumentArtifact } from '../integrations/google-workspace-runtime'
import {
  createGoogleDocDocumentPreview,
  editGoogleDocDocument,
  type GoogleDocsEditApprovalOperation,
  type GoogleDocsEditOperation,
  type GoogleDocsTextOccurrence,
  readGoogleDocDocument,
  searchGoogleDriveFiles
} from '../integrations/google-workspace-runtime'
import {
  deleteGoogleDocDocumentArtifact,
  getOrCreateLinkedGoogleDoc,
  persistGoogleDocDocumentArtifact
} from '../integrations/project-artifacts'

type GoogleDriveSearchFilesToolArgs = {
  limit?: number
  query?: string
}

type GoogleDocsReadToolArgs = {
  documentId?: string
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
  ask?: (input: {
    always: string[]
    metadata: Record<string, unknown>
    patterns: string[]
    permission: string
  }) => Promise<void>
  directory?: string
  sessionID?: string
  worktree?: string
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
    google_docs_edit: {
      description:
        'Edit a Google Docs document using semantic operations with the Google Workspace account connected in OpenKhodam Settings. Supports append_text and insert_after_text, requires OpenCode permission approval before writing, and returns a bounded updated-document preview.',
      args: {
        documentId: {
          description: 'The Google Docs document ID to edit.',
          type: 'string'
        },
        operation: {
          additionalProperties: false,
          description:
            'One semantic edit operation. Use append_text with text, or insert_after_text with match, optional occurrence (defaults to last), and text. Do not provide raw Google Docs indexes.',
          properties: {
            type: {
              description: 'Operation type: append_text or insert_after_text.',
              enum: ['append_text', 'insert_after_text'],
              type: 'string'
            },
            match: {
              description: 'Text to find when type is insert_after_text.',
              type: 'string'
            },
            occurrence: {
              description:
                'Optional match occurrence for insert_after_text: first, last, or a 1-based number. Defaults to last.',
              type: ['number', 'string']
            },
            text: {
              description:
                'Text to insert. Literal newline escapes like \\n are normalized before approval and writing.',
              type: 'string'
            }
          },
          required: ['type', 'text'],
          type: 'object'
        }
      },
      async execute(args, context) {
        const documentId = stringArg(args.documentId)
        const result = await editGoogleDocDocument({
          approve: ({ document, operation }) =>
            askForEditApproval(context, {
              document,
              operation
            }),
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

  if (value.type === 'insert_after_text') {
    return {
      match: stringArg(value.match),
      occurrence: occurrenceArg(value.occurrence),
      text: stringArg(value.text),
      type: 'insert_after_text'
    }
  }

  throw new Error('Google Docs edit operation type must be append_text or insert_after_text.')
}

function occurrenceArg(value: unknown): GoogleDocsTextOccurrence | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value === 'first' || value === 'last') return value
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value.trim())
  return Number.NaN
}

async function askForEditApproval(
  context: GoogleWorkspaceToolContext,
  input: {
    document: GoogleDocDocumentArtifact
    operation: GoogleDocsEditApprovalOperation
  }
): Promise<void> {
  if (typeof context.ask !== 'function') {
    throw new Error(
      'Google Docs edit requires OpenCode permission approval, but approval is unavailable. Try again from an OpenCode session.'
    )
  }

  const metadata: Record<string, unknown> = {
    action: input.operation.type,
    characterCount: input.operation.text.length,
    documentId: input.document.id,
    documentTitle: input.document.title,
    link: input.document.link,
    textPreview: previewText(input.operation.text)
  }

  if (input.operation.type === 'insert_after_text') {
    metadata.matchPreview = previewText(input.operation.match)
    metadata.matchCharacterCount = input.operation.match.length
    metadata.occurrence = input.operation.occurrence
  }

  await context.ask({
    always: [`google-docs:${input.document.id}`],
    metadata,
    patterns: [`google-docs:${input.document.id}`],
    permission: 'google_docs_edit'
  })
}

function previewText(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim()
  return singleLine.length > 120 ? `${singleLine.slice(0, 117)}...` : singleLine
}

async function recordReadGoogleDocArtifact(
  context: GoogleWorkspaceToolContext,
  document: GoogleDocDocumentArtifact
): Promise<void> {
  const projectDirectory = nonEmptyString(context.directory)
  const sessionId = nonEmptyString(context.sessionID)
  if (!projectDirectory || !sessionId) return

  let artifactPath: string | null = null
  let createdArtifact = false

  try {
    const persisted = await persistGoogleDocDocumentArtifact({
      document,
      projectDirectory
    })
    artifactPath = persisted.artifactPath
    createdArtifact = persisted.created
  } catch {
    console.warn('Failed to persist Google Doc artifact', {
      docId: document.id,
      reason: 'artifact_persist_failed'
    })
    return
  }

  try {
    await getOrCreateLinkedGoogleDoc({
      doc: {
        artifactPath,
        id: document.id,
        title: document.title,
        url: document.link
      },
      projectDirectory,
      sessionId
    })
  } catch {
    const artifactCleanedUp = artifactPath
      ? await cleanupCreatedGoogleDocArtifact({
          artifactPath,
          createdArtifact,
          docId: document.id,
          projectDirectory,
          sessionId
        })
      : null
    console.warn('Failed to record linked Google Doc artifact', {
      artifactCleanedUp,
      docId: document.id,
      reason: 'artifact_record_failed',
      sessionId
    })
  }
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
