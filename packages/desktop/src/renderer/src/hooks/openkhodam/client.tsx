import { createOpenKhodamClient, type OpenKhodamClient } from '@openkhodam/client'
import type { ConnectionInfo } from '@openkhodam/protocol'
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'

type OpenKhodamClientContextValue = {
  client: OpenKhodamClient | null
  connection: ConnectionInfo | null
  health: 'idle' | 'ok' | 'error'
}

const OpenKhodamClientContext = createContext<OpenKhodamClientContextValue | null>(null)

export function OpenKhodamClientProvider({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<ConnectionInfo | null>(null)
  const [health, setHealth] = useState<OpenKhodamClientContextValue['health']>('idle')

  useEffect(() => {
    let active = true
    void window.api
      .getOpenKhodamConnection()
      .then((next) => {
        if (active) setConnection(next)
      })
      .catch(() => undefined)
    return () => {
      active = false
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
  }, [client])

  const value = useMemo(() => ({ client, connection, health }), [client, connection, health])
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
