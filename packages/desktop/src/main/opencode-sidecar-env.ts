import { join } from 'node:path'

export type CreateSidecarEnvOptions = {
  env?: NodeJS.ProcessEnv
  password: string
  profileDir: string
  runtimeConfigPath: string
  username?: string
}

export function createSidecarEnv({
  env = process.env,
  password,
  profileDir,
  runtimeConfigPath,
  username = 'opencode'
}: CreateSidecarEnvOptions): NodeJS.ProcessEnv {
  const baseEnv: NodeJS.ProcessEnv = {
    ...env,
    OPENCODE_CLIENT: 'openkhodam-desktop',
    OPENCODE_CONFIG: runtimeConfigPath,
    OPENCODE_CONFIG_DIR: join(profileDir, 'config'),
    OPENCODE_SERVER_USERNAME: username,
    OPENCODE_SERVER_PASSWORD: password,
    XDG_CACHE_HOME: join(profileDir, 'cache'),
    XDG_CONFIG_HOME: join(profileDir, 'config'),
    XDG_DATA_HOME: join(profileDir, 'data'),
    XDG_STATE_HOME: join(profileDir, 'state')
  }

  return {
    ...baseEnv,
    NO_PROXY: withLoopbackNoProxy(baseEnv.NO_PROXY),
    no_proxy: withLoopbackNoProxy(baseEnv.no_proxy)
  }
}

function withLoopbackNoProxy(value: string | undefined): string {
  const items = (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  for (const item of ['127.0.0.1', 'localhost', '::1']) {
    if (!items.some((current) => current.toLowerCase() === item)) items.push(item)
  }

  return items.join(',')
}
