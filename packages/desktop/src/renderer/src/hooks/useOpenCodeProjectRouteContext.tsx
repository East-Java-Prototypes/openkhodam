import { createContext, type ReactNode, useContext } from 'react'

import type { OpenCodeProjectRouteState } from './useOpenCodeChatInterface'

const OpenCodeProjectRouteContext = createContext<OpenCodeProjectRouteState | null>(null)

export function OpenCodeProjectRouteProvider({ project, children }: { project: OpenCodeProjectRouteState; children: ReactNode }) {
  return <OpenCodeProjectRouteContext.Provider value={project}>{children}</OpenCodeProjectRouteContext.Provider>
}

export function useOpenCodeProjectRouteContext(): OpenCodeProjectRouteState {
  const project = useContext(OpenCodeProjectRouteContext)
  if (!project) throw new Error('useOpenCodeProjectRouteContext must be used within an OpenCodeProjectRouteProvider.')
  return project
}
