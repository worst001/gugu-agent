import * as React from 'react'
import { Box, Text } from '../../ink.js'

export type ClawdPose =
  | 'default'
  | 'arms-up'
  | 'look-left'
  | 'look-right'

type Props = {
  pose?: ClawdPose
}

type Eyes = {
  left: string
  right: string
}

const EYES: Record<ClawdPose, Eyes> = {
  default: { left: '●', right: '●' },
  'look-left': { left: '●', right: '◐' },
  'look-right': { left: '◑', right: '●' },
  'arms-up': { left: '●', right: '●' },
}

export function Clawd({ pose = 'default' }: Props = {}): React.ReactNode {
  const eyes = EYES[pose]
  const armLeft = pose === 'arms-up' ? '╲' : ' '
  const armRight = pose === 'arms-up' ? '╱' : ' '

  return (
    <Box flexDirection="column" alignItems="center">
      <Text color="clawd_body">{'   ▟▙     ▟▙   '}</Text>
      <Text color="clawd_body">{'  ▟██▙▄▄▟██▙  '}</Text>
      <Text>
        <Text color="clawd_body">{' ▐█'}</Text>
        <Text color="clawd_background" backgroundColor="clawd_body">{eyes.left}</Text>
        <Text color="clawd_body">{'███'}</Text>
        <Text color="clawd_background" backgroundColor="clawd_body">{eyes.right}</Text>
        <Text color="clawd_body">{'█▌ ▟█▌'}</Text>
      </Text>
      <Text>
        <Text color="clawd_body">{' ▐█'}</Text>
        <Text color="permission">{'◖'}</Text>
        <Text color="clawd_body">{' ▾ '}</Text>
        <Text color="permission">{'◗'}</Text>
        <Text color="clawd_body">{'█▌▟█▛ '}</Text>
      </Text>
      <Text>
        <Text color="clawd_body">{`${armLeft}▜█████▛${armRight}▝▛  `}</Text>
        <Text color="warning">✦</Text>
      </Text>
      <Text color="clawd_body">{'   ▘▘ ▝▝       '}</Text>
    </Box>
  )
}
