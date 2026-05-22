import { describe, expect, it } from 'bun:test'
import { isScreenshotCommand } from '../screenshot-command.js'

describe('screenshot command matcher', () => {
  it('accepts explicit screenshot commands', () => {
    expect(isScreenshotCommand('/screenshot')).toBe(true)
    expect(isScreenshotCommand('/SHOT')).toBe(true)
    expect(isScreenshotCommand('截图')).toBe(true)
    expect(isScreenshotCommand('发一张截图')).toBe(true)
    expect(isScreenshotCommand('帮我截图发给我')).toBe(true)
    expect(isScreenshotCommand('截图给我看看')).toBe(true)
    expect(isScreenshotCommand('直接截屏')).toBe(true)
    expect(isScreenshotCommand('现在截图一下')).toBe(true)
    expect(isScreenshotCommand('帮我截个图')).toBe(true)
    expect(isScreenshotCommand('再试一次截屏')).toBe(true)
    expect(isScreenshotCommand('重新截图')).toBe(true)
    expect(isScreenshotCommand('测试一下截图')).toBe(true)
    expect(isScreenshotCommand('[CQ:at,qq=123456]截图')).toBe(true)
    expect(isScreenshotCommand('@Gu Agent 截图')).toBe(true)
    expect(isScreenshotCommand('Gu Agent 截屏')).toBe(true)
  })

  it('does not treat casual chat as a screenshot command', () => {
    expect(isScreenshotCommand('帮我看看这个截图')).toBe(false)
    expect(isScreenshotCommand('截图功能怎么用')).toBe(false)
    expect(isScreenshotCommand('截图失败怎么办')).toBe(false)
  })
})
