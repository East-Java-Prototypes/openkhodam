import { createOpenKhodamClient, type OpenKhodamClient } from '@openkhodam/client'
import type { ConnectionInfo } from '@openkhodam/protocol'
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

type OpenKhodamClientContextValue = {
  client: OpenKhodamClient | null
  connection: ConnectionInfo | null
  connectionRevision: number
  health: 'idle' | 'ok' | 'error'
}

const OpenKhodamClientContext = createContext<OpenKhodamClientContextValue | null>(null)

export function OpenKhodamClientProvider({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<ConnectionInfo | null>(null)
  const [connectionRevision, setConnectionRevision] = useState(0)
  const [health, setHealth] = useState<OpenKhodamClientContextValue['health']>('idle')
  const connectedUpdatedAt = useRef<number | null>(null)

  useEffect(() => {
    let active = true
    const observeStatus = () => {
      void window.api.getOpenKhodamStatus().then((status) => {
        if (
          !active ||
          status.state !== 'connected' ||
          status.updatedAt === connectedUpdatedAt.current
        )
          return
        connectedUpdatedAt.current = status.updatedAt
        setConnectionRevision((revision) => revision + 1)
        void window.api.getOpenKhodamConnection().then((next) => active && setConnection(next))
      })
    }
    observeStatus()
    const unsubscribe = window.api.onOpenKhodamStatus(observeStatus)
    const poll = window.setInterval(observeStatus, 1_000)
    return () => {
      active = false
      window.clearInterval(poll)
      unsubscribe()
    }
  }, [])

  const client = useMemo(
    () => (connection ? createOpenKhodamClient(connection) : null),
    [connection]
  )

  useEffect(() => {
    if (!client) return
    let active = true
    setHealth('idle')
    void client.health().then(
      () => active && setHealth('ok'),
      () => active && setHealth('error')
    )
    return () => {
      active = false
    }
  }, [client, connectionRevision])

  const value = useMemo(
    () => ({ client, connection, connectionRevision, health }),
    [client, connection, connectionRevision, health]
  )
  return (
    <OpenKhodamClientContext.Provider value={value}>{children}</OpenKhodamClientContext.Provider>
  )
}

export function useOpenKhodamClient(): OpenKhodamClientContextValue {
  const value = useContext(OpenKhodamClientContext)
  if (!value)
    throw new Error('useOpenKhodamClient must be used within an OpenKhodamClientProvider.')
  return value
}
