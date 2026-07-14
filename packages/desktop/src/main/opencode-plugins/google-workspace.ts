import { Buffer } from 'node:buffer'

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
  type GoogleDocsListPlacement,
  type GoogleDocsListType,
  type GoogleDocsParagraphStyle,
  type GoogleDocsTextStyle,
  type GoogleDocsTextOccurrence,
  type GoogleSheetsEditOperation,
  type GoogleSheetsValueInputOption,
  type GoogleSheetsValueRenderOption,
  readGoogleDocDocument,
  readGoogleSheetSpreadsheet,
  searchGoogleDriveFiles
} from '../integrations/google-workspace-runtime'
import {
  deleteGoogleSheetSpreadsheetArtifact,
  getOrCreateLinkedGoogleArtifact,
  getOrCreateLinkedGoogleDoc,
  persistGoogleDocDocumentArtifact,
  persistGoogleSheetSpreadsheetArtifact,
  readGoogleDocDocumentArtifact
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

type GoogleWorkspaceArtifactContext = {
  messageId: string | null
  projectDirectory: string
  sessionId: string | null
}

type PersistedReadGoogleWorkspaceArtifact = GoogleWorkspaceArtifactContext & {
  artifactPath: string
  cachedAt: number
  created: boolean
}

type GoogleDocArtifactSync =
  | { reason: 'project_context_missing' | 'persist_failed'; status: 'unavailable' }
  | {
      artifactRef: string
      cachedAt: number
      linked: boolean
      providerRevision: string | null
      status: 'synced'
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
  config: (config: { skills?: { paths?: string[] } }) => void
  tool: {
    google_workspace_execute_command: GoogleWorkspaceExecuteCommandToolDefinition
    google_workspace_list_commands: GoogleWorkspaceListCommandsToolDefinition
  }
}

export const GoogleWorkspace = async (): Promise<GoogleWorkspaceHooks> => ({
  config(config) {
    appendManagedSkillPath(config, process.env.OPENKHODAM_MANAGED_SKILL_PATH)
  },
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

function appendManagedSkillPath(
  config: { skills?: { paths?: string[] } },
  managedSkillPath: string | undefined
): void {
  const path = managedSkillPath?.trim()
  if (!path) return
  const paths = config.skills?.paths ?? []
  config.skills = { ...config.skills, paths: [...new Set([...paths, path])] }
}

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
  createGoogleArtifactsReadCommand(),
  createGoogleDocsCommand({
    description:
      'Append literal text to a Google Docs document, then use its refreshed artifactRef for offline reads.',
    id: 'google.docs.append_text',
    operationType: 'append_text',
    required: ['documentId', 'text']
  }),
  createGoogleDocsCommand({
    description:
      'Insert literal text before a matching Google Docs occurrence, then use its refreshed artifactRef for offline reads.',
    id: 'google.docs.insert_before_text',
    operationType: 'insert_before_text',
    required: ['documentId', 'match', 'text']
  }),
  createGoogleDocsCommand({
    description:
      'Insert literal text after a matching Google Docs occurrence, then use its refreshed artifactRef for offline reads.',
    id: 'google.docs.insert_after_text',
    operationType: 'insert_after_text',
    required: ['documentId', 'match', 'text']
  }),
  createGoogleDocsCommand({
    description:
      'Replace a matching Google Docs occurrence, then use its refreshed artifactRef for offline reads.',
    id: 'google.docs.replace_text',
    operationType: 'replace_text',
    required: ['documentId', 'match', 'text']
  }),
  createGoogleDocsCommand({
    description:
      'Delete a matching Google Docs occurrence, then use its refreshed artifactRef for offline reads.',
    id: 'google.docs.delete_text',
    operationType: 'delete_text',
    required: ['documentId', 'match']
  }),
  createGoogleDocsFormatCommand({
    description: 'Format a matching text occurrence in a Google Docs document.',
    id: 'google.docs.format_text',
    operationType: 'format_text'
  }),
  createGoogleDocsFormatCommand({
    description:
      'Format the paragraph containing a matching text occurrence in a Google Docs document.',
    id: 'google.docs.format_paragraph',
    operationType: 'format_paragraph'
  }),
  createGoogleDocsListCommand({
    description:
      'Insert isolated native list paragraphs before, after, or at the end of a Google Docs document.',
    id: 'google.docs.insert_list',
    operationType: 'insert_list'
  }),
  createGoogleDocsTableCommand(),
  createGoogleDocsListCommand({
    description:
      'Format only the paragraph containing a matching text occurrence as a native Google Docs list.',
    id: 'google.docs.format_list',
    operationType: 'format_list'
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

function createGoogleDocsTableCommand(): GoogleWorkspaceCommand {
  const id = 'google.docs.insert_table'
  return {
    description:
      'Insert a simple native Google Docs table before, after, or at the end of a Google Docs document.',
    id,
    inputSchema: {
      additionalProperties: false,
      properties: {
        documentId: { description: 'The Google Docs document ID to edit.', type: 'string' },
        match: { description: 'Text in the paragraph to target.', type: 'string' },
        occurrence: {
          description:
            'Optional match occurrence: first, last, or a 1-based number. Defaults to last.',
          type: ['number', 'string']
        },
        placement: { enum: ['before', 'after', 'document_end'], type: 'string' },
        rows: {
          items: {
            items: { maxLength: 2000, type: 'string' },
            maxItems: 100,
            minItems: 1,
            type: 'array'
          },
          maxItems: 100,
          minItems: 1,
          type: 'array'
        }
      },
      required: ['documentId', 'placement', 'rows'],
      type: 'object'
    },
    async execute(parsedInput, context) {
      const parsed = parsedInput as { documentId: string; operation: GoogleDocsEditOperation }
      return executeGoogleDocsEdit({
        context,
        documentId: parsed.documentId,
        operation: parsed.operation
      })
    },
    parseInput(value, options) {
      const record = objectArg(value, `Google Workspace command ${id} input`)
      rejectAdditionalProperties(
        record,
        ['documentId', 'match', 'occurrence', 'placement', 'rows'],
        id,
        options?.rejectUndefinedProperties
      )
      const documentId = requiredStringArg(record.documentId, id, 'documentId')
      const placement = listPlacementArg(record.placement, id)
      const hasMatch = record.match !== undefined
      const hasOccurrence = record.occurrence !== undefined
      if (placement === 'document_end' && (hasMatch || hasOccurrence)) {
        throw new Error(
          `Google Workspace command ${id} does not accept match or occurrence for document_end.`
        )
      }
      if (placement !== 'document_end' && !hasMatch) {
        throw new Error(`Google Workspace command ${id} requires match for ${placement}.`)
      }
      if (!Array.isArray(record.rows) || record.rows.length === 0 || record.rows.length > 100) {
        throw new Error(
          `Google Workspace command ${id} requires rows as a non-empty array of at most 100 rows.`
        )
      }
      const rows = record.rows as unknown[]
      let columnCount: number | null = null
      let totalLength = 0
      for (const row of rows) {
        if (!Array.isArray(row) || row.length === 0 || row.length > 100) {
          throw new Error(
            `Google Workspace command ${id} requires non-empty rows of at most 100 strings.`
          )
        }
        if (columnCount === null) columnCount = row.length
        if (row.length !== columnCount)
          throw new Error(`Google Workspace command ${id} requires rectangular rows.`)
        for (const cell of row) {
          if (typeof cell !== 'string' || cell.length > 2000 || /[\r\n]/.test(cell)) {
            throw new Error(
              `Google Workspace command ${id} requires single-line string cells of at most 2000 characters.`
            )
          }
          totalLength += cell.length
        }
      }
      if (totalLength > 20_000)
        throw new Error(
          `Google Workspace command ${id} cell text must be at most 20000 characters.`
        )
      return {
        documentId,
        operation: {
          ...(placement === 'document_end'
            ? {}
            : {
                match: requiredStringArg(record.match, id, 'match'),
                occurrence: occurrenceArg(record.occurrence)
              }),
          placement,
          rows: rows as string[][],
          type: 'insert_table'
        }
      }
    }
  }
}

function createGoogleDocsListCommand(input: {
  description: string
  id: string
  operationType: 'insert_list' | 'format_list'
}): GoogleWorkspaceCommand {
  const isInsert = input.operationType === 'insert_list'
  const properties: Record<string, unknown> = {
    documentId: { description: 'The Google Docs document ID to edit.', type: 'string' },
    listType: { enum: ['bullet', 'numbered', 'checkbox'], type: 'string' },
    match: { description: 'Text in the paragraph to target.', type: 'string' },
    occurrence: {
      description: 'Optional match occurrence: first, last, or a 1-based number. Defaults to last.',
      type: ['number', 'string']
    }
  }
  if (isInsert) {
    properties.items = {
      items: { maxLength: 2000, minLength: 1, type: 'string' },
      maxItems: 100,
      minItems: 1,
      type: 'array'
    }
    properties.placement = { enum: ['before', 'after', 'document_end'], type: 'string' }
  }
  const allowed = Object.keys(properties)
  return {
    ...input,
    inputSchema: {
      additionalProperties: false,
      properties,
      required: isInsert
        ? ['documentId', 'items', 'listType', 'placement']
        : ['documentId', 'match', 'listType'],
      type: 'object'
    },
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
      rejectAdditionalProperties(record, allowed, input.id, options?.rejectUndefinedProperties)
      const documentId = requiredStringArg(record.documentId, input.id, 'documentId')
      const listType = listTypeArg(record.listType, input.id)
      const occurrence = occurrenceArg(record.occurrence)
      if (!isInsert) {
        return {
          documentId,
          operation: {
            listType,
            match: requiredStringArg(record.match, input.id, 'match'),
            occurrence,
            type: 'format_list'
          }
        }
      }
      const placement = listPlacementArg(record.placement, input.id)
      const hasMatch = record.match !== undefined
      const hasOccurrence = record.occurrence !== undefined
      if (placement === 'document_end' && (hasMatch || hasOccurrence)) {
        throw new Error(
          `Google Workspace command ${input.id} does not accept match or occurrence for document_end.`
        )
      }
      if (placement !== 'document_end' && !hasMatch) {
        throw new Error(`Google Workspace command ${input.id} requires match for ${placement}.`)
      }
      return {
        documentId,
        operation: {
          items: listItemsArg(record.items, input.id),
          listType,
          ...(placement === 'document_end'
            ? {}
            : { match: requiredStringArg(record.match, input.id, 'match'), occurrence }),
          placement,
          type: 'insert_list'
        }
      }
    }
  }
}

function listTypeArg(value: unknown, command: string): GoogleDocsListType {
  if (value === 'bullet' || value === 'numbered' || value === 'checkbox') return value
  throw new Error(
    `Google Workspace command ${command} requires listType to be bullet, numbered, or checkbox.`
  )
}

function listPlacementArg(value: unknown, command: string): GoogleDocsListPlacement {
  if (value === 'before' || value === 'after' || value === 'document_end') return value
  throw new Error(
    `Google Workspace command ${command} requires placement to be before, after, or document_end.`
  )
}

function listItemsArg(value: unknown, command: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new Error(
      `Google Workspace command ${command} requires items as a non-empty array of at most 100 strings.`
    )
  }
  if (
    value.some(
      (item) =>
        typeof item !== 'string' ||
        !item ||
        item.length > 2000 ||
        /[\r\n]/.test(item) ||
        item.startsWith('\t')
    )
  ) {
    throw new Error(
      `Google Workspace command ${command} requires non-empty single-line items that do not start with a tab.`
    )
  }
  if ((value as string[]).join('\n').length > 20_000) {
    throw new Error(
      `Google Workspace command ${command} item text must be at most 20000 characters.`
    )
  }
  return value as string[]
}

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

function createGoogleDocsFormatCommand(input: {
  description: string
  id: string
  operationType: 'format_text' | 'format_paragraph'
}): GoogleWorkspaceCommand {
  const styleSchema =
    input.operationType === 'format_text'
      ? googleDocsTextStyleSchema()
      : googleDocsParagraphStyleSchema()
  return {
    ...input,
    inputSchema: {
      additionalProperties: false,
      properties: {
        documentId: { description: 'The Google Docs document ID to edit.', type: 'string' },
        match: { description: 'Text to find for match-based formatting.', type: 'string' },
        occurrence: {
          description:
            'Optional match occurrence: first, last, or a 1-based number. Defaults to last.',
          type: ['number', 'string']
        },
        style: styleSchema
      },
      required: ['documentId', 'match', 'style'],
      type: 'object'
    },
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
        ['documentId', 'match', 'occurrence', 'style'],
        input.id,
        options?.rejectUndefinedProperties
      )
      const documentId = requiredStringArg(record.documentId, input.id, 'documentId')
      const match = requiredStringArg(record.match, input.id, 'match')
      const occurrence = occurrenceArg(record.occurrence)
      const style =
        input.operationType === 'format_text'
          ? parseGoogleDocsTextStyle(record.style, input.id)
          : parseGoogleDocsParagraphStyle(record.style, input.id)
      return {
        documentId,
        operation: {
          match,
          occurrence,
          style,
          type: input.operationType
        } as GoogleDocsEditOperation
      }
    }
  }
}

function googleDocsTextStyleSchema(): Record<string, unknown> {
  return {
    additionalProperties: false,
    minProperties: 1,
    properties: {
      bold: { type: ['boolean', 'null'] },
      italic: { type: ['boolean', 'null'] },
      underline: { type: ['boolean', 'null'] },
      strikethrough: { type: ['boolean', 'null'] },
      fontFamily: { type: ['string', 'null'] },
      fontSizePt: { exclusiveMinimum: 0, type: ['number', 'null'] },
      foregroundColor: { pattern: '^#[0-9A-F]{6}$', type: ['string', 'null'] },
      backgroundColor: { pattern: '^#[0-9A-F]{6}$', type: ['string', 'null'] },
      linkUrl: { type: ['string', 'null'] }
    },
    type: 'object'
  }
}

function googleDocsParagraphStyleSchema(): Record<string, unknown> {
  return {
    additionalProperties: false,
    minProperties: 1,
    properties: {
      namedStyle: {
        enum: [
          'NORMAL_TEXT',
          'TITLE',
          'SUBTITLE',
          'HEADING_1',
          'HEADING_2',
          'HEADING_3',
          'HEADING_4',
          'HEADING_5',
          'HEADING_6',
          null
        ]
      },
      alignment: { enum: ['START', 'CENTER', 'END', 'JUSTIFIED', null] },
      lineSpacingPercent: { exclusiveMinimum: 0, type: ['number', 'null'] },
      spaceAbovePt: { exclusiveMinimum: 0, type: ['number', 'null'] },
      spaceBelowPt: { exclusiveMinimum: 0, type: ['number', 'null'] }
    },
    type: 'object'
  }
}

function parseGoogleDocsTextStyle(value: unknown, command: string): GoogleDocsTextStyle {
  const record = objectArg(value, `Google Workspace command ${command} style`)
  rejectAdditionalProperties(
    record,
    [
      'bold',
      'italic',
      'underline',
      'strikethrough',
      'fontFamily',
      'fontSizePt',
      'foregroundColor',
      'backgroundColor',
      'linkUrl'
    ],
    command
  )
  if (!Object.keys(record).length)
    throw new Error(`Google Workspace command ${command} requires a non-empty style.`)
  for (const key of ['bold', 'italic', 'underline', 'strikethrough'])
    if (record[key] !== undefined && record[key] !== null && typeof record[key] !== 'boolean')
      throw new Error(`Google Workspace command ${command} requires ${key} to be boolean or null.`)
  if (
    record.fontFamily !== undefined &&
    record.fontFamily !== null &&
    (typeof record.fontFamily !== 'string' || !record.fontFamily.trim())
  )
    throw new Error(
      `Google Workspace command ${command} requires fontFamily to be a non-empty string or null.`
    )
  for (const key of ['fontSizePt'] as const)
    if (
      record[key] !== undefined &&
      record[key] !== null &&
      (typeof record[key] !== 'number' || !Number.isFinite(record[key]) || record[key] <= 0)
    )
      throw new Error(
        `Google Workspace command ${command} requires ${key} to be a positive number or null.`
      )
  for (const key of ['foregroundColor', 'backgroundColor'])
    if (
      record[key] !== undefined &&
      record[key] !== null &&
      (typeof record[key] !== 'string' || !/^#[0-9A-F]{6}$/.test(record[key] as string))
    )
      throw new Error(
        `Google Workspace command ${command} requires ${key} to be canonical #RRGGBB or null.`
      )
  if (record.linkUrl !== undefined && record.linkUrl !== null && typeof record.linkUrl !== 'string')
    throw new Error(`Google Workspace command ${command} requires linkUrl to be a string or null.`)
  return record as GoogleDocsTextStyle
}

function parseGoogleDocsParagraphStyle(value: unknown, command: string): GoogleDocsParagraphStyle {
  const record = objectArg(value, `Google Workspace command ${command} style`)
  rejectAdditionalProperties(
    record,
    ['namedStyle', 'alignment', 'lineSpacingPercent', 'spaceAbovePt', 'spaceBelowPt'],
    command
  )
  if (!Object.keys(record).length)
    throw new Error(`Google Workspace command ${command} requires a non-empty style.`)
  if (
    record.namedStyle !== undefined &&
    record.namedStyle !== null &&
    ![
      'NORMAL_TEXT',
      'TITLE',
      'SUBTITLE',
      'HEADING_1',
      'HEADING_2',
      'HEADING_3',
      'HEADING_4',
      'HEADING_5',
      'HEADING_6'
    ].includes(record.namedStyle as string)
  )
    throw new Error(`Google Workspace command ${command} requires a valid namedStyle.`)
  if (
    record.alignment !== undefined &&
    record.alignment !== null &&
    !['START', 'CENTER', 'END', 'JUSTIFIED'].includes(record.alignment as string)
  )
    throw new Error(`Google Workspace command ${command} requires a valid alignment.`)
  for (const key of ['lineSpacingPercent', 'spaceAbovePt', 'spaceBelowPt'])
    if (
      record[key] !== undefined &&
      record[key] !== null &&
      (typeof record[key] !== 'number' || !Number.isFinite(record[key]) || record[key] <= 0)
    )
      throw new Error(
        `Google Workspace command ${command} requires ${key} to be a positive number or null.`
      )
  return record as GoogleDocsParagraphStyle
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
    description:
      'Read and refresh a Google Docs artifact preview. Use artifactRef with google.artifacts.read when truncated.',
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
      const artifactSync = await recordReadGoogleDocArtifact(context, result.document)
      const document = createGoogleDocDocumentPreview(result.document)
      return JSON.stringify({
        artifactRef: artifactSync.status === 'synced' ? artifactSync.artifactRef : null,
        artifactSync,
        document,
        ...createGoogleDocArtifactNextAction(
          artifactSync.status === 'synced' ? artifactSync.artifactRef : null,
          document.preview.truncated
        )
      })
    },
    parseInput(value) {
      const record = objectArg(value, 'Google Workspace command google.docs.read input')
      rejectAdditionalProperties(record, ['documentId'], 'google.docs.read')
      return { documentId: requiredStringArg(record.documentId, 'google.docs.read', 'documentId') }
    }
  }
}

