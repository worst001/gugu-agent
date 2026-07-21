export type SkillSource = 'user' | 'project' | 'plugin' | 'mcp' | 'bundled'

export type SkillMeta = {
  name: string
  displayName?: string
  description: string
  source: SkillSource
  userInvocable: boolean
  version?: string
  contentLength: number
  hasDirectory: boolean
  pluginName?: string
}

export type FileTreeNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileTreeNode[]
}

export type SkillFrontmatter = Record<string, unknown>

export type SkillFile = {
  path: string
  content: string
  language: string
  frontmatter?: SkillFrontmatter
  body?: string
  isEntry?: boolean
}

export type SkillDetail = {
  meta: SkillMeta
  tree: FileTreeNode[]
  files: SkillFile[]
  skillRoot: string
}

export type VideoCapabilityHealth = {
  provider: 'hyperframes'
  installed: boolean
  ready: boolean
  skills: string[]
  checks: Array<{
    id: 'node' | 'ffmpeg'
    ready: boolean
    value?: string
    requirement: string
  }>
  missing: string[]
}
