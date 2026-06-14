import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { useOpenCodeSdk, type createOpenCodeClient } from './opencode/client'
import { openCodeQueryKeys } from './opencode/sidecar'

type OpenCodeClient = ReturnType<typeof createOpenCodeClient>
type ProviderListResponse = NonNullable<
  Awaited<ReturnType<OpenCodeClient['provider']['list']>>['data']
>

export type OpenCodeModelSelection = {
  providerID: string
  modelID: string
}

export type OpenCodeModelOption = OpenCodeModelSelection & {
  id: string
  label: string
  providerName: string
  modelName: string
}

export function modelOptionID(model: OpenCodeModelSelection): string {
  return `${model.providerID}/${model.modelID}`
}

export function useOpenCodeModels(directory: string | null | undefined) {
  const { status, statusQuery, connection, connectionQuery, client } = useOpenCodeSdk()
  const [selectedModelID, setSelectedModelID] = useState<string | null>(null)

  const modelsQuery = useQuery({
    queryKey: [
      ...openCodeQueryKeys.all,
      'providers',
      status.url,
      status.pid,
      status.updatedAt,
      directory
    ],
    queryFn: async (): Promise<ProviderListResponse> => {
      const response = await client!.provider.list({ directory: directory! })
      if (response.error) throw response.error
      return response.data!
    },
    enabled: client !== null && Boolean(directory)
  })

  const options = useMemo(() => normalizeModelOptions(modelsQuery.data), [modelsQuery.data])
  const defaultModelID = useMemo(
    () => getDefaultModelID(modelsQuery.data, options),
    [modelsQuery.data, options]
  )
  const selectedModel = options.find((option) => option.id === selectedModelID) ?? null

  useEffect(() => {
    setSelectedModelID((current) => {
      if (current && options.some((option) => option.id === current)) return current
      return defaultModelID ?? options[0]?.id ?? null
    })
  }, [defaultModelID, options])

  return {
    status,
    statusQuery,
    connection,
    connectionQuery,
    modelsQuery,
    options,
    selectedModel,
    selectedModelID,
    setSelectedModelID,
    isLoading: modelsQuery.isLoading,
    errorMessage: modelsQuery.error ? formatUnknownError(modelsQuery.error) : null,
    helperText: getModelHelperText(modelsQuery.isLoading, options.length, selectedModel)
  }
}

function normalizeModelOptions(data: ProviderListResponse | undefined): OpenCodeModelOption[] {
  if (!isRecord(data)) return []
  const connected = new Set(getStringArray(data.connected))
  return getArray(data.all)
    .filter(
      (provider): provider is Record<string, unknown> =>
        isRecord(provider) && connected.has(getString(provider.id))
    )
    .flatMap((provider) =>
      Object.values(isRecord(provider.models) ? provider.models : {})
        .filter(isRecord)
        .map((model) => {
          const providerID = getString(provider.id)
          const modelID = getString(model.id)
          const providerName = getString(provider.name) || providerID
          const modelName = getString(model.name) || modelID
          return {
            id: `${providerID}/${modelID}`,
            providerID,
            modelID,
            providerName,
            modelName,
            label: `${providerName} · ${modelName}`
          }
        })
        .filter((option) => option.providerID.length > 0 && option.modelID.length > 0)
    )
}

function getDefaultModelID(
  data: ProviderListResponse | undefined,
  options: OpenCodeModelOption[]
): string | null {
  if (!isRecord(data)) return null
  const connected = new Set(getStringArray(data.connected))
  const defaults = isRecord(data.default) ? data.default : {}
  for (const providerID of connected) {
    const modelID = getString(defaults[providerID])
    if (!modelID) continue
    const id = `${providerID}/${modelID}`
    if (options.some((option) => option.id === id)) return id
  }
  return null
}

function getArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function getStringArray(value: unknown): string[] {
  return getArray(value).filter((item): item is string => typeof item === 'string')
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getModelHelperText(
  isLoading: boolean,
  optionCount: number,
  selectedModel: OpenCodeModelOption | null
): string {
  if (isLoading) return 'Loading connected OpenCode models…'
  if (optionCount === 0) return 'Connect an OpenCode provider model before sending.'
  if (!selectedModel) return 'Select a connected OpenCode model before sending.'
  return `Using ${selectedModel.label}`
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Failed to load OpenCode models.'
}
