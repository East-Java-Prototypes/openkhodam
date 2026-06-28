import type { JSX } from 'react'

import type { OpenCodeConnection, OpenCodeSidecarStatus, RendererHttpHealthSnapshot } from './types'
import { formatOpenCodeStatus, formatRendererHttpState, formatUpdatedAt } from './formatters'

export type OpenCodeServerViewProps = {
  status: OpenCodeSidecarStatus
  connection: OpenCodeConnection | null
  rendererHttpHealth: RendererHttpHealthSnapshot
  rendererOrigin: string
  isRestarting: boolean
  onRestart: () => void | Promise<void>
}

export function OpenCodeServerView({
  status,
  connection,
  rendererHttpHealth,
  rendererOrigin,
  isRestarting,
  onRestart
}: OpenCodeServerViewProps): JSX.Element {
  const statusText = formatOpenCodeStatus(status.state)
  const updatedAt = formatUpdatedAt(status.updatedAt)

  return (
    <section
      className="border bg-card p-4 text-card-foreground shadow-sm"
      aria-labelledby="opencode-server-heading"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Local sidecar
            </p>
            <h2 id="opencode-server-heading" className="text-lg font-semibold tracking-tight">
              OpenCode Server
            </h2>
          </div>
          <div className="grid gap-1 text-sm text-muted-foreground">
            <p>Status: {statusText}</p>
            <p>Message: {status.message}</p>
            <p className="break-all">Endpoint: {status.url ?? 'Waiting for port'}</p>
          </div>
        </div>

        <button
          className="inline-flex h-8 shrink-0 items-center justify-center border border-border bg-background px-2.5 text-xs font-medium transition-all outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50"
          type="button"
          onClick={() => void onRestart()}
          disabled={isRestarting || status.state === 'starting'}
        >
          {isRestarting ? 'Restarting' : 'Restart'}
        </button>
      </div>

      <dl className="mt-4 grid gap-3 border-t pt-4 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
        <dt className="text-muted-foreground font-medium">Version</dt>
        <dd className="min-w-0 break-words">{status.version ?? 'Unknown'}</dd>

        <dt className="text-muted-foreground font-medium">PID</dt>
        <dd>{status.pid ?? 'None'}</dd>

        <dt className="text-muted-foreground font-medium">Updated</dt>
        <dd>{updatedAt}</dd>

        <dt className="text-muted-foreground font-medium">Renderer Origin</dt>
        <dd className="min-w-0 break-all">{rendererOrigin}</dd>

        <dt className="text-muted-foreground font-medium">CORS Origins</dt>
        <dd className="min-w-0 break-all">{connection?.corsOrigins.join(', ') || 'None'}</dd>

        <dt className="text-muted-foreground font-medium">Renderer HTTP</dt>
        <dd>{formatRendererHttpState(rendererHttpHealth.state)}</dd>

        <dt className="text-muted-foreground font-medium">Renderer HTTP Status</dt>
        <dd>{rendererHttpHealth.statusCode ?? 'None'}</dd>

        <dt className="text-muted-foreground font-medium">Renderer HTTP Detail</dt>
        <dd className="min-w-0 break-words">{rendererHttpHealth.message}</dd>

        <dt className="text-muted-foreground font-medium">Username</dt>
        <dd>{connection?.username ?? 'Waiting'}</dd>

        <dt className="text-muted-foreground font-medium">Password</dt>
        <dd>{connection ? 'Hidden' : 'Waiting'}</dd>
      </dl>

      {connection ? (
        <div className="mt-4 border-t pt-4">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Health check command
          </p>
          <pre className="mt-2 overflow-x-auto border bg-background p-3 text-xs">
            curl -u {connection.username}:{'<password>'} {connection.url}/global/health
          </pre>
        </div>
      ) : null}
    </section>
  )
}
