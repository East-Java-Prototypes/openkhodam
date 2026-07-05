import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  GetOpenCodeModelSelectionInput,
  GoogleWorkspaceIntegrationStatus,
  LinkedGoogleDoc,
  OpenCodeConnection,
  OpenCodeModelSelection,
  OpenCodeSidecarStatus,
  ProjectArtifactsConfig,
  ProjectArtifactsListInput,
  ProjectSessionLinkedDocsListInput,
  RecordLinkedGoogleDocInput,
  SetOpenCodeModelSelectionInput,
  UpdateLinkedGoogleDocListingInput
} from '@openkhodam/ui/types'

export type {
  GetOpenCodeModelSelectionInput,
  GoogleWorkspaceIntegrationStatus,
  LinkedGoogleDoc,
  OpenCodeConnection,
  OpenCodeModelSelection,
  OpenCodeSidecarStatus
} from '@openkhodam/ui/types'

export type DesktopPlatform = 'darwin' | 'linux' | 'win32'

export type OpenKhodamAPI = {
  platform: DesktopPlatform
  getOpenCodeConnection: () => Promise<OpenCodeConnection>
  getOpenCodeStatus: () => Promise<OpenCodeSidecarStatus>
  restartOpenCode: () => Promise<OpenCodeSidecarStatus>
  getOpenCodeModelSelection: (
    input: GetOpenCodeModelSelectionInput
  ) => Promise<OpenCodeModelSelection | null>
  setOpenCodeModelSelection: (
    input: SetOpenCodeModelSelectionInput
  ) => Promise<OpenCodeModelSelection | null>
  getGoogleWorkspaceStatus: () => Promise<GoogleWorkspaceIntegrationStatus>
  connectGoogleWorkspace: () => Promise<GoogleWorkspaceIntegrationStatus>
  cancelGoogleWorkspaceConnect: () => Promise<GoogleWorkspaceIntegrationStatus>
  disconnectGoogleWorkspace: () => Promise<GoogleWorkspaceIntegrationStatus>
  listProjectArtifacts: (input: ProjectArtifactsListInput) => Promise<ProjectArtifactsConfig>
  listSessionLinkedDocs: (input: ProjectSessionLinkedDocsListInput) => Promise<LinkedGoogleDoc[]>
  recordLinkedGoogleDoc: (input: RecordLinkedGoogleDocInput) => Promise<LinkedGoogleDoc>
  delistLinkedGoogleDoc: (
    input: UpdateLinkedGoogleDocListingInput
  ) => Promise<LinkedGoogleDoc | null>
  relistLinkedGoogleDoc: (
    input: UpdateLinkedGoogleDocListingInput
  ) => Promise<LinkedGoogleDoc | null>
  onOpenCodeStatus: (callback: (status: OpenCodeSidecarStatus) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: OpenKhodamAPI
  }
}
