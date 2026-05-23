import { describe, expect, it } from 'vitest'
import {
  MAX_ATTACHMENT_FILE_BYTES,
  MAX_ATTACHMENT_TOTAL_BYTES,
  MAX_LOCAL_ARCHIVE_FILE_BYTES,
  estimateDataUrlBytes,
  formatAttachmentBytes,
  isArchiveFileName,
  validateAttachmentFile,
} from './attachmentLimits'

describe('attachmentLimits', () => {
  it('detects compressed archive names', () => {
    expect(isArchiveFileName('project.zip')).toBe(true)
    expect(isArchiveFileName('archive.tar.gz')).toBe(true)
    expect(isArchiveFileName('notes.txt')).toBe(false)
  })

  it('allows archive uploads through the composer size gate', () => {
    const issue = validateAttachmentFile({
      name: 'firmware.zip',
      size: 1024,
      type: 'application/zip',
    }, [])

    expect(issue).toBeNull()
  })

  it('allows larger local archive path drops', () => {
    const issue = validateAttachmentFile({
      name: 'project.zip',
      size: MAX_ATTACHMENT_FILE_BYTES + 1,
      type: 'application/zip',
    }, [], 0, { allowLargeLocalArchive: true })

    expect(issue).toBeNull()
  })

  it('still caps very large local archive path drops', () => {
    const issue = validateAttachmentFile({
      name: 'project.zip',
      size: MAX_LOCAL_ARCHIVE_FILE_BYTES + 1,
      type: 'application/zip',
    }, [], 0, { allowLargeLocalArchive: true })

    expect(issue?.key).toBe('chat.attachmentRejectedTooLarge')
  })

  it('rejects files over the per-file limit', () => {
    const issue = validateAttachmentFile({
      name: 'huge.pdf',
      size: MAX_ATTACHMENT_FILE_BYTES + 1,
      type: 'application/pdf',
    }, [])

    expect(issue?.key).toBe('chat.attachmentRejectedTooLarge')
    expect(issue?.params.limit).toBe(formatAttachmentBytes(MAX_ATTACHMENT_FILE_BYTES))
  })

  it('rejects uploads that would exceed the total composer limit', () => {
    const issue = validateAttachmentFile({
      name: 'part-2.txt',
      size: 2 * 1024 * 1024,
      type: 'text/plain',
    }, [{ size: MAX_ATTACHMENT_TOTAL_BYTES - (1024 * 1024) }])

    expect(issue?.key).toBe('chat.attachmentRejectedTotalTooLarge')
  })

  it('estimates data URL payload bytes', () => {
    expect(estimateDataUrlBytes('data:text/plain;base64,aGVsbG8=')).toBe(5)
  })
})
