import type { Command } from '../../commands.js'

export default {
  type: 'local',
  name: 'connect',
  description: 'Connect ChatGPT via browser OAuth and activate the ChatGPT provider',
  supportsNonInteractive: false,
  isSensitive: true,
  load: () => import('./connect.js'),
} satisfies Command
