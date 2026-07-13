import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

export const DEFAULT_JSON_CONFIG_FILE_MODE = 0o600

export type JsonConfigFileOptions<TConfig> = {
  readonly defaultValue: () => TConfig
  readonly mode?: number
  readonly normalize: (value: unknown) => TConfig
}

export class JsonConfigFile<TConfig> {
  constructor(
    readonly filePath: string,
    private readonly options: JsonConfigFileOptions<TConfig>
  ) {}
  read(): Promise<TConfig> {
    return readJsonConfigFile(this.filePath, this.options)
  }
  write(config: TConfig): Promise<void> {
    return writeJsonConfigFile(this.filePath, config, this.options)
  }
}

export async function readJsonConfigFile<TConfig>(
  filePath: string,
  options: JsonConfigFileOptions<TConfig>
): Promise<TConfig> {
  try {
    return options.normalize(JSON.parse(await readFile(filePath, 'utf8')) as unknown)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT')
      return options.normalize(options.defaultValue())
    throw error
  }
}

export async function writeJsonConfigFile<TConfig>(
  filePath: string,
  config: TConfig,
  options: { mode?: number; normalize?: (value: unknown) => TConfig } = {}
): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  let handle: Awaited<ReturnType<typeof open>> | null = null
  await mkdir(dirname(filePath), { recursive: true })
  try {
    handle = await open(temporaryPath, 'w', options.mode ?? DEFAULT_JSON_CONFIG_FILE_MODE)
    await handle.writeFile(
      `${JSON.stringify(options.normalize ? options.normalize(config) : config, null, 2)}\n`,
      'utf8'
    )
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temporaryPath, filePath)
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined)
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
