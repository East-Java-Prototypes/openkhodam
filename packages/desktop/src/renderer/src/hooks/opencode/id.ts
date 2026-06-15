// Ported from OpenCode desktop's packages/app/src/utils/id.ts.
// Keep this browser-safe helper compatible with OpenCode's native lexicographic ID order.

const prefixes = {
  message: 'msg',
  part: 'prt'
} as const

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
let lastTime = 0
let lastCount = 0

export namespace Identifier {
  export function ascending(kind: keyof typeof prefixes): string {
    const now = Date.now()
    if (now !== lastTime) {
      lastTime = now
      lastCount = 0
    }
    lastCount += 1

    const sortable = BigInt(now) * BigInt(0x1000) + BigInt(lastCount)
    return `${prefixes[kind]}_${encodeSortable(sortable)}${randomBase62(14)}`
  }
}

function encodeSortable(value: bigint): string {
  let result = ''
  for (let i = 0; i < 6; i++) {
    const shift = BigInt(40 - 8 * i)
    const byte = Number((value >> shift) & BigInt(0xff))
    result += byte.toString(16).padStart(2, '0')
  }
  return result
}

function randomBase62(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}
