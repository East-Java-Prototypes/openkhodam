import type { OpenCodeSidecarStatus, RendererHttpHealthState } from './types'

export function formatOpenCodeStatus(state: OpenCodeSidecarStatus['state']): string {
  switch (state) {
    case 'connected':
      return 'Connected'
    case 'starting':
      return 'Starting'
    case 'stopped':
      return 'Stopped'
    case 'error':
      return 'Disconnected'
  }
}

export function formatRendererHttpState(state: RendererHttpHealthState): string {
  switch (state) {
    case 'connected':
      return 'Connected'
    case 'checking':
      return 'Checking'
    case 'error':
      return 'Failed'
    case 'waiting':
      return 'Waiting'
  }
}

export function formatUpdatedAt(updatedAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(updatedAt))
}
