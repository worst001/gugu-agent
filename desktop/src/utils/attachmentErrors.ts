export function isUnsupportedAttachmentInputError(message: string): boolean {
  const normalized = message.toLowerCase()

  return (
    normalized.includes('does not support image input') ||
    normalized.includes('does not support file input') ||
    normalized.includes('vision-capable provider/model') ||
    normalized.includes('unsupported image format') ||
    normalized.includes('unsupported file type') ||
    normalized.includes('无法识别图片') ||
    normalized.includes('无法识别文件') ||
    normalized.includes('不支持图片') ||
    normalized.includes('不支持图像') ||
    normalized.includes('不支持文件')
  )
}
