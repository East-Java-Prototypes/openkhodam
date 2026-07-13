import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { JsonConfigFile, writeJsonConfigFile } from './json-config-file'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'openkhodam-json-config-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('JsonConfigFile', () => {
  it('returns normalized defaults when the file is missing', async () => {
    const directory = await createTemporaryDirectory()
    const configFile = new JsonConfigFile(join(directory, 'config.json'), {
      defaultValue: () => ({ enabled: false, items: [] as string[] }),
      normalize: normalizeTestConfig
    })

    await expect(configFile.read()).resolves.toEqual({ enabled: false, items: [] })
  })

  it('normalizes partial persisted configuration', async () => {
    const directory = await createTemporaryDirectory()
    const configPath = join(directory, 'config.json')
    await writeFile(configPath, JSON.stringify({ enabled: true, items: ['one', 2] }))
    const configFile = new JsonConfigFile(configPath, {
      defaultValue: () => ({ enabled: false, items: [] as string[] }),
      normalize: normalizeTestConfig
    })

    await expect(configFile.read()).resolves.toEqual({ enabled: true, items: ['one'] })
  })

  it('propagates invalid JSON failures', async () => {
    const directory = await createTemporaryDirectory()
    const configPath = join(directory, 'config.json')
    await writeFile(configPath, '{ invalid json')
    const configFile = new JsonConfigFile(configPath, {
      defaultValue: () => ({ enabled: false, items: [] as string[] }),
      normalize: normalizeTestConfig
    })

    await expect(configFile.read()).rejects.toThrow(SyntaxError)
  })

  it('writes normalized JSON through a replacement and applies the configured mode', async () => {
    const directory = await createTemporaryDirectory()
    const configPath = join(directory, 'nested', 'config.json')
    await writeJsonConfigFile(
      configPath,
      { enabled: true, items: ['one', 2] } as unknown as TestConfig,
      { normalize: normalizeTestConfig }
    )

    expect(await readFile(configPath, 'utf8')).toBe(
      '{\n  "enabled": true,\n  "items": [\n    "one"\n  ]\n}\n'
    )
    if (process.platform !== 'win32') expect((await stat(configPath)).mode & 0o777).toBe(0o600)
    expect(
      (await readdir(join(directory, 'nested'))).filter((entry) => entry.endsWith('.tmp'))
    ).toEqual([])
  })

  it('cleans up its temporary file after a deterministic rename failure', async () => {
    const directory = await createTemporaryDirectory()
    const destinationDirectory = join(directory, 'config.json')
    await mkdir(destinationDirectory)

    await expect(
      writeJsonConfigFile(destinationDirectory, { enabled: true, items: [] })
    ).rejects.toMatchObject({
      code: expect.any(String)
    })
    expect((await readdir(directory)).filter((entry) => entry.endsWith('.tmp'))).toEqual([])
  })
})

type TestConfig = { enabled: boolean; items: string[] }

function normalizeTestConfig(value: unknown): TestConfig {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    enabled: record.enabled === true,
    items: Array.isArray(record.items)
      ? record.items.filter((item): item is string => typeof item === 'string')
      : []
  }
}
