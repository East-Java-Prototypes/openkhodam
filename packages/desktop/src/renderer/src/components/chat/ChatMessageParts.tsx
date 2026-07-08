import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

import type { ChatMessage, ChatMessagePart } from '../../hooks/useChatInterfaceData'
import { MarkdownText } from './MarkdownText'

type ChatMessageAuthor = ChatMessage['author']
type ToolStatusTone = 'completed' | 'error' | 'updated'
const GOOGLE_WORKSPACE_TOOL_TITLES = {
  google_docs_edit: 'Google Docs edit',
  google_docs_read: 'Google Docs read',
  google_drive_search_files: 'Google Drive search'
} as const
type ToolPartModel = Extract<ChatMessagePart, { type: 'tool' }>
type GoogleWorkspaceToolName = keyof typeof GOOGLE_WORKSPACE_TOOL_TITLES

export function ChatMessageParts({
  author,
  parts
}: {
  author: ChatMessageAuthor
  parts: ChatMessagePart[]
}): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {parts.map((part) => (
        <div key={part.id}>{renderPart(part, author)}</div>
      ))}
    </div>
  )
}

function renderPart(part: ChatMessagePart, author: ChatMessageAuthor): JSX.Element {
  switch (part.type) {
    case 'text':
      return <TextPart author={author} part={part} />
    case 'reasoning':
      return <ReasoningPart part={part} />
    case 'status':
      return <StatusPart part={part} />
    case 'tool':
      return <ToolPart part={part} />
    case 'unknown':
      return <UnknownPart part={part} />
  }
}

function TextPart({
  author,
  part
}: {
  author: ChatMessageAuthor
  part: Extract<ChatMessagePart, { type: 'text' }>
}): JSX.Element {
  if (author === 'assistant') return <MarkdownText text={part.text} />
  return <p className="whitespace-pre-wrap break-words leading-7">{part.text}</p>
}

function ReasoningPart({
  part
}: {
  part: Extract<ChatMessagePart, { type: 'reasoning' }>
}): JSX.Element {
  return (
    <p className="whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground/80">
      {part.text}
    </p>
  )
}

function StatusPart({ part }: { part: Extract<ChatMessagePart, { type: 'status' }> }): JSX.Element {
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium">{part.title}</span>
      {part.text ? ` · ${part.text}` : ''}
    </p>
  )
}

