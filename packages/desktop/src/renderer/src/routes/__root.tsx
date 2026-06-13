import { createRootRoute, Outlet } from '@tanstack/react-router'
import type { JSX } from 'react'

export const Route = createRootRoute({ component: RootRoute })

function RootRoute(): JSX.Element {
  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <Outlet />
    </div>
  )
}
