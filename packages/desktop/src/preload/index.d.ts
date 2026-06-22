import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  GoogleWorkspaceIntegrationStatus,
  OpenCodeConnection,
  OpenCodeSidecarStatus
} from '@openkhodam/ui/types'

export type {
  GoogleWorkspaceIntegrationStatus,
  OpenCodeConnection,
  OpenCodeSidecarStatus
} from '@openkhodam/ui/types'

export type OpenKhodamAPI = {
  getOpenCodeConnection: () => Promise<OpenCodeConnection>
  getOpenCodeStatus: () => Promise<OpenCodeSidecarStatus>
  restartOpenCode: () => Promise<OpenCodeSidecarStatus>
  getGoogleWorkspaceStatus: () => Promise<GoogleWorkspaceIntegrationStatus>
  connectGoogleWorkspace: () => Promise<GoogleWorkspaceIntegrationStatus>
  cancelGoogleWorkspaceConnect: () => Promise<GoogleWorkspaceIntegrationStatus>
  disconnectGoogleWorkspace: () => Promise<GoogleWorkspaceIntegrationStatus>
  onOpenCodeStatus: (callback: (status: OpenCodeSidecarStatus) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: OpenKhodamAPI
  }
}
