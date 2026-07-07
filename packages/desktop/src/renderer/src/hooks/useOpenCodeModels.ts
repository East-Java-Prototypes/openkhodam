import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { useOpenCodeSdk, type createOpenCodeClient } from './opencode/client'
import { openCodeQueryKeys } from './opencode/sidecar'

type OpenCodeClient = ReturnType<typeof createOpenCodeClient>
type ProviderListResponse = NonNullable<
  Awaited<ReturnType<OpenCodeClient['provider']['list']>>['data']
>
type ProviderListItem = ProviderListResponse['all'][number]
type ProviderModel = ProviderListItem['models'][string]
type ConnectedProviderPayload = Pick<ProviderListItem, 'id'> &
  Partial<Pick<ProviderListItem, 'models' | 'name'>>
type ProviderModelPayload = Pick<ProviderModel, 'id'> &
  Partial<Pick<ProviderModel, 'name' | 'variants'>>

export type OpenCodeModelSelection = {
  providerID: string
  modelID: string
}

export type OpenCodeModelOption = OpenCodeModelSelection & {
  id: string
  label: string
  providerName: string
  modelName: string
  variantIDs: string[]
}

export type OpenCodeModelEffortOption = {
  id: string
  value: string | null
  label: string
}

const defaultEffortOption: OpenCodeModelEffortOption = {
  id: 'default',
  value: null,
  label: 'Default'
}

const knownVariantOrder = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export function modelOptionID(model: OpenCodeModelSelection): string {
  return `${model.providerID}/${model.modelID}`
}

export function useOpenCodeModels(directory: string | null | undefined) {
  const { status, statusQuery, connection, connectionQuery, client } = useOpenCodeSdk()
  const [selectedModelID, setSelectedModelID] = useState<string | null>(null)
  const [selectedEffortID, setSelectedEffortID] = useState<string | null>(null)

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
  const effortOptions = useMemo(() => getEffortOptions(selectedModel), [selectedModel])
  const selectedEffort = effortOptions.find((option) => option.value === selectedEffortID) ?? null
  const effectiveSelectedEffortID = selectedEffort?.value ?? null

  useEffect(() => {
    setSelectedModelID((current) => {
      if (current && options.some((option) => option.id === current)) return current
      return defaultModelID ?? options[0]?.id ?? null
    })
  }, [defaultModelID, options])

  useEffect(() => {
    setSelectedEffortID((current) => {
      if (!current) return null
      return effortOptions.some((option) => option.value === current) ? current : null
    })
  }, [effortOptions])

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
    effortOptions,
    selectedEffort,
    selectedEffortID: effectiveSelectedEffortID,
    setSelectedEffortID,
    isLoading: modelsQuery.isLoading,
    errorMessage: modelsQuery.error ? formatUnknownError(modelsQuery.error) : null,
    helperText: getModelHelperText(modelsQuery.isLoading, options.length, selectedModel)
  }
}

function normalizeModelOptions(data: ProviderListResponse | undefined): OpenCodeModelOption[] {
  const connected = new Set(readStringArrayProperty(data, 'connected'))
  return readArrayProperty(data, 'all')
    .filter((provider): provider is ConnectedProviderPayload =>
      isConnectedProvider(provider, connected)
    )
    .flatMap((provider) =>
      Object.values(readObjectProperty(provider, 'models') ?? {})
        .filter(isProviderModelPayload)
        .map((model) => {
          const providerID = provider.id
          const modelID = model.id
          const providerName = readStringProperty(provider, 'name') || providerID
          const modelName = readStringProperty(model, 'name') || modelID
          return {
            id: `${providerID}/${modelID}`,
            providerID,
            modelID,
            providerName,
            modelName,
            variantIDs: getModelVariantIDs(model),
            label: `${providerName} · ${modelName}`
          }
        })
        .filter((option) => option.providerID.length > 0 && option.modelID.length > 0)
    )
}

function getEffortOptions(selectedModel: OpenCodeModelOption | null): OpenCodeModelEffortOption[] {
  if (!selectedModel || selectedModel.variantIDs.length === 0) return []
  return [
    defaultEffortOption,
    ...selectedModel.variantIDs.map((variantID) => ({
      id: variantID,
      value: variantID,
      label: humanizeVariantID(variantID)
    }))
  ]
}

function getModelVariantIDs(model: ProviderModelPayload): string[] {
  const variants = readObjectProperty(model, 'variants')
  if (!variants) return []
  return Object.entries(variants)
    .filter(([, variant]) => readBooleanProperty(variant, 'disabled') !== true)
    .map(([variantID]) => variantID.trim())
    .filter((variantID) => variantID.length > 0)
    .sort(compareVariantIDs)
}

function compareVariantIDs(a: string, b: string): number {
  const aIndex = knownVariantOrder.indexOf(a as (typeof knownVariantOrder)[number])
  const bIndex = knownVariantOrder.indexOf(b as (typeof knownVariantOrder)[number])
  if (aIndex !== -1 || bIndex !== -1) {
    if (aIndex === -1) return 1
    if (bIndex === -1) return -1
    return aIndex - bIndex
  }
  return a.localeCompare(b)
}

function humanizeVariantID(variantID: string): string {
  const normalized = variantID.trim().toLowerCase()
  if (normalized === 'xhigh') return 'X High'
  const cleaned = variantID.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned) return variantID
  return cleaned
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function getDefaultModelID(
  data: ProviderListResponse | undefined,
  options: OpenCodeModelOption[]
): string | null {
  const connected = new Set(readStringArrayProperty(data, 'connected'))
  const defaults = readObjectProperty(data, 'default')
  for (const providerID of connected) {
    const modelID = readStringValue(defaults?.[providerID])
    if (!modelID) continue
    const id = `${providerID}/${modelID}`
    if (options.some((option) => option.id === id)) return id
  }
  return null
}

function isConnectedProvider(
  provider: unknown,
  connected: Set<string>
): provider is ConnectedProviderPayload {
  const providerID = readStringProperty(provider, 'id')
  return providerID.length > 0 && connected.has(providerID)
}

function isProviderModelPayload(model: unknown): model is ProviderModelPayload {
  return readStringProperty(model, 'id').length > 0
}

function readStringArrayProperty(value: unknown, property: string): string[] {
  return readArrayProperty(value, property).filter((item): item is string => typeof item === 'string')
}

function readArrayProperty(value: unknown, property: string): unknown[] {
  const propertyValue = readProperty(value, property)
  return Array.isArray(propertyValue) ? propertyValue : []
}

function readObjectProperty(value: unknown, property: string): Record<string, unknown> | null {
  const propertyValue = readProperty(value, property)
  return typeof propertyValue === 'object' && propertyValue !== null
    ? (propertyValue as Record<string, unknown>)
    : null
}

function readStringProperty(value: unknown, property: string): string {
  return readStringValue(readProperty(value, property))
}

function readStringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readBooleanProperty(value: unknown, property: string): boolean | null {
  const propertyValue = readProperty(value, property)
  return typeof propertyValue === 'boolean' ? propertyValue : null
}

function readProperty(value: unknown, property: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  return (value as { [key: string]: unknown })[property]
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
