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
    <main>
      <h1>OpenCode Server</h1>
      <p>Status: {statusText}</p>
      <p>Message: {status.message}</p>
      <p>Endpoint: {status.url ?? 'Waiting for port'}</p>

      <dl>
        <dt>Version</dt>
        <dd>{status.version ?? 'Unknown'}</dd>

        <dt>PID</dt>
        <dd>{status.pid ?? 'None'}</dd>

        <dt>Updated</dt>
        <dd>{updatedAt}</dd>

        <dt>Renderer Origin</dt>
        <dd>{rendererOrigin}</dd>

        <dt>CORS Origins</dt>
        <dd>{connection?.corsOrigins.join(', ') || 'None'}</dd>

        <dt>Renderer HTTP</dt>
        <dd>{formatRendererHttpState(rendererHttpHealth.state)}</dd>

        <dt>Renderer HTTP Status</dt>
        <dd>{rendererHttpHealth.statusCode ?? 'None'}</dd>

        <dt>Renderer HTTP Detail</dt>
        <dd>{rendererHttpHealth.message}</dd>

        <dt>Username</dt>
        <dd>{connection?.username ?? 'Waiting'}</dd>

        <dt>Password</dt>
        <dd>{connection?.password ?? 'Waiting'}</dd>
      </dl>

      {connection ? (
        <pre>
          curl -u {connection.username}:{connection.password} {connection.url}/global/health
        </pre>
      ) : null}

      <button
        type="button"
        onClick={() => void onRestart()}
        disabled={isRestarting || status.state === 'starting'}
      >
        {isRestarting ? 'Restarting' : 'Restart'}
      </button>
    </main>
  )
}
