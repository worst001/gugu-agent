---
name: mail-master
description: Draft, rewrite, and polish emails from context, goals, tone, screenshots, documents, or chat history without sending mail or performing external side effects.
---

# Mail Master

Use this skill for email drafts, replies, rewrites, subject lines, tone variants, and business communication.

## Required Behavior

1. Clarify recipient, goal, tone, and required action when they are missing and important.
2. Draft only. Never send email, open email clients, submit forms, or contact external services.
3. Preserve sensitive context and avoid adding facts not provided by the user.
4. If the user asks for variants, provide concise alternatives.

## Output Shape

Prefer this shape unless the user asks otherwise:

- Subject
- Email body
- Optional shorter version
- Optional warmer or more formal variant
- Notes on missing information when needed

## Quality Rules

- Keep the first paragraph purposeful.
- Make the requested action explicit.
- Use natural language, not template filler.
- Avoid over-promising, legal claims, or unsupported statements.
