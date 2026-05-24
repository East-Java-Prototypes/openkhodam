import { useEffect, useMemo, useState } from 'react'

type OpenCodeSidecarStatus = Awaited<ReturnType<Window['api']['getOpenCodeStatus']>>
type OpenCodeConnection = Awaited<ReturnType<Window['api']['getOpenCodeConnection']>>
type OpenCodeConnectionResult = {
  updatedAt: number
  connection: OpenCodeConnection
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
        if (isMounted) setConnection({ updatedAt: status.updatedAt, connection })
      })
      .catch(() => undefined)

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

export default App
