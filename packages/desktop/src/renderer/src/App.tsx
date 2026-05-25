import { useEffect, useMemo, useState, type JSX } from 'react'
import {
  OpenCodeServerView,
  type OpenCodeConnection,
  type OpenCodeSidecarStatus,
  type RendererHttpHealthSnapshot
} from '@openkhodam/ui'

type OpenCodeConnectionResult = {
  updatedAt: number
  connection: OpenCodeConnection
}

type RendererHttpHealth = RendererHttpHealthSnapshot & {
  updatedAt: number
}

const initialStatus: OpenCodeSidecarStatus = {
  state: 'starting',
  url: null,
  version: null,
  pid: null,
  message: 'Checking OpenCode sidecar...',
  updatedAt: Date.now()
}

function App(): JSX.Element {
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

  const displayedConnection = useMemo((): OpenCodeConnection | null => {
    if (status.state !== 'connected') return null
    if (connection?.updatedAt !== status.updatedAt) return null
    return connection.connection
  }, [connection, status.state, status.updatedAt])

  const displayedRendererHttpHealth = useMemo((): RendererHttpHealthSnapshot => {
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
    <OpenCodeServerView
      status={status}
      connection={displayedConnection}
      rendererHttpHealth={displayedRendererHttpHealth}
      rendererOrigin={window.location.origin}
      isRestarting={isRestarting}
      onRestart={restartOpenCode}
    />
  )
}

async function checkRendererHttpHealth(
  connection: OpenCodeConnection
): Promise<RendererHttpHealthSnapshot> {
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

function formatRendererHttpError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  if (message.includes('Failed to fetch')) {
    return `${message}. Check that CORS Origins includes ${window.location.origin} and renderer CSP allows the OpenCode endpoint.`
  }

  return message
}

export default App
