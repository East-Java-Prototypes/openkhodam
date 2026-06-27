import { useEffect, useRef, useState, type JSX } from 'react'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

import type { ChatMessagePart } from '../../hooks/useChatInterfaceData'

type PartComponentMap = {
  [K in ChatMessagePart['type']]: (props: {
    part: Extract<ChatMessagePart, { type: K }>
  }) => JSX.Element
}

const PART_COMPONENTS = {
  text: TextPart,
  reasoning: ReasoningPart,
  status: StatusPart,
  tool: ToolPart as unknown as PartComponentMap['tool'],
  unknown: UnknownPart
} satisfies PartComponentMap

export function ChatMessageParts({ parts }: { parts: ChatMessagePart[] }): JSX.Element {
  return (
    <div className="space-y-3">
      {parts.map((part) => (
        <div key={part.id}>{renderPart(part)}</div>
      ))}
    </div>
  )
}

function renderPart(part: ChatMessagePart): JSX.Element {
  switch (part.type) {
    case 'text':
      return <PART_COMPONENTS.text part={part} />
    case 'reasoning':
      return <PART_COMPONENTS.reasoning part={part} />
    case 'status':
      return <PART_COMPONENTS.status part={part} />
    case 'tool':
      return <PART_COMPONENTS.tool part={part} />
    case 'unknown':
      return <PART_COMPONENTS.unknown part={part} />
  }
}

function TextPart({ part }: { part: Extract<ChatMessagePart, { type: 'text' }> }): JSX.Element {
  return <p className="whitespace-pre-wrap break-words leading-7">{part.text}</p>
}

function ReasoningPart({
  part
}: {
  part: Extract<ChatMessagePart, { type: 'reasoning' }>
}): JSX.Element {
  return (
    <section className="whitespace-pre-wrap border-l pl-3 text-sm leading-6 text-muted-foreground">
      {part.text}
    </section>
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
    const viewport = trigger.closest('[data-slot="scroll-area-viewport"]') as HTMLDivElement | null
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
      className={`border p-3 text-sm ${part.error ? 'border-destructive/70' : 'border-border bg-background/60'}`}
      aria-label={`Tool ${part.name}`}
      onOpenChange={handleOpenChange}
    >
      <CollapsibleTrigger
        className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
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
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{part.title ?? part.name}</span>
          {part.status ? (
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {part.status}
            </span>
          ) : null}
        </span>
        <span className="text-xs text-muted-foreground">Details</span>
      </CollapsibleTrigger>
      {part.artifact?.type === 'google.doc.document' ? (
        <GoogleDocArtifactCard artifact={part.artifact} />
      ) : null}
      <CollapsibleContent className="pt-3">
        <div className="flex flex-col gap-3">
          {part.input ? <PartBlock label="Input" text={part.input} /> : null}
          {part.output ? <PartBlock label="Output" text={part.output} /> : null}
          {part.error ? <PartBlock label="Error" text={part.error} tone="error" /> : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function GoogleDocArtifactCard({
  artifact
}: {
  artifact: NonNullable<Extract<ChatMessagePart, { type: 'tool' }>['artifact']>
}): JSX.Element {
  const title = artifact.title ?? 'Untitled Google Doc'
  const preview = artifact.text.trim() || 'No document text returned.'
  return (
    <section
      className="mt-3 rounded-lg border border-border bg-muted/30 p-3"
      aria-label={`Google Doc ${title}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Google Doc
          </div>
          {artifact.link ? (
            <a
              className="font-semibold underline-offset-4 hover:underline"
              href={artifact.link}
              target="_blank"
              rel="noreferrer"
            >
              {title}
            </a>
          ) : (
            <div className="font-semibold">{title}</div>
          )}
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>{artifact.id}</div>
          {artifact.revision ? <div>Revision {artifact.revision}</div> : null}
        </div>
      </div>
      <p className="mt-3 max-h-40 overflow-hidden whitespace-pre-wrap break-words text-sm leading-6">
        {truncateArtifactPreview(preview)}
      </p>
    </section>
  )
}

function truncateArtifactPreview(text: string): string {
  return text.length > 1200 ? `${text.slice(0, 1197)}...` : text
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
    <div>
      <div
        className={`mb-1 text-xs font-medium uppercase tracking-wide ${tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {label}
      </div>
      <pre
        className={`whitespace-pre-wrap break-words font-mono text-xs leading-5 ${tone === 'error' ? 'text-destructive' : ''}`}
      >
        {text}
      </pre>
    </div>
  )
}
