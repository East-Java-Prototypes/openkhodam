import { Link, createFileRoute } from '@tanstack/react-router'
import type { JSX } from 'react'
import { useMemo, useState } from 'react'

import {
  type OpenCodeCurrentProject,
  type OpenCodeProject,
  useOpenCodeProject,
  useOpenCodeProjects
} from '../hooks/opencode/projects'

export const Route = createFileRoute('/')({ component: IndexRoute })

function IndexRoute(): JSX.Element {
  const { status, connection, connectionQuery, projectsQuery } = useOpenCodeProjects()
  const [selectedDirectory, setSelectedDirectory] = useState<string | null>(null)
  const [projectDirectory, setProjectDirectory] = useState('')
  const [openedDirectory, setOpenedDirectory] = useState<string | null>(null)
  const { projectQuery } = useOpenCodeProject(openedDirectory)
  const projects = projectsQuery.data ?? []
  const selectedProject = useMemo(
    () => projects.find((project) => project.worktree === selectedDirectory),
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
              const label = projectLabel(project, index)
              const isSelected = project.worktree === selectedDirectory

              return (
                <li key={project.id}>
                  <button type="button" onClick={() => setSelectedDirectory(project.worktree)}>
                    {isSelected ? 'Selected: ' : 'Select '}
                    {label}
                  </button>
                  <dl>
                    <dt>Directory</dt>
                    <dd>{project.worktree}</dd>
                    <dt>Worktree</dt>
                    <dd>{project.worktree}</dd>
                    <dt>ID</dt>
                    <dd>{project.id}</dd>
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

      <section>
        <h2>Open project by directory</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const directory = projectDirectory.trim()
            if (directory) setOpenedDirectory(directory)
          }}
        >
          <label htmlFor="project-directory">Project directory</label>
          <input
            id="project-directory"
            name="project-directory"
            type="text"
            value={projectDirectory}
            onChange={(event) => setProjectDirectory(event.currentTarget.value)}
            placeholder="/path/to/opencode/project"
          />
          <button type="submit" disabled={projectDirectory.trim().length === 0}>
            Open project
          </button>
        </form>
        {openedDirectory ? <p>Opening directory: {openedDirectory}</p> : null}
        {projectQuery.isLoading ? <p>Opening project...</p> : null}
        {projectQuery.isError ? <p>Project open error: {formatError(projectQuery.error)}</p> : null}
        {projectQuery.isSuccess ? <OpenedProjectDetails project={projectQuery.data} /> : null}
      </section>

      <Link to="/settings">Open settings</Link>
    </main>
  )
}

function OpenedProjectDetails({ project }: { project: OpenCodeCurrentProject }): JSX.Element {
  return (
    <section aria-labelledby="opened-project-heading">
      <h3 id="opened-project-heading">Opened project details</h3>
      <dl>
        <dt>Name</dt>
        <dd>{project.name ?? 'Unknown'}</dd>
        <dt>ID</dt>
        <dd>{project.id ?? 'Unknown'}</dd>
        <dt>Worktree</dt>
        <dd>{project.worktree ?? 'Unknown'}</dd>
        <dt>Directory</dt>
        <dd>{project.worktree ?? 'Unknown'}</dd>
      </dl>
    </section>
  )
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function projectLabel(project: OpenCodeProject, index: number): string {
  return project.name ?? project.worktree ?? project.id ?? `Project ${index + 1}`
}
