import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  GoogleWorkspaceIntegrationStatus,
  LinkedGoogleDoc,
  OpenCodeConnection,
  OpenCodeSidecarStatus,
  ProjectArtifactsConfig,
  ProjectArtifactsListInput,
  ProjectSessionLinkedDocsListInput,
  RecordLinkedGoogleDocInput,
  UpdateLinkedGoogleDocListingInput
} from '@openkhodam/ui/types'

// Custom APIs for renderer
const api = {
  platform: process.platform,
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
  listProjectArtifacts: (input: ProjectArtifactsListInput): Promise<ProjectArtifactsConfig> =>
    ipcRenderer.invoke('project-artifacts:list-project', input),
  listSessionLinkedDocs: (input: ProjectSessionLinkedDocsListInput): Promise<LinkedGoogleDoc[]> =>
    ipcRenderer.invoke('project-artifacts:list-session-docs', input),
  recordLinkedGoogleDoc: (input: RecordLinkedGoogleDocInput): Promise<LinkedGoogleDoc> =>
    ipcRenderer.invoke('project-artifacts:record-linked-doc', input),
  delistLinkedGoogleDoc: (
    input: UpdateLinkedGoogleDocListingInput
  ): Promise<LinkedGoogleDoc | null> =>
    ipcRenderer.invoke('project-artifacts:delist-linked-doc', input),
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
