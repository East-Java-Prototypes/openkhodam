import { Link, createFileRoute } from '@tanstack/react-router'
import type { JSX } from 'react'

export const Route = createFileRoute('/')({ component: IndexRoute })

function IndexRoute(): JSX.Element {
  return (
    <main>
      <h1>Index</h1>
      <p>OpenKhodam desktop is running.</p>
      <Link to="/settings">Open settings</Link>
    </main>
  )
}
