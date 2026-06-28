import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type {
  WorkspaceResource,
  WorkspaceResourceAttachGoogleDocInput,
  WorkspaceResourcesConfig,
  WorkspaceSessionActiveResourceInput
} from '@openkhodam/ui/types'

type AttachGoogleDocDraft = Omit<WorkspaceResourceAttachGoogleDocInput, 'projectDirectory'>

export type WorkspaceResourcesState = {
  config: WorkspaceResourcesConfig
  resources: WorkspaceResource[]
  defaultResource: WorkspaceResource | null
  isLoading: boolean
  isAttaching: boolean
  isSettingActiveResource: boolean
  errorMessage: string | null
  attachErrorMessage: string | null
  setActiveErrorMessage: string | null
  attachGoogleDoc: (input: AttachGoogleDocDraft) => Promise<WorkspaceResourcesConfig>
  setSessionActiveResource: (
    sessionId: string,
    activeResource: WorkspaceSessionActiveResourceInput['activeResource']
  ) => Promise<WorkspaceResourcesConfig>
  getSessionActiveResource: (sessionId: string | null | undefined) => WorkspaceResource | null
  getSessionActiveResourceAlias: (sessionId: string | null | undefined) => string
}

const emptyWorkspaceResourcesConfig: WorkspaceResourcesConfig = {
  version: 1,
  resources: [],
  defaultResource: null,
  sessions: {}
}

export function workspaceResourcesQueryKey(projectDirectory: string | null | undefined) {
  return ['workspace-resources', projectDirectory ?? null] as const
}

export function useWorkspaceResources(
  projectDirectory: string | null | undefined
): WorkspaceResourcesState {
  const queryClient = useQueryClient()
  const queryKey = workspaceResourcesQueryKey(projectDirectory)

  const resourcesQuery = useQuery({
    queryKey,
    queryFn: async (): Promise<WorkspaceResourcesConfig> => {
      return window.api.getWorkspaceResources(projectDirectory!)
    },
    enabled: Boolean(projectDirectory)
  })
  const attachMutation = useMutation({
    mutationFn: async (input: AttachGoogleDocDraft): Promise<WorkspaceResourcesConfig> => {
      if (!projectDirectory) {
        throw new Error('Open a project before attaching Google Docs.')
      }

      return window.api.attachWorkspaceGoogleDoc({ ...input, projectDirectory })
    },
    onSuccess: (config) => {
      queryClient.setQueryData(queryKey, config)
    }
  })
  const setActiveMutation = useMutation({
    mutationFn: async (input: {
      activeResource: WorkspaceSessionActiveResourceInput['activeResource']
      sessionId: string
    }): Promise<WorkspaceResourcesConfig> => {
      if (!projectDirectory) {
        throw new Error('Open a project before selecting an active Google Doc.')
      }

      return window.api.setWorkspaceSessionActiveResource({ ...input, projectDirectory })
    },
    onSuccess: (config) => {
      queryClient.setQueryData(queryKey, config)
    }
  })
  const config = resourcesQuery.data ?? emptyWorkspaceResourcesConfig
  const resourceByAlias = useMemo(
    () => new Map(config.resources.map((resource) => [resource.alias, resource])),
    [config.resources]
  )
  const defaultResource = config.defaultResource
    ? (resourceByAlias.get(config.defaultResource) ?? null)
    : null
  const getSessionActiveResourceAlias = useCallback(
    (sessionId: string | null | undefined): string => {
      if (!sessionId) return ''
      return config.sessions[sessionId]?.activeResource ?? ''
    },
    [config]
  )
  const getSessionActiveResource = useCallback(
    (sessionId: string | null | undefined): WorkspaceResource | null => {
      const alias = getSessionActiveResourceAlias(sessionId) || config.defaultResource || ''
      return alias ? (resourceByAlias.get(alias) ?? null) : null
    },
    [config.defaultResource, getSessionActiveResourceAlias, resourceByAlias]
  )
  const attachGoogleDoc = useCallback(
    (input: AttachGoogleDocDraft): Promise<WorkspaceResourcesConfig> => {
      return attachMutation.mutateAsync(input)
    },
    [attachMutation]
  )
  const setSessionActiveResource = useCallback(
    (
      sessionId: string,
      activeResource: WorkspaceSessionActiveResourceInput['activeResource']
    ): Promise<WorkspaceResourcesConfig> => {
      return setActiveMutation.mutateAsync({ sessionId, activeResource })
    },
    [setActiveMutation]
  )

  return {
    config,
    resources: config.resources,
    defaultResource,
    isLoading: resourcesQuery.isLoading,
    isAttaching: attachMutation.isPending,
    isSettingActiveResource: setActiveMutation.isPending,
    errorMessage: formatUnknownError(resourcesQuery.error),
    attachErrorMessage: formatUnknownError(attachMutation.error),
    setActiveErrorMessage: formatUnknownError(setActiveMutation.error),
    attachGoogleDoc,
    setSessionActiveResource,
    getSessionActiveResource,
    getSessionActiveResourceAlias
  }
}

function formatUnknownError(error: unknown): string | null {
  if (!error) return null
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (!isRecord(error)) return String(error)
  const message = getStringFromRecord(error, 'message') ?? getStringFromRecord(error, 'detail')
  if (message) return message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function getStringFromRecord(value: Record<string, unknown>, property: string): string | null {
  const propertyValue = value[property]
  return typeof propertyValue === 'string' && propertyValue.length > 0 ? propertyValue : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
