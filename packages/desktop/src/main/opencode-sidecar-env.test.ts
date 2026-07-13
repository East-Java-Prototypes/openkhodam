import { describe, expect, it } from 'vitest'
import { createPluginEnv } from './opencode-sidecar'

describe('createPluginEnv', () => {
  it('injects only the plugin connection and protocol metadata', () => {
    expect(createPluginEnv({ url: 'http://127.0.0.1:4567', token: 'plugin-token' })).toEqual({
      OPENKHODAM_PLUGIN_URL: 'http://127.0.0.1:4567',
      OPENKHODAM_PLUGIN_TOKEN: 'plugin-token',
      OPENKHODAM_PROTOCOL_VERSION: '1'
    })
  })
})
