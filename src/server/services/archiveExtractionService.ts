import * as fs from 'fs/promises'
import * as path from 'path'
import * as zlib from 'node:zlib'

const MAX_ARCHIVE_ENTRIES = 20_000
const MAX_ARCHIVE_FILE_BYTES = 64 * 1024 * 1024
const MAX_ARCHIVE_TOTAL_BYTES = 256 * 1024 * 1024
const MAX_CENTRAL_DIRECTORY_BYTES = 16 * 1024 * 1024
const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const LOCAL_FILE_SIGNATURE = 0x04034b50

export type ExtractedArchive = {
  archiveName: string
  outputDir: string
  fileCount: number
  totalBytes: number
  entries: string[]
}

type ZipEntry = {
  name: string
  method: number
  flags: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
  isDirectory: boolean
}

export class ArchiveExtractionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArchiveExtractionError'
  }
}

export function isLocallyExtractableArchiveName(name: string): boolean {
  return name.toLowerCase().endsWith('.zip')
}

export async function extractLocalArchive(input: {
  archiveName: string
  archivePath?: string
  archiveData?: Buffer
  workDir: string
}): Promise<ExtractedArchive> {
  if (!isLocallyExtractableArchiveName(input.archiveName)) {
    throw new ArchiveExtractionError(`Local extraction is not supported for ${input.archiveName}.`)
  }

  const workDir = path.resolve(input.workDir)
  const workDirStat = await fs.stat(workDir).catch(() => null)
  if (!workDirStat?.isDirectory()) {
    throw new ArchiveExtractionError(`Working directory is not available: ${workDir}`)
  }

  const archiveData = input.archiveData ?? await readArchiveFile(input.archivePath)
  const entries = readZipEntries(archiveData)
  if (entries.length === 0) {
    throw new ArchiveExtractionError('Archive does not contain any files.')
  }

  const outputDir = await createArchiveOutputDir(workDir, input.archiveName)
  try {
    let fileCount = 0
    let totalBytes = 0
    const extractedEntries: string[] = []

    for (const entry of entries) {
      const safeName = normalizeArchiveEntryName(entry.name)
      const outputPath = path.resolve(outputDir, safeName)
      if (!isPathInside(outputPath, outputDir)) {
        throw new ArchiveExtractionError(`Unsafe archive path: ${entry.name}`)
      }

      if (entry.isDirectory) {
        await fs.mkdir(outputPath, { recursive: true })
        continue
      }

      fileCount += 1
      totalBytes += entry.uncompressedSize
      if (fileCount > MAX_ARCHIVE_ENTRIES) {
        throw new ArchiveExtractionError(`Archive contains too many files. The limit is ${MAX_ARCHIVE_ENTRIES}.`)
      }
      if (entry.uncompressedSize > MAX_ARCHIVE_FILE_BYTES) {
        throw new ArchiveExtractionError(`${entry.name} is too large after extraction. The per-file limit is ${formatBytes(MAX_ARCHIVE_FILE_BYTES)}.`)
      }
      if (totalBytes > MAX_ARCHIVE_TOTAL_BYTES) {
        throw new ArchiveExtractionError(`Archive expands to more than ${formatBytes(MAX_ARCHIVE_TOTAL_BYTES)}.`)
      }

      const fileData = inflateZipEntry(archiveData, entry)
      await fs.mkdir(path.dirname(outputPath), { recursive: true })
      await fs.writeFile(outputPath, fileData)
      extractedEntries.push(safeName)
    }

    return {
      archiveName: input.archiveName,
      outputDir,
      fileCount,
      totalBytes,
      entries: extractedEntries.slice(0, 80),
    }
  } catch (error) {
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

async function readArchiveFile(archivePath?: string): Promise<Buffer> {
  if (!archivePath) {
    throw new ArchiveExtractionError('Archive file path is missing.')
  }
  return fs.readFile(archivePath)
}

async function createArchiveOutputDir(workDir: string, archiveName: string): Promise<string> {
  const baseName = sanitizeFileName(archiveName.replace(/\.[^.]+$/, '')) || 'archive'
  const outputDir = path.join(
    workDir,
    '.gugu',
    'archive-extracts',
    `${baseName}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
  )
  await fs.mkdir(outputDir, { recursive: true })
  return outputDir
}

function readZipEntries(data: Buffer): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(data)
  if (eocdOffset < 0) {
    throw new ArchiveExtractionError('Invalid ZIP archive: end of central directory not found.')
  }

  const entryCount = data.readUInt16LE(eocdOffset + 10)
  const centralDirectorySize = data.readUInt32LE(eocdOffset + 12)
  const centralDirectoryOffset = data.readUInt32LE(eocdOffset + 16)
  if (entryCount === 0xffff || centralDirectoryOffset === 0xffffffff || centralDirectorySize === 0xffffffff) {
    throw new ArchiveExtractionError('ZIP64 archives are not supported yet.')
  }
  if (entryCount > MAX_ARCHIVE_ENTRIES) {
    throw new ArchiveExtractionError(`Archive contains too many files. The limit is ${MAX_ARCHIVE_ENTRIES}.`)
  }
  if (centralDirectorySize > MAX_CENTRAL_DIRECTORY_BYTES) {
    throw new ArchiveExtractionError('ZIP central directory is too large.')
  }
  if (centralDirectoryOffset + centralDirectorySize > data.length) {
    throw new ArchiveExtractionError('Invalid ZIP archive: central directory is outside the file.')
  }

  const entries: ZipEntry[] = []
  let offset = centralDirectoryOffset
  let totalBytes = 0
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new ArchiveExtractionError('Invalid ZIP archive: malformed central directory.')
    }

    const flags = data.readUInt16LE(offset + 8)
    const method = data.readUInt16LE(offset + 10)
    const compressedSize = data.readUInt32LE(offset + 20)
    const uncompressedSize = data.readUInt32LE(offset + 24)
    const nameLength = data.readUInt16LE(offset + 28)
    const extraLength = data.readUInt16LE(offset + 30)
    const commentLength = data.readUInt16LE(offset + 32)
    const localHeaderOffset = data.readUInt32LE(offset + 42)
    const nameStart = offset + 46
    const nameEnd = nameStart + nameLength
    if (nameEnd > data.length) {
      throw new ArchiveExtractionError('Invalid ZIP archive: entry name is truncated.')
    }

    const name = data.toString((flags & 0x0800) ? 'utf8' : 'utf8', nameStart, nameEnd)
    const safeName = normalizeArchiveEntryName(name)
    const isDirectory = safeName.endsWith('/')
    if ((flags & 0x0001) !== 0) {
      throw new ArchiveExtractionError(`Encrypted ZIP entries are not supported: ${name}`)
    }
    if (method !== 0 && method !== 8) {
      throw new ArchiveExtractionError(`Unsupported ZIP compression method ${method}: ${name}`)
    }
    if (uncompressedSize > MAX_ARCHIVE_FILE_BYTES) {
      throw new ArchiveExtractionError(`${name} is too large after extraction. The per-file limit is ${formatBytes(MAX_ARCHIVE_FILE_BYTES)}.`)
    }
    totalBytes += isDirectory ? 0 : uncompressedSize
    if (totalBytes > MAX_ARCHIVE_TOTAL_BYTES) {
      throw new ArchiveExtractionError(`Archive expands to more than ${formatBytes(MAX_ARCHIVE_TOTAL_BYTES)}.`)
    }

    entries.push({
      name,
      method,
      flags,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      isDirectory,
    })

    offset = nameEnd + extraLength + commentLength
  }

  return entries
}

function inflateZipEntry(data: Buffer, entry: ZipEntry): Buffer {
  if (entry.localHeaderOffset + 30 > data.length || data.readUInt32LE(entry.localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
    throw new ArchiveExtractionError(`Invalid ZIP local header: ${entry.name}`)
  }
  const nameLength = data.readUInt16LE(entry.localHeaderOffset + 26)
  const extraLength = data.readUInt16LE(entry.localHeaderOffset + 28)
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength
  const dataEnd = dataStart + entry.compressedSize
  if (dataEnd > data.length) {
    throw new ArchiveExtractionError(`ZIP entry data is truncated: ${entry.name}`)
  }

  const compressed = data.subarray(dataStart, dataEnd)
  const inflated = entry.method === 0
    ? Buffer.from(compressed)
    : zlib.inflateRawSync(compressed)
  if (inflated.length !== entry.uncompressedSize) {
    throw new ArchiveExtractionError(`ZIP entry size mismatch: ${entry.name}`)
  }
  return inflated
}

function findEndOfCentralDirectory(data: Buffer): number {
  const minOffset = Math.max(0, data.length - 22 - 0xffff)
  for (let offset = data.length - 22; offset >= minOffset; offset -= 1) {
    if (data.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset
    }
  }
  return -1
}

function normalizeArchiveEntryName(name: string): string {
  if (!name || name.includes('\0')) {
    throw new ArchiveExtractionError('Archive contains an empty or invalid path.')
  }
  const normalized = name.replace(/\\/g, '/')
  if (
    normalized.startsWith('/') ||
    normalized.startsWith('//') ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    throw new ArchiveExtractionError(`Unsafe archive path: ${name}`)
  }

  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new ArchiveExtractionError(`Unsafe archive path: ${name}`)
  }
  return parts.join('/') + (normalized.endsWith('/') ? '/' : '')
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '_').replace(/^_+|_+$/g, '')
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) {
    const value = mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10
    return `${value} MB`
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
