import { describe, expect, it } from 'bun:test'
import path from 'node:path'
import {
  getHostCommandPath,
  withHostCommandPath,
} from '../hostCommandEnv.js'

describe('host command env', () => {
  it('adds Windows user command directories when they exist', () => {
    const appData = 'C:\\Users\\Ada\\AppData\\Roaming'
    const npmBin = path.win32.join(appData, 'npm')
    const nodeBin = 'C:\\Program Files\\nodejs'

    const hostPath = getHostCommandPath(
      {
        PATH: 'C:\\Windows\\System32',
        APPDATA: appData,
        ProgramFiles: 'C:\\Program Files',
        USERPROFILE: 'C:\\Users\\Ada',
      },
      {
        platform: 'win32',
        pathExists: entry =>
          [npmBin, nodeBin].some(
            expected => entry.toLowerCase() === expected.toLowerCase(),
          ),
      },
    )

    expect(hostPath.split(';')).toEqual([
      'C:\\Windows\\System32',
      npmBin,
      nodeBin,
    ])
  })

  it('keeps Windows PATH keys consistent when both Path and PATH are present', () => {
    const appData = 'C:\\Users\\Ada\\AppData\\Roaming'
    const npmBin = path.win32.join(appData, 'npm')

    const env = withHostCommandPath(
      {
        Path: 'C:\\Windows\\System32',
        PATH: 'C:\\Custom\\Bin',
        APPDATA: appData,
        USERPROFILE: 'C:\\Users\\Ada',
      },
      {
        platform: 'win32',
        pathExists: entry => entry.toLowerCase() === npmBin.toLowerCase(),
      },
    )

    expect(env.PATH).toBe(`C:\\Custom\\Bin;${npmBin}`)
    expect(env.Path).toBe(env.PATH)
  })
})
