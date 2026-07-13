import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  GetOpenCodeModelSelectionInput,
  GoogleWorkspaceIntegrationStatus,
  OpenProjectFolderInput,
  OpenCodeConnection,
  OpenCodeModelSelection,
  OpenCodeSidecarStatus,
  OpenedProjectFolder,
  RemoveProjectFolderInput,
  SetOpenCodeModelSelectionInput
} from '@openkhodam/ui/types'
import type { ThemeMode } from '../theme'
import type { OpenKhodamSidecarStatus } from '../main/openkhodam-sidecar'
import type { ConnectionInfo } from '@openkhodam/protocol'

export type {
  GetOpenCodeModelSelectionInput,
  GoogleWorkspaceIntegrationStatus,
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
  getOpenKhodamConnection: () => Promise<ConnectionInfo>
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
  onOpenCodeStatus: (callback: (status: OpenCodeSidecarStatus) => void) => () => void
  onOpenKhodamStatus: (callback: (status: OpenKhodamSidecarStatus) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: OpenKhodamAPI
  }
}
