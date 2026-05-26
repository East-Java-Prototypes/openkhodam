import AppNavbar from '../components/AppNavbar'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import type { JSX } from 'react'

export const Route = createRootRoute({ component: RootRoute })

function RootRoute(): JSX.Element {
  return (
    <div className="min-h-screen">
      <AppNavbar />
      <Outlet />
    </div>
  )
}
