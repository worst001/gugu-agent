import * as React from 'react'
import { Box, Text } from 'src/ink.js'
import { Clawd } from './Clawd.js'

const WELCOME_V2_WIDTH = 58
const WELCOME_MESSAGE = 'Welcome to Claude Code GuGu'

export function WelcomeV2(): React.ReactNode {
  return (
    <Box width={WELCOME_V2_WIDTH} flexDirection="column">
      <Text>
        <Text color="claude">{WELCOME_MESSAGE} </Text>
        <Text dimColor>v{MACRO.VERSION} </Text>
      </Text>
      <Text dimColor>{'………………………………………………………………………………'}</Text>
      <Box marginTop={1} flexDirection="row" gap={2} alignItems="center">
        <Clawd />
        <Box flexDirection="column">
          <Text>
            <Text color="warning">✦</Text>
            <Text>{' GuGu is ready to code'}</Text>
          </Text>
          <Text dimColor>{'A tiny squirrel helper for your terminal.'}</Text>
        </Box>
      </Box>
      <Text dimColor>{'………………………………………………………………………………'}</Text>
    </Box>
  )
}
