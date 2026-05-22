import { describe, expect, test } from 'bun:test'
import {
  createWecomSignature,
  decryptWecomPayload,
  encryptWecomPayloadForTest,
  verifyWecomSignature,
} from './crypto.js'
import { getXmlTag, parseEncryptedEnvelope, parseInboundMessage } from './xml.js'

const encodingAesKey = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'

describe('wecom crypto helpers', () => {
  test('signs and verifies encrypted payloads', () => {
    const signature = createWecomSignature('token', '123', 'nonce', 'encrypted')
    expect(verifyWecomSignature('token', '123', 'nonce', 'encrypted', signature)).toBe(true)
    expect(verifyWecomSignature('token', '123', 'nonce', 'tampered', signature)).toBe(false)
  })

  test('decrypts a WeCom encrypted payload', () => {
    const xml = '<xml><Content><![CDATA[hello]]></Content></xml>'
    const encrypted = encryptWecomPayloadForTest(xml, encodingAesKey, 'wwcorp')
    expect(decryptWecomPayload(encrypted, encodingAesKey, 'wwcorp')).toBe(xml)
    expect(() => decryptWecomPayload(encrypted, encodingAesKey, 'other')).toThrow()
  })
})

describe('wecom xml helpers', () => {
  test('parses encrypted envelopes and inbound text messages', () => {
    const envelope = parseEncryptedEnvelope('<xml><ToUserName><![CDATA[wwcorp]]></ToUserName><Encrypt><![CDATA[cipher]]></Encrypt><AgentID><![CDATA[1000002]]></AgentID></xml>')
    expect(envelope).toEqual({ toUserName: 'wwcorp', encrypt: 'cipher', agentId: '1000002' })

    const message = parseInboundMessage('<xml><ToUserName><![CDATA[wwcorp]]></ToUserName><FromUserName><![CDATA[zhangsan]]></FromUserName><CreateTime>1710000000</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[hello & welcome]]></Content><MsgId>123</MsgId><AgentID>1000002</AgentID></xml>')
    expect(message.fromUserName).toBe('zhangsan')
    expect(message.content).toBe('hello & welcome')
    expect(message.msgType).toBe('text')
    expect(getXmlTag('<xml><Content>Tom &amp; Jerry</Content></xml>', 'Content')).toBe('Tom & Jerry')
  })
})
