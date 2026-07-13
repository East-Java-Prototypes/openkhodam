import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { RouterProvider } from '@tanstack/react-router'

import { OpenCodeSdkProvider } from './hooks/opencode/client'
import { OpenKhodamClientProvider } from './hooks/openkhodam/client'
import { OpenKhodamHealthDiagnostic } from './hooks/openkhodam/health-diagnostic'
import { queryClient } from './queryClient'
import { router } from './router'
import { bootstrapTheme } from './theme'
import './styles.css'

bootstrapTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <OpenKhodamClientProvider>
        <OpenKhodamHealthDiagnostic />
        <OpenCodeSdkProvider>
          <RouterProvider router={router} />
        </OpenCodeSdkProvider>
      </OpenKhodamClientProvider>
      {import.meta.env.DEV ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </QueryClientProvider>
  </StrictMode>
)
