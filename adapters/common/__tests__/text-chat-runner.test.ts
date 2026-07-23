import { afterEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { TextChatRunner } from '../text-chat-runner.js'

const cleanupDirs: string[] = []
const originalConfigDir = process.env.CLAUDE_CONFIG_DIR

afterEach(async () => {
  if (originalConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  }
  for (const dir of cleanupDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

describe('TextChatRunner', () => {
  it('allows the same provider message to retry after processing fails', async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-text-runner-'))
    cleanupDirs.push(configDir)
    process.env.CLAUDE_CONFIG_DIR = configDir
    await fs.writeFile(
      path.join(configDir, 'adapters.json'),
      JSON.stringify({ weixin: { allowedUsers: ['user-1'] } }),
    )

    const runner = new TextChatRunner({
      platform: 'weixin',
      serverUrl: 'ws://127.0.0.1:1',
      defaultProjectDir: '',
      sendText: async () => {},
      userLabel: 'Weixin User',
    })
    let attempts = 0
    const testRunner = runner as unknown as {
      routeText: () => Promise<void>
    }
    testRunner.routeText = async () => {
      attempts += 1
      if (attempts === 1) throw new Error('transient failure')
    }
    const message = {
      conversationId: 'conversation-1',
      userId: 'user-1',
      displayName: 'User',
      text: 'hello',
      messageId: 'provider-message-1',
    }

    try {
      await expect(runner.handleIncomingText(message)).rejects.toThrow('transient failure')
      await runner.handleIncomingText(message)
      expect(attempts).toBe(2)
    } finally {
      runner.destroy()
    }
  })
})
