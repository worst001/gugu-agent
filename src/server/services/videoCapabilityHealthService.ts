import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'

export type VideoCapabilityCheck = {
  id: 'node' | 'ffmpeg'
  ready: boolean
  value?: string
  requirement: string
}

export type VideoCapabilityHealth = {
  provider: 'hyperframes'
  installed: boolean
  ready: boolean
  skills: string[]
  checks: VideoCapabilityCheck[]
  missing: string[]
}

const HYPERFRAMES_COMPOSITION_SKILLS = new Set([
  'hyperframes',
  'website-to-hyperframes',
])
const HYPERFRAMES_RENDER_SKILLS = new Set(['hyperframes-cli'])

export async function inspectVideoCapabilityHealth(
  installedSkillNames: readonly string[],
): Promise<VideoCapabilityHealth> {
  const hyperframesSkills = installedSkillNames.filter((name) => {
    const localName = name.split(':').at(-1) ?? name
    return HYPERFRAMES_COMPOSITION_SKILLS.has(localName) ||
      HYPERFRAMES_RENDER_SKILLS.has(localName) ||
      localName.startsWith('hyperframes-')
  })
  const localNames = new Set(
    hyperframesSkills.map((name) => name.split(':').at(-1) ?? name),
  )

  const [node, ffmpeg] = await Promise.all([
    checkCommand(
      process.platform === 'win32' ? 'node.exe' : 'node',
      ['--version'],
    ),
    checkCommand(
      process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
      ['-version'],
    ),
  ])

  const nodeMajor = parseNodeMajor(node.value)
  const checks: VideoCapabilityCheck[] = [
    {
      id: 'node',
      ready: node.ready && nodeMajor >= 22,
      value: node.value,
      requirement: 'Node.js >= 22',
    },
    {
      id: 'ffmpeg',
      ready: ffmpeg.ready,
      value: ffmpeg.value,
      requirement: 'FFmpeg',
    },
  ]
  const hasComposition = [...HYPERFRAMES_COMPOSITION_SKILLS].some((name) =>
    localNames.has(name),
  )
  const hasRendering = [...HYPERFRAMES_RENDER_SKILLS].some((name) =>
    localNames.has(name),
  )
  const missing = [
    ...(!hasComposition ? ['HyperFrames composition skill'] : []),
    ...(!hasRendering ? ['HyperFrames CLI skill'] : []),
    ...checks.filter((check) => !check.ready).map((check) => check.requirement),
  ]

  return {
    provider: 'hyperframes',
    installed: hyperframesSkills.length > 0,
    ready: hasComposition && hasRendering && checks.every((check) => check.ready),
    skills: hyperframesSkills,
    checks,
    missing,
  }
}

async function checkCommand(
  command: string,
  args: string[],
): Promise<{ ready: boolean; value?: string }> {
  const result = await execFileNoThrowWithCwd(command, args, {
    cwd: process.cwd(),
    timeout: 5_000,
    preserveOutputOnError: true,
    maxBuffer: 100_000,
  })
  const firstLine = (result.stdout || result.stderr)
    .split(/\r?\n/, 1)[0]
    ?.trim()
  return {
    ready: result.code === 0,
    value: firstLine || undefined,
  }
}

function parseNodeMajor(value: string | undefined): number {
  const match = value?.match(/v?(\d+)/)
  return match ? Number.parseInt(match[1]!, 10) : 0
}
