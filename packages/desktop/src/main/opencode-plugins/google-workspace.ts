import { statSync } from 'node:fs'
import { posix, win32 } from 'node:path'

import type { GoogleDocDocumentArtifact } from '../integrations/google-workspace-runtime'
import {
  readGoogleDocDocument,
  searchGoogleDriveFiles
} from '../integrations/google-workspace-runtime'
import { getOrCreateLinkedGoogleDoc } from '../integrations/project-artifacts'

type GoogleDriveSearchFilesToolArgs = {
  limit?: number
  query?: string
}

type GoogleDocsReadToolArgs = {
  documentId?: string
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

type GoogleWorkspaceHooks = {
  tool: {
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
        await recordReadGoogleDocArtifact(context, result.document)

        return JSON.stringify(result)
      }
    }
  }
})

function stringArg(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

async function recordReadGoogleDocArtifact(
  context: GoogleWorkspaceToolContext,
  document: GoogleDocDocumentArtifact
): Promise<void> {
  const projectDirectory = resolveProjectDirectoryForArtifactRecord(context)
  const sessionId = nonEmptyString(context.sessionID)
  if (!projectDirectory || !sessionId) return

  try {
    await getOrCreateLinkedGoogleDoc({
      doc: {
        id: document.id,
        title: document.title,
        url: document.link
      },
      projectDirectory,
      sessionId
    })
  } catch {
    console.warn('Failed to record linked Google Doc artifact', {
      docId: document.id,
      reason: 'artifact_record_failed',
      sessionId
    })
  }
}

function resolveProjectDirectoryForArtifactRecord(
  context: GoogleWorkspaceToolContext
): string | null {
  return usableProjectDirectory(context.worktree) ?? usableProjectDirectory(context.directory)
}

function usableProjectDirectory(value: unknown): string | null {
  const directory = nonEmptyString(value)
  if (!directory) return null
  if (!isAbsoluteProjectPath(directory)) return null
  if (isRootLikePath(directory)) return null
  if (!isExistingDirectory(directory)) return null

  return directory
}

function isAbsoluteProjectPath(value: string): boolean {
  return posix.isAbsolute(value) || win32.isAbsolute(value)
}

function isRootLikePath(value: string): boolean {
  return (
    isNormalizedRootLikePath(posix.normalize(value), posix) ||
    isNormalizedRootLikePath(win32.normalize(value), win32)
  )
}

function isNormalizedRootLikePath(value: string, pathModule: Pick<typeof posix, 'parse'>): boolean {
  const root = pathModule.parse(value).root
  return root.length > 0 && value === root
}

function isExistingDirectory(value: string): boolean {
  try {
    return statSync(value).isDirectory()
  } catch {
    return false
  }
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
