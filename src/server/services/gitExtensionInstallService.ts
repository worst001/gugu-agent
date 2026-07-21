import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { clearAllCaches } from '../../utils/plugins/cacheUtils.js'
import {
  addMarketplaceSource,
  getMarketplace,
  saveMarketplaceToSettings,
} from '../../utils/plugins/marketplaceManager.js'
import { parseMarketplaceInput } from '../../utils/plugins/parseMarketplaceInput.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { ApiError } from '../middleware/errorHandler.js'

const ALLOWED_GIT_HOSTS = new Set([
  'github.com',
  'gitee.com',
  'gitlab.com',
  'bitbucket.org',
])

export type GitExtensionInstallResult =
  | {
      kind: 'marketplace'
      source: string
      marketplace: string
      plugins: Array<{
        id: string
        name: string
        description?: string
        version?: string
      }>
    }
  | {
      kind: 'skills'
      source: string
      installedSkills: string[]
      message: string
    }

export class GitExtensionInstallService {
  async addSource(
    rawSource: string,
    confirmed: boolean,
  ): Promise<GitExtensionInstallResult> {
    if (!confirmed) {
      throw ApiError.badRequest('Git source installation requires explicit confirmation')
    }

    const source = normalizeGitRepositoryUrl(rawSource)
    let marketplaceFailure: string | null = null

    if (isHyperframesSource(source)) {
      marketplaceFailure = 'HyperFrames publishes an Agent Skills pack'
    } else {
      let marketplaceAdded = false
      try {
        const parsed = await parseMarketplaceInput(toCloneUrl(source))
        if (!parsed || 'error' in parsed) {
          throw new Error(parsed && 'error' in parsed ? parsed.error : 'Unsupported Git source')
        }
        const added = await addMarketplaceSource(parsed)
        marketplaceAdded = true
        clearAllCaches()
        const marketplace = await getMarketplace(added.name)
        saveMarketplaceToSettings(
          added.name,
          { source: added.resolvedSource },
          'userSettings',
        )
        return {
          kind: 'marketplace',
          source,
          marketplace: added.name,
          plugins: marketplace.plugins.map((plugin) => ({
            id: `${plugin.name}@${added.name}`,
            name: plugin.name,
            description: plugin.description,
            version: plugin.version,
          })),
        }
      } catch (error) {
        marketplaceFailure = error instanceof Error ? error.message : String(error)
        if (/blocked by enterprise policy/i.test(marketplaceFailure)) {
          throw new ApiError(403, marketplaceFailure, 'FORBIDDEN')
        }
        if (marketplaceAdded) {
          throw ApiError.badRequest(
            `Plugin marketplace was added but could not be read: ${marketplaceFailure}`,
          )
        }
      }
    }

    const before = await listUserSkillNames()
    const result = await execFileNoThrowWithCwd(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      [
        '--yes',
        'skills',
        'add',
        source,
        '--skill',
        '*',
        '--agent',
        'claude-code',
        '--global',
        '--yes',
        '--copy',
      ],
      {
        cwd: process.cwd(),
        timeout: 10 * 60 * 1000,
        preserveOutputOnError: true,
        maxBuffer: 2_000_000,
      },
    )

    if (result.code !== 0) {
      const skillFailure = (result.stderr || result.stdout || result.error || '').trim()
      throw ApiError.badRequest(
        [
          'The repository is neither an installable plugin marketplace nor an Agent Skills pack.',
          marketplaceFailure ? `Plugin check: ${marketplaceFailure}` : '',
          skillFailure ? `Skills check: ${skillFailure}` : '',
        ].filter(Boolean).join('\n'),
      )
    }

    clearAllCaches()
    const after = await listUserSkillNames()
    const installedSkills = after.filter((name) => !before.includes(name))
    return {
      kind: 'skills',
      source,
      installedSkills,
      message: installedSkills.length > 0
        ? `Installed ${installedSkills.length} skill(s): ${installedSkills.join(', ')}`
        : 'Skills source installed or updated successfully.',
    }
  }

}

export function normalizeGitRepositoryUrl(rawSource: string): string {
  const trimmed = rawSource.trim()
  if (!trimmed || trimmed.length > 2_048) {
    throw ApiError.badRequest('A Git repository URL is required')
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw ApiError.badRequest('Enter a full HTTPS Git repository URL')
  }

  if (url.protocol !== 'https:') {
    throw ApiError.badRequest('Only HTTPS Git repository URLs are supported')
  }
  if (url.username || url.password) {
    throw ApiError.badRequest('Repository URLs must not contain credentials')
  }

  const hostname = url.hostname.toLowerCase()
  if (!ALLOWED_GIT_HOSTS.has(hostname)) {
    throw ApiError.badRequest(
      'Supported Git hosts are GitHub, Gitee, GitLab, and Bitbucket',
    )
  }

  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length < 2) {
    throw ApiError.badRequest('The URL must point to a Git repository')
  }

  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/$/, '')
  return url.toString()
}

function toCloneUrl(source: string): string {
  const url = new URL(source)
  if (!url.pathname.endsWith('.git')) {
    url.pathname = `${url.pathname}.git`
  }
  return url.toString()
}

function isHyperframesSource(source: string): boolean {
  const url = new URL(source)
  return url.hostname.toLowerCase() === 'github.com' &&
    /^\/heygen-com\/hyperframes(?:\.git)?$/i.test(url.pathname)
}

async function listUserSkillNames(): Promise<string[]> {
  const skillsDir = join(getClaudeConfigHomeDir(), 'skills')
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}
