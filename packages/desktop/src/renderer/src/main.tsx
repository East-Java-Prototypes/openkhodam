import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'

import { OpenCodeSdkProvider } from './hooks/opencode/client'
import { queryClient } from './queryClient'
import { router } from './router'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <OpenCodeSdkProvider>
        <RouterProvider router={router} />
      </OpenCodeSdkProvider>
    </QueryClientProvider>
  </StrictMode>
)
