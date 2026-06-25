import { searchGoogleDriveFiles } from '../integrations/google-workspace-runtime'

type GoogleDriveSearchFilesToolArgs = {
  limit?: number
  query?: string
}

type GoogleDriveSearchFilesToolContext = {
  abort?: AbortSignal
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
    context: GoogleDriveSearchFilesToolContext
  ) => Promise<string>
}

type GoogleWorkspaceHooks = {
  tool: {
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
    }
  }
})
