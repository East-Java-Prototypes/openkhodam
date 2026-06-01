import { createFileRoute } from '@tanstack/react-router'
import type { JSX } from 'react'

import { ChatHomePage } from '../components/chat/ChatHomePage'

export const Route = createFileRoute('/')({ component: IndexRoute })

function IndexRoute(): JSX.Element {
  return <ChatHomePage />
}
