import { createFileRoute } from '@tanstack/react-router'
import type { JSX } from 'react'

export const Route = createFileRoute('/')({ component: IndexRoute })

function IndexRoute(): JSX.Element {
  return <main />
}
