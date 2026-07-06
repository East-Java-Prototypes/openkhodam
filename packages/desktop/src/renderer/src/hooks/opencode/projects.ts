import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { OpenedProjectFolder } from '@openkhodam/ui/types'

import { useOpenCodeRuntime, type createOpenCodeClient } from './client'
import { openCodeQueryKeys } from './sidecar'

type OpenCodeClient = ReturnType<typeof createOpenCodeClient>
type OpenCodeProjectListResponse = Awaited<ReturnType<OpenCodeClient['project']['list']>>
export type OpenCodeProject = NonNullable<OpenCodeProjectListResponse['data']>[number]
type OpenCodeProjectCurrentResponse = Awaited<ReturnType<OpenCodeClient['project']['current']>>
export type OpenCodeCurrentProject = NonNullable<OpenCodeProjectCurrentResponse['data']>
export type OpenCodeOpenedProject = OpenCodeProject & {
  directory: string
  lastOpenedAt: number
  worktree: string
}

type OpenCodeOpenedProjectsQuery = {
  data: OpenCodeOpenedProject[]
  error: unknown
  isLoading: boolean
  isSuccess: boolean
}

type OpenProjectByDirectoryResult = {
  folder: OpenedProjectFolder
  project: OpenCodeCurrentProject
}

const emptyOpenCodeProjects: OpenCodeProject[] = []
const emptyOpenedProjectFolders: OpenedProjectFolder[] = []

export const openCodeProjectQueryKeys = {
  all: () => [...openCodeQueryKeys.all, 'projects'] as const,
  openedFolders: () => [...openCodeQueryKeys.all, 'opened-project-folders'] as const,
  list: (url: string | null, pid: number | null, updatedAt: number) =>
    [...openCodeQueryKeys.all, 'projects', url, pid, updatedAt] as const,
  current: (
    directory: string | null | undefined,
    url: string | null,
    pid: number | null,
    updatedAt: number
  ) => [...openCodeQueryKeys.all, 'project', directory, url, pid, updatedAt] as const
}

export function useOpenCodeProjects() {
  const runtime = useOpenCodeRuntime()
  const { status, statusQuery, connection, connectionQuery, client } = runtime
  const queryClient = useQueryClient()

  const openedFoldersQuery = useQuery({
    queryKey: openCodeProjectQueryKeys.openedFolders(),
    queryFn: (): Promise<OpenedProjectFolder[]> => window.api.listOpenedProjectFolders()
  })

  const projectMetadataQuery = useQuery({
    queryKey: openCodeProjectQueryKeys.list(status.url, status.pid, status.updatedAt),
    queryFn: async (): Promise<OpenCodeProject[]> => {
      const response = await client!.project.list()
      if (response.error) throw response.error
      return response.data ?? []
    },
    enabled: connection !== null
  })

  const openedFolders = openedFoldersQuery.data ?? emptyOpenedProjectFolders
  const projectMetadata = projectMetadataQuery.data ?? emptyOpenCodeProjects
  const openedProjects = mergeOpenedFoldersWithProjectMetadata(openedFolders, projectMetadata)
  const projectsQuery: OpenCodeOpenedProjectsQuery = {
    data: openedProjects,
    error: openedFoldersQuery.error ?? projectMetadataQuery.error,
    isLoading: openedFoldersQuery.isLoading,
    isSuccess: openedFoldersQuery.isSuccess
  }

  const openProjectMutation = useMutation({
    mutationFn: async (directory: string): Promise<OpenProjectByDirectoryResult> => {
      if (connection === null) throw new Error('OpenCode sidecar is not connected.')
      const response = await client!.project.current({ directory })
      if (response.error) throw response.error
      if (!response.data) throw new Error('OpenCode did not return project details.')
      const folder = await window.api.recordOpenedProjectFolder({ directory })
      return { folder, project: response.data }
    },
    onSuccess: async ({ folder, project }) => {
      queryClient.setQueryData(
        openCodeProjectQueryKeys.current(
          folder.directory,
          status.url,
          status.pid,
          status.updatedAt
        ),
        project
      )
      queryClient.setQueryData<OpenedProjectFolder[]>(
        openCodeProjectQueryKeys.openedFolders(),
        (current) => upsertOpenedFolder(current ?? emptyOpenedProjectFolders, folder)
      )
      await queryClient.invalidateQueries({ queryKey: openCodeProjectQueryKeys.openedFolders() })
      await queryClient.invalidateQueries({
        queryKey: openCodeProjectQueryKeys.list(status.url, status.pid, status.updatedAt)
      })
    }
  })

  const removeProjectFolderMutation = useMutation({
    mutationFn: (directory: string): Promise<OpenedProjectFolder | null> =>
      window.api.removeOpenedProjectFolder({ directory }),
    onSuccess: async (_removed, directory) => {
      queryClient.setQueryData<OpenedProjectFolder[]>(
        openCodeProjectQueryKeys.openedFolders(),
        (current) => removeOpenedFolder(current ?? emptyOpenedProjectFolders, directory)
      )
      await queryClient.invalidateQueries({ queryKey: openCodeProjectQueryKeys.openedFolders() })
    }
  })

  return {
    runtime,
    status,
    statusQuery,
    connection,
    connectionQuery,
    projectsQuery,
    openedFoldersQuery,
    projectMetadataQuery,
    openProjectMutation,
    removeProjectFolderMutation,
    openProjectByDirectory: openProjectMutation.mutate
  }
}

export function useOpenCodeProject(directory: string | null | undefined) {
  const { status, statusQuery, connection, connectionQuery, client } = useOpenCodeRuntime()

  const projectQuery = useQuery({
    queryKey: openCodeProjectQueryKeys.current(directory, status.url, status.pid, status.updatedAt),
    queryFn: async (): Promise<OpenCodeCurrentProject> => {
      const response = await client!.project.current({ directory: directory! })
      if (response.error) throw response.error
      if (!response.data) throw new Error('OpenCode did not return project details.')
      return response.data
    },
    enabled: connection !== null && Boolean(directory)
  })

  return {
    status,
    statusQuery,
    connection,
    connectionQuery,
    projectQuery
  }
}

function mergeOpenedFoldersWithProjectMetadata(
  openedFolders: OpenedProjectFolder[],
  projects: OpenCodeProject[]
): OpenCodeOpenedProject[] {
  return openedFolders.map((folder) => {
    const project = projects.find((candidate) => candidate.worktree === folder.directory)
    return {
      ...project,
      directory: folder.directory,
      lastOpenedAt: folder.lastOpenedAt,
      worktree: project?.worktree ?? folder.directory
    } as OpenCodeOpenedProject
  })
}

function upsertOpenedFolder(
  folders: OpenedProjectFolder[],
  folder: OpenedProjectFolder
): OpenedProjectFolder[] {
  return [...folders.filter((current) => current.directory !== folder.directory), folder].sort(
    (left, right) =>
      right.lastOpenedAt - left.lastOpenedAt || left.directory.localeCompare(right.directory)
  )
}

function removeOpenedFolder(
  folders: OpenedProjectFolder[],
  directory: string
): OpenedProjectFolder[] {
  return folders.filter((folder) => folder.directory !== directory)
}
