export type WecomEncryptedEnvelope = {
  toUserName: string
  encrypt: string
  agentId: string
}

export type WecomInboundMessage = {
  toUserName: string
  fromUserName: string
  createTime: string
  msgType: string
  content: string
  msgId: string
  event: string
  agentId: string
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

export function getXmlTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`))
  if (!match) return ''
  return decodeXmlEntities((match[1] ?? match[2] ?? '').trim())
}

export function parseEncryptedEnvelope(xml: string): WecomEncryptedEnvelope {
  return {
    toUserName: getXmlTag(xml, 'ToUserName'),
    encrypt: getXmlTag(xml, 'Encrypt'),
    agentId: getXmlTag(xml, 'AgentID'),
  }
}

export function parseInboundMessage(xml: string): WecomInboundMessage {
  return {
    toUserName: getXmlTag(xml, 'ToUserName'),
    fromUserName: getXmlTag(xml, 'FromUserName'),
    createTime: getXmlTag(xml, 'CreateTime'),
    msgType: getXmlTag(xml, 'MsgType'),
    content: getXmlTag(xml, 'Content'),
    msgId: getXmlTag(xml, 'MsgId'),
    event: getXmlTag(xml, 'Event'),
    agentId: getXmlTag(xml, 'AgentID'),
  }
}
