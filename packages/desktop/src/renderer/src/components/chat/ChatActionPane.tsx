import { useEffect, useMemo, useState, type JSX } from 'react'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

import type { ChatMessage, ChatMessagePart } from '../../hooks/useChatInterfaceData'

type ToolPart = Extract<ChatMessagePart, { type: 'tool' }>

type ChatActionArtifact = {
  id: string
  title: string
  status?: string
  messageAuthor: ChatMessage['author']
  createdAt: string
  text: string
  input?: string
  output?: string
  error?: string
}

type PreviewBlock = {
  label: string
  text: string
  tone?: 'default' | 'error'
}

export function ChatActionPane({
  messages,
  onCollapse
}: {
  messages: ChatMessage[]
  onCollapse: () => void
}): JSX.Element {
  const artifacts = useMemo(() => deriveActionArtifacts(messages), [messages])
  const [selectedArtifactID, setSelectedArtifactID] = useState<string | null>(null)
  const selectedArtifact =
    artifacts.find((artifact) => artifact.id === selectedArtifactID) ?? artifacts[0] ?? null

  useEffect(() => {
    if (artifacts.length === 0) {
      setSelectedArtifactID(null)
      return
    }

    if (!selectedArtifactID || !artifacts.some((artifact) => artifact.id === selectedArtifactID)) {
      setSelectedArtifactID(artifacts[0]?.id ?? null)
    }
  }, [artifacts, selectedArtifactID])

  return (
    <aside
      className="flex h-full min-h-0 min-w-0 flex-col border-l bg-sidebar/40 text-foreground"
      role="complementary"
      aria-label="Action pane"
    >
      <header className="shrink-0 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-muted-foreground text-sm">Chat-local</p>
            <h2 id="action-pane-heading" className="text-lg font-semibold tracking-tight">
              Action pane
            </h2>
          </div>
          <Button
            type="button"
            size="xs"
            variant="outline"
            aria-label="Collapse action pane"
            title="Collapse action pane"
            onClick={onCollapse}
          >
            Collapse
          </Button>
        </div>
      </header>
      <Separator />
      {artifacts.length > 0 ? (
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,0.9fr)_auto_minmax(0,1.1fr)]">
          <ArtifactList
            artifacts={artifacts}
            selectedArtifactID={selectedArtifact?.id ?? null}
            onSelect={setSelectedArtifactID}
          />
          <Separator />
          <ArtifactPreview artifact={selectedArtifact} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <div className="border border-dashed bg-background/60 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No artifacts yet.</p>
            <p className="mt-2 leading-6">
              Tool calls from the current chat will appear here with their input and output
              previews.
            </p>
          </div>
        </div>
      )}
    </aside>
  )
}

function ArtifactList({
  artifacts,
  selectedArtifactID,
  onSelect
}: {
  artifacts: ChatActionArtifact[]
  selectedArtifactID: string | null
  onSelect: (artifactID: string) => void
}): JSX.Element {
  return (
    <section className="min-h-0 overflow-y-auto p-4" aria-labelledby="action-artifacts-heading">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 id="action-artifacts-heading" className="text-sm font-semibold">
          Artifacts
        </h3>
        <span className="text-muted-foreground text-xs">{artifacts.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {artifacts.map((artifact) => (
          <Button
            key={artifact.id}
            type="button"
            variant={artifact.id === selectedArtifactID ? 'outline' : 'ghost'}
            className={cn(
              'h-auto w-full justify-start px-3 py-2 text-left whitespace-normal',
              artifact.id === selectedArtifactID ? 'bg-background' : 'hover:bg-background/70'
            )}
            aria-label={`Select artifact ${artifact.title}`}
            aria-current={artifact.id === selectedArtifactID ? 'true' : undefined}
            onClick={() => onSelect(artifact.id)}
          >
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex min-w-0 items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{artifact.title}</span>
                {artifact.status ? (
                  <span className="text-muted-foreground shrink-0 text-[0.65rem] uppercase tracking-wide">
                    {artifact.status}
                  </span>
                ) : null}
              </span>
              <span className="text-muted-foreground line-clamp-2 text-xs leading-5">
                {previewSummary(artifact)}
              </span>
            </span>
          </Button>
        ))}
      </div>
    </section>
  )
}

function ArtifactPreview({ artifact }: { artifact: ChatActionArtifact | null }): JSX.Element {
  if (!artifact) {
    return (
      <section className="min-h-0 p-4" aria-label="Artifact preview">
        <p className="text-sm text-muted-foreground">Select an artifact to preview it.</p>
      </section>
    )
  }

  const blocks = getPreviewBlocks(artifact)

  return (
    <section className="min-h-0 overflow-y-auto p-4" aria-label="Artifact preview">
      <div className="mb-3">
        <p className="text-muted-foreground text-xs uppercase tracking-wide">Preview</p>
        <h3 className="truncate text-sm font-semibold">{artifact.title}</h3>
        <p className="text-muted-foreground text-xs">
          {artifact.messageAuthor} message · {artifact.createdAt || 'Unknown time'}
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {blocks.map((block) => (
          <PreviewBlock key={block.label} block={block} />
        ))}
      </div>
    </section>
  )
}

function PreviewBlock({ block }: { block: PreviewBlock }): JSX.Element {
  return (
    <div>
      <div
        className={cn(
          'mb-1 text-xs font-medium uppercase tracking-wide',
          block.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'
        )}
      >
        {block.label}
      </div>
      <pre
        className={cn(
          'max-h-64 overflow-auto border bg-background/70 p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words',
          block.tone === 'error' ? 'border-destructive/60 text-destructive' : 'border-border'
        )}
      >
        {block.text}
      </pre>
    </div>
  )
}

function deriveActionArtifacts(messages: ChatMessage[]): ChatActionArtifact[] {
  return messages.flatMap((message) =>
    message.parts.flatMap((part) =>
      part.type === 'tool' ? [toolPartToArtifact(message, part)] : []
    )
  )
}

function toolPartToArtifact(message: ChatMessage, part: ToolPart): ChatActionArtifact {
  const title = part.title ?? part.name
  return {
    id: `${message.id}:${part.id}`,
    title,
    status: part.status,
    messageAuthor: message.author,
    createdAt: message.createdAt,
    text: [`Tool: ${title}`, part.status ? `Status: ${part.status}` : null]
      .filter(Boolean)
      .join('\n'),
    input: part.input,
    output: part.output,
    error: part.error
  }
}

function getPreviewBlocks(artifact: ChatActionArtifact): PreviewBlock[] {
  const blocks: PreviewBlock[] = [{ label: 'Text', text: artifact.text }]
  if (artifact.input) blocks.push({ label: 'Input', text: artifact.input })
  if (artifact.output) blocks.push({ label: 'Output', text: artifact.output })
  if (artifact.error) blocks.push({ label: 'Error', text: artifact.error, tone: 'error' })
  return blocks
}

function previewSummary(artifact: ChatActionArtifact): string {
  const preview = firstText(artifact.output, artifact.error, artifact.input, artifact.text)
  return `${artifact.messageAuthor} · ${artifact.createdAt || 'Unknown time'} · ${preview}`
}

function firstText(...values: Array<string | undefined>): string {
  const value = values.find((item) => item && item.trim().length > 0) ?? ''
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > 96 ? `${compact.slice(0, 93)}…` : compact
}
