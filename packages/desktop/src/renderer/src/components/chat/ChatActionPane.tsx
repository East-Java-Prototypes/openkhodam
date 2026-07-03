import type { JSX } from 'react'
import type { LinkedGoogleDoc } from '@openkhodam/ui/types'

import { buttonVariants } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

export function ChatActionPane({ linkedDocs }: { linkedDocs: LinkedGoogleDoc[] }): JSX.Element {
  return (
    <aside
      className="flex h-full min-h-0 min-w-0 flex-col border-l bg-sidebar/40 text-foreground"
      role="complementary"
      aria-label="Action pane"
    >
      <header className="shrink-0 px-4 py-4">
        <div className="min-w-0">
          <p className="text-muted-foreground text-sm">Linked Google Docs</p>
          <h2 id="action-pane-heading" className="text-lg font-semibold tracking-tight">
            Action pane
          </h2>
        </div>
      </header>
      <Separator />
      {linkedDocs.length > 0 ? (
        <LinkedDocList linkedDocs={linkedDocs} />
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

function LinkedDocList({ linkedDocs }: { linkedDocs: LinkedGoogleDoc[] }): JSX.Element {
  return (
    <section className="min-h-0 flex-1 overflow-y-auto p-4" aria-labelledby="linked-docs-heading">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 id="linked-docs-heading" className="text-sm font-semibold">
          Linked Google Docs
        </h3>
        <span className="text-muted-foreground text-xs">{linkedDocs.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {linkedDocs.map((doc) => (
          <LinkedDocItem key={doc.id} doc={doc} />
        ))}
      </div>
    </section>
  )
}

function LinkedDocItem({ doc }: { doc: LinkedGoogleDoc }): JSX.Element {
  const title = linkedDocTitle(doc)
  return (
    <Collapsible className="border bg-background/60" aria-label={`Linked Google Doc ${title}`}>
      <CollapsibleTrigger
        type="button"
        className={cn(
          buttonVariants({ variant: 'ghost' }),
          'h-auto w-full justify-between gap-3 px-3 py-2 text-left whitespace-normal hover:bg-background/70'
        )}
        aria-label={`Toggle linked Google Doc ${title}`}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-sm font-medium">{title}</span>
          <span className="text-muted-foreground line-clamp-2 text-xs leading-5">
            {doc.url ?? 'No Google Docs URL stored.'}
          </span>
        </span>
        <span className="text-muted-foreground shrink-0 text-xs">Preview</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t p-3">
        <div className="flex flex-col gap-3">
          {doc.url ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">Preview</p>
              <a
                href={doc.url}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ size: 'xs', variant: 'outline' }), 'w-fit')}
              >
                Open in Google Docs
              </a>
            </div>
          ) : null}
          <LinkedDocBrowserPreview title={title} sourceUrl={doc.url} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function LinkedDocBrowserPreview({
  sourceUrl,
  title
}: {
  sourceUrl: string | null
  title: string
}): JSX.Element {
  const label = `Google Docs browser preview for ${title}`
  const unavailableMessage = 'No Google Docs URL was stored, so no browser preview can be loaded.'

  return (
    <section className="overflow-hidden border bg-background/60" role="region" aria-label={label}>
      <div className="border-b px-3 py-2 text-sm">
        <p className="font-medium text-foreground">Browser preview</p>
        <p className="mt-1 break-words text-muted-foreground text-xs leading-5">
          {sourceUrl ?? unavailableMessage}
        </p>
      </div>
      {sourceUrl ? (
        <webview
          aria-label={label}
          className="h-[32rem] w-full bg-background"
          data-testid="linked-google-doc-browser-preview"
          src={sourceUrl}
          title={label}
        />
      ) : (
        <div className="border border-dashed bg-background/60 m-3 p-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No preview available</p>
          <p className="mt-2 leading-6">{unavailableMessage}</p>
        </div>
      )}
    </section>
  )
}

function linkedDocTitle(doc: LinkedGoogleDoc): string {
  return doc.title?.trim() || 'Untitled Google Doc'
}
