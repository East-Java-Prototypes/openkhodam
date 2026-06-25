import { basename, dirname, join } from 'node:path'

const pluginDirectory = 'opencode-plugins'
const builtPluginFileName = 'openkhodam-poc.mjs'
const sourcePluginFileName = 'openkhodam-poc.ts'

export type OpenKhodamPluginPathOptions = {
  baseDir?: string
  dev?: boolean
  packaged?: boolean
  resourcesPath?: string
}

export function resolveOpenKhodamPluginPath({
  baseDir,
  dev = false,
  packaged = false,
  resourcesPath
}: OpenKhodamPluginPathOptions = {}): string {
  if (packaged) {
    const resolvedResourcesPath = resourcesPath?.trim() || getResourcesPath()
    if (!resolvedResourcesPath) {
      throw new Error(
        'Electron resourcesPath is required to resolve the bundled OpenKhodam plugin path.'
      )
    }

    return join(resolvedResourcesPath, pluginDirectory, builtPluginFileName)
  }

  if (!baseDir) {
    throw new Error('baseDir is required to resolve the OpenKhodam plugin path.')
  }

  const desktopDirectory = resolveDesktopDirectory(baseDir)
  if (dev) {
    return join(desktopDirectory, 'src', 'main', pluginDirectory, sourcePluginFileName)
  }

  return join(desktopDirectory, 'out', pluginDirectory, builtPluginFileName)
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
