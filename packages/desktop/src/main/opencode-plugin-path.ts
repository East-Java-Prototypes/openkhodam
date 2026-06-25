import { basename, dirname, join } from 'node:path'

const pluginDirectory = 'opencode-plugins'
const pluginFiles = [
  {
    built: 'openkhodam-poc.mjs',
    source: 'openkhodam-poc.ts'
  },
  {
    built: 'google-workspace.mjs',
    source: 'google-workspace.ts'
  }
] as const

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
  return resolveOpenKhodamPluginPaths({ baseDir, dev, packaged, resourcesPath })[0]
}

export function resolveOpenKhodamPluginPaths({
  baseDir,
  dev = false,
  packaged = false,
  resourcesPath
}: OpenKhodamPluginPathOptions = {}): string[] {
  if (packaged) {
    const resolvedResourcesPath = resourcesPath?.trim() || getResourcesPath()
    if (!resolvedResourcesPath) {
      throw new Error(
        'Electron resourcesPath is required to resolve the bundled OpenKhodam plugin path.'
      )
    }

    return pluginFiles.map((plugin) => join(resolvedResourcesPath, pluginDirectory, plugin.built))
  }

  if (!baseDir) {
    throw new Error('baseDir is required to resolve the OpenKhodam plugin path.')
  }

  const desktopDirectory = resolveDesktopDirectory(baseDir)
  if (dev) {
    return pluginFiles.map((plugin) =>
      join(desktopDirectory, 'src', 'main', pluginDirectory, plugin.source)
    )
  }

  return pluginFiles.map((plugin) => join(desktopDirectory, 'out', pluginDirectory, plugin.built))
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