function createGoogleArtifactsReadCommand(): GoogleWorkspaceCommand {
  return {
    description:
      'Read a cached Google Docs artifact offline. Continue with nextCursor; refresh with google.docs.read when stale or missing. Supports first-tab rich text, lists, and simple table cells; merged or irregular tables and images are unsupported.',
    id: 'google.artifacts.read',
    inputSchema: {
      additionalProperties: false,
      properties: {
        artifactRef: {
          description: 'Opaque artifact reference returned by a Google Docs command.',
          type: 'string'
        },
        cursor: {
          description: 'Opaque cursor returned by a previous artifact read.',
          type: 'string'
        },
        maxBlocks: {
          default: 20,
          description: 'Maximum paragraph blocks to return, from 1 to 100.',
          maximum: 100,
          minimum: 1,
          type: 'number'
        },
        maxCharacters: {
          default: 12000,
          description: 'Maximum text characters to return, from 1 to 12000.',
          maximum: 12000,
          minimum: 1,
          type: 'number'
        }
      },
      required: ['artifactRef'],
      type: 'object'
    },
    async execute(parsedInput, context) {
      const input = parsedInput as {
        artifactRef: string
        cursor?: string
        maxBlocks?: number
        maxCharacters?: number
      }
      const projectDirectory = nonEmptyString(context.directory)
      if (!projectDirectory) throw new Error('google.artifacts.read requires project context.')
      const cached = await readGoogleDocDocumentArtifact({
        artifactRef: input.artifactRef,
        projectDirectory
      })
      const cursor = parseGoogleDocArtifactCursor(
        input.cursor,
        cached.artifactRef,
        cached.snapshotId
      )
      const page = createGoogleDocArtifactPage(
        cached.document,
        cached.artifactRef,
        cached.snapshotId,
        input.maxBlocks ?? 20,
        input.maxCharacters ?? 12_000,
        cursor
      )
      return JSON.stringify({
        artifactRef: cached.artifactRef,
        cachedAt: cached.document.cachedAt,
        coverage:
          cached.document.schemaVersion === 2
            ? {
                richText: true,
                lists: true,
                simpleTables: true,
                mergedOrIrregularTables: false,
                unsupportedTableStructures: {
                  present: cached.document.body.blocks.some(
                    (block) => block.location?.kind === 'unsupported-table'
                  ),
                  count: new Set(
                    cached.document.body.blocks.flatMap((block) =>
                      block.location?.kind === 'unsupported-table'
                        ? [block.location.tableIndex]
                        : []
                    )
                  ).size
                },
                images: false,
                firstTabOnly: true
              }
            : {
                richText: false,
                lists: false,
                simpleTables: false,
                mergedOrIrregularTables: false,
                unsupportedTableStructures: { present: false, count: 0 },
                images: false,
                firstTabOnly: true
              },
        nextCursor: page.nextCursor,
        providerRevision: cached.document.revision,
        returnedBlocks: page.blocks,
        totalBlockCount: cached.document.body.blocks.length,
        totalTextLength: cached.document.body.blocks.reduce(
          (length, block) => length + block.text.length,
          0
        ),
        truncated: page.nextCursor !== null,
        ...createGoogleDocArtifactCursorNextAction(cached.artifactRef, page.nextCursor)
      })
    },
    parseInput(value) {
      const record = objectArg(value, 'Google Workspace command google.artifacts.read input')
      rejectAdditionalProperties(
        record,
        ['artifactRef', 'cursor', 'maxBlocks', 'maxCharacters'],
        'google.artifacts.read'
      )
      const artifactRef = requiredStringArg(
        record.artifactRef,
        'google.artifacts.read',
        'artifactRef'
      )
      const cursor =
        record.cursor === undefined
          ? undefined
          : requiredStringArg(record.cursor, 'google.artifacts.read', 'cursor')
      return {
        artifactRef,
        cursor,
        maxBlocks: boundedIntegerArg(
          record.maxBlocks,
          'google.artifacts.read',
          'maxBlocks',
          1,
          100
        ),
        maxCharacters: boundedIntegerArg(
          record.maxCharacters,
          'google.artifacts.read',
          'maxCharacters',
          1,
          12_000
        )
      }
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
  const artifactSync = await recordReadGoogleDocArtifact(input.context, result.document)

  const document = createGoogleDocDocumentPreview(result.document)
  return JSON.stringify({
    edit: result.edit,
    artifactRef: artifactSync.status === 'synced' ? artifactSync.artifactRef : null,
    artifactSync,
    document,
    ...createGoogleDocArtifactNextAction(
      artifactSync.status === 'synced' ? artifactSync.artifactRef : null,
      document.preview.truncated
    )
  })
}

function createGoogleDocArtifactNextAction(artifactRef: string | null, truncated: boolean): object {
  if (!artifactRef || !truncated) return {}
  return {
    nextAction: {
      artifactRef,
      command: 'google.artifacts.read',
      reason: 'The document preview is truncated; read the cached artifact for more content.'
    }
  }
}

function createGoogleDocArtifactCursorNextAction(
  artifactRef: string,
  nextCursor: string | null
): object {
  if (!nextCursor) return {}
  return {
    nextAction: {
      artifactRef,
      command: 'google.artifacts.read',
      cursor: nextCursor,
      reason: 'More cached artifact content remains; continue with this cursor.'
    }
  }
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
): Promise<GoogleDocArtifactSync> {
  const persisted = await persistReadGoogleDocArtifact({
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
  if (!persisted) {
    return {
      reason: nonEmptyString(context.directory) ? 'persist_failed' : 'project_context_missing',
      status: 'unavailable'
    }
  }

  const artifactRef = createGoogleDocArtifactRef(document.id)
  if (!persisted.sessionId) {
    return {
      artifactRef,
      cachedAt: persisted.cachedAt,
      linked: false,
      providerRevision: document.revision,
      status: 'synced'
    }
  }

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
    return {
      artifactRef,
      cachedAt: persisted.cachedAt,
      linked: true,
      providerRevision: document.revision,
      status: 'synced'
    }
  } catch {
    console.warn('Failed to record linked Google Doc artifact', {
      docId: document.id,
      reason: 'artifact_record_failed',
      sessionId: persisted.sessionId
    })
    return {
      artifactRef,
      cachedAt: persisted.cachedAt,
      linked: false,
      providerRevision: document.revision,
      status: 'synced'
    }
  }
}

async function recordReadGoogleSheetArtifact(
  context: GoogleWorkspaceToolContext,
  spreadsheet: GoogleSheetSpreadsheetArtifact
): Promise<void> {
  const persisted = await persistReadGoogleSheetArtifact({
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
  if (!persisted.sessionId) return

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
  deleteArtifact: (input: {
    artifactPath: string
    projectDirectory: string
  }) => Promise<{ deleted: boolean }>
  failureDetails: Record<string, string>
  failureMessage: string
  projectDirectory: string
}): Promise<boolean | null> {
  if (!createdArtifact) return null
  try {
    return (await deleteArtifact({ artifactPath, projectDirectory })).deleted
  } catch {
    console.warn(failureMessage, failureDetails)
    return false
  }
}

async function persistReadGoogleDocArtifact(input: {
  context: GoogleWorkspaceToolContext
  failureDetails: Record<string, string>
  failureMessage: string
  persist: (projectDirectory: string) => Promise<{
    artifactPath: string
    cachedAt: number
    created: boolean
  }>
}): Promise<PersistedReadGoogleWorkspaceArtifact | null> {
  const artifactContext = getGoogleDocArtifactContext(input.context)
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

async function persistReadGoogleSheetArtifact(input: {
  context: GoogleWorkspaceToolContext
  failureDetails: Record<string, string>
  failureMessage: string
  persist: (projectDirectory: string) => Promise<{
    artifactPath: string
    cachedAt: number
    created: boolean
  }>
}): Promise<PersistedReadGoogleWorkspaceArtifact | null> {
  const artifactContext = getGoogleSheetArtifactContext(input.context)
  if (!artifactContext) return null
  try {
    const persisted = await input.persist(artifactContext.projectDirectory)
    return { ...artifactContext, ...persisted }
  } catch {
    console.warn(input.failureMessage, input.failureDetails)
    return null
  }
}

function getGoogleDocArtifactContext(
  context: GoogleWorkspaceToolContext
): GoogleWorkspaceArtifactContext | null {
  const projectDirectory = nonEmptyString(context.directory)
  const messageId = nonEmptyString(context.messageID)
  const sessionId = nonEmptyString(context.sessionID)
  if (!projectDirectory) return null

  return { messageId, projectDirectory, sessionId }
}

function getGoogleSheetArtifactContext(
  context: GoogleWorkspaceToolContext
): GoogleWorkspaceArtifactContext | null {
  const projectDirectory = nonEmptyString(context.directory)
  const messageId = nonEmptyString(context.messageID)
  const sessionId = nonEmptyString(context.sessionID)
  if (!projectDirectory || !sessionId) return null
  return { messageId, projectDirectory, sessionId }
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function boundedIntegerArg(
  value: unknown,
  command: string,
  field: string,
  minimum: number,
  maximum: number
): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `Google Workspace command ${command} requires ${field} to be an integer from ${minimum} to ${maximum}.`
    )
  }
  return value
}

type GoogleDocArtifactCursor = { block: number; character: number }

function parseGoogleDocArtifactCursor(
  value: string | undefined,
  artifactRef: string,
  snapshotId: string
): GoogleDocArtifactCursor {
  if (!value) return { block: 0, character: 0 }
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >
    if (decoded.artifactRef !== artifactRef || decoded.snapshotId !== snapshotId) {
      throw new Error('stale')
    }
    const block = decoded.block
    const character = decoded.character
    if (
      !Number.isInteger(block) ||
      !Number.isInteger(character) ||
      typeof block !== 'number' ||
      typeof character !== 'number' ||
      block < 0 ||
      character < 0
    ) {
      throw new Error('invalid')
    }
    return { block, character }
  } catch (error) {
    if (error instanceof Error && error.message === 'stale') {
      throw new Error(
        'Google Docs artifact cursor is stale. Restart with google.docs.read, then google.artifacts.read without a cursor.'
      )
    }
    throw new Error(
      'Google Docs artifact cursor is invalid. Restart google.artifacts.read without a cursor.'
    )
  }
}

function createGoogleDocArtifactPage(
  document: GoogleDocDocumentArtifact & { cachedAt: number },
  artifactRef: string,
  snapshotId: string,
  maxBlocks: number,
  maxCharacters: number,
  cursor: GoogleDocArtifactCursor
): {
  blocks: GoogleDocDocumentArtifact['body']['blocks']
  nextCursor: string | null
} {
  const blocks: GoogleDocDocumentArtifact['body']['blocks'] = []
  let blockIndex = cursor.block
  let character = cursor.character
  let remaining = maxCharacters
  if (document.body.blocks.length === 0 && blockIndex === 0 && character === 0) {
    return { blocks, nextCursor: null }
  }
  if (blockIndex >= document.body.blocks.length) {
    throw new Error(
      'Google Docs artifact cursor is invalid. Restart google.artifacts.read without a cursor.'
    )
  }
  while (blockIndex < document.body.blocks.length && blocks.length < maxBlocks && remaining > 0) {
    const block = document.body.blocks[blockIndex]
    const codePoints = Array.from(block.text)
    if (character > codePoints.length || (codePoints.length > 0 && character >= codePoints.length))
      throw new Error(
        'Google Docs artifact cursor is invalid. Restart google.artifacts.read without a cursor.'
      )
    const text = codePoints.slice(character, character + remaining).join('')
    blocks.push({
      ...block,
      text,
      ...(block.runs
        ? { runs: sliceGoogleDocTextRuns(block.runs, character, Array.from(text).length) }
        : {})
    })
    remaining -= Array.from(text).length
    character += Array.from(text).length
    if (character < codePoints.length) break
    blockIndex += 1
    character = 0
  }
  const nextCursor =
    blockIndex >= document.body.blocks.length
      ? null
      : Buffer.from(
          JSON.stringify({ artifactRef, snapshotId, block: blockIndex, character }),
          'utf8'
        ).toString('base64url')
  return { blocks, nextCursor }
}

function sliceGoogleDocTextRuns(
  runs: NonNullable<GoogleDocDocumentArtifact['body']['blocks'][number]['runs']>,
  start: number,
  length: number
) {
  let offset = 0
  let remaining = length
  return runs.flatMap((run) => {
    const points = Array.from(run.text)
    const runStart = Math.max(0, start - offset)
    const available = points.length - runStart
    const take = Math.min(available, remaining)
    offset += points.length
    if (take <= 0 || remaining <= 0) return []
    remaining -= take
    return [{ ...run, text: points.slice(runStart, runStart + take).join('') }]
  })
}

function createGoogleDocArtifactRef(id: string): string {
  return `google-docs:v1:${Buffer.from(id, 'utf8').toString('base64url')}`
}
