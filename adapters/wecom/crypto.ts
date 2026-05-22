import * as crypto from 'node:crypto'

const RANDOM_PREFIX_BYTES = 16
const MESSAGE_LENGTH_BYTES = 4

function getAesKey(encodingAesKey: string): Buffer {
  const key = Buffer.from(`${encodingAesKey}=`, 'base64')
  if (key.length !== 32) {
    throw new Error('Invalid WeCom EncodingAESKey: decoded key must be 32 bytes')
  }
  return key
}

export function createWecomSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypted: string,
): string {
  return crypto
    .createHash('sha1')
    .update([token, timestamp, nonce, encrypted].sort().join(''))
    .digest('hex')
}

export function verifyWecomSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypted: string,
  signature: string,
): boolean {
  const expected = createWecomSignature(token, timestamp, nonce, encrypted)
  const expectedBuffer = Buffer.from(expected)
  const signatureBuffer = Buffer.from(signature)
  return expectedBuffer.length === signatureBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
}

export function decryptWecomPayload(
  encrypted: string,
  encodingAesKey: string,
  expectedReceiveId: string,
): string {
  const aesKey = getAesKey(encodingAesKey)
  const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, aesKey.subarray(0, 16))
  const plain = Buffer.concat([
    decipher.update(encrypted, 'base64'),
    decipher.final(),
  ])

  const lengthOffset = RANDOM_PREFIX_BYTES
  if (plain.length < lengthOffset + MESSAGE_LENGTH_BYTES) {
    throw new Error('Invalid WeCom payload: too short')
  }

  const messageLength = plain.readUInt32BE(lengthOffset)
  const messageStart = lengthOffset + MESSAGE_LENGTH_BYTES
  const messageEnd = messageStart + messageLength
  if (messageEnd > plain.length) {
    throw new Error('Invalid WeCom payload: message length out of bounds')
  }

  const message = plain.subarray(messageStart, messageEnd).toString('utf-8')
  const receiveId = plain.subarray(messageEnd).toString('utf-8')
  if (expectedReceiveId && receiveId !== expectedReceiveId) {
    throw new Error('Invalid WeCom payload: receive id mismatch')
  }
  return message
}

export function encryptWecomPayloadForTest(
  message: string,
  encodingAesKey: string,
  receiveId: string,
): string {
  const aesKey = getAesKey(encodingAesKey)
  const messageBuffer = Buffer.from(message, 'utf-8')
  const lengthBuffer = Buffer.alloc(MESSAGE_LENGTH_BYTES)
  lengthBuffer.writeUInt32BE(messageBuffer.length, 0)

  const plain = Buffer.concat([
    crypto.randomBytes(RANDOM_PREFIX_BYTES),
    lengthBuffer,
    messageBuffer,
    Buffer.from(receiveId, 'utf-8'),
  ])

  const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, aesKey.subarray(0, 16))
  return Buffer.concat([cipher.update(plain), cipher.final()]).toString('base64')
}
