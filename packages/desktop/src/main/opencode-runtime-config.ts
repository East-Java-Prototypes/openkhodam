import { join } from 'node:path'

import { writeJsonConfigFile } from './config/json-config-file'

export type RuntimeOpenCodeConfig = {
  $schema: string
  plugin: string[]
}

const runtimeConfigFileName = 'runtime-opencode-config.json'

export function runtimeOpenCodeConfigPath(userDataPath: string): string {
  return join(userDataPath, 'opencode-sidecar', runtimeConfigFileName)
}

export function createRuntimeOpenCodeConfig(pluginPaths: string | string[]): RuntimeOpenCodeConfig {
  return {
    $schema: 'https://opencode.ai/config.json',
    plugin: Array.isArray(pluginPaths) ? pluginPaths : [pluginPaths]
  }
}

export async function writeRuntimeOpenCodeConfig(
  userDataPath: string,
  pluginPaths: string | string[]
): Promise<string> {
  const filePath = runtimeOpenCodeConfigPath(userDataPath)
  await writeJsonConfigFile(filePath, createRuntimeOpenCodeConfig(pluginPaths))

  return filePath
}
