/// <reference types="vite/client" />

import type { WebviewTag } from 'electron'
import type { HTMLAttributes } from 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: HTMLAttributes<WebviewTag> & {
        src?: string
      }
    }
  }
}
