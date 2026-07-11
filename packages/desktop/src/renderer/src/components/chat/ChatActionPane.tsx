import type { JSX } from 'react'
import type { LinkedGoogleArtifact, LinkedGoogleArtifactType } from '@openkhodam/ui/types'
import { ExternalLinkIcon, EyeIcon } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

type LinkedGoogleArtifactDisplay = {
  browserPreviewTestId: string
  productName: string
  singularName: string
}

const linkedGoogleArtifactDisplays: Record<LinkedGoogleArtifactType, LinkedGoogleArtifactDisplay> =
  {
    'google.doc.document': {
      browserPreviewTestId: 'linked-google-doc-browser-preview',
      productName: 'Google Docs',
      singularName: 'Google Doc'
    },
    'google.sheet.spreadsheet': {
      browserPreviewTestId: 'linked-google-sheet-browser-preview',
      productName: 'Google Sheets',
      singularName: 'Google Sheet'
    }
  }

export function ChatActionPane({
  linkedGoogleArtifacts
}: {
  linkedGoogleArtifacts: LinkedGoogleArtifact[]
}): JSX.Element {
  return (
    <aside
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l bg-sidebar/40 text-foreground"
      role="complementary"
      aria-label="Action pane"
    >
      {linkedGoogleArtifacts.length > 0 ? (
        <LinkedGoogleArtifactList linkedGoogleArtifacts={linkedGoogleArtifacts} />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <div className="border border-dashed bg-background/60 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No linked Google Workspace artifacts yet.</p>
            <p className="mt-2 leading-6">
              Google Docs and Sheets linked to this chat will appear here after OpenKhodam reads
              them.
            </p>
          </div>
        </div>
      )}
    </aside>
  )
}

function LinkedGoogleArtifactList({
  linkedGoogleArtifacts
}: {
  linkedGoogleArtifacts: LinkedGoogleArtifact[]
}): JSX.Element {
  return (
    <section
      className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto"
      aria-label="Linked Google Workspace artifacts"
    >
      <div className="flex min-h-full flex-col gap-2">
        {linkedGoogleArtifacts.map((artifact) => (
          <LinkedGoogleArtifactItem key={`${artifact.type}:${artifact.id}`} artifact={artifact} />
        ))}
      </div>
    </section>
  )
}

function LinkedGoogleArtifactItem({ artifact }: { artifact: LinkedGoogleArtifact }): JSX.Element {
  const display = linkedGoogleArtifactDisplays[artifact.type]
  const title = linkedGoogleArtifactTitle(artifact, display)
  const toggleLabel = `Toggle linked ${display.singularName} ${title}`
  const previewToggleLabel = `Toggle linked ${display.singularName} preview ${title}`
  const openLabel = `Open linked ${display.singularName} ${title} in ${display.productName}`

  return (
    <Collapsible
      className="min-h-0 border bg-background/60 data-[open]:flex-1 data-[open]:flex data-[open]:flex-col"
      aria-label={`Linked ${display.singularName} ${title}`}
    >
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
              {artifact.url ?? `No ${display.productName} URL stored.`}
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
          {artifact.url ? (
            <a
              href={artifact.url}
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
      <CollapsibleContent className="flex min-h-0 flex-1 flex-col border-t">
        <LinkedGoogleArtifactBrowserPreview
          display={display}
          title={title}
          sourceUrl={artifact.url}
        />
      </CollapsibleContent>
    </Collapsible>
  )
}

function LinkedGoogleArtifactBrowserPreview({
  display,
  sourceUrl,
  title
}: {
  display: LinkedGoogleArtifactDisplay
  sourceUrl: string | null
  title: string
}): JSX.Element {
  const label = `${display.productName} browser preview for ${title}`
  const unavailableMessage = `No ${display.productName} URL was stored, so no browser preview can be loaded.`

  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background/60"
      role="region"
      aria-label={label}
    >
      {sourceUrl ? (
        <webview
          aria-label={label}
          className="h-full min-h-0 w-full flex-1 bg-background"
          data-testid={display.browserPreviewTestId}
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

function linkedGoogleArtifactTitle(
  artifact: LinkedGoogleArtifact,
  display: LinkedGoogleArtifactDisplay
): string {
  return artifact.title?.trim() || `Untitled ${display.singularName}`
}
