import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { OpenKhodamConfigFileStore, OpenKhodamConfigStore } from './openkhodam-config'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'openkhodam-config-store-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('OpenKhodamConfigFileStore', () => {
  it('reads normalized defaults from a missing app configuration file', async () => {
    const userDataPath = await createTemporaryDirectory()

    await expect(new OpenKhodamConfigStore(userDataPath).read()).resolves.toEqual({
      version: 1,
      projects: { openedFolders: [] },
      integrations: {
        googleWorkspace: { account: null, scopes: [], token: null, updatedAt: null }
      }
    })
  })

  it('tolerates partial persisted app configuration and normalizes opened folders', async () => {
    const userDataPath = await createTemporaryDirectory()
    const configPath = join(userDataPath, 'openkhodam-config.json')
    await writeFile(
      configPath,
      JSON.stringify({
        projects: {
          openedFolders: [
            { directory: ' workspace/ ', lastOpenedAt: 1 },
            { directory: 'workspace', lastOpenedAt: 3 },
            { directory: '', lastOpenedAt: 4 },
            { directory: 'other', lastOpenedAt: 'bad' }
          ]
        },
        integrations: { googleWorkspace: { scopes: ['email', 1], updatedAt: 'bad' } }
      })
    )
    const store = new OpenKhodamConfigFileStore(configPath)

    await expect(store.read()).resolves.toEqual({
      version: 1,
      projects: {
        openedFolders: [
          { directory: normalize('workspace'), lastOpenedAt: 3 },
          { directory: normalize('other'), lastOpenedAt: 0 }
        ]
      },
      integrations: {
        googleWorkspace: { account: null, scopes: ['email'], token: null, updatedAt: null }
      }
    })
  })

  it('normalizes, deduplicates, and removes opened project folders through store operations', async () => {
    const userDataPath = await createTemporaryDirectory()
    const store = new OpenKhodamConfigStore(userDataPath)
    const first = await store.recordOpenedProjectFolder({ directory: 'workspace/' })
    const second = await store.recordOpenedProjectFolder({ directory: 'workspace' })

    expect(await store.listOpenedProjectFolders()).toEqual([second])
    await expect(store.removeOpenedProjectFolder({ directory: ' workspace/ ' })).resolves.toEqual(
      second
    )
    await expect(store.listOpenedProjectFolders()).resolves.toEqual([])
    await expect(
      store.removeOpenedProjectFolder({ directory: first.directory })
    ).resolves.toBeNull()
  })
})
