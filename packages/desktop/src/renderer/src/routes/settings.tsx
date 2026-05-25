import { createFileRoute } from '@tanstack/react-router'
import type { JSX } from 'react'

import SettingsPage from '../pages/SettingsPage'

export const Route = createFileRoute('/settings')({ component: SettingsRoute })

function SettingsRoute(): JSX.Element {
  return <SettingsPage />
}
