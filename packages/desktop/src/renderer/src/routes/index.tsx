import { createFileRoute } from '@tanstack/react-router'

import { ChatHomePage } from '../components/chat/ChatHomePage'

export const Route = createFileRoute('/')({ component: ChatHomePage })
