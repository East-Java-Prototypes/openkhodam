type OpenKhodamPocToolArgs = {
  payload?: {
    message?: string
  }
}

type OpenKhodamPocToolContext = {
  directory: string
  sessionID: string
  worktree: string
}

type OpenKhodamPocToolDefinition = {
  args: {
    payload: {
      additionalProperties: false
      description: string
      properties: {
        message: {
          description: string
          type: 'string'
        }
      }
      type: 'object'
    }
  }
  description: string
  execute: (args: OpenKhodamPocToolArgs, context: OpenKhodamPocToolContext) => Promise<string>
}

type OpenKhodamPocHooks = {
  'experimental.chat.system.transform': (
    _input: { model: { providerID: string; modelID: string }; sessionID?: string },
    output: { system: string[] }
  ) => Promise<void>
  tool: {
    openkhodam_plugin_ping: OpenKhodamPocToolDefinition
  }
}

const pluginName = 'openkhodam-poc'
const toolName = 'openkhodam_plugin_ping'
const loadedMessage = `OpenKhodam Desktop loaded the bundled ${pluginName} plugin; ${toolName} is available.`

export const OpenKhodamPoc = async (): Promise<OpenKhodamPocHooks> => ({
  tool: {
    openkhodam_plugin_ping: {
      description:
        'Ping the bundled OpenKhodam plugin and optionally echo payload.message while returning a non-sensitive proof that session context is present.',
      args: {
        payload: {
          additionalProperties: false,
          description: 'Optional message payload. Leave it empty to get pong.',
          properties: {
            message: {
              description: 'Optional message to echo back.',
              type: 'string'
            }
          },
          type: 'object'
        }
      },
      async execute(args, context) {
        const message =
          typeof args.payload?.message === 'string' && args.payload.message.trim()
            ? args.payload.message
            : 'pong'

        const connection = getOpenKhodamPluginConnection(process.env)
        let ok = false
        if (connection) {
          try {
            ok = (await createOpenKhodamClient(connection).health()).status === 'ok'
          } catch {
            ok = false
          }
        }

        return JSON.stringify({
          ok,
          plugin: pluginName,
          tool: toolName,
          message,
          hasSessionID: Boolean(context.sessionID),
          hasDirectory: Boolean(context.directory),
          hasWorktree: Boolean(context.worktree)
        })
      }
    }
  },
  'experimental.chat.system.transform': async (_input, output) => {
    output.system.push(loadedMessage)
  }
})
import { createOpenKhodamClient, getOpenKhodamPluginConnection } from '@openkhodam/client'
