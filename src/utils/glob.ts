import { basename, dirname, isAbsolute, join, sep } from 'path'
import picomatch from 'picomatch'
import type { ToolPermissionContext } from '../Tool.js'
import { isEnvTruthy } from './envUtils.js'
import { getFsImplementation } from './fsOperations.js'
import {
  getFileReadIgnorePatterns,
  normalizePatternsToPath,
} from './permissions/filesystem.js'
import { getPlatform } from './platform.js'
import { getGlobExclusionsForPluginCache } from './plugins/orphanedPluginFilter.js'
import { ripGrep } from './ripgrep.js'

const NODE_FALLBACK_MAX_DIRS = 20_000

type GlobMatch = {
  path: string
  modifiedMs: number
}

function normalizeGlobPath(path: string): string {
  return path.replace(/\\/g, '/')
}

function stripNegativeGlobPrefix(pattern: string): string {
  return pattern.startsWith('!') ? pattern.slice(1) : pattern
}

function stripRootGlobPrefix(pattern: string): string {
  return pattern.startsWith('/') ? pattern.slice(1) : pattern
}

function createSearchMatcher(pattern: string): (
  relativePath: string,
  fileName: string,
) => boolean {
  const normalizedPattern = normalizeGlobPath(pattern)
  const patternHasPathSegment = normalizedPattern.includes('/')
  const matcher = picomatch(normalizedPattern, { dot: true })

  return (relativePath, fileName) => {
    if (patternHasPathSegment) {
      return matcher(relativePath)
    }
    // Match basename for ripgrep-like "*.ts" behavior across subdirectories.
    return matcher(fileName) || matcher(relativePath)
  }
}

function createIgnoreMatcher(patterns: string[]): (relativePath: string) => boolean {
  if (patterns.length === 0) {
    return () => false
  }

  const normalizedPatterns = patterns
    .map(stripNegativeGlobPrefix)
    .map(stripRootGlobPrefix)
    .map(normalizeGlobPath)
    .filter(Boolean)

  if (normalizedPatterns.length === 0) {
    return () => false
  }

  const matcher = picomatch(normalizedPatterns, { dot: true })
  return relativePath => matcher(relativePath) || matcher(`/${relativePath}`)
}

function isRipgrepUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const errno = (error as NodeJS.ErrnoException).code
  return (
    errno === 'ENOENT' ||
    error.message.includes('ripgrep is not available')
  )
}

export async function globWithNodeFallback(
  searchPattern: string,
  searchDir: string,
  { limit, offset }: { limit: number; offset: number },
  abortSignal: AbortSignal,
  ignorePatterns: string[],
  hidden: boolean,
): Promise<{ files: string[]; truncated: boolean }> {
  const fs = getFsImplementation()
  const matches: GlobMatch[] = []
  const shouldInclude = createSearchMatcher(searchPattern)
  const shouldIgnore = createIgnoreMatcher(ignorePatterns)
  const pendingDirs: Array<{ absolutePath: string; relativePath: string }> = [
    { absolutePath: searchDir, relativePath: '' },
  ]
  const maxMatches = offset + limit + 1
  let visitedDirs = 0
  let truncated = false

  while (pendingDirs.length > 0) {
    if (abortSignal.aborted) {
      throw abortSignal.reason ?? new Error('Glob search aborted')
    }

    const current = pendingDirs.shift()
    if (!current) {
      break
    }

    visitedDirs += 1
    if (visitedDirs > NODE_FALLBACK_MAX_DIRS) {
      truncated = true
      break
    }

    let entries
    try {
      entries = await fs.readdir(current.absolutePath)
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!hidden && entry.name.startsWith('.')) {
        continue
      }

      const absolutePath = join(current.absolutePath, entry.name)
      const relativePath = current.relativePath
        ? `${current.relativePath}/${entry.name}`
        : entry.name
      const normalizedRelativePath = normalizeGlobPath(relativePath)

      if (shouldIgnore(normalizedRelativePath)) {
        continue
      }

      if (entry.isDirectory()) {
        pendingDirs.push({
          absolutePath,
          relativePath: normalizedRelativePath,
        })
        continue
      }

      if (!entry.isFile() && !entry.isSymbolicLink()) {
        continue
      }

      if (!shouldInclude(normalizedRelativePath, entry.name)) {
        continue
      }

      try {
        const stats = await fs.stat(absolutePath)
        if (!stats.isFile()) {
          continue
        }
        matches.push({ path: absolutePath, modifiedMs: stats.mtimeMs })
      } catch {
        continue
      }

      if (matches.length >= maxMatches) {
        truncated = true
        break
      }
    }

    if (truncated) {
      break
    }
  }

  matches.sort((a, b) => a.modifiedMs - b.modifiedMs)
  const files = matches.slice(offset, offset + limit).map(match => match.path)
  return { files, truncated: truncated || matches.length > offset + limit }
}

