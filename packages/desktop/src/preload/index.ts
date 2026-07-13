import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
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
import type { OpenKhodamSidecarStatus } from '../main/openkhodam-sidecar'
import type { ConnectionInfo } from '@openkhodam/protocol'
import type { ThemeMode } from '../theme'

type SupportedDesktopPlatform = 'darwin' | 'linux' | 'win32'

const supportedDesktopPlatforms = new Set<NodeJS.Platform>(['darwin', 'linux', 'win32'])

function supportedDesktopPlatform(platform: NodeJS.Platform): SupportedDesktopPlatform {
  return supportedDesktopPlatforms.has(platform) ? (platform as SupportedDesktopPlatform) : 'linux'
}

// Custom APIs for renderer
const api = {
  platform: supportedDesktopPlatform(process.platform),
  getOpenCodeConnection: (): Promise<OpenCodeConnection> =>
    ipcRenderer.invoke('opencode:get-connection'),
  getOpenCodeStatus: (): Promise<OpenCodeSidecarStatus> =>
    ipcRenderer.invoke('opencode:get-status'),
  restartOpenCode: (): Promise<OpenCodeSidecarStatus> => ipcRenderer.invoke('opencode:restart'),
  getOpenKhodamConnection: (): Promise<ConnectionInfo> =>
    ipcRenderer
      .invoke('openkhodam:get-connection')
      .then((connection: { url: string; token: string }) => ({
        baseUrl: connection.url,
        token: connection.token
      })),
  getOpenKhodamStatus: (): Promise<OpenKhodamSidecarStatus> =>
    ipcRenderer.invoke('openkhodam:get-status'),
  restartOpenKhodam: (): Promise<OpenKhodamSidecarStatus> =>
    ipcRenderer.invoke('openkhodam:restart'),
  setNativeTheme: (mode: ThemeMode): Promise<void> =>
    ipcRenderer.invoke('appearance:set-native-theme', mode),
  getOpenCodeModelSelection: (
    input: GetOpenCodeModelSelectionInput
  ): Promise<OpenCodeModelSelection | null> =>
    ipcRenderer.invoke('opencode:get-model-selection', input),
  setOpenCodeModelSelection: (
    input: SetOpenCodeModelSelectionInput
  ): Promise<OpenCodeModelSelection | null> =>
    ipcRenderer.invoke('opencode:set-model-selection', input),
  getGoogleWorkspaceStatus: (): Promise<GoogleWorkspaceIntegrationStatus> =>
    ipcRenderer.invoke('google-workspace:get-status'),
  connectGoogleWorkspace: (): Promise<GoogleWorkspaceIntegrationStatus> =>
    ipcRenderer.invoke('google-workspace:connect'),
  cancelGoogleWorkspaceConnect: (): Promise<GoogleWorkspaceIntegrationStatus> =>
    ipcRenderer.invoke('google-workspace:cancel-connect'),
  disconnectGoogleWorkspace: (): Promise<GoogleWorkspaceIntegrationStatus> =>
    ipcRenderer.invoke('google-workspace:disconnect'),
  listOpenedProjectFolders: (): Promise<OpenedProjectFolder[]> =>
    ipcRenderer.invoke('projects:list-opened-folders'),
  selectProjectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('project-directory:select'),
  recordOpenedProjectFolder: (input: OpenProjectFolderInput): Promise<OpenedProjectFolder> =>
    ipcRenderer.invoke('projects:record-opened-folder', input),
  removeOpenedProjectFolder: (
    input: RemoveProjectFolderInput
  ): Promise<OpenedProjectFolder | null> =>
    ipcRenderer.invoke('projects:remove-opened-folder', input),
  onOpenCodeStatus: (callback: (status: OpenCodeSidecarStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: OpenCodeSidecarStatus): void =>
      callback(status)

    ipcRenderer.on('opencode:status', listener)
    return (): void => {
      ipcRenderer.removeListener('opencode:status', listener)
    }
  },
  onOpenKhodamStatus: (callback: (status: OpenKhodamSidecarStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: OpenKhodamSidecarStatus): void =>
      callback(status)
    ipcRenderer.on('openkhodam:status', listener)
    return (): void => {
      ipcRenderer.removeListener('openkhodam:status', listener)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
