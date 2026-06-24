import { mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export type RuntimeOpenCodeConfig = {
  $schema: string
  plugin: string[]
}

const runtimeConfigFileName = 'runtime-opencode-config.json'

export function runtimeOpenCodeConfigPath(userDataPath: string): string {
  return join(userDataPath, 'opencode-sidecar', runtimeConfigFileName)
}

export function createRuntimeOpenCodeConfig(pluginPath: string): RuntimeOpenCodeConfig {
  return {
    $schema: 'https://opencode.ai/config.json',
    plugin: [pluginPath]
  }
}

export async function writeRuntimeOpenCodeConfig(
  userDataPath: string,
  pluginPath: string
): Promise<string> {
  const filePath = runtimeOpenCodeConfigPath(userDataPath)
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`

  await mkdir(dirname(filePath), { recursive: true })

  const handle = await open(temporaryPath, 'w', 0o600)

  try {
    await handle.writeFile(
      `${JSON.stringify(createRuntimeOpenCodeConfig(pluginPath), null, 2)}\n`,
      'utf8'
    )
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    await rename(temporaryPath, filePath)
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }

  return filePath
}