/**
 * Extracts the static base directory from a glob pattern.
 * The base directory is everything before the first glob special character (* ? [ {).
 * Returns the directory portion and the remaining relative pattern.
 */
export function extractGlobBaseDirectory(pattern: string): {
  baseDir: string
  relativePattern: string
} {
  // Find the first glob special character: *, ?, [, {
  const globChars = /[*?[{]/
  const match = pattern.match(globChars)

  if (!match || match.index === undefined) {
    // No glob characters - this is a literal path
    // Return the directory portion and filename as pattern
    const dir = dirname(pattern)
    const file = basename(pattern)
    return { baseDir: dir, relativePattern: file }
  }

  // Get everything before the first glob character
  const staticPrefix = pattern.slice(0, match.index)

  // Find the last path separator in the static prefix
  const lastSepIndex = Math.max(
    staticPrefix.lastIndexOf('/'),
    staticPrefix.lastIndexOf(sep),
  )

  if (lastSepIndex === -1) {
    // No path separator before the glob - pattern is relative to cwd
    return { baseDir: '', relativePattern: pattern }
  }

  let baseDir = staticPrefix.slice(0, lastSepIndex)
  const relativePattern = pattern.slice(lastSepIndex + 1)

  // Handle root directory patterns (e.g., /*.txt on Unix or C:/*.txt on Windows)
  // When lastSepIndex is 0, baseDir is empty but we need to use '/' as the root
  if (baseDir === '' && lastSepIndex === 0) {
    baseDir = '/'
  }

  // Handle Windows drive root paths (e.g., C:/*.txt)
  // 'C:' means "current directory on drive C" (relative), not root
  // We need 'C:/' or 'C:\' for the actual drive root
  if (getPlatform() === 'windows' && /^[A-Za-z]:$/.test(baseDir)) {
    baseDir = baseDir + sep
  }

  return { baseDir, relativePattern }
}

export async function glob(
  filePattern: string,
  cwd: string,
  { limit, offset }: { limit: number; offset: number },
  abortSignal: AbortSignal,
  toolPermissionContext: ToolPermissionContext,
): Promise<{ files: string[]; truncated: boolean }> {
  let searchDir = cwd
  let searchPattern = filePattern

  // Handle absolute paths by extracting the base directory and converting to relative pattern
  // ripgrep's --glob flag only works with relative patterns
  if (isAbsolute(filePattern)) {
    const { baseDir, relativePattern } = extractGlobBaseDirectory(filePattern)
    if (baseDir) {
      searchDir = baseDir
      searchPattern = relativePattern
    }
  }

  const ignorePatterns = normalizePatternsToPath(
    getFileReadIgnorePatterns(toolPermissionContext),
    searchDir,
  )

  // Use ripgrep for better memory performance
  // --files: list files instead of searching content
  // --glob: filter by pattern
  // --sort=modified: sort by modification time (oldest first)
  // --no-ignore: don't respect .gitignore (default true, set CLAUDE_CODE_GLOB_NO_IGNORE=false to respect .gitignore)
  // --hidden: include hidden files (default true, set CLAUDE_CODE_GLOB_HIDDEN=false to exclude)
  // Note: use || instead of ?? to treat empty string as unset (defaulting to true)
  const noIgnore = isEnvTruthy(process.env.CLAUDE_CODE_GLOB_NO_IGNORE || 'true')
  const hidden = isEnvTruthy(process.env.CLAUDE_CODE_GLOB_HIDDEN || 'true')
  const args = [
    '--files',
    '--glob',
    searchPattern,
    '--sort=modified',
    ...(noIgnore ? ['--no-ignore'] : []),
    ...(hidden ? ['--hidden'] : []),
  ]

  // Add ignore patterns
  for (const pattern of ignorePatterns) {
    args.push('--glob', `!${pattern}`)
  }

  // Exclude orphaned plugin version directories
  const pluginCacheExclusions = await getGlobExclusionsForPluginCache(searchDir)
  for (const exclusion of pluginCacheExclusions) {
    args.push('--glob', exclusion)
  }

  let allPaths: string[]
  try {
    allPaths = await ripGrep(args, searchDir, abortSignal)
  } catch (error) {
    if (!isRipgrepUnavailableError(error)) {
      throw error
    }

    return globWithNodeFallback(
      searchPattern,
      searchDir,
      { limit, offset },
      abortSignal,
      [
        ...ignorePatterns,
        ...pluginCacheExclusions,
      ],
      hidden,
    )
  }

  // ripgrep returns relative paths, convert to absolute
  const absolutePaths = allPaths.map(p =>
    isAbsolute(p) ? p : join(searchDir, p),
  )

  const truncated = absolutePaths.length > offset + limit
  const files = absolutePaths.slice(offset, offset + limit)

  return { files, truncated }
}
