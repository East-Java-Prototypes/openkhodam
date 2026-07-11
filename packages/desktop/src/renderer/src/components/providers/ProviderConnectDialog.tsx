import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  type OpenCodeProviderAuthMethod,
  type OpenCodeProviderOption,
  useOpenCodeProviders
} from '@/hooks/useOpenCodeProviders'

type ProviderAuthPrompt = NonNullable<OpenCodeProviderAuthMethod['prompts']>[number]

type ProviderConnectDialogStep =
  | 'method'
  | 'prompt'
  | 'api'
  | 'oauth-pending'
  | 'oauth-code'
  | 'oauth-auto'
  | 'success'
  | 'error'

export function ProviderConnectDialog({
  open,
  onOpenChange,
  providerID
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  providerID: string
}): JSX.Element {
  const providers = useOpenCodeProviders()
  const [selectedMethodIndex, setSelectedMethodIndex] = useState<number | null>(null)
  const [step, setStep] = useState<ProviderConnectDialogStep>('method')
  const [promptInputs, setPromptInputs] = useState<Record<string, string>>({})
  const [promptIndex, setPromptIndex] = useState(0)
  const [promptDraft, setPromptDraft] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [authorization, setAuthorization] = useState<{
    url: string
    method: 'auto' | 'code'
    instructions: string
  } | null>(null)
  const [oauthCode, setOAuthCode] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const autoSelectedMethodRef = useRef<string | null>(null)
  const openRef = useRef(open)
  const flowGenerationRef = useRef(0)

  const selectedProvider = useMemo(
    () => providers.providers.find((provider) => provider.id === providerID) ?? null,
    [providerID, providers.providers]
  )
  const authMethods = useMemo(() => providers.getAuthMethods(providerID), [providerID, providers])
  const selectedMethod =
    selectedMethodIndex === null ? null : (authMethods?.[selectedMethodIndex] ?? null)
  const currentPrompt = selectedMethod
    ? getNextPrompt(selectedMethod, promptInputs, promptIndex)
    : null
  const title = selectedProvider ? `Connect ${selectedProvider.name}` : 'Connect OpenCode provider'
  const isBusy =
    providers.connectApiProviderMutation.isPending ||
    providers.authorizeOAuthProviderMutation.isPending ||
    providers.completeOAuthProviderMutation.isPending

  const isCurrentFlow = useCallback(
    (generation: number): boolean => openRef.current && generation === flowGenerationRef.current,
    []
  )

  useEffect(() => {
    openRef.current = open
    if (!open) flowGenerationRef.current += 1
  }, [open])

  useEffect(() => {
    return () => {
      openRef.current = false
      flowGenerationRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setSelectedMethodIndex(null)
    setStep('method')
    setPromptInputs({})
    setPromptIndex(0)
    setPromptDraft('')
    setApiKey('')
    setAuthorization(null)
    setOAuthCode('')
    setMessage(null)
    autoSelectedMethodRef.current = null
  }, [open, providerID])

  function resetMethod(): void {
    setSelectedMethodIndex(null)
    clearTransientState()
    autoSelectedMethodRef.current = null
    setStep('method')
  }

  function clearTransientState(): void {
    setPromptInputs({})
    setPromptIndex(0)
    setPromptDraft('')
    setApiKey('')
    setAuthorization(null)
    setOAuthCode('')
    setMessage(null)
  }

  function retrySelectedMethod(): void {
    if (selectedMethodIndex === null) {
      resetMethod()
      return
    }
    flowGenerationRef.current += 1
    clearTransientState()
    void selectMethod(selectedMethodIndex)
  }

  const beginAuthMethod = useCallback(
    async (
      provider: OpenCodeProviderOption,
      method: OpenCodeProviderAuthMethod,
      index: number,
      inputs: Record<string, string>
    ): Promise<void> => {
      if (method.type === 'api') {
        setStep('api')
        return
      }

      if (method.type !== 'oauth') {
        setMessage(`Unsupported provider auth method: ${method.type}.`)
        setStep('error')
        return
      }

      setStep('oauth-pending')
      const generation = ++flowGenerationRef.current
      try {
        const nextAuthorization = await providers.authorizeOAuthProviderMutation.mutateAsync({
          providerID: provider.id,
          method: index,
          inputs: emptyRecordToUndefined(inputs)
        })
        if (!isCurrentFlow(generation)) return
        setAuthorization(nextAuthorization)
        openAuthorizationUrl(nextAuthorization.url)
        if (nextAuthorization.method === 'code') {
          setStep('oauth-code')
          return
        }

        setStep('oauth-auto')
        const callbackResponse = await providers.completeOAuthProviderMutation.mutateAsync({
          providerID: provider.id,
          method: index
        })
        void callbackResponse
        if (!isCurrentFlow(generation)) return
        setMessage(`${provider.name} connected.`)
        setStep('success')
      } catch (error) {
        if (!isCurrentFlow(generation)) return
        setMessage(formatUnknownError(error, 'OAuth authorization failed.'))
        setStep('error')
      }
    },
    [
      isCurrentFlow,
      providers.authorizeOAuthProviderMutation,
      providers.completeOAuthProviderMutation
    ]
  )

  const selectMethod = useCallback(
    async (index: number, inputs: Record<string, string> = {}) => {
      const method = authMethods?.[index]
      if (!method || !selectedProvider) return

      setSelectedMethodIndex(index)
      setPromptInputs(inputs)
      setPromptIndex(0)
      setAuthorization(null)
      setMessage(null)

      const prompt = getNextPrompt(method, inputs, 0)
      if (prompt) {
        setPromptIndex(prompt.index)
        setPromptDraft(prompt.prompt.type === 'text' ? (inputs[prompt.prompt.key] ?? '') : '')
        setStep('prompt')
        return
      }

      await beginAuthMethod(selectedProvider, method, index, inputs)
    },
    [authMethods, beginAuthMethod, selectedProvider]
  )

  useEffect(() => {
    if (!open || selectedMethodIndex !== null) return
    if (providers.authMethodsQuery.isLoading || providers.authMethodsQuery.isError) return
    if (!authMethods || authMethods.length !== 1) return
    const autoSelectionKey = `${providerID}:0`
    if (autoSelectedMethodRef.current === autoSelectionKey) return
    autoSelectedMethodRef.current = autoSelectionKey
    void selectMethod(0)
  }, [
    authMethods,
    open,
    providers.authMethodsQuery.isError,
    providers.authMethodsQuery.isLoading,
    selectedMethodIndex,
    providerID,
    selectMethod
  ])

  async function submitPrompt(value: string): Promise<void> {
    if (!selectedMethod || selectedMethodIndex === null || !selectedProvider || !currentPrompt)
      return
    const trimmedValue = value.trim()
    if (currentPrompt.prompt.type === 'text' && !trimmedValue) {
      setMessage('This value is required.')
      return
    }

    const nextInputs = {
      ...promptInputs,
      [currentPrompt.prompt.key]: currentPrompt.prompt.type === 'text' ? trimmedValue : value
    }
    const nextPrompt = getNextPrompt(selectedMethod, nextInputs, currentPrompt.index + 1)
    setPromptInputs(nextInputs)
    setMessage(null)
    if (nextPrompt) {
      setPromptIndex(nextPrompt.index)
      setPromptDraft(
        nextPrompt.prompt.type === 'text' ? (nextInputs[nextPrompt.prompt.key] ?? '') : ''
      )
      return
    }

    await beginAuthMethod(selectedProvider, selectedMethod, selectedMethodIndex, nextInputs)
  }

  async function submitApiKey(): Promise<void> {
    if (!selectedProvider) return
    const key = apiKey.trim()
    if (!key) {
      setMessage('API key is required.')
      return
    }

    try {
      const generation = ++flowGenerationRef.current
      await providers.connectApiProviderMutation.mutateAsync({
        providerID: selectedProvider.id,
        key,
        metadata: emptyRecordToUndefined(promptInputs)
      })
      if (!isCurrentFlow(generation)) return
      setApiKey('')
      setMessage(`${selectedProvider.name} connected.`)
      setStep('success')
    } catch (error) {
      if (!openRef.current) return
      setMessage(formatUnknownError(error, 'Provider connection failed.'))
      setStep('error')
    }
  }

  async function completeOAuth(
    providerID: string,
    method: number,
    code?: string,
    generation = ++flowGenerationRef.current
  ): Promise<void> {
    try {
      await providers.completeOAuthProviderMutation.mutateAsync({ providerID, method, code })
      if (!isCurrentFlow(generation)) return
      const providerName = selectedProvider?.name ?? providerID
      setMessage(`${providerName} connected.`)
      setStep('success')
    } catch (error) {
      if (!isCurrentFlow(generation)) return
      setMessage(formatUnknownError(error, 'OAuth callback failed.'))
      setStep('error')
    }
  }

  async function submitOAuthCode(): Promise<void> {
    if (!selectedProvider || selectedMethodIndex === null) return
    const code = oauthCode.trim()
    if (!code) {
      setMessage('Authorization code is required.')
      return
    }

    setOAuthCode('')
    await completeOAuth(selectedProvider.id, selectedMethodIndex, code)
  }

  function handleOpenChange(nextOpen: boolean): void {
    if (!nextOpen && isBusy) return
    if (!nextOpen) flowGenerationRef.current += 1
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-lg flex-col gap-0 p-0"
        aria-describedby="provider-connect-description"
        showCloseButton={!isBusy}
      >
        <DialogHeader className="p-4 pr-12">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription id="provider-connect-description">
            Connect through OpenCode. OpenKhodam never stores provider secrets.
          </DialogDescription>
        </DialogHeader>
        <Separator />
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-4 p-4">
            {selectedProvider ? (
              <div className="border bg-card p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">{selectedProvider.name}</div>
                    <div className="text-muted-foreground text-xs">
                      {selectedProvider.modelCount} model
                      {selectedProvider.modelCount === 1 ? '' : 's'}
                    </div>
                  </div>
                  {step !== 'success' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={resetMethod}
                      disabled={isBusy}
                    >
                      Change
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {providers.errorMessage ? (
              <StatusMessage tone="error">
                Unable to load providers: {providers.errorMessage}
              </StatusMessage>
            ) : null}
            {providers.authMethodsErrorMessage && selectedProvider ? (
              <StatusMessage tone="error">
                Unable to load auth methods: {providers.authMethodsErrorMessage}
              </StatusMessage>
            ) : null}
            {message && step !== 'success' && step !== 'error' ? (
              <StatusMessage tone="error">{message}</StatusMessage>
            ) : null}

            {renderDialogStep()}
          </div>
        </ScrollArea>
        <DialogFooter className="border-t p-4">
          {step === 'success' ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isBusy}
            >
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  function renderDialogStep(): JSX.Element {
    if (!selectedProvider) {
      return <StatusMessage tone="error">This provider is unavailable.</StatusMessage>
    }

    if (providers.authMethodsQuery.isLoading) {
      return <StatusMessage>Loading provider auth methods…</StatusMessage>
    }

    if (providers.authMethodsQuery.isError || authMethods === null) {
      return (
        <StatusMessage tone="error">
          Provider auth methods are unavailable. Retry after OpenCode can load this provider.
        </StatusMessage>
      )
    }

    if (step === 'method') {
      return <MethodPicker methods={authMethods} onSelect={(index) => void selectMethod(index)} />
    }

    if (step === 'prompt' && currentPrompt) {
      return (
        <PromptStep
          prompt={currentPrompt.prompt}
          value={promptDraft}
          onValueChange={setPromptDraft}
          onSubmit={(value) => void submitPrompt(value)}
          disabled={isBusy}
        />
      )
    }

    if (step === 'api') {
      return (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void submitApiKey()
          }}
        >
          <p className="text-muted-foreground text-sm">
            Paste the API key requested by {selectedProvider.name}. The key is sent directly to
            OpenCode.
          </p>
          <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="provider-api-key">
            API key
            <Input
              id="provider-api-key"
              name="apiKey"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.currentTarget.value)}
              disabled={isBusy}
              autoFocus
            />
          </label>
          <Button type="submit" disabled={isBusy}>
            {providers.connectApiProviderMutation.isPending ? 'Connecting…' : 'Connect provider'}
          </Button>
        </form>
      )
    }

    if (step === 'oauth-pending') {
      return <StatusMessage>Starting OAuth authorization…</StatusMessage>
    }

    if (step === 'oauth-code' && authorization) {
      return (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void submitOAuthCode()
          }}
        >
          <p className="text-muted-foreground text-sm">
            Open the authorization link, then paste the code returned by {selectedProvider.name}.
          </p>
          <AuthorizationLink authorization={authorization} />
          <label
            className="flex flex-col gap-1.5 text-sm font-medium"
            htmlFor="provider-oauth-code"
          >
            Authorization code
            <Input
              id="provider-oauth-code"
              name="code"
              value={oauthCode}
              onChange={(event) => setOAuthCode(event.currentTarget.value)}
              disabled={isBusy}
              autoFocus
            />
          </label>
          <Button type="submit" disabled={isBusy}>
            {providers.completeOAuthProviderMutation.isPending ? 'Completing…' : 'Complete OAuth'}
          </Button>
        </form>
      )
    }

    if (step === 'oauth-auto' && authorization) {
      return (
        <div className="flex flex-col gap-3">
          <AuthorizationLink authorization={authorization} />
          <label
            className="flex flex-col gap-1.5 text-sm font-medium"
            htmlFor="provider-oauth-confirmation"
          >
            Confirmation code
            <Input
              id="provider-oauth-confirmation"
              value={getConfirmationCode(authorization)}
              readOnly
            />
          </label>
          <StatusMessage>Waiting for OpenCode to finish OAuth…</StatusMessage>
        </div>
      )
    }

    if (step === 'success') {
      return <StatusMessage>{message ?? `${selectedProvider.name} connected.`}</StatusMessage>
    }

    return (
      <div className="flex flex-col gap-3">
        <StatusMessage tone="error">{message ?? 'Provider connection failed.'}</StatusMessage>
        <Button type="button" variant="outline" onClick={retrySelectedMethod}>
          Try again
        </Button>
      </div>
    )
  }
}

