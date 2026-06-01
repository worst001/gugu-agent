import { describe, expect, it } from 'bun:test'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { Command } from '../types/command.js'
import { estimateSkillFrontmatterTokens } from '../skills/loadSkillsDir.js'
import { estimateSkillListingTokenBreakdown } from './analyzeContext.js'

function makeSkill(index: number, description: string): Command {
  return {
    type: 'prompt',
    name: `verbose-skill-${index}`,
    description,
    whenToUse: description,
    progressMessage: 'Running skill',
    contentLength: description.length,
    source: 'plugin',
    loadedFrom: 'plugin',
    getPromptForCommand: async (): Promise<ContentBlockParam[]> => [],
  }
}

describe('analyzeContext skill token estimates', () => {
  it('uses the bounded skill listing instead of raw frontmatter totals', () => {
    const description = 'Use this skill for a detailed engineering workflow. '.repeat(40)
    const skills = Array.from({ length: 80 }, (_, index) =>
      makeSkill(index, description),
    )
    const rawTotal = skills.reduce(
      (sum, skill) => sum + estimateSkillFrontmatterTokens(skill),
      0,
    )

    const breakdown = estimateSkillListingTokenBreakdown(skills, 200_000, 123)
    const displayedSkillTotal = breakdown.skillFrontmatter.reduce(
      (sum, skill) => sum + skill.tokens,
      0,
    )

    expect(rawTotal).toBeGreaterThan(10_000)
    expect(breakdown.listingTokens).toBeLessThan(rawTotal)
    expect(breakdown.listingTokens).toBeLessThanOrEqual(2_500)
    expect(displayedSkillTotal).toBe(breakdown.listingTokens)
    expect(breakdown.toolSchemaTokens).toBe(123)
  })
})
