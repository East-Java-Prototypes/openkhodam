import { basename, dirname, join } from 'node:path'

const skillDirectory = 'opencode-skills'

export type OpenKhodamSkillPathOptions = {
  baseDir?: string
  dev?: boolean
  packaged?: boolean
  resourcesPath?: string
}

export function resolveOpenKhodamSkillPath({
  baseDir,
  dev = false,
  packaged = false,
  resourcesPath
}: OpenKhodamSkillPathOptions = {}): string {
  if (packaged) {
    const resolvedResourcesPath = resourcesPath?.trim() || getResourcesPath()
    if (!resolvedResourcesPath) {
      throw new Error(
        'Electron resourcesPath is required to resolve the bundled OpenKhodam skill path.'
      )
    }

    return join(resolvedResourcesPath, skillDirectory)
  }

  if (!baseDir) {
    throw new Error('baseDir is required to resolve the OpenKhodam skill path.')
  }

  const desktopDirectory = resolveDesktopDirectory(baseDir)
  return dev
    ? join(desktopDirectory, 'src', 'main', skillDirectory)
    : join(desktopDirectory, 'out', skillDirectory)
}

function resolveDesktopDirectory(baseDir: string): string {
  const currentDirectory = basename(baseDir)
  const parentDirectory = basename(dirname(baseDir))

  if (currentDirectory === 'main' && (parentDirectory === 'out' || parentDirectory === 'src')) {
    return dirname(dirname(baseDir))
  }

  return baseDir
}

function getResourcesPath(): string | undefined {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath?.trim()
}
