import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  GoogleWorkspaceIntegrationStatus,
  OpenCodeConnection,
  OpenCodeSidecarStatus,
  WorkspaceResourceAttachGoogleDocInput,
  WorkspaceResourcesConfig,
  WorkspaceSessionActiveResourceInput
} from '@openkhodam/ui/types'

export type {
  GoogleWorkspaceIntegrationStatus,
  OpenCodeConnection,
  OpenCodeSidecarStatus,
  WorkspaceResourceAttachGoogleDocInput,
  WorkspaceResourcesConfig,
  WorkspaceSessionActiveResourceInput
} from '@openkhodam/ui/types'

export type OpenKhodamAPI = {
  getOpenCodeConnection: () => Promise<OpenCodeConnection>
  getOpenCodeStatus: () => Promise<OpenCodeSidecarStatus>
  restartOpenCode: () => Promise<OpenCodeSidecarStatus>
  getGoogleWorkspaceStatus: () => Promise<GoogleWorkspaceIntegrationStatus>
  connectGoogleWorkspace: () => Promise<GoogleWorkspaceIntegrationStatus>
  cancelGoogleWorkspaceConnect: () => Promise<GoogleWorkspaceIntegrationStatus>
  disconnectGoogleWorkspace: () => Promise<GoogleWorkspaceIntegrationStatus>
  getWorkspaceResources: (projectDirectory: string) => Promise<WorkspaceResourcesConfig>
  attachWorkspaceGoogleDoc: (
    input: WorkspaceResourceAttachGoogleDocInput
  ) => Promise<WorkspaceResourcesConfig>
  setWorkspaceSessionActiveResource: (
    input: WorkspaceSessionActiveResourceInput
  ) => Promise<WorkspaceResourcesConfig>
  onOpenCodeStatus: (callback: (status: OpenCodeSidecarStatus) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: OpenKhodamAPI
  }
}
