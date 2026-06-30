import { useEffect, useState, type JSX } from 'react'
import type { LinkedGoogleDoc } from '@openkhodam/ui/types'

import { Button, buttonVariants } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

export function ChatActionPane({
  linkedDocs,
  onCollapse
}: {
  linkedDocs: LinkedGoogleDoc[]
  onCollapse: () => void
}): JSX.Element {
  const [selectedDocID, setSelectedDocID] = useState<string | null>(null)
  const selectedDoc = linkedDocs.find((doc) => doc.id === selectedDocID) ?? linkedDocs[0] ?? null

  useEffect(() => {
    if (linkedDocs.length === 0) {
      setSelectedDocID(null)
      return
    }

    if (!selectedDocID || !linkedDocs.some((doc) => doc.id === selectedDocID)) {
      setSelectedDocID(linkedDocs[0]?.id ?? null)
    }
  }, [linkedDocs, selectedDocID])

  return (
    <aside
      className="flex h-full min-h-0 min-w-0 flex-col border-l bg-sidebar/40 text-foreground"
      role="complementary"
      aria-label="Action pane"
    >
      <header className="shrink-0 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-muted-foreground text-sm">Linked Google Docs</p>
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
      {linkedDocs.length > 0 ? (
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,0.9fr)_auto_minmax(0,1.1fr)]">
          <LinkedDocList
            linkedDocs={linkedDocs}
            selectedDocID={selectedDoc?.id ?? null}
            onSelect={setSelectedDocID}
          />
          <Separator />
          <LinkedDocPreview doc={selectedDoc} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <div className="border border-dashed bg-background/60 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No linked Google Docs yet.</p>
            <p className="mt-2 leading-6">
              Google Docs linked to this chat will appear here after OpenKhodam reads them.
            </p>
          </div>
        </div>
      )}
    </aside>
  )
}

function LinkedDocList({
  linkedDocs,
  selectedDocID,
  onSelect
}: {
  linkedDocs: LinkedGoogleDoc[]
  selectedDocID: string | null
  onSelect: (docID: string) => void
}): JSX.Element {
  return (
    <section className="min-h-0 overflow-y-auto p-4" aria-labelledby="linked-docs-heading">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 id="linked-docs-heading" className="text-sm font-semibold">
          Linked Google Docs
        </h3>
        <span className="text-muted-foreground text-xs">{linkedDocs.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {linkedDocs.map((doc) => (
          <Button
            key={doc.id}
            type="button"
            variant={doc.id === selectedDocID ? 'outline' : 'ghost'}
            className={cn(
              'h-auto w-full justify-start px-3 py-2 text-left whitespace-normal',
              doc.id === selectedDocID ? 'bg-background' : 'hover:bg-background/70'
            )}
            aria-label={`Select linked Google Doc ${linkedDocTitle(doc)}`}
            aria-current={doc.id === selectedDocID ? 'true' : undefined}
            onClick={() => onSelect(doc.id)}
          >
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-sm font-medium">{linkedDocTitle(doc)}</span>
              <span className="text-muted-foreground truncate text-xs">Doc ID: {doc.id}</span>
              <span className="text-muted-foreground line-clamp-2 text-xs leading-5">
                {doc.url ?? 'No Google Docs URL stored.'}
              </span>
            </span>
          </Button>
        ))}
      </div>
    </section>
  )
}

function LinkedDocPreview({ doc }: { doc: LinkedGoogleDoc | null }): JSX.Element {
  if (!doc) {
    return (
      <section className="min-h-0 p-4" aria-label="Linked Google Doc details">
        <p className="text-sm text-muted-foreground">Select a linked Google Doc to preview it.</p>
      </section>
    )
  }

  return (
    <section className="min-h-0 overflow-y-auto p-4" aria-label="Linked Google Doc details">
      <div className="mb-3">
        <p className="text-muted-foreground text-xs uppercase tracking-wide">Selected doc</p>
        <h3 className="truncate text-sm font-semibold">{linkedDocTitle(doc)}</h3>
        <p className="text-muted-foreground text-xs">Doc ID: {doc.id}</p>
      </div>
      <dl className="grid gap-2 text-sm">
        <LinkedDocDetail label="Title" value={linkedDocTitle(doc)} />
        <LinkedDocDetail label="Doc ID" value={doc.id} />
        <LinkedDocDetail label="Google Docs URL" value={doc.url ?? 'No URL stored.'} />
        <LinkedDocDetail label="First linked" value={formatLinkedDocTime(doc.firstSeenAt)} />
        <LinkedDocDetail label="Last linked" value={formatLinkedDocTime(doc.lastSeenAt)} />
      </dl>
      <div className="mt-4 flex flex-col gap-3">
        {doc.url ? (
          <a
            href={doc.url}
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ size: 'xs', variant: 'outline' }), 'w-fit')}
          >
            Open in Google Docs
          </a>
        ) : (
          <p className="text-sm text-muted-foreground">No Google Docs URL was stored.</p>
        )}
        <div className="border border-dashed bg-background/60 p-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Preview placeholder</p>
          <p className="mt-2 leading-6">
            Remote Google Docs preview is not loaded in this pane. Use the link above to open the
            document.
          </p>
        </div>
      </div>
    </section>
  )
}

function LinkedDocDetail({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="grid gap-1 border bg-background/50 p-2">
      <dt className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{label}</dt>
      <dd className="break-words text-xs leading-5">{value}</dd>
    </div>
  )
}

function linkedDocTitle(doc: LinkedGoogleDoc): string {
  return doc.title?.trim() || 'Untitled Google Doc'
}

function formatLinkedDocTime(value: number): string {
  return value > 0 ? new Date(value).toLocaleString() : 'Unknown'
}
