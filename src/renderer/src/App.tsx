import { useEffect, useMemo, useState } from 'react'
import Versions from './components/Versions'

type OpenCodeSidecarStatus = Awaited<ReturnType<Window['api']['getOpenCodeStatus']>>

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

  const restartOpenCode = async (): Promise<void> => {
    setIsRestarting(true)

    try {
      setStatus(await window.api.restartOpenCode())
    } finally {
      setIsRestarting(false)
    }
  }

  return (
    <main className="app-shell">
      <section className="status-panel" aria-live="polite">
        <div className="panel-header">
          <div>
            <p className="eyebrow">OpenKhodam</p>
            <h1>OpenCode Server</h1>
          </div>
          <span className={`status-pill ${status.state}`}>
            <span className="status-dot" />
            {statusText}
          </span>
        </div>

        <div className="connection-row">
          <div>
            <p className="label">Endpoint</p>
            <p className="value">{status.url ?? 'Waiting for port'}</p>
          </div>
          <button
            type="button"
            onClick={restartOpenCode}
            disabled={isRestarting || status.state === 'starting'}
          >
            {isRestarting ? 'Restarting' : 'Restart'}
          </button>
        </div>

        <p className="message">{status.message}</p>

        <dl className="metrics">
          <div>
            <dt>Version</dt>
            <dd>{status.version ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt>PID</dt>
            <dd>{status.pid ?? 'None'}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{updatedAt}</dd>
          </div>
        </dl>
      </section>

      <Versions />
    </main>
  )
}

export default App
