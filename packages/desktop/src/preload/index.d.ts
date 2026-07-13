import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  GetOpenCodeModelSelectionInput,
  GoogleWorkspaceIntegrationStatus,
  LinkedGoogleArtifact,
  LinkedGoogleDoc,
  OpenProjectFolderInput,
  OpenCodeConnection,
  OpenCodeModelSelection,
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
  SetOpenCodeModelSelectionInput,
  UpdateLinkedGoogleDocListingInput
} from '@openkhodam/ui/types'
import type { ThemeMode } from '../theme'
import type { OpenKhodamSidecarStatus } from '../main/openkhodam-sidecar'

export type {
  GetOpenCodeModelSelectionInput,
  GoogleWorkspaceIntegrationStatus,
  LinkedGoogleArtifact,
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
  getOpenKhodamStatus: () => Promise<OpenKhodamSidecarStatus>
  restartOpenKhodam: () => Promise<OpenKhodamSidecarStatus>
  setNativeTheme: (mode: ThemeMode) => Promise<void>
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
  onOpenKhodamStatus: (callback: (status: OpenKhodamSidecarStatus) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: OpenKhodamAPI
  }
}
