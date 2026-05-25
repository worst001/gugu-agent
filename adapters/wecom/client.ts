import { splitMessage } from '../common/format.js'

type AccessTokenResponse = {
  errcode?: number
  errmsg?: string
  access_token?: string
  expires_in?: number
}

type SendMessageResponse = {
  errcode?: number
  errmsg?: string
}

type UploadMediaResponse = {
  errcode?: number
  errmsg?: string
  type?: string
  media_id?: string
  created_at?: string
}

const WECOM_TEXT_LIMIT = 1900

export class WecomClient {
  private accessToken: string | null = null
  private expiresAt = 0

  constructor(
    private corpId: string,
    private secret: string,
    private agentId: string,
  ) {}

  async sendText(userId: string, text: string): Promise<void> {
    const chunks = splitMessage(text, WECOM_TEXT_LIMIT)
    for (const chunk of chunks) {
      await this.sendTextChunk(userId, chunk)
    }
  }

  async sendImage(userId: string, buffer: Buffer, fileName = 'screenshot.png', mime = 'image/png'): Promise<void> {
    const mediaId = await this.uploadTempMedia('image', buffer, fileName, mime)
    await this.sendImageMediaId(userId, mediaId)
  }

  private async sendTextChunk(userId: string, text: string, retry = true): Promise<void> {
    const accessToken = await this.getAccessToken()
    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: userId,
          msgtype: 'text',
          agentid: Number(this.agentId),
          text: { content: text },
          safe: 0,
        }),
      },
    )
    const data = await response.json().catch(() => ({})) as SendMessageResponse
    if (data.errcode === 0) return

    if (retry && (data.errcode === 40014 || data.errcode === 42001)) {
      this.accessToken = null
      this.expiresAt = 0
      await this.sendTextChunk(userId, text, false)
      return
    }

    throw new Error(`WeCom send failed: ${data.errcode ?? response.status} ${data.errmsg ?? response.statusText}`)
  }

  private async sendImageMediaId(userId: string, mediaId: string, retry = true): Promise<void> {
    const accessToken = await this.getAccessToken()
    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: userId,
          msgtype: 'image',
          agentid: Number(this.agentId),
          image: { media_id: mediaId },
          safe: 0,
        }),
      },
    )
    const data = await response.json().catch(() => ({})) as SendMessageResponse
    if (data.errcode === 0) return

    if (retry && (data.errcode === 40014 || data.errcode === 42001)) {
      this.accessToken = null
      this.expiresAt = 0
      await this.sendImageMediaId(userId, mediaId, false)
      return
    }

    throw new Error(`WeCom image send failed: ${data.errcode ?? response.status} ${data.errmsg ?? response.statusText}`)
  }

  private async uploadTempMedia(
    type: 'image' | 'voice' | 'video' | 'file',
    buffer: Buffer,
    fileName: string,
    mime: string,
    retry = true,
  ): Promise<string> {
    const accessToken = await this.getAccessToken()
    const form = new FormData()
    form.append('media', new Blob([new Uint8Array(buffer)], { type: mime }), fileName)

    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${encodeURIComponent(accessToken)}&type=${encodeURIComponent(type)}`,
      {
        method: 'POST',
        body: form,
      },
    )
    const data = await response.json().catch(() => ({})) as UploadMediaResponse
    if (data.errcode === 0 && data.media_id) return data.media_id

    if (retry && (data.errcode === 40014 || data.errcode === 42001)) {
      this.accessToken = null
      this.expiresAt = 0
      return await this.uploadTempMedia(type, buffer, fileName, mime, false)
    }

    throw new Error(`WeCom media upload failed: ${data.errcode ?? response.status} ${data.errmsg ?? response.statusText}`)
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt) return this.accessToken

    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(this.corpId)}&corpsecret=${encodeURIComponent(this.secret)}`,
    )
    const data = await response.json().catch(() => ({})) as AccessTokenResponse
    if (data.errcode && data.errcode !== 0) {
      throw new Error(`WeCom token failed: ${data.errcode} ${data.errmsg ?? ''}`)
    }
    if (!data.access_token) {
      throw new Error(`WeCom token failed: ${response.status} ${response.statusText}`)
    }

    this.accessToken = data.access_token
    this.expiresAt = Date.now() + Math.max(60, (data.expires_in ?? 7200) - 120) * 1000
    return this.accessToken
  }
}
