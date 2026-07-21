import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { handleSettingsApi } from '../api/settings.js'
import { DesktopProfileService } from '../services/desktopProfileService.js'
import {
  MAX_DESKTOP_DRAFTS,
  MAX_DESKTOP_DRAFT_TEXT_LENGTH,
  normalizeDesktopProfile,
  normalizeDesktopWorkspaceState,
} from '../types/desktopProfile.js'

const originalConfigDir = process.env.GUGU_DESKTOP_CONFIG_DIR
const originalDataDir = process.env.GUGU_DESKTOP_DATA_DIR
let tempDir: string
let configDir: string
let dataDir: string

async function callApi(
  method = 'GET',
  body?: Record<string, unknown>,
): Promise<Response> {
  const request = new Request('http://localhost/api/settings/desktop-profile', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const url = new URL(request.url)
  return handleSettingsApi(request, url, url.pathname.split('/').filter(Boolean))
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'desktop-profile-test-'))
  configDir = join(tempDir, 'config')
  dataDir = join(tempDir, 'data')
  process.env.GUGU_DESKTOP_CONFIG_DIR = configDir
  process.env.GUGU_DESKTOP_DATA_DIR = dataDir
})

afterEach(async () => {
  if (originalConfigDir === undefined) delete process.env.GUGU_DESKTOP_CONFIG_DIR
  else process.env.GUGU_DESKTOP_CONFIG_DIR = originalConfigDir
  if (originalDataDir === undefined) delete process.env.GUGU_DESKTOP_DATA_DIR
  else process.env.GUGU_DESKTOP_DATA_DIR = originalDataDir
  await rm(tempDir, { recursive: true, force: true })
})

describe('desktop profile persistence', () => {
  it('returns defaults without creating files on first read', async () => {
    const response = await callApi()
    const body = await response.json() as {
      profile: {
        preferences: {
          appearance: { theme: string }
          work: { newSessionDefault: string }
        }
      }
      workspaceState: { drafts: Record<string, unknown> }
    }

    expect(response.status).toBe(200)
    expect(body.profile.preferences.appearance.theme).toBe('dark')
    expect(body.profile.preferences.work.newSessionDefault).toBe('smart')
    expect(body.workspaceState.drafts).toEqual({})
    expect(await readdir(tempDir)).toEqual([])
  })

  it('writes both files and preserves concurrent section patches', async () => {
    const service = new DesktopProfileService()
    await Promise.all([
      service.updateBundle({
        profile: { preferences: { appearance: { theme: 'gray-dark' } } },
      }),
      service.updateBundle({
        profile: { preferences: { layout: { sidebarWidth: 336 } } },
      }),
      service.updateBundle({
        profile: { preferences: { work: { newSessionDefault: 'knowledge_delivery' } } },
      }),
      service.updateBundle({
        workspaceState: { projects: { pinned: ['D:/work'] } },
      }),
    ])

    const bundle = await service.getBundle()
    expect(bundle.profile.preferences.appearance.theme).toBe('gray-dark')
    expect(bundle.profile.preferences.layout.sidebarWidth).toBe(336)
    expect(bundle.profile.preferences.work.newSessionDefault).toBe('knowledge_delivery')
    expect(bundle.workspaceState.projects.pinned).toEqual(['D:/work'])
    expect(JSON.parse(await readFile(join(configDir, 'profile.json'), 'utf-8'))).toMatchObject({
      schemaVersion: 1,
    })
    expect(JSON.parse(await readFile(join(dataDir, 'workspace-state.json'), 'utf-8'))).toMatchObject({
      schemaVersion: 1,
    })
  })

  it('rejects unknown and oversized API values', async () => {
    const unknown = await callApi('PATCH', {
      profile: { preferences: { appearance: { secretToken: 'nope' } } },
    })
    const oversized = await callApi('PATCH', {
      workspaceState: {
        drafts: {
          session: { text: 'x'.repeat(MAX_DESKTOP_DRAFT_TEXT_LENGTH + 1), updatedAt: 1 },
        },
      },
    })

    expect(unknown.status).toBe(400)
    expect(oversized.status).toBe(400)
  })

  it('quarantines corrupt JSON and recovers the last good profile', async () => {
    const service = new DesktopProfileService()
    await service.updateBundle({
      profile: { preferences: { appearance: { locale: 'en' } } },
    })
    await writeFile(join(configDir, 'profile.json'), '{broken', 'utf-8')

    const bundle = await service.getBundle()
    const secondRead = await service.getBundle()
    const names = await readdir(configDir)

    expect(bundle.profile.preferences.appearance.locale).toBe('en')
    expect(secondRead.profile.preferences.appearance.locale).toBe('en')
    expect(names.some((name) => name.startsWith('profile.json.corrupt-'))).toBe(true)
  })

  it('resets only owned profile files', async () => {
    const service = new DesktopProfileService()
    await service.updateBundle({
      profile: { preferences: { appearance: { locale: 'en' } } },
      workspaceState: { projects: { removed: ['D:/old'] } },
    })
    await writeFile(join(configDir, 'keep.txt'), 'keep', 'utf-8')

    await service.reset()

    expect(await readdir(configDir)).toEqual(['keep.txt'])
    expect(await readdir(dataDir)).toEqual([])
  })
})

describe('desktop profile normalization', () => {
  it('falls back per field instead of discarding valid values', () => {
    const profile = normalizeDesktopProfile({
      preferences: {
        appearance: { theme: 'green-dark', locale: 'invalid' },
        layout: { sidebarWidth: 9999, workbenchWidth: 444, capabilityPanelCollapsed: true },
      },
    })

    expect(profile.preferences.appearance).toEqual({ theme: 'green-dark', locale: 'zh' })
    expect(profile.preferences.layout).toMatchObject({
      sidebarWidth: 280,
      workbenchWidth: 444,
      capabilityPanelCollapsed: true,
    })
    expect(profile.preferences.work.newSessionDefault).toBe('smart')
  })

  it('normalizes custom assistants against built-in Role Packs', () => {
    const state = normalizeDesktopWorkspaceState({
      assistants: {
        custom: [
          {
            id: 'custom-ops',
            name: 'Launch operator',
            description: '',
            baseRole: 'short_video_operator',
            instructions: 'Review hook and pacing.',
            createdAt: '2026-07-13T00:00:00.000Z',
            updatedAt: '2026-07-13T00:00:00.000Z',
          },
          {
            id: 'invalid',
            name: 'Invalid role',
            description: '',
            baseRole: 'invented_role',
            instructions: 'Ignore',
            createdAt: '2026-07-13T00:00:00.000Z',
            updatedAt: '2026-07-13T00:00:00.000Z',
          },
        ],
      },
    })

    expect(state.assistants.custom).toHaveLength(1)
    expect(state.assistants.custom[0]?.baseRole).toBe('short_video_operator')
  })
  it('prunes invalid, oversized, and excess drafts', () => {
    const drafts = Object.fromEntries(Array.from({ length: MAX_DESKTOP_DRAFTS + 5 }, (_, index) => [
      `session-${index}`,
      {
        text: index === 0 ? 'x'.repeat(MAX_DESKTOP_DRAFT_TEXT_LENGTH + 1) : `draft-${index}`,
        updatedAt: index,
      },
    ]))

    const state = normalizeDesktopWorkspaceState({ drafts })

    expect(Object.keys(state.drafts)).toHaveLength(MAX_DESKTOP_DRAFTS)
    expect(state.drafts['session-0']).toBeUndefined()
  })
})
