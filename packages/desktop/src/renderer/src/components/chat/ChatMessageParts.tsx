import { useEffect, useRef, useState, type JSX } from 'react'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

import type { ChatMessage, ChatMessagePart } from '../../hooks/useChatInterfaceData'
import { MarkdownText } from './MarkdownText'

type ChatMessageAuthor = ChatMessage['author']
type ToolStatusTone = 'completed' | 'error' | 'updated'

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
              {part.title ?? part.name}
            </span>
            {part.title ? (
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
          {part.input ? <PartBlock label="Input" text={part.input} /> : null}
          {part.output ? <PartBlock label="Output" text={part.output} /> : null}
          {part.error ? <PartBlock label="Error" text={part.error} tone="error" /> : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
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
