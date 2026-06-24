import { join } from 'node:path'

const pluginDirectory = 'opencode-plugins'
const pluginFileName = 'openkhodam-poc.js'

export type OpenKhodamPluginPathOptions = {
  baseDir?: string
  packaged?: boolean
  resourcesPath?: string
}

export function resolveOpenKhodamPluginPath({
  baseDir,
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

    return join(resolvedResourcesPath, pluginDirectory, pluginFileName)
  }

  if (!baseDir) {
    throw new Error('baseDir is required to resolve the OpenKhodam plugin path.')
  }

  return join(baseDir, pluginDirectory, pluginFileName)
}

function getResourcesPath(): string | undefined {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath?.trim()
}
