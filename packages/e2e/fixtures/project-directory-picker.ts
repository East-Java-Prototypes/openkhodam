import type { ElectronApplication } from '@playwright/test'

export async function installProjectDirectoryPickerMock(
  electronApp: ElectronApplication,
  selectedDirectory: string | null
): Promise<void> {
  await electronApp.evaluate(({ dialog }, directory) => {
    const globalObject = globalThis as any
    globalObject.__projectDirectoryPickerCalls = []

    dialog.showOpenDialog = async (...args: unknown[]) => {
      const options = args.length > 1 ? args[1] : args[0]
      globalObject.__projectDirectoryPickerCalls.push(options)

      if (directory === null) return { canceled: true, filePaths: [] }
      return { canceled: false, filePaths: [directory] }
    }
  }, selectedDirectory)
}

export async function getProjectDirectoryPickerCallCount(
  electronApp: ElectronApplication
): Promise<number> {
  return electronApp.evaluate(() => {
    const calls = (globalThis as any).__projectDirectoryPickerCalls as unknown[] | undefined
    return calls?.length ?? 0
  })
}
