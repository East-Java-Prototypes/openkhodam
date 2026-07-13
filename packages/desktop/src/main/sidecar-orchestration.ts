export type StartableSidecar = { start(): Promise<unknown> }
export type StoppableSidecar = { stop(): Promise<unknown> }

export async function startSidecars(
  openkhodam: StartableSidecar,
  opencode: StartableSidecar
): Promise<void> {
  await openkhodam.start().catch(() => undefined)
  await opencode.start().catch(() => undefined)
}

export function createQuitCleanup(
  opencode: StoppableSidecar,
  openkhodam: StoppableSidecar,
  exit: () => void
): () => void {
  let quitting = false
  return () => {
    if (quitting) return
    quitting = true
    void (async () => {
      try {
        await opencode.stop().catch(() => undefined)
        await openkhodam.stop().catch(() => undefined)
      } finally {
        exit()
      }
    })()
  }
}
