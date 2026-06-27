import {
  editGoogleDocDocument,
  type GoogleDocsEditOperation,
  readGoogleDocDocument,
  searchGoogleDriveFiles
} from '../integrations/google-workspace-runtime'

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
        'Read a Google Docs document using the Google Workspace account connected in OpenKhodam Settings. Returns a safe google.doc.document artifact with document text.',
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

        return JSON.stringify(result)
      }
    },
    google_docs_edit: {
      description:
        'Edit a Google Docs document using semantic operations with the Google Workspace account connected in OpenKhodam Settings. Supports append_text and insert_after_text, and requires OpenCode permission approval before writing.',
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
                'Text to insert. Literal newline escapes like \\n and \\n\\n are normalized before approval and writing.',
              type: 'string'
            }
          },
          required: ['type', 'text'],
          type: 'object'
        }
      },
      async execute(args, context) {
        const documentId = stringArg(args.documentId).trim()
        const operation = toGoogleDocsEditOperation(args.operation)

        if (!documentId) throw new Error('Google Docs document ID is required.')

        const result = await editGoogleDocDocument({
          approve: ({ document, operation }) =>
            askForEditApproval(context, {
              documentId,
              documentTitle: document.title,
              link: document.link,
              operation
            }),
          documentId,
          operation,
          signal: context.abort
        })

        return JSON.stringify(result)
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
      type: 'append_text',
      text: stringArg(value.text)
    }
  }

  if (value.type === 'insert_after_text') {
    return {
      type: 'insert_after_text',
      match: stringArg(value.match),
      occurrence: occurrenceArg(value.occurrence),
      text: stringArg(value.text)
    }
  }

  throw new Error('Google Docs edit operation type must be append_text or insert_after_text.')
}

function occurrenceArg(value: unknown): 'first' | 'last' | number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value === 'first' || value === 'last') return value
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value.trim())
  return undefined
}

async function askForEditApproval(
  context: GoogleWorkspaceToolContext,
  input: {
    documentId: string
    documentTitle: string | null
    link: string | null
    operation: {
      match?: string
      occurrence?: number | string
      text: string
      type: 'append_text' | 'insert_after_text'
    }
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
    documentId: input.documentId,
    documentTitle: input.documentTitle,
    link: input.link,
    textPreview: previewText(input.operation.text)
  }

  if (input.operation.type === 'insert_after_text') {
    metadata.match = input.operation.match
    metadata.occurrence = input.operation.occurrence
  }

  await context.ask({
    permission: 'google_docs_edit',
    patterns: [`google-docs:${input.documentId}`],
    always: [`google-docs:${input.documentId}`],
    metadata
  })
}

function previewText(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim()
  return singleLine.length > 120 ? `${singleLine.slice(0, 117)}...` : singleLine
}
