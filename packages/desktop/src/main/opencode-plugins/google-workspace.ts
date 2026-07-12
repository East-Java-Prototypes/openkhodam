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
    google_workspace_execute_command: GoogleWorkspaceExecuteCommandToolDefinition
    google_workspace_list_commands: GoogleWorkspaceListCommandsToolDefinition
  }
}

export const GoogleWorkspace = async (): Promise<GoogleWorkspaceHooks> => ({
  tool: {
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
        return command.execute(input, context)
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
  execute: (input: unknown, context: GoogleWorkspaceToolContext) => Promise<string>
  operationType?: GoogleDocsEditOperation['type'] | GoogleSheetsEditOperation['type']
  parseInput: (input: unknown, options?: { rejectUndefinedProperties?: boolean }) => unknown
}

const GOOGLE_WORKSPACE_COMMANDS: GoogleWorkspaceCommand[] = [
  createGoogleDriveSearchCommand(),
  createGoogleDocsReadCommand(),
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
  }),
  createGoogleSheetsReadCommand(),
  createGoogleSheetsEditCommand({
    description: 'Set 2D values in a Google Sheets A1 range.',
    id: 'google.sheets.set_values',
    operationType: 'set_values',
    valueProperty: 'values'
  }),
  createGoogleSheetsEditCommand({
    description: 'Append 2D rows to a Google Sheets A1 range.',
    id: 'google.sheets.append_rows',
    operationType: 'append_rows',
    valueProperty: 'rows'
  }),
  createGoogleSheetsEditCommand({
    description: 'Clear values from a Google Sheets A1 range.',
    id: 'google.sheets.clear_range',
    operationType: 'clear_range'
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
    async execute(parsedInput, context) {
      const parsed = parsedInput as { documentId: string; operation: GoogleDocsEditOperation }
      return executeGoogleDocsEdit({
        context,
        documentId: parsed.documentId,
        operation: parsed.operation
      })
    },
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

function createGoogleDriveSearchCommand(): GoogleWorkspaceCommand {
  return {
    description: 'Search Google Drive files by name. Returns file metadata only.',
    id: 'google.drive.search_files',
    inputSchema: {
      additionalProperties: false,
      properties: {
        query: { description: 'Optional file name text to search for.', type: 'string' },
        limit: {
          default: 10,
          description: 'Maximum files to return, from 1 to 20.',
          maximum: 20,
          minimum: 1,
          type: 'number'
        }
      },
      required: [],
      type: 'object'
    },
    async execute(parsedInput, context) {
      const input = parsedInput as { limit?: number; query?: string }
      return JSON.stringify(
        await searchGoogleDriveFiles({
          limit: input.limit,
          query: input.query ?? '',
          signal: context.abort
        })
      )
    },
    parseInput(value) {
      const record = objectArg(value, 'Google Workspace command google.drive.search_files input')
      rejectAdditionalProperties(record, ['query', 'limit'], 'google.drive.search_files')
      if (record.query !== undefined && typeof record.query !== 'string') {
        throw new Error(
          'Google Workspace command google.drive.search_files requires query to be a string.'
        )
      }
      if (
        record.limit !== undefined &&
        (typeof record.limit !== 'number' || !Number.isFinite(record.limit) || record.limit < 1)
      ) {
        throw new Error(
          'Google Workspace command google.drive.search_files requires limit to be a number of at least 1.'
        )
      }
      return {
        limit: record.limit as number | undefined,
        query: record.query as string | undefined
      }
    }
  }
}

function createGoogleDocsReadCommand(): GoogleWorkspaceCommand {
  return {
    description: 'Read a Google Docs document and return a bounded artifact preview.',
    id: 'google.docs.read',
    inputSchema: {
      additionalProperties: false,
      properties: {
        documentId: { description: 'The Google Docs document ID to read.', type: 'string' }
      },
      required: ['documentId'],
      type: 'object'
    },
    async execute(parsedInput, context) {
      const input = parsedInput as { documentId: string }
      const result = await readGoogleDocDocument({
        documentId: input.documentId,
        signal: context.abort
      })
      await recordReadGoogleDocArtifact(context, result.document)
      return JSON.stringify({ document: createGoogleDocDocumentPreview(result.document) })
    },
    parseInput(value) {
      const record = objectArg(value, 'Google Workspace command google.docs.read input')
      rejectAdditionalProperties(record, ['documentId'], 'google.docs.read')
      return { documentId: requiredStringArg(record.documentId, 'google.docs.read', 'documentId') }
    }
  }
}

function createGoogleSheetsReadCommand(): GoogleWorkspaceCommand {
  return {
    description: 'Read a Google Sheets spreadsheet and return bounded A1 range previews.',
    id: 'google.sheets.read',
    inputSchema: {
      additionalProperties: false,
      properties: {
        spreadsheetId: { description: 'The Google Sheets spreadsheet ID to read.', type: 'string' },
        ranges: {
          description: 'Optional A1 ranges, up to 5.',
          items: { type: 'string' },
          maxItems: 5,
          type: 'array'
        },
        valueRenderOption: {
          default: 'FORMATTED_VALUE',
          description: 'Cell rendering mode.',
          enum: ['FORMATTED_VALUE', 'UNFORMATTED_VALUE', 'FORMULA'],
          type: 'string'
        }
      },
      required: ['spreadsheetId'],
      type: 'object'
    },
    async execute(parsedInput, context) {
      const input = parsedInput as {
        ranges?: string[]
        spreadsheetId: string
        valueRenderOption?: GoogleSheetsValueRenderOption
      }
      const result = await readGoogleSheetSpreadsheet({ ...input, signal: context.abort })
      await recordReadGoogleSheetArtifact(context, result.spreadsheet)
      return JSON.stringify({
        spreadsheet: createGoogleSheetSpreadsheetPreview(result.spreadsheet)
      })
    },
    parseInput(value) {
      const record = objectArg(value, 'Google Workspace command google.sheets.read input')
      rejectAdditionalProperties(
        record,
        ['spreadsheetId', 'ranges', 'valueRenderOption'],
        'google.sheets.read'
      )
      const spreadsheetId = requiredStringArg(
        record.spreadsheetId,
        'google.sheets.read',
        'spreadsheetId'
      )
      if (
        record.ranges !== undefined &&
        (!Array.isArray(record.ranges) ||
          record.ranges.length > 5 ||
          record.ranges.some((range) => typeof range !== 'string' || !range.trim()))
      ) {
        throw new Error(
          'Google Workspace command google.sheets.read requires ranges to be an array of at most 5 strings.'
        )
      }
      if (
        record.valueRenderOption !== undefined &&
        !['FORMATTED_VALUE', 'UNFORMATTED_VALUE', 'FORMULA'].includes(
          record.valueRenderOption as string
        )
      ) {
        throw new Error(
          'Google Workspace command google.sheets.read requires a valid valueRenderOption.'
        )
      }
      return {
        spreadsheetId,
        ranges: record.ranges as string[] | undefined,
        valueRenderOption: record.valueRenderOption as GoogleSheetsValueRenderOption | undefined
      }
    }
  }
}

function createGoogleSheetsEditCommand(input: {
  description: string
  id: string
  operationType: GoogleSheetsEditOperation['type']
  valueProperty?: 'rows' | 'values'
}): GoogleWorkspaceCommand {
  const properties: Record<string, unknown> = {
    spreadsheetId: { description: 'The Google Sheets spreadsheet ID to edit.', type: 'string' },
    range: { description: 'Required A1 notation range.', type: 'string' }
  }
  if (input.valueProperty) {
    properties[input.valueProperty] = {
      description: '2D primitive cell values.',
      items: {
        items: { type: ['string', 'number', 'boolean', 'null'] },
        type: 'array'
      },
      minItems: 1,
      type: 'array'
    }
    properties.valueInputOption = {
      default: 'USER_ENTERED',
      description: 'USER_ENTERED or RAW.',
      enum: ['USER_ENTERED', 'RAW'],
      type: 'string'
    }
  }
  const allowed = Object.keys(properties)
  return {
    ...input,
    inputSchema: {
      additionalProperties: false,
      properties,
      required: input.valueProperty
        ? ['spreadsheetId', 'range', input.valueProperty]
        : ['spreadsheetId', 'range'],
      type: 'object'
    },
    async execute(parsedInput, context) {
      const parsed = parsedInput as { spreadsheetId: string; operation: GoogleSheetsEditOperation }
      const result = await editGoogleSheetSpreadsheet({ ...parsed, signal: context.abort })
      await recordReadGoogleSheetArtifact(context, result.spreadsheet)
      return JSON.stringify({
        edit: result.edit,
        spreadsheet: createGoogleSheetSpreadsheetPreview(result.spreadsheet)
      })
    },
    parseInput(value) {
      const record = objectArg(value, `Google Workspace command ${input.id} input`)
      rejectAdditionalProperties(record, allowed, input.id)
      const spreadsheetId = requiredStringArg(record.spreadsheetId, input.id, 'spreadsheetId')
      const range = requiredStringArg(record.range, input.id, 'range')
      if (input.valueProperty && !isGoogleSheetValues(record[input.valueProperty])) {
        throw new Error(
          `Google Workspace command ${input.id} requires ${input.valueProperty} to be a 2D primitive values array.`
        )
      }
      if (
        record.valueInputOption !== undefined &&
        record.valueInputOption !== 'USER_ENTERED' &&
        record.valueInputOption !== 'RAW'
      ) {
        throw new Error(`Google Workspace command ${input.id} requires a valid valueInputOption.`)
      }
      const valueInputOption = record.valueInputOption as GoogleSheetsValueInputOption | undefined
      const operation =
        input.operationType === 'clear_range'
          ? { range, type: 'clear_range' as const }
          : input.operationType === 'set_values'
            ? {
                range,
                type: 'set_values' as const,
                valueInputOption,
                values: record.values as GoogleSheetCellValue[][]
              }
            : {
                range,
                rows: record.rows as GoogleSheetCellValue[][],
                type: 'append_rows' as const,
                valueInputOption
              }
      return { spreadsheetId, operation }
    }
  }
}

function isGoogleSheetValues(value: unknown): value is GoogleSheetCellValue[][] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (row) =>
        Array.isArray(row) &&
        row.every(
          (cell) =>
            cell === null ||
            typeof cell === 'string' ||
            typeof cell === 'boolean' ||
            (typeof cell === 'number' && Number.isFinite(cell))
        )
    )
  )
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
