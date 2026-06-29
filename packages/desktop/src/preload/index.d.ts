import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  GoogleWorkspaceIntegrationStatus,
  LinkedSource,
  OpenCodeConnection,
  OpenCodeSidecarStatus,
  ProjectSessionSourcesListInput,
  ProjectSourcesConfig,
  ProjectSourcesListInput,
  RecordLinkedSourceInput,
  UpdateLinkedSourceListingInput
} from '@openkhodam/ui/types'

export type {
  GoogleWorkspaceIntegrationStatus,
  LinkedSource,
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
  listProjectSources: (input: ProjectSourcesListInput) => Promise<ProjectSourcesConfig>
  listSessionSources: (input: ProjectSessionSourcesListInput) => Promise<LinkedSource[]>
  recordLinkedSource: (input: RecordLinkedSourceInput) => Promise<LinkedSource>
  delistLinkedSource: (input: UpdateLinkedSourceListingInput) => Promise<LinkedSource | null>
  relistLinkedSource: (input: UpdateLinkedSourceListingInput) => Promise<LinkedSource | null>
  onOpenCodeStatus: (callback: (status: OpenCodeSidecarStatus) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: OpenKhodamAPI
  }
}
