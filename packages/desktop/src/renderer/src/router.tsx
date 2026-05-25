import { createHashHistory, createRouter } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen'

const history = createHashHistory()

export const router = createRouter({ routeTree, history })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
