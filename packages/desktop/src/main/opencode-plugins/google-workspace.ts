import type {
  GoogleDocDocumentArtifact,
  GoogleSheetCellValue,
  GoogleSheetSpreadsheetArtifact
} from '../integrations/google-workspace-runtime'
import {
  createGoogleDocDocumentPreview,
  createGoogleSheetSpreadsheetPreview,
  editGoogleDocDocument,
  editGoogleSheetSpreadsheet,
  type GoogleDocsEditOperation,
  type GoogleDocsTextOccurrence,
  type GoogleSheetsEditOperation,
  type GoogleSheetsValueInputOption,
  type GoogleSheetsValueRenderOption,
  readGoogleDocDocument,
  readGoogleSheetSpreadsheet,
  searchGoogleDriveFiles
} from '../integrations/google-workspace-runtime'
import {
  deleteGoogleDocDocumentArtifact,
  deleteGoogleSheetSpreadsheetArtifact,
  getOrCreateLinkedGoogleArtifact,
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

type GoogleSheetsEditToolArgs = {
  operation?: {
    range?: string
    rows?: unknown
    type?: string
    valueInputOption?: string
    values?: unknown
  }
  spreadsheetId?: string
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

type GoogleWorkspaceListCommandsToolArgs = {
  query: string
}

type GoogleWorkspaceExecuteCommandToolArgs = {
  command?: string
  input?: unknown
}

type GoogleWorkspaceToolContext = {
  abort?: AbortSignal
  directory?: string
  messageID?: string
  sessionID?: string
  worktree?: string
}

type GoogleWorkspaceArtifactSessionContext = {
  messageId: string | null
  projectDirectory: string
  sessionId: string
}

type PersistedReadGoogleWorkspaceArtifact = GoogleWorkspaceArtifactSessionContext & {
  artifactPath: string
  created: boolean
}

type DeletePersistedGoogleWorkspaceArtifact = (input: {
  artifactPath: string
  projectDirectory: string
}) => Promise<{ deleted: boolean }>

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

type GoogleSheetsEditToolDefinition = {
  args: {
    operation: {
      additionalProperties: boolean
      description: string
      properties: Record<string, unknown>
      required: string[]
      type: 'object'
    }
    spreadsheetId: {
      description: string
      type: 'string'
    }
  }
  description: string
  execute: (args: GoogleSheetsEditToolArgs, context: GoogleWorkspaceToolContext) => Promise<string>
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

type GoogleWorkspaceListCommandsToolDefinition = {
  args: {
    query: {
      description: string
      type: 'string'
    }
  }
  description: string
  execute: (
    args: GoogleWorkspaceListCommandsToolArgs,
    context: GoogleWorkspaceToolContext
  ) => Promise<string>
}

type GoogleWorkspaceExecuteCommandToolDefinition = {
  args: {
    command: {
      description: string
      type: 'string'
    }
    input: {
      additionalProperties: boolean
      description: string
      type: 'object'
    }
  }
  description: string
  execute: (
    args: GoogleWorkspaceExecuteCommandToolArgs,
    context: GoogleWorkspaceToolContext
  ) => Promise<string>
}

type GoogleWorkspaceHooks = {
  tool: {
    google_docs_edit: GoogleDocsEditToolDefinition
    google_docs_read: GoogleDocsReadToolDefinition
    google_drive_search_files: GoogleDriveSearchFilesToolDefinition
    google_sheets_edit: GoogleSheetsEditToolDefinition
    google_sheets_read: GoogleSheetsReadToolDefinition
    google_workspace_execute_command: GoogleWorkspaceExecuteCommandToolDefinition
    google_workspace_list_commands: GoogleWorkspaceListCommandsToolDefinition
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
    google_sheets_edit: {
      description:
        'Edit a Google Sheets spreadsheet using narrow A1 range operations with the Google Workspace account connected in OpenKhodam Settings. Supports set_values, append_rows, and clear_range; writes directly with the connected account; rereads the affected range; persists the updated spreadsheet artifact; and returns a bounded updated-spreadsheet preview.',
      args: {
        spreadsheetId: {
          description: 'The Google Sheets spreadsheet ID to edit.',
          type: 'string'
        },
        operation: {
          additionalProperties: false,
          description:
            'One Google Sheets edit operation. Use set_values with an A1 range and 2D values array; append_rows with an A1 range and 2D rows array; or clear_range with an A1 range. valueInputOption defaults to USER_ENTERED and may be RAW. Do not provide raw grid coordinates, formatting, or structural edits.',
          properties: {
            type: {
              description: 'Operation type: set_values, append_rows, or clear_range.',
              enum: ['set_values', 'append_rows', 'clear_range'],
              type: 'string'
            },
            range: {
              description:
                "Required A1 notation range such as Summary!A1:C3 or 'Data Sheet'!B2:D4.",
              type: 'string'
            },
            values: {
              description:
                '2D primitive values array for set_values. Cells must be strings, finite numbers, booleans, or null.',
              items: {
                items: { type: ['string', 'number', 'boolean', 'null'] },
                type: 'array'
              },
              type: 'array'
            },
            rows: {
              description:
                '2D primitive rows array for append_rows. Cells must be strings, finite numbers, booleans, or null.',
              items: {
                items: { type: ['string', 'number', 'boolean', 'null'] },
                type: 'array'
              },
              type: 'array'
            },
            valueInputOption: {
              default: 'USER_ENTERED',
              description:
                'How Sheets should interpret written cell values for set_values or append_rows: USER_ENTERED or RAW. Defaults to USER_ENTERED.',
              enum: ['USER_ENTERED', 'RAW'],
              type: 'string'
            }
          },
          required: ['type', 'range'],
          type: 'object'
        }
      },
      async execute(args, context) {
        const spreadsheetId = stringArg(args.spreadsheetId)
        const result = await editGoogleSheetSpreadsheet({
          operation: toGoogleSheetsEditOperation(args.operation),
          signal: context.abort,
          spreadsheetId
        })
        await recordReadGoogleSheetArtifact(context, result.spreadsheet)

        return JSON.stringify({
          edit: result.edit,
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
        const operation = toGoogleDocsEditOperation(args.operation)
        const command = commandForGoogleDocsOperation(operation.type)
        const input = command.parseInput(
          googleDocsOperationToCommandInput(stringArg(args.documentId), operation),
          { rejectUndefinedProperties: false }
        )
        return executeGoogleDocsEdit({
          context,
          documentId: input.documentId,
          operation: input.operation
        })
      }
    },
    google_workspace_list_commands: {
      description:
        'List available Google Workspace commands and their input schemas. This is read-only and does not access Google.',
      args: {
        query: {
          description:
            'Text filter matched against command IDs and descriptions. Pass an empty string to list all commands.',
          type: 'string'
        }
      },
      async execute(args) {
        const query = stringArg(args.query).trim().toLowerCase()
        const commands = GOOGLE_WORKSPACE_COMMANDS.filter(
          (command) =>
            !query ||
            command.id.toLowerCase().includes(query) ||
            command.description.toLowerCase().includes(query)
        ).map(({ description, id, inputSchema }) => ({ description, id, inputSchema }))

        return JSON.stringify({ commands })
      }
    },
    google_workspace_execute_command: {
      description:
        'Execute a discovered Google Workspace command. Use google_workspace_list_commands first to obtain command IDs and required input schemas.',
      args: {
        command: {
          description: 'A command ID returned by google_workspace_list_commands.',
          type: 'string'
        },
        input: {
          additionalProperties: true,
          description: 'Input object validated against the selected command schema.',
          type: 'object'
        }
      },
      async execute(args, context) {
        const command = GOOGLE_WORKSPACE_COMMANDS.find((candidate) => candidate.id === args.command)
        if (!command) {
          throw new Error(
            `Unknown Google Workspace command: ${stringArg(args.command) || '(empty)'}.`
          )
        }

        const input = command.parseInput(args.input)
        return executeGoogleDocsEdit({
          context,
          documentId: input.documentId,
          operation: input.operation
        })
      }
    }
  }
})

type GoogleWorkspaceCommandInputSchema = {
  additionalProperties: false
  properties: Record<string, unknown>
  required: string[]
  type: 'object'
}

type GoogleWorkspaceCommandInputProperties = {
  allowed: string[]
  properties: Record<string, unknown>
}

type GoogleWorkspaceCommand = {
  description: string
  id: string
  inputSchema: GoogleWorkspaceCommandInputSchema
  operationType: GoogleDocsEditOperation['type']
  parseInput: (
    input: unknown,
    options?: { rejectUndefinedProperties?: boolean }
  ) => { documentId: string; operation: GoogleDocsEditOperation }
}

const GOOGLE_WORKSPACE_COMMANDS: GoogleWorkspaceCommand[] = [
  createGoogleDocsCommand({
    description: 'Append literal text to the end of a Google Docs document.',
    id: 'google.docs.append_text',
    operationType: 'append_text',
    required: ['documentId', 'text']
  }),
  createGoogleDocsCommand({
    description: 'Insert literal text before a matching text occurrence in a Google Docs document.',
    id: 'google.docs.insert_before_text',
    operationType: 'insert_before_text',
    required: ['documentId', 'match', 'text']
  }),
  createGoogleDocsCommand({
    description: 'Insert literal text after a matching text occurrence in a Google Docs document.',
    id: 'google.docs.insert_after_text',
    operationType: 'insert_after_text',
    required: ['documentId', 'match', 'text']
  }),
  createGoogleDocsCommand({
    description: 'Replace a matching text occurrence with literal text in a Google Docs document.',
    id: 'google.docs.replace_text',
    operationType: 'replace_text',
    required: ['documentId', 'match', 'text']
  }),
  createGoogleDocsCommand({
    description: 'Delete a matching text occurrence from a Google Docs document.',
    id: 'google.docs.delete_text',
    operationType: 'delete_text',
    required: ['documentId', 'match']
  })
]

function createGoogleDocsCommand(input: {
  description: string
  id: string
  operationType: GoogleDocsEditOperation['type']
  required: string[]
}): GoogleWorkspaceCommand {
  const inputSchema: GoogleWorkspaceCommandInputSchema = {
    additionalProperties: false,
    properties: googleDocsCommandInputProperties(input.operationType).properties,
    required: input.required,
    type: 'object'
  }

  return {
    ...input,
    inputSchema,
    parseInput(value, options) {
      const record = objectArg(value, `Google Workspace command ${input.id} input`)
      rejectAdditionalProperties(
        record,
        googleDocsCommandInputProperties(input.operationType).allowed,
        input.id,
        options?.rejectUndefinedProperties
      )
      const documentId = requiredStringArg(record.documentId, input.id, 'documentId')
      const text = input.required.includes('text')
        ? requiredStringArg(record.text, input.id, 'text')
        : undefined
      const match = input.required.includes('match')
        ? requiredStringArg(record.match, input.id, 'match')
        : undefined
      const occurrence = occurrenceArg(record.occurrence)

      if (input.operationType === 'append_text') {
        return { documentId, operation: { text: text!, type: 'append_text' } }
      }
      if (input.operationType === 'delete_text') {
        return { documentId, operation: { match: match!, occurrence, type: 'delete_text' } }
      }
      return {
        documentId,
        operation: { match: match!, occurrence, text: text!, type: input.operationType }
      }
    }
  }
}

function googleDocsCommandInputProperties(
  operationType: GoogleDocsEditOperation['type']
): GoogleWorkspaceCommandInputProperties {
  const properties: Record<string, unknown> = {
    documentId: { description: 'The Google Docs document ID to edit.', type: 'string' }
  }
  const allowed = ['documentId']
  if (
    operationType === 'insert_after_text' ||
    operationType === 'insert_before_text' ||
    operationType === 'replace_text' ||
    operationType === 'delete_text'
  ) {
    allowed.push('match', 'occurrence')
    properties.match = { description: 'Text to find for match-based edits.', type: 'string' }
    properties.occurrence = {
      description: 'Optional match occurrence: first, last, or a 1-based number. Defaults to last.',
      type: ['number', 'string']
    }
  }
  if (
    operationType === 'append_text' ||
    operationType === 'insert_after_text' ||
    operationType === 'insert_before_text' ||
    operationType === 'replace_text'
  ) {
    allowed.push('text')
    properties.text = {
      description: 'Literal text to append, insert, or use as replacement text.',
      type: 'string'
    }
  }
  return { allowed, properties }
}

function commandForGoogleDocsOperation(
  operationType: GoogleDocsEditOperation['type']
): GoogleWorkspaceCommand {
  const command = GOOGLE_WORKSPACE_COMMANDS.find(
    (candidate) => candidate.operationType === operationType
  )
  if (!command) throw new Error(`Unsupported Google Docs edit operation: ${operationType}.`)
  return command
}

function googleDocsOperationToCommandInput(
  documentId: string,
  operation: GoogleDocsEditOperation
): Record<string, unknown> {
  if (operation.type === 'append_text') return { documentId, text: operation.text }
  if (operation.type === 'delete_text') {
    return { documentId, match: operation.match, occurrence: operation.occurrence }
  }
  return {
    documentId,
    match: operation.match,
    occurrence: operation.occurrence,
    text: operation.text
  }
}

async function executeGoogleDocsEdit(input: {
  context: GoogleWorkspaceToolContext
  documentId: string
  operation: GoogleDocsEditOperation
}): Promise<string> {
  const result = await editGoogleDocDocument({
    documentId: input.documentId,
    operation: input.operation,
    signal: input.context.abort
  })
  await recordReadGoogleDocArtifact(input.context, result.document)

  return JSON.stringify({
    edit: result.edit,
    document: createGoogleDocDocumentPreview(result.document)
  })
}

function stringArg(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function objectArg(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`)
  }
  return value as Record<string, unknown>
}

function requiredStringArg(value: unknown, command: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Google Workspace command ${command} requires a non-empty ${field}.`)
  }
  return value
}

function rejectAdditionalProperties(
  input: Record<string, unknown>,
  allowed: string[],
  command: string,
  rejectUndefinedProperties = true
): void {
  const additionalProperties = Object.keys(input).filter(
    (key) => !allowed.includes(key) && (rejectUndefinedProperties || input[key] !== undefined)
  )
  if (additionalProperties.length > 0) {
    throw new Error(
      `Google Workspace command ${command} does not accept input property ${additionalProperties[0]}.`
    )
  }
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

function valueInputOptionArg(value: unknown): GoogleSheetsValueInputOption | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value === 'USER_ENTERED' || value === 'RAW') return value

  return value as GoogleSheetsValueInputOption
}

function toGoogleSheetsEditOperation(
  value: GoogleSheetsEditToolArgs['operation']
): GoogleSheetsEditOperation {
  if (!value || typeof value !== 'object') {
    throw new Error('Google Sheets edit operation is required.')
  }

  if (value.type === 'set_values') {
    return {
      range: stringArg(value.range),
      type: 'set_values',
      valueInputOption: valueInputOptionArg(value.valueInputOption),
      values: valuesArg(value.values)
    }
  }

  if (value.type === 'append_rows') {
    return {
      range: stringArg(value.range),
      rows: valuesArg(value.rows),
      type: 'append_rows',
      valueInputOption: valueInputOptionArg(value.valueInputOption)
    }
  }

  if (value.type === 'clear_range') {
    return {
      range: stringArg(value.range),
      type: 'clear_range'
    }
  }

  throw new Error(
    'Google Sheets edit operation type must be set_values, append_rows, or clear_range.'
  )
}

function valuesArg(value: unknown): GoogleSheetCellValue[][] {
  return Array.isArray(value) ? (value as GoogleSheetCellValue[][]) : []
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
      messageId: persisted.messageId,
      sessionId: persisted.sessionId
    })
  } catch {
    const artifactCleanedUp = await cleanupCreatedGoogleWorkspaceArtifact({
      artifactPath: persisted.artifactPath,
      createdArtifact: persisted.created,
      deleteArtifact: deleteGoogleDocDocumentArtifact,
      failureDetails: {
        docId: document.id,
        reason: 'artifact_cleanup_failed',
        sessionId: persisted.sessionId
      },
      failureMessage: 'Failed to clean up Google Doc artifact after record failure',
      projectDirectory: persisted.projectDirectory
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
  const persisted = await persistReadGoogleWorkspaceArtifact({
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
  if (!persisted) return

  try {
    await getOrCreateLinkedGoogleArtifact({
      artifact: {
        artifactPath: persisted.artifactPath,
        id: spreadsheet.id,
        title: spreadsheet.title,
        type: 'google.sheet.spreadsheet',
        url: spreadsheet.link
      },
      projectDirectory: persisted.projectDirectory,
      messageId: persisted.messageId,
      sessionId: persisted.sessionId
    })
  } catch {
    const artifactCleanedUp = await cleanupCreatedGoogleWorkspaceArtifact({
      artifactPath: persisted.artifactPath,
      createdArtifact: persisted.created,
      deleteArtifact: deleteGoogleSheetSpreadsheetArtifact,
      failureDetails: {
        reason: 'artifact_cleanup_failed',
        sessionId: persisted.sessionId,
        spreadsheetId: spreadsheet.id
      },
      failureMessage: 'Failed to clean up Google Sheet artifact after record failure',
      projectDirectory: persisted.projectDirectory
    })
    console.warn('Failed to record linked Google Sheet artifact', {
      artifactCleanedUp,
      reason: 'artifact_record_failed',
      sessionId: persisted.sessionId,
      spreadsheetId: spreadsheet.id
    })
  }
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
  const messageId = nonEmptyString(context.messageID)
  const sessionId = nonEmptyString(context.sessionID)
  if (!projectDirectory || !sessionId) return null

  return { messageId, projectDirectory, sessionId }
}

async function cleanupCreatedGoogleWorkspaceArtifact({
  artifactPath,
  createdArtifact,
  deleteArtifact,
  failureDetails,
  failureMessage,
  projectDirectory
}: {
  artifactPath: string
  createdArtifact: boolean
  deleteArtifact: DeletePersistedGoogleWorkspaceArtifact
  failureDetails: Record<string, string>
  failureMessage: string
  projectDirectory: string
}): Promise<boolean | null> {
  if (!createdArtifact) return null

  try {
    const result = await deleteArtifact({
      artifactPath,
      projectDirectory
    })
    return result.deleted
  } catch {
    console.warn(failureMessage, failureDetails)
    return false
  }
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
