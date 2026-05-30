import { Link, createFileRoute } from '@tanstack/react-router'
import type { JSX } from 'react'
import { useMemo, useState } from 'react'

import { type OpenCodeProject, useOpenCodeProjects } from '../hooks/useOpenCodeProjects'

export const Route = createFileRoute('/')({ component: IndexRoute })

function IndexRoute(): JSX.Element {
  const { status, connection, connectionQuery, projectsQuery } = useOpenCodeProjects()
  const [selectedDirectory, setSelectedDirectory] = useState<string | null>(null)
  const projects = projectsQuery.data ?? []
  const selectedProject = useMemo(
    () => projects.find((project) => getProjectDirectory(project) === selectedDirectory),
    [projects, selectedDirectory]
  )

  return (
    <main>
      <h1>Projects</h1>
      <p>OpenKhodam desktop is running.</p>

      <section>
        <h2>OpenCode sidecar</h2>
        <p>
          Status: <strong>{status.state}</strong>
          {status.message ? ` — ${status.message}` : null}
        </p>
        {status.state === 'connected' && connection === null ? <p>Loading connection details...</p> : null}
        {connectionQuery.isError ? <p>Connection error: {formatError(connectionQuery.error)}</p> : null}
      </section>

      <section>
        <h2>OpenCode projects</h2>
        {connection === null ? <p>Waiting for an OpenCode sidecar connection before loading projects.</p> : null}
        {projectsQuery.isLoading ? <p>Loading projects...</p> : null}
        {projectsQuery.isError ? <p>Project load error: {formatError(projectsQuery.error)}</p> : null}
        {projectsQuery.isSuccess && projects.length === 0 ? <p>No projects found.</p> : null}
        {projects.length > 0 ? (
          <ul>
            {projects.map((project, index) => {
              const directory = getProjectDirectory(project)
              const id = getProjectId(project)
              const name = getProjectName(project) ?? directory ?? id ?? `Project ${index + 1}`
              const isSelected = directory !== null && directory === selectedDirectory

              return (
                <li key={id ?? directory ?? index}>
                  <button type="button" onClick={() => setSelectedDirectory(directory)} disabled={!directory}>
                    {isSelected ? 'Selected: ' : 'Select '}
                    {name}
                  </button>
                  <dl>
                    <dt>Directory</dt>
                    <dd>{directory ?? 'Unknown'}</dd>
                    <dt>Worktree</dt>
                    <dd>{getProjectWorktree(project) ?? 'Unknown'}</dd>
                    <dt>ID</dt>
                    <dd>{id ?? 'Unknown'}</dd>
                  </dl>
                </li>
              )
            })}
          </ul>
        ) : null}
        {selectedDirectory ? (
          <p>
            Selected directory for the next stack: <code>{selectedDirectory}</code>
            {selectedProject ? null : ' (project no longer in list)'}
          </p>
        ) : null}
      </section>

      <Link to="/settings">Open settings</Link>
    </main>
  )
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function getProjectDirectory(project: OpenCodeProject): string | null {
  return (
    getStringProperty(project, 'worktree') ??
    getStringProperty(project, 'directory') ??
    getStringProperty(project, 'path') ??
    getStringProperty(project, 'root')
  )
}

function getProjectWorktree(project: OpenCodeProject): string | null {
  return getStringProperty(project, 'worktree') ?? getStringProperty(project, 'root')
}

function getProjectName(project: OpenCodeProject): string | null {
  return getStringProperty(project, 'name')
}

function getProjectId(project: OpenCodeProject): string | null {
  return getStringProperty(project, 'id')
}

function getStringProperty(project: OpenCodeProject, property: string): string | null {
  if (typeof project !== 'object' || project === null || !(property in project)) return null
  const value = (project as Record<string, unknown>)[property]
  return typeof value === 'string' && value.length > 0 ? value : null
}
