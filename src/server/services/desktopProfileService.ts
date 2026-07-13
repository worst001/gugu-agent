import * as fs from 'fs/promises'
import { randomBytes } from 'node:crypto'
import * as os from 'node:os'
import * as path from 'node:path'
import { ApiError } from '../middleware/errorHandler.js'
import {
  createDefaultDesktopProfile,
  createDefaultDesktopWorkspaceState,
  desktopProfileSchema,
  desktopWorkspaceStateSchema,
  normalizeDesktopProfile,
  normalizeDesktopWorkspaceState,
  type DesktopProfile,
  type DesktopProfilePatch,
  type DesktopWorkspaceState,
  type DesktopWorkspaceStatePatch,
} from '../types/desktopProfile.js'

export type DesktopProfileBundle = {
  profile: DesktopProfile
  workspaceState: DesktopWorkspaceState
}

export type DesktopProfileBundlePatch = {
  profile?: DesktopProfilePatch
  workspaceState?: DesktopWorkspaceStatePatch
}

type JsonSchema<T> = {
  parse: (value: unknown) => T
}

const PROFILE_FILE_NAME = 'profile.json'
const WORKSPACE_STATE_FILE_NAME = 'workspace-state.json'

export class DesktopProfileService {
  private static writeLocks = new Map<string, Promise<unknown>>()

  private getFallbackRoot(): string {
    const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
    return path.join(claudeConfigDir, 'cc-haha', 'desktop')
  }

  private getProfilePath(): string {
    return path.join(
      process.env.GUGU_DESKTOP_CONFIG_DIR || this.getFallbackRoot(),
      PROFILE_FILE_NAME,
    )
  }

  private getWorkspaceStatePath(): string {
    return path.join(
      process.env.GUGU_DESKTOP_DATA_DIR || this.getFallbackRoot(),
      WORKSPACE_STATE_FILE_NAME,
    )
  }

  async getBundle(): Promise<DesktopProfileBundle> {
    const [profile, workspaceState] = await Promise.all([
      this.readProfile(),
      this.readWorkspaceState(),
    ])
    return { profile, workspaceState }
  }

  async updateBundle(patch: DesktopProfileBundlePatch): Promise<DesktopProfileBundle> {
    if (patch.profile) await this.updateProfile(patch.profile)
    if (patch.workspaceState) await this.updateWorkspaceState(patch.workspaceState)
    return this.getBundle()
  }

  async reset(): Promise<void> {
    await Promise.all([
      this.removeOwnedFiles(this.getProfilePath()),
      this.removeOwnedFiles(this.getWorkspaceStatePath()),
    ])
  }

  private async readProfile(): Promise<DesktopProfile> {
    return this.readValidatedFile(
      this.getProfilePath(),
      normalizeDesktopProfile,
      createDefaultDesktopProfile,
    )
  }

  private async readWorkspaceState(): Promise<DesktopWorkspaceState> {
    return this.readValidatedFile(
      this.getWorkspaceStatePath(),
      normalizeDesktopWorkspaceState,
      createDefaultDesktopWorkspaceState,
    )
  }

  private async updateProfile(patch: DesktopProfilePatch): Promise<void> {
    const filePath = this.getProfilePath()
    await this.withWriteLock(filePath, async () => {
      const current = await this.readProfile()
      const next = desktopProfileSchema.parse({
        ...current,
        preferences: {
          ...current.preferences,
          ...patch.preferences,
          appearance: {
            ...current.preferences.appearance,
            ...patch.preferences?.appearance,
          },
          layout: {
            ...current.preferences.layout,
            ...patch.preferences?.layout,
          },
          updates: {
            ...current.preferences.updates,
            ...patch.preferences?.updates,
          },
        },
        migration: { ...current.migration, ...patch.migration },
        updatedAt: new Date().toISOString(),
      })
      await this.writeValidatedFile(filePath, next, desktopProfileSchema)
    })
  }

  private async updateWorkspaceState(patch: DesktopWorkspaceStatePatch): Promise<void> {
    const filePath = this.getWorkspaceStatePath()
    await this.withWriteLock(filePath, async () => {
      const current = await this.readWorkspaceState()
      const next = desktopWorkspaceStateSchema.parse({
        ...current,
        projects: { ...current.projects, ...patch.projects },
        tabs: { ...current.tabs, ...patch.tabs },
        drafts: patch.drafts ?? current.drafts,
        tools: { ...current.tools, ...patch.tools },
        migration: { ...current.migration, ...patch.migration },
        updatedAt: new Date().toISOString(),
      })
      await this.writeValidatedFile(filePath, next, desktopWorkspaceStateSchema)
    })
  }

  private async readValidatedFile<T>(
    filePath: string,
    normalize: (value: unknown) => T,
    createDefault: () => T,
  ): Promise<T> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8')
      return normalize(JSON.parse(raw))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.readBackup(filePath, normalize, createDefault)
      if (error instanceof SyntaxError) {
        await this.quarantineCorruptFile(filePath)
        return this.readBackup(filePath, normalize, createDefault)
      }
      throw ApiError.internal(`Failed to read desktop profile from ${filePath}: ${error}`)
    }
  }

  private async readBackup<T>(
    filePath: string,
    normalize: (value: unknown) => T,
    createDefault: () => T,
  ): Promise<T> {
    try {
      const raw = await fs.readFile(`${filePath}.bak`, 'utf-8')
      return normalize(JSON.parse(raw))
    } catch {
      return createDefault()
    }
  }

  private async quarantineCorruptFile(filePath: string): Promise<void> {
    const suffix = new Date().toISOString().replace(/[:.]/g, '-')
    await fs.rename(filePath, `${filePath}.corrupt-${suffix}`).catch(() => {})
  }

  private async writeValidatedFile<T>(
    filePath: string,
    value: T,
    schema: JsonSchema<T>,
  ): Promise<void> {
    const validated = schema.parse(value)
    await this.writeJsonFile(filePath, validated)
    await this.writeJsonFile(`${filePath}.bak`, validated).catch(() => {})
  }

  private async withWriteLock<T>(filePath: string, task: () => Promise<T>): Promise<T> {
    const previous = DesktopProfileService.writeLocks.get(filePath) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(task)
    DesktopProfileService.writeLocks.set(filePath, next)

    try {
      return await next
    } finally {
      if (DesktopProfileService.writeLocks.get(filePath) === next) {
        DesktopProfileService.writeLocks.delete(filePath)
      }
    }
  }

  private async writeJsonFile(filePath: string, value: unknown): Promise<void> {
    const directory = path.dirname(filePath)
    const contents = `${JSON.stringify(value, null, 2)}\n`
    const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${randomBytes(6).toString('hex')}`

    try {
      await fs.mkdir(directory, { recursive: true })
      await fs.writeFile(tempPath, contents, 'utf-8')
      await fs.rename(tempPath, filePath)
    } catch (error) {
      await fs.unlink(tempPath).catch(() => {})
      throw ApiError.internal(`Failed to write desktop profile to ${filePath}: ${error}`)
    }
  }

  private async removeOwnedFiles(filePath: string): Promise<void> {
    const directory = path.dirname(filePath)
    const baseName = path.basename(filePath)
    let names: string[]
    try {
      names = await fs.readdir(directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw ApiError.internal(`Failed to reset desktop profile in ${directory}: ${error}`)
    }

    await Promise.all(names
      .filter((name) => name === baseName || name === `${baseName}.bak` || name.startsWith(`${baseName}.corrupt-`))
      .map((name) => fs.unlink(path.join(directory, name)).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      })))
  }
}
