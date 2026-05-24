import { useEffect, useMemo, useState } from 'react'

type OpenCodeSidecarStatus = Awaited<ReturnType<Window['api']['getOpenCodeStatus']>>
type OpenCodeConnection = Awaited<ReturnType<Window['api']['getOpenCodeConnection']>>
type OpenCodeConnectionResult = {
  updatedAt: number
  connection: OpenCodeConnection
}
type RendererHttpHealthState = 'waiting' | 'checking' | 'connected' | 'error'
type RendererHttpHealth = {
  updatedAt: number
  state: RendererHttpHealthState
  statusCode: number | null
  message: string
}

const initialStatus: OpenCodeSidecarStatus = {
  state: 'starting',
  url: null,
  version: null,
  pid: null,
  message: 'Checking OpenCode sidecar...',
  updatedAt: Date.now()
}

function App(): React.JSX.Element {
  const [status, setStatus] = useState<OpenCodeSidecarStatus>(initialStatus)
  const [connection, setConnection] = useState<OpenCodeConnectionResult | null>(null)
  const [rendererHttpHealth, setRendererHttpHealth] = useState<RendererHttpHealth | null>(null)
  const [isRestarting, setIsRestarting] = useState(false)

  useEffect(() => {
    let isMounted = true

    window.api.getOpenCodeStatus().then((next) => {
      if (isMounted) setStatus(next)
    })

    const unsubscribe = window.api.onOpenCodeStatus((next) => {
      if (isMounted) setStatus(next)
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (status.state !== 'connected') return

    let isMounted = true

    void (async () => {
      try {
        const connection = await window.api.getOpenCodeConnection()
        if (!isMounted) return

        setConnection({ updatedAt: status.updatedAt, connection })
        setRendererHttpHealth({
          updatedAt: status.updatedAt,
          state: 'checking',
          statusCode: null,
          message: 'Checking OpenCode from the renderer process...'
        })

        const result = await checkRendererHttpHealth(connection)
        if (isMounted) setRendererHttpHealth({ updatedAt: status.updatedAt, ...result })
      } catch (error) {
        if (!isMounted) return

        setRendererHttpHealth({
          updatedAt: status.updatedAt,
          state: 'error',
          statusCode: null,
          message: formatRendererHttpError(error)
        })
      }
    })()

    return () => {
      isMounted = false
    }
  }, [status.state, status.updatedAt])

  const statusText = useMemo(() => {
    switch (status.state) {
      case 'connected':
        return 'Connected'
      case 'starting':
        return 'Starting'
      case 'stopped':
        return 'Stopped'
      case 'error':
        return 'Disconnected'
    }
  }, [status.state])

  const updatedAt = useMemo(() => {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit'
    }).format(new Date(status.updatedAt))
  }, [status.updatedAt])

  const displayedConnection = useMemo((): OpenCodeConnection | null => {
    if (status.state !== 'connected') return null
    if (connection?.updatedAt !== status.updatedAt) return null
    return connection.connection
  }, [connection, status.state, status.updatedAt])

  const displayedRendererHttpHealth = useMemo((): Omit<RendererHttpHealth, 'updatedAt'> => {
    if (status.state !== 'connected') {
      return { state: 'waiting', statusCode: null, message: 'Waiting for OpenCode.' }
    }

    if (rendererHttpHealth?.updatedAt !== status.updatedAt) {
      return {
        state: 'checking',
        statusCode: null,
        message: 'Checking OpenCode from the renderer process...'
      }
    }

    return rendererHttpHealth
  }, [rendererHttpHealth, status.state, status.updatedAt])

  const restartOpenCode = async (): Promise<void> => {
    setIsRestarting(true)

    try {
      setStatus(await window.api.restartOpenCode())
    } finally {
      setIsRestarting(false)
    }
  }

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
        <dd>{window.location.origin}</dd>

        <dt>CORS Origins</dt>
        <dd>{displayedConnection?.corsOrigins.join(', ') || 'None'}</dd>

        <dt>Renderer HTTP</dt>
        <dd>{formatRendererHttpState(displayedRendererHttpHealth.state)}</dd>

        <dt>Renderer HTTP Status</dt>
        <dd>{displayedRendererHttpHealth.statusCode ?? 'None'}</dd>

        <dt>Renderer HTTP Detail</dt>
        <dd>{displayedRendererHttpHealth.message}</dd>

        <dt>Username</dt>
        <dd>{displayedConnection?.username ?? 'Waiting'}</dd>

        <dt>Password</dt>
        <dd>{displayedConnection?.password ?? 'Waiting'}</dd>
      </dl>

      {displayedConnection ? (
        <pre>
          curl -u {displayedConnection.username}:{displayedConnection.password}{' '}
          {displayedConnection.url}/global/health
        </pre>
      ) : null}

      <button
        type="button"
        onClick={restartOpenCode}
        disabled={isRestarting || status.state === 'starting'}
      >
        {isRestarting ? 'Restarting' : 'Restart'}
      </button>
    </main>
  )
}

async function checkRendererHttpHealth(
  connection: OpenCodeConnection
): Promise<Omit<RendererHttpHealth, 'updatedAt'>> {
  try {
    const response = await fetch(`${connection.url}/global/health`, {
      headers: {
        authorization: `Basic ${btoa(`${connection.username}:${connection.password}`)}`
      }
    })
    const body = await readResponseJson(response)

    if (!response.ok) {
      return {
        state: 'error',
        statusCode: response.status,
        message: `OpenCode returned HTTP ${response.status}.`
      }
    }

    if (!body.healthy) {
      return {
        state: 'error',
        statusCode: response.status,
        message: 'OpenCode health check returned unhealthy.'
      }
    }

    return {
      state: 'connected',
      statusCode: response.status,
      message: `OpenCode renderer HTTP health check passed${
        body.version ? ` (${body.version})` : ''
      }.`
    }
  } catch (error) {
    return {
      state: 'error',
      statusCode: null,
      message: formatRendererHttpError(error)
    }
  }
}

async function readResponseJson(
  response: Response
): Promise<{ healthy?: boolean; version?: string }> {
  try {
    return (await response.json()) as { healthy?: boolean; version?: string }
  } catch {
    return {}
  }
}

function formatRendererHttpState(state: RendererHttpHealthState): string {
  switch (state) {
    case 'connected':
      return 'Connected'
    case 'checking':
      return 'Checking'
    case 'error':
      return 'Failed'
    case 'waiting':
      return 'Waiting'
  }
}

function formatRendererHttpError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  if (message.includes('Failed to fetch')) {
    return `${message}. Check that CORS Origins includes ${window.location.origin}.`
  }

  return message
}

export default App
