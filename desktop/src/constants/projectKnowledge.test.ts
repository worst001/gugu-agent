import { describe, expect, it } from 'vitest'
import {
  createProjectKnowledgeTabId,
  parseProjectKnowledgeTabId,
} from './projectKnowledge'

describe('projectKnowledge tab ids', () => {
  it('round-trips Windows paths without exposing separators as routing syntax', () => {
    const path = 'D:\\Gugu\\短视频项目'
    expect(parseProjectKnowledgeTabId(createProjectKnowledgeTabId(path)))
      .toBe(path)
  })

  it('rejects unrelated or malformed tab ids', () => {
    expect(parseProjectKnowledgeTabId('session-1')).toBeNull()
    expect(parseProjectKnowledgeTabId('__project_knowledge__:%')).toBeNull()
  })
})