function ToolPart({ part }: { part: Extract<ChatMessagePart, { type: 'tool' }> }): JSX.Element {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const correctionTimersRef = useRef<number[]>([])
  const openRef = useRef(Boolean(part.error))
  const correctionGenerationRef = useRef(0)
  const [open, setOpen] = useState(Boolean(part.error))
  const googleWorkspaceToolName = getGoogleWorkspaceToolName(part.name)
  const toolTitle = googleWorkspaceToolName
    ? GOOGLE_WORKSPACE_TOOL_TITLES[googleWorkspaceToolName]
    : (part.title ?? part.name)
  const statusLabel = part.status ?? (part.error ? 'error' : undefined)
  const statusTone = getToolStatusTone(statusLabel, Boolean(part.error))
  const syncOpenRef = (nextOpen: boolean): void => {
    openRef.current = nextOpen
  }
  const clearCorrectionTimers = (): void => {
    for (const timer of correctionTimersRef.current) window.clearTimeout(timer)
    correctionTimersRef.current = []
  }
  useEffect(() => clearCorrectionTimers, [])
  const preserveTriggerTop = (
    trigger: HTMLElement | null,
    beforeTop: number,
    generation: number
  ): void => {
    if (!openRef.current || generation !== correctionGenerationRef.current) return
    if (!trigger?.isConnected) return
    const viewport = trigger.closest(
      '[data-slot="message-scroller-viewport"], [data-slot="scroll-area-viewport"]'
    ) as HTMLDivElement | null
    if (!viewport?.isConnected) return
    const currentTop = trigger.getBoundingClientRect().top
    const delta = currentTop - beforeTop
    if (Math.abs(delta) > 1 && openRef.current && generation === correctionGenerationRef.current) {
      viewport.scrollTop += delta
    }
  }
  const scheduleCorrectionPasses = (trigger: HTMLElement, beforeTop: number): void => {
    clearCorrectionTimers()
    const generation = correctionGenerationRef.current
    const runCorrection = (): void => {
      preserveTriggerTop(trigger, beforeTop, generation)
    }
    requestAnimationFrame(runCorrection)
    for (const delay of [0, 50, 100, 200, 400, 750]) {
      correctionTimersRef.current.push(window.setTimeout(runCorrection, delay))
    }
  }
  const beginOpenCorrection = (trigger: HTMLElement): void => {
    const beforeTop = trigger.getBoundingClientRect().top
    correctionGenerationRef.current += 1
    scheduleCorrectionPasses(trigger, beforeTop)
  }
  const handleOpenChange = (nextOpen: boolean): void => {
    if (nextOpen) {
      syncOpenRef(true)
      setOpen(true)
      return
    }
    if (open && !nextOpen) {
      correctionGenerationRef.current += 1
      syncOpenRef(false)
      clearCorrectionTimers()
    }
    setOpen(false)
  }
  return (
    <Collapsible
      open={open}
      data-slot="tool-card"
      data-status={statusLabel}
      data-tone={statusTone}
      className={cn(
        'border p-2 text-sm shadow-sm',
        statusTone === 'error'
          ? 'border-destructive/50 bg-destructive/5'
          : 'border-border/70 bg-muted/20'
      )}
      aria-label={`Tool ${part.name}`}
      onOpenChange={handleOpenChange}
    >
      <CollapsibleTrigger
        className="flex min-h-10 w-full items-center justify-between gap-3 px-2 py-1.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-label={`Toggle details for tool ${part.name}`}
        ref={triggerRef}
        onClickCapture={(event) => {
          if (openRef.current) return
          beginOpenCorrection(event.currentTarget)
        }}
        onKeyDownCapture={(event) => {
          if (openRef.current) return
          if (event.key !== 'Enter' && event.key !== ' ') return
          beginOpenCorrection(event.currentTarget)
        }}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-background/80 text-xs font-semibold text-muted-foreground shadow-sm">
            {part.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span
              data-slot="tool-title"
              className="truncate font-semibold leading-5 text-foreground"
            >
              {toolTitle}
            </span>
            {toolTitle !== part.name ? (
              <span
                data-slot="tool-name"
                className="truncate text-xs leading-4 text-muted-foreground"
              >
                {part.name}
              </span>
            ) : null}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {statusLabel ? (
            <span
              data-slot="tool-status-badge"
              data-tone={statusTone}
              className={cn(
                'border px-2 py-0.5 text-[0.6875rem] font-medium uppercase leading-4 tracking-wide',
                statusTone === 'error'
                  ? 'border-destructive/30 bg-destructive/10 text-destructive'
                  : statusTone === 'completed'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-border bg-background text-muted-foreground'
              )}
            >
              {statusLabel}
            </span>
          ) : null}
          <span data-slot="tool-detail-affordance" className="text-xs text-muted-foreground">
            {open ? 'Hide details' : 'Show details'}
          </span>
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-2 pb-2 pt-2">
        <div className="flex flex-col gap-2">
          {googleWorkspaceToolName ? (
            <GoogleWorkspaceToolSummary toolName={googleWorkspaceToolName} part={part} />
          ) : null}
          {part.input ? <PartBlock label="Input" text={part.input} /> : null}
          {part.output ? <PartBlock label="Output" text={part.output} /> : null}
          {part.error ? <PartBlock label="Error" text={part.error} tone="error" /> : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function GoogleWorkspaceToolSummary({
  part,
  toolName
}: {
  part: ToolPartModel
  toolName: GoogleWorkspaceToolName
}): JSX.Element | null {
  const input = parseJsonRecord(part.input)
  const output = parseJsonRecord(part.output)

  if (toolName === 'google_drive_search_files') {
    return <GoogleDriveSearchSummary input={input} output={output} />
  }
  if (toolName === 'google_docs_read') {
    return <GoogleDocsReadSummary input={input} output={output} />
  }

  return <GoogleDocsEditSummary input={input} output={output} />
}

function GoogleDriveSearchSummary({
  input,
  output
}: {
  input: Record<string, unknown> | null
  output: Record<string, unknown> | null
}): JSX.Element | null {
  if (!input && !output) return null

  const query = getString(input, 'query')?.trim()
  const limit = getNumber(input, 'limit')
  const files = getRecordArray(output, 'files')

  return (
    <GoogleSummaryShell toolName="google_drive_search_files">
      <SummaryRow label="Query">{query || 'Recent non-trashed files'}</SummaryRow>
      <SummaryRow label="Limit">{limit !== null ? limit : 'Default'}</SummaryRow>
      {output ? <SummaryRow label="Returned files">{files.length}</SummaryRow> : null}
      {output ? <FileResultList files={files} /> : null}
    </GoogleSummaryShell>
  )
}

function GoogleDocsReadSummary({
  input,
  output
}: {
  input: Record<string, unknown> | null
  output: Record<string, unknown> | null
}): JSX.Element | null {
  const document = getRecord(output, 'document')
  if (!input && !document) return null

  const documentId = getString(document, 'id') ?? getString(input, 'documentId')
  const revision = getString(document, 'revision')
  const title = getString(document, 'title') ?? documentId ?? 'Untitled Google Doc'
  const link = getString(document, 'link')
  const previewMetadata = formatPreviewMetadata(document)
  const previewText = formatTextPreview(getString(document, 'text'))

  return (
    <GoogleSummaryShell toolName="google_docs_read">
      <SummaryRow label="Document">
        <SummaryLink href={link} label={title} />
      </SummaryRow>
      {documentId ? <SummaryRow label="Document ID">{documentId}</SummaryRow> : null}
      {revision ? <SummaryRow label="Revision">{revision}</SummaryRow> : null}
      {previewMetadata ? <SummaryRow label="Preview">{previewMetadata}</SummaryRow> : null}
      {previewText ? <SummaryRow label="Text preview">{previewText}</SummaryRow> : null}
    </GoogleSummaryShell>
  )
}

function GoogleDocsEditSummary({
  input,
  output
}: {
  input: Record<string, unknown> | null
  output: Record<string, unknown> | null
}): JSX.Element | null {
  const edit = getRecord(output, 'edit')
  const document = getRecord(output, 'document')
  const inputOperation = getRecord(input, 'operation')
  if (!input && !edit && !document) return null

  const inputDocumentId = getString(input, 'documentId')
  const documentId = getString(edit, 'documentId') ?? getString(document, 'id') ?? inputDocumentId
  const operation =
    getString(edit, 'operation') ?? getString(inputOperation, 'type') ?? 'unknown operation'
  const title =
    getString(edit, 'title') ?? getString(document, 'title') ?? documentId ?? 'Google Doc'
  const link = getString(edit, 'link') ?? getString(document, 'link')
  const revision = getString(edit, 'revision') ?? getString(document, 'revision')
  const match = getString(inputOperation, 'match')
  const previewMetadata = formatPreviewMetadata(document)
  const textChange = formatTextChange(edit)
  const hasUpdatedDocument = Boolean(edit || document)

  return (
    <GoogleSummaryShell toolName="google_docs_edit">
      <SummaryRow label="Operation">{formatOperationName(operation)}</SummaryRow>
      {hasUpdatedDocument ? (
        <SummaryRow label="Updated document">
          <SummaryLink href={link} label={title} />
        </SummaryRow>
      ) : null}
      {documentId ? <SummaryRow label="Document ID">{documentId}</SummaryRow> : null}
      {textChange ? <SummaryRow label="Text change">{textChange}</SummaryRow> : null}
      {match ? <SummaryRow label="Match">{formatTextPreview(match, 96)}</SummaryRow> : null}
      {revision ? <SummaryRow label="Revision">{revision}</SummaryRow> : null}
      {previewMetadata ? <SummaryRow label="Updated preview">{previewMetadata}</SummaryRow> : null}
    </GoogleSummaryShell>
  )
}

function GoogleSummaryShell({
  children,
  toolName
}: {
  children: ReactNode
  toolName: GoogleWorkspaceToolName
}): JSX.Element {
  return (
    <section
      data-slot="google-workspace-tool-summary"
      data-tool-name={toolName}
      className="border border-border/60 bg-background/60 p-2.5 text-xs shadow-inner"
    >
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  )
}

function SummaryRow({ children, label }: { children: ReactNode; label: string }): JSX.Element {
  return (
    <div data-slot="google-workspace-summary-row" className="grid gap-1 sm:grid-cols-[8rem_1fr]">
      <span
        data-slot="google-workspace-summary-label"
        className="font-medium uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </span>
      <span data-slot="google-workspace-summary-value" className="min-w-0 text-foreground/90">
        {children}
      </span>
    </div>
  )
}

function FileResultList({ files }: { files: Record<string, unknown>[] }): JSX.Element {
  if (files.length === 0) {
    return (
      <div
        data-slot="google-drive-file-results"
        className="border-t border-border/50 pt-2 text-muted-foreground"
      >
        No files returned.
      </div>
    )
  }

  return (
    <ul
      data-slot="google-drive-file-results"
      className="mt-1 flex flex-col gap-1.5 border-t border-border/50 pt-2"
    >
      {files.map((file, index) => {
        const id = getString(file, 'id')
        const name = getString(file, 'name') ?? id ?? `File ${index + 1}`
        const link = getString(file, 'webViewLink')
        const mimeType = formatMimeType(getString(file, 'mimeType'))
        const modified = getString(file, 'modifiedTime')
        const metadata = [
          mimeType,
          modified ? `modified ${modified}` : null,
          id ? `id ${id}` : null
        ]
          .filter(Boolean)
          .join(' · ')

        return (
          <li key={`${id ?? name}-${index}`} className="min-w-0">
            <div className="font-medium text-foreground">
              <SummaryLink href={link} label={name} />
            </div>
            {metadata ? <div className="mt-0.5 text-muted-foreground">{metadata}</div> : null}
          </li>
        )
      })}
    </ul>
  )
}

function SummaryLink({ href, label }: { href: string | null; label: string }): JSX.Element {
  if (!href) return <span>{label}</span>

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="break-words font-medium text-foreground underline decoration-border underline-offset-2 hover:text-primary"
    >
      {label}
    </a>
  )
}

function getGoogleWorkspaceToolName(name: string): GoogleWorkspaceToolName | null {
  return Object.prototype.hasOwnProperty.call(GOOGLE_WORKSPACE_TOOL_TITLES, name)
    ? (name as GoogleWorkspaceToolName)
    : null
}

function parseJsonRecord(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null
  try {
    const value = JSON.parse(text) as unknown
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function formatPreviewMetadata(document: Record<string, unknown> | null): string | null {
  const preview = getRecord(document, 'preview')
  if (!preview) return null

  const includedBlockCount = getNumber(preview, 'includedBlockCount')
  const totalBlockCount = getNumber(preview, 'totalBlockCount')
  const totalTextLength = getNumber(preview, 'totalTextLength')
  const truncated = getBoolean(preview, 'truncated')
  const parts = [
    includedBlockCount !== null && totalBlockCount !== null
      ? `${includedBlockCount}/${totalBlockCount} blocks`
      : null,
    totalTextLength !== null ? `${totalTextLength} chars` : null,
    truncated === null ? null : truncated ? 'truncated' : 'complete'
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(' · ') : null
}

function formatTextChange(edit: Record<string, unknown> | null): string | null {
  if (!edit) return null

  const inserted = getNumber(edit, 'insertedTextLength')
  const deleted = getNumber(edit, 'deletedTextLength')
  const delta = getNumber(edit, 'textLengthDelta')
  const parts = [
    inserted !== null ? `Inserted ${inserted} chars` : null,
    deleted !== null ? `Deleted ${deleted} chars` : null,
    delta !== null ? `Delta ${formatSignedNumber(delta)}` : null
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(' · ') : null
}

function formatSignedNumber(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

function formatOperationName(operation: string): string {
  return operation.replaceAll('_', ' ')
}

function formatTextPreview(text: string | null, limit = 160): string | null {
  const normalized = text?.replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized
}

function formatMimeType(mimeType: string | null): string | null {
  if (!mimeType) return null
  if (mimeType === 'application/vnd.google-apps.document') return 'Google Docs document'
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return 'Google Sheets spreadsheet'
  if (mimeType === 'application/vnd.google-apps.presentation') return 'Google Slides presentation'
  return mimeType
}

function getRecord(
  value: Record<string, unknown> | null,
  property: string
): Record<string, unknown> | null {
  if (!value) return null
  const propertyValue = value[property]
  return isRecord(propertyValue) ? propertyValue : null
}

function getRecordArray(
  value: Record<string, unknown> | null,
  property: string
): Record<string, unknown>[] {
  if (!value || !Array.isArray(value[property])) return []
  return value[property].filter(isRecord)
}

function getString(value: Record<string, unknown> | null, property: string): string | null {
  if (!value) return null
  const propertyValue = value[property]
  return typeof propertyValue === 'string' && propertyValue.length > 0 ? propertyValue : null
}

function getNumber(value: Record<string, unknown> | null, property: string): number | null {
  if (!value) return null
  const propertyValue = value[property]
  return typeof propertyValue === 'number' && Number.isFinite(propertyValue) ? propertyValue : null
}

function getBoolean(value: Record<string, unknown> | null, property: string): boolean | null {
  if (!value) return null
  const propertyValue = value[property]
  return typeof propertyValue === 'boolean' ? propertyValue : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getToolStatusTone(status: string | undefined, hasError: boolean): ToolStatusTone {
  if (hasError || status?.toLowerCase() === 'error') return 'error'
  if (status?.toLowerCase() === 'completed') return 'completed'
  return 'updated'
}

function UnknownPart({
  part
}: {
  part: Extract<ChatMessagePart, { type: 'unknown' }>
}): JSX.Element {
  return (
    <section className="border border-dashed p-3 text-xs text-muted-foreground">
      <span className="font-medium">Unsupported part: {part.label}</span>
      <pre className="mt-2 whitespace-pre-wrap break-words font-mono">{part.text}</pre>
    </section>
  )
}

function PartBlock({
  label,
  text,
  tone = 'default'
}: {
  label: string
  text: string
  tone?: 'default' | 'error'
}): JSX.Element {
  return (
    <section
      data-slot="tool-detail-block"
      data-tone={tone}
      className={cn(
        'border bg-background/80 p-2.5 shadow-inner',
        tone === 'error' ? 'border-destructive/30 bg-destructive/5' : 'border-border/60'
      )}
    >
      <div
        data-slot="tool-detail-label"
        className={cn(
          'mb-1.5 text-xs font-medium uppercase tracking-wide',
          tone === 'error' ? 'text-destructive' : 'text-muted-foreground'
        )}
      >
        {label}
      </div>
      <pre
        data-slot="tool-detail-text"
        className={cn(
          'max-w-full overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground/90',
          tone === 'error' ? 'text-destructive' : ''
        )}
      >
        {text}
      </pre>
    </section>
  )
}
