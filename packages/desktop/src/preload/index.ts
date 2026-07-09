import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
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
  listProjectArtifacts: (input: ProjectArtifactsListInput): Promise<ProjectArtifactsConfig> =>
    ipcRenderer.invoke('project-artifacts:list-project', input),
  listSessionLinkedGoogleArtifacts: (
    input: ProjectSessionLinkedGoogleArtifactsListInput
  ): Promise<LinkedGoogleArtifact[]> =>
    ipcRenderer.invoke('project-artifacts:list-session-google-artifacts', input),
  listSessionLinkedDocs: (input: ProjectSessionLinkedDocsListInput): Promise<LinkedGoogleDoc[]> =>
    ipcRenderer.invoke('project-artifacts:list-session-docs', input),
  recordLinkedGoogleArtifact: (
    input: RecordLinkedGoogleArtifactInput
  ): Promise<LinkedGoogleArtifact> =>
    ipcRenderer.invoke('project-artifacts:record-linked-google-artifact', input),
  recordLinkedGoogleDoc: (input: RecordLinkedGoogleDocInput): Promise<LinkedGoogleDoc> =>
    ipcRenderer.invoke('project-artifacts:record-linked-doc', input),
  delistLinkedGoogleArtifact: (
    input: UpdateLinkedGoogleArtifactListingInput
  ): Promise<LinkedGoogleArtifact | null> =>
    ipcRenderer.invoke('project-artifacts:delist-linked-google-artifact', input),
  delistLinkedGoogleDoc: (
    input: UpdateLinkedGoogleDocListingInput
  ): Promise<LinkedGoogleDoc | null> =>
    ipcRenderer.invoke('project-artifacts:delist-linked-doc', input),
  relistLinkedGoogleArtifact: (
    input: UpdateLinkedGoogleArtifactListingInput
  ): Promise<LinkedGoogleArtifact | null> =>
    ipcRenderer.invoke('project-artifacts:relist-linked-google-artifact', input),
  relistLinkedGoogleDoc: (
    input: UpdateLinkedGoogleDocListingInput
  ): Promise<LinkedGoogleDoc | null> =>
    ipcRenderer.invoke('project-artifacts:relist-linked-doc', input),
  onOpenCodeStatus: (callback: (status: OpenCodeSidecarStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: OpenCodeSidecarStatus): void =>
      callback(status)

    ipcRenderer.on('opencode:status', listener)
    return (): void => {
      ipcRenderer.removeListener('opencode:status', listener)
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
