import {
  appendTextToGoogleDocDocument,
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

type GoogleDocsAppendTextToolArgs = {
  documentId?: string
  text?: string
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

type GoogleDocsAppendTextToolDefinition = {
  args: {
    documentId: {
      description: string
      type: 'string'
    }
    text: {
      description: string
      type: 'string'
    }
  }
  description: string
  execute: (
    args: GoogleDocsAppendTextToolArgs,
    context: GoogleWorkspaceToolContext
  ) => Promise<string>
}

type GoogleWorkspaceHooks = {
  tool: {
    google_docs_append_text: GoogleDocsAppendTextToolDefinition
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
    google_docs_append_text: {
      description:
        'Append text to a Google Docs document using the Google Workspace account connected in OpenKhodam Settings. Requires OpenCode permission approval before writing.',
      args: {
        documentId: {
          description: 'The Google Docs document ID to append to.',
          type: 'string'
        },
        text: {
          description: 'The text to append near the end of the document body.',
          type: 'string'
        }
      },
      async execute(args, context) {
        const documentId = stringArg(args.documentId).trim()
        const text = stringArg(args.text)

        if (!documentId) throw new Error('Google Docs document ID is required.')
        if (!text) throw new Error('Text to append to the Google Doc is required.')

        const result = await appendTextToGoogleDocDocument({
          approve: ({ document, insertionIndex }) =>
            askForAppendApproval(context, {
              documentId,
              documentTitle: document.title,
              insertionIndex,
              link: document.link,
              text
            }),
          documentId,
          signal: context.abort,
          text
        })

        return JSON.stringify(result)
      }
    }
  }
})

function stringArg(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

async function askForAppendApproval(
  context: GoogleWorkspaceToolContext,
  input: {
    documentId: string
    documentTitle: string | null
    insertionIndex: number
    link: string | null
    text: string
  }
): Promise<void> {
  if (typeof context.ask !== 'function') {
    throw new Error(
      'Google Docs append requires OpenCode permission approval, but approval is unavailable. Try again from an OpenCode session.'
    )
  }

  await context.ask({
    permission: 'google_docs_append_text',
    patterns: [`google-docs:${input.documentId}`],
    always: [`google-docs:${input.documentId}`],
    metadata: {
      action: 'append_text',
      characterCount: input.text.length,
      documentId: input.documentId,
      documentTitle: input.documentTitle,
      insertionIndex: input.insertionIndex,
      link: input.link,
      textPreview: previewText(input.text)
    }
  })
}

function previewText(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim()
  return singleLine.length > 120 ? `${singleLine.slice(0, 117)}...` : singleLine
}
