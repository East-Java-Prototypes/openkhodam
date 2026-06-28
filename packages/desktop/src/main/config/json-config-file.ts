import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

export const DEFAULT_JSON_CONFIG_FILE_MODE = 0o600

export type JsonConfigFileOptions<TConfig> = {
  readonly defaultValue: () => TConfig
  readonly mode?: number
  readonly normalize: (value: unknown) => TConfig
}

export type WriteJsonConfigFileOptions<TConfig> = {
  readonly mode?: number
  readonly normalize?: (value: unknown) => TConfig
}

export class JsonConfigFile<TConfig> {
  readonly filePath: string
  private readonly options: JsonConfigFileOptions<TConfig>

  constructor(filePath: string, options: JsonConfigFileOptions<TConfig>) {
    this.filePath = filePath
    this.options = options
  }

  async read(): Promise<TConfig> {
    return readJsonConfigFile(this.filePath, this.options)
  }

  async write(config: TConfig): Promise<void> {
    await writeJsonConfigFile(this.filePath, config, this.options)
  }
}

export async function readJsonConfigFile<TConfig>(
  filePath: string,
  options: JsonConfigFileOptions<TConfig>
): Promise<TConfig> {
  try {
    const raw = await readFile(filePath, 'utf8')
    return options.normalize(JSON.parse(raw) as unknown)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return options.normalize(options.defaultValue())
    }

    throw error
  }
}

export async function writeJsonConfigFile<TConfig>(
  filePath: string,
  config: TConfig,
  options: WriteJsonConfigFileOptions<TConfig> = {}
): Promise<void> {
  const mode = options.mode ?? DEFAULT_JSON_CONFIG_FILE_MODE
  const normalized = options.normalize ? options.normalize(config) : config
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  let handle: Awaited<ReturnType<typeof open>> | null = null

  await mkdir(dirname(filePath), { recursive: true })

  try {
    handle = await open(temporaryPath, 'w', mode)
    await handle.writeFile(`${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
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