function MethodPicker({
  methods,
  onSelect
}: {
  methods: OpenCodeProviderAuthMethod[]
  onSelect: (index: number) => void
}): JSX.Element {
  if (methods.length === 0)
    return <StatusMessage>No auth methods found for this provider.</StatusMessage>

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        Choose how OpenCode should connect this provider.
      </p>
      <div className="flex flex-col gap-2" role="list" aria-label="Provider auth methods">
        {methods.map((method, index) => (
          <button
            key={`${method.type}-${method.label}-${index}`}
            type="button"
            className="flex min-h-12 items-center justify-between gap-3 border bg-card px-3 py-2 text-left text-sm hover:bg-muted"
            onClick={() => onSelect(index)}
          >
            <span className="font-medium">{methodLabel(method)}</span>
            <span className="text-muted-foreground text-xs">
              {method.type === 'api' ? 'API key' : 'OAuth'}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function PromptStep({
  prompt,
  value,
  onValueChange,
  onSubmit,
  disabled
}: {
  prompt: ProviderAuthPrompt
  value: string
  onValueChange: (value: string) => void
  onSubmit: (value: string) => void
  disabled: boolean
}): JSX.Element {
  if (prompt.type === 'select') {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">{prompt.message}</p>
        <div className="flex flex-col gap-2" role="list" aria-label={prompt.message}>
          {prompt.options.map((option) => (
            <button
              key={option.value}
              type="button"
              className="flex min-h-12 items-center justify-between gap-3 border bg-card px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => onSubmit(option.value)}
              disabled={disabled}
            >
              <span className="font-medium">{option.label}</span>
              {option.hint ? (
                <span className="text-muted-foreground text-xs">{option.hint}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(value)
      }}
    >
      <label
        className="flex flex-col gap-1.5 text-sm font-medium"
        htmlFor={`provider-prompt-${prompt.key}`}
      >
        {prompt.message}
        <Input
          id={`provider-prompt-${prompt.key}`}
          value={value}
          placeholder={prompt.placeholder}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          disabled={disabled}
          autoFocus
        />
      </label>
      <Button type="submit" disabled={disabled}>
        Continue
      </Button>
    </form>
  )
}

function AuthorizationLink({
  authorization
}: {
  authorization: { url: string; instructions: string }
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2 border bg-card p-3 text-sm">
      <p className="text-muted-foreground">{authorization.instructions}</p>
      <a
        className="text-primary underline-offset-4 hover:underline"
        href={authorization.url}
        target="_blank"
        rel="noreferrer"
      >
        Open authorization link
      </a>
    </div>
  )
}

function StatusMessage({
  children,
  tone = 'default'
}: {
  children: ReactNode
  tone?: 'default' | 'error'
}): JSX.Element {
  return (
    <div
      className={`border px-3 py-2 text-sm ${tone === 'error' ? 'border-destructive text-destructive' : 'border-border bg-card text-muted-foreground'}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {children}
    </div>
  )
}

function getNextPrompt(
  method: OpenCodeProviderAuthMethod,
  inputs: Record<string, string>,
  startIndex: number
): { index: number; prompt: ProviderAuthPrompt } | null {
  const prompts = method.prompts ?? []
  for (let index = startIndex; index < prompts.length; index += 1) {
    const prompt = prompts[index]
    if (promptMatches(prompt, inputs)) return { index, prompt }
  }
  return null
}

function promptMatches(prompt: ProviderAuthPrompt, inputs: Record<string, string>): boolean {
  if (!prompt.when) return true
  const actual = inputs[prompt.when.key]
  if (actual === undefined) return false
  return prompt.when.op === 'eq' ? actual === prompt.when.value : actual !== prompt.when.value
}

function methodLabel(method: OpenCodeProviderAuthMethod): string {
  if (method.type === 'api') return method.label || 'API key'
  if (method.type === 'oauth') return method.label || 'OAuth'
  return method.label || 'Unsupported auth method'
}

function emptyRecordToUndefined(value: Record<string, string>): Record<string, string> | undefined {
  return Object.keys(value).length > 0 ? value : undefined
}

function openAuthorizationUrl(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

function getConfirmationCode(authorization: { instructions: string }): string {
  const marker = authorization.instructions.includes(':')
    ? authorization.instructions.split(':').pop()
    : authorization.instructions
  return marker?.trim() ?? ''
}

function formatUnknownError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  if (!isRecord(error)) return fallback
  const data = isRecord(error.data) ? error.data : null
  const message =
    getString(error.message) ||
    getString(error.detail) ||
    getString(error.name) ||
    (data ? getString(data.message) || getString(data.field) : '')
  return message || fallback
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
