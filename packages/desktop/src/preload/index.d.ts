import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  GoogleWorkspaceIntegrationStatus,
  LinkedGoogleArtifact,
  LinkedGoogleDoc,
  OpenProjectFolderInput,
  OpenCodeConnection,
  OpenCodeSidecarStatus,
  OpenedProjectFolder,
  ProjectArtifactsConfig,
  ProjectArtifactsListInput,
  ProjectSessionLinkedGoogleArtifactsListInput,
  ProjectSessionLinkedDocsListInput,
  RecordLinkedGoogleArtifactInput,
  RecordLinkedGoogleDocInput,
  RemoveProjectFolderInput,
  UpdateLinkedGoogleArtifactListingInput,
  UpdateLinkedGoogleDocListingInput
} from '@openkhodam/ui/types'
import type { ThemeMode } from '../theme'

export type {
  GoogleWorkspaceIntegrationStatus,
  LinkedGoogleArtifact,
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
  setNativeTheme: (mode: ThemeMode) => Promise<void>
  getGoogleWorkspaceStatus: () => Promise<GoogleWorkspaceIntegrationStatus>
  connectGoogleWorkspace: () => Promise<GoogleWorkspaceIntegrationStatus>
  cancelGoogleWorkspaceConnect: () => Promise<GoogleWorkspaceIntegrationStatus>
  disconnectGoogleWorkspace: () => Promise<GoogleWorkspaceIntegrationStatus>
  listOpenedProjectFolders: () => Promise<OpenedProjectFolder[]>
  selectProjectDirectory: () => Promise<string | null>
  recordOpenedProjectFolder: (input: OpenProjectFolderInput) => Promise<OpenedProjectFolder>
  removeOpenedProjectFolder: (
    input: RemoveProjectFolderInput
  ) => Promise<OpenedProjectFolder | null>
  listProjectArtifacts: (input: ProjectArtifactsListInput) => Promise<ProjectArtifactsConfig>
  listSessionLinkedGoogleArtifacts: (
    input: ProjectSessionLinkedGoogleArtifactsListInput
  ) => Promise<LinkedGoogleArtifact[]>
  listSessionLinkedDocs: (input: ProjectSessionLinkedDocsListInput) => Promise<LinkedGoogleDoc[]>
  recordLinkedGoogleArtifact: (
    input: RecordLinkedGoogleArtifactInput
  ) => Promise<LinkedGoogleArtifact>
  recordLinkedGoogleDoc: (input: RecordLinkedGoogleDocInput) => Promise<LinkedGoogleDoc>
  delistLinkedGoogleArtifact: (
    input: UpdateLinkedGoogleArtifactListingInput
  ) => Promise<LinkedGoogleArtifact | null>
  delistLinkedGoogleDoc: (
    input: UpdateLinkedGoogleDocListingInput
  ) => Promise<LinkedGoogleDoc | null>
  relistLinkedGoogleArtifact: (
    input: UpdateLinkedGoogleArtifactListingInput
  ) => Promise<LinkedGoogleArtifact | null>
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
