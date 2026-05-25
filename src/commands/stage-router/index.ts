import type { Command } from '../../commands.js'

export default {
  type: 'local',
  name: 'stage-router',
  aliases: ['stages'],
  description: 'Route planning/review to Cursor and execution to DeepSeek',
  argumentHint: '[status|enable|disable|plan|review]',
  supportsNonInteractive: false,
  load: () => import('./stage-router.js'),
} satisfies Command
