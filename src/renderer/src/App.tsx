import { useEffect, useMemo, useState } from 'react'

type OpenCodeSidecarStatus = Awaited<ReturnType<Window['api']['getOpenCodeStatus']>>
type RendererHealth = 'waiting' | 'checking' | 'connected' | 'error'
type RendererHealthResult = {
  updatedAt: number
  health: Extract<RendererHealth, 'connected' | 'error'>
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
  const [rendererHealth, setRendererHealth] = useState<RendererHealthResult | null>(null)
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

    window.api
      .getOpenCodeConnection()
      .then(async (connection) => {
        const response = await fetch(`${connection.url}/global/health`, {
          headers: {
            authorization: `Basic ${btoa(`${connection.username}:${connection.password}`)}`
          }
        })

        if (!response.ok) throw new Error(`Health check failed with ${response.status}.`)
        const data = (await response.json()) as { healthy?: boolean }
        if (!data.healthy) throw new Error('OpenCode health check returned unhealthy.')
        if (isMounted) setRendererHealth({ updatedAt: status.updatedAt, health: 'connected' })
      })
      .catch(() => {
        if (isMounted) setRendererHealth({ updatedAt: status.updatedAt, health: 'error' })
      })

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

  const displayedRendererHealth = useMemo((): RendererHealth => {
    if (status.state !== 'connected') return 'waiting'
    if (rendererHealth?.updatedAt !== status.updatedAt) return 'checking'
    return rendererHealth.health
  }, [rendererHealth, status.state, status.updatedAt])

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

        <dt>Renderer HTTP</dt>
        <dd>{formatRendererHealth(displayedRendererHealth)}</dd>
      </dl>

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

function formatRendererHealth(health: RendererHealth): string {
  switch (health) {
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

export default App
