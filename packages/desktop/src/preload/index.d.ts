import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  GoogleWorkspaceIntegrationStatus,
  LinkedGoogleDoc,
  OpenProjectFolderInput,
  OpenCodeConnection,
  OpenCodeSidecarStatus,
  OpenedProjectFolder,
  ProjectArtifactsConfig,
  ProjectArtifactsListInput,
  ProjectSessionLinkedDocsListInput,
  RecordLinkedGoogleDocInput,
  RemoveProjectFolderInput,
  UpdateLinkedGoogleDocListingInput
} from '@openkhodam/ui/types'

export type {
  GoogleWorkspaceIntegrationStatus,
  LinkedGoogleDoc,
  OpenCodeConnection,
  OpenCodeSidecarStatus
} from '@openkhodam/ui/types'

export type DesktopPlatform = 'darwin' | 'linux' | 'win32'

export type OpenKhodamAPI = {
  platform: DesktopPlatform
  getOpenCodeConnection: () => Promise<OpenCodeConnection>
  getOpenCodeStatus: () => Promise<OpenCodeSidecarStatus>
  restartOpenCode: () => Promise<OpenCodeSidecarStatus>
  getGoogleWorkspaceStatus: () => Promise<GoogleWorkspaceIntegrationStatus>
  connectGoogleWorkspace: () => Promise<GoogleWorkspaceIntegrationStatus>
  cancelGoogleWorkspaceConnect: () => Promise<GoogleWorkspaceIntegrationStatus>
  disconnectGoogleWorkspace: () => Promise<GoogleWorkspaceIntegrationStatus>
  listOpenedProjectFolders: () => Promise<OpenedProjectFolder[]>
  recordOpenedProjectFolder: (input: OpenProjectFolderInput) => Promise<OpenedProjectFolder>
  removeOpenedProjectFolder: (
    input: RemoveProjectFolderInput
  ) => Promise<OpenedProjectFolder | null>
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
