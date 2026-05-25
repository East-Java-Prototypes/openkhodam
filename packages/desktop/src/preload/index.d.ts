import { ElectronAPI } from '@electron-toolkit/preload'
import type { OpenCodeConnection, OpenCodeSidecarStatus } from '@openkhodam/ui/types'

export type { OpenCodeConnection, OpenCodeSidecarStatus } from '@openkhodam/ui/types'

export type OpenKhodamAPI = {
  getOpenCodeConnection: () => Promise<OpenCodeConnection>
  getOpenCodeStatus: () => Promise<OpenCodeSidecarStatus>
  restartOpenCode: () => Promise<OpenCodeSidecarStatus>
  onOpenCodeStatus: (callback: (status: OpenCodeSidecarStatus) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: OpenKhodamAPI
  }
}
