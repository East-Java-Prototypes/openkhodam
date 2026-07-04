import type { JSX } from 'react'
import type { LinkedGoogleDoc } from '@openkhodam/ui/types'
import { ExternalLinkIcon, EyeIcon } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

export function ChatActionPane({ linkedDocs }: { linkedDocs: LinkedGoogleDoc[] }): JSX.Element {
  return (
    <aside
      className="flex h-full min-h-0 min-w-0 flex-col border-l bg-sidebar/40 text-foreground"
      role="complementary"
      aria-label="Action pane"
    >
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
    <section className="min-h-0 flex-1 overflow-y-auto p-4" aria-label="Linked Google Docs">
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
  const toggleLabel = `Toggle linked Google Doc ${title}`
  const previewToggleLabel = `Toggle linked Google Doc preview ${title}`
  const openLabel = `Open linked Google Doc ${title} in Google Docs`

  return (
    <Collapsible className="border bg-background/60" aria-label={`Linked Google Doc ${title}`}>
      <div className="flex items-stretch">
        <CollapsibleTrigger
          type="button"
          className={cn(
            buttonVariants({ variant: 'ghost' }),
            'h-auto min-w-0 flex-1 justify-start px-3 py-2 text-left whitespace-normal hover:bg-background/70'
          )}
          aria-label={toggleLabel}
          title={toggleLabel}
        >
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-sm font-medium">{title}</span>
            <span className="text-muted-foreground line-clamp-2 text-xs leading-5">
              {doc.url ?? 'No Google Docs URL stored.'}
            </span>
          </span>
        </CollapsibleTrigger>
        <div className="flex shrink-0 items-stretch border-l">
          <CollapsibleTrigger
            type="button"
            className={cn(buttonVariants({ size: 'icon-xs', variant: 'ghost' }), 'h-auto min-h-10')}
            aria-label={previewToggleLabel}
            title={previewToggleLabel}
          >
            <EyeIcon aria-hidden="true" />
          </CollapsibleTrigger>
          {doc.url ? (
            <a
              href={doc.url}
              target="_blank"
              rel="noreferrer"
              aria-label={openLabel}
              title={openLabel}
              className={cn(
                buttonVariants({ size: 'icon-xs', variant: 'ghost' }),
                'h-auto min-h-10 border-l'
              )}
            >
              <ExternalLinkIcon aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </div>
      <CollapsibleContent className="border-t">
        <LinkedDocBrowserPreview title={title} sourceUrl={doc.url} />
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
    <section className="overflow-hidden bg-background/60" role="region" aria-label={label}>
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
