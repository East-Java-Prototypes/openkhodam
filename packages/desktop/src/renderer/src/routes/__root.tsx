import { createRootRoute, Link, Outlet } from '@tanstack/react-router'
import type { JSX } from 'react'

export const Route = createRootRoute({ component: RootRoute })

function RootRoute(): JSX.Element {
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between px-4 py-3">
        <Link className="rounded px-2 py-1" to="/">
          Home
        </Link>
        <Link className="rounded px-2 py-1" to="/settings">
          Settings
        </Link>
      </header>
      <Outlet />
    </div>
  )
}
