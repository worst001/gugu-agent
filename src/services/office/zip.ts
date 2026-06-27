import { deflateRawSync, inflateRawSync } from 'node:zlib'

export type ZipEntry = {
  name: string
  data: Buffer
  compressionMethod?: 0 | 8
}

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const UTF8_GENERAL_PURPOSE_FLAG = 0x0800
const VERSION_NEEDED_TO_EXTRACT = 20

let crcTable: Uint32Array | null = null

export function readZipEntries(archive: Buffer): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(archive)
  const entryCount = archive.readUInt16LE(eocdOffset + 10)
  const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16)
  const entries: ZipEntry[] = []
  let offset = centralDirectoryOffset

  for (let i = 0; i < entryCount; i++) {
    assertSignature(archive, offset, CENTRAL_DIRECTORY_SIGNATURE, 'central directory')

    const compressionMethod = archive.readUInt16LE(offset + 10)
    const compressedSize = archive.readUInt32LE(offset + 20)
    const uncompressedSize = archive.readUInt32LE(offset + 24)
    const fileNameLength = archive.readUInt16LE(offset + 28)
    const extraFieldLength = archive.readUInt16LE(offset + 30)
    const commentLength = archive.readUInt16LE(offset + 32)
    const localHeaderOffset = archive.readUInt32LE(offset + 42)
    const fileNameStart = offset + 46
    const fileNameEnd = fileNameStart + fileNameLength
    const name = archive.subarray(fileNameStart, fileNameEnd).toString('utf8')

    assertSignature(
      archive,
      localHeaderOffset,
      LOCAL_FILE_HEADER_SIGNATURE,
      `local header for ${name}`,
    )

    const localFileNameLength = archive.readUInt16LE(localHeaderOffset + 26)
    const localExtraFieldLength = archive.readUInt16LE(localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength
    const dataEnd = dataStart + compressedSize
    const compressedData = archive.subarray(dataStart, dataEnd)
    let data: Buffer

    if (compressionMethod === 0) {
      data = Buffer.from(compressedData)
    } else if (compressionMethod === 8) {
      data = inflateRawSync(compressedData)
    } else {
      throw new Error(`Unsupported ZIP compression method ${compressionMethod} for ${name}`)
    }

    if (uncompressedSize !== data.length) {
      throw new Error(
        `Invalid ZIP entry size for ${name}: expected ${uncompressedSize}, got ${data.length}`,
      )
    }

    entries.push({
      name,
      data,
      compressionMethod: compressionMethod as 0 | 8,
    })

    offset = fileNameEnd + extraFieldLength + commentLength
  }

  return entries
}

export function writeZipEntries(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const fileName = Buffer.from(entry.name, 'utf8')
    const data = Buffer.from(entry.data)
    const compressionMethod = entry.compressionMethod ?? 8
    const compressedData = compressionMethod === 0 ? data : deflateRawSync(data)
    const checksum = crc32(data)
    const localHeader = Buffer.alloc(30)

    localHeader.writeUInt32LE(LOCAL_FILE_HEADER_SIGNATURE, 0)
    localHeader.writeUInt16LE(VERSION_NEEDED_TO_EXTRACT, 4)
    localHeader.writeUInt16LE(UTF8_GENERAL_PURPOSE_FLAG, 6)
    localHeader.writeUInt16LE(compressionMethod, 8)
    localHeader.writeUInt16LE(0, 10)
    localHeader.writeUInt16LE(0, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(compressedData.length, 18)
    localHeader.writeUInt32LE(data.length, 22)
    localHeader.writeUInt16LE(fileName.length, 26)
    localHeader.writeUInt16LE(0, 28)

    localParts.push(localHeader, fileName, compressedData)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(CENTRAL_DIRECTORY_SIGNATURE, 0)
    centralHeader.writeUInt16LE(VERSION_NEEDED_TO_EXTRACT, 4)
    centralHeader.writeUInt16LE(VERSION_NEEDED_TO_EXTRACT, 6)
    centralHeader.writeUInt16LE(UTF8_GENERAL_PURPOSE_FLAG, 8)
    centralHeader.writeUInt16LE(compressionMethod, 10)
    centralHeader.writeUInt16LE(0, 12)
    centralHeader.writeUInt16LE(0, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(compressedData.length, 20)
    centralHeader.writeUInt32LE(data.length, 24)
    centralHeader.writeUInt16LE(fileName.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)

    centralParts.push(centralHeader, fileName)
    offset += localHeader.length + fileName.length + compressedData.length
  }

  const centralDirectoryOffset = offset
  const centralDirectory = Buffer.concat(centralParts)
  const centralDirectorySize = centralDirectory.length
  const eocd = Buffer.alloc(22)

  eocd.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralDirectorySize, 12)
  eocd.writeUInt32LE(centralDirectoryOffset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralDirectory, eocd])
}

function findEndOfCentralDirectory(archive: Buffer): number {
  const minimumOffset = Math.max(0, archive.length - 65_558)

  for (let offset = archive.length - 22; offset >= minimumOffset; offset--) {
    if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset
    }
  }

  throw new Error('Invalid ZIP file: end of central directory not found')
}

function assertSignature(
  archive: Buffer,
  offset: number,
  expected: number,
  label: string,
) {
  if (offset < 0 || offset + 4 > archive.length || archive.readUInt32LE(offset) !== expected) {
    throw new Error(`Invalid ZIP file: missing ${label} signature`)
  }
}

function crc32(data: Buffer): number {
  const table = getCrcTable()
  let crc = 0xffffffff

  for (const byte of data) {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff]!
  }

  return (crc ^ 0xffffffff) >>> 0
}

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable

  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let value = i
    for (let j = 0; j < 8; j++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[i] = value >>> 0
  }
  crcTable = table
  return table
}
