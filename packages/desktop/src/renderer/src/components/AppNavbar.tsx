import { Link } from '@tanstack/react-router'
import type { JSX } from 'react'

function AppNavbar(): JSX.Element {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between px-4 py-3">
      <Link className="rounded px-2 py-1" to="/">
        Home
      </Link>
      <Link className="rounded px-2 py-1" to="/settings">
        Settings
      </Link>
    </header>
  )
}

export default AppNavbar
