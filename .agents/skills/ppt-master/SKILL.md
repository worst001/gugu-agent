---
name: ppt-master
description: Create or revise polished slide decks, PPT/PPTX files, and HTML slide presentations with strict layout, typography, and visual quality checks. Use for requests to make, improve, redesign, or export presentation slides.
---

# PPT Master

Use this skill when the user asks to create, revise, redesign, or export a slide deck, PPT/PPTX, or HTML presentation.

## First Decide The Output

1. If the user asks for planning, outline, page structure, or speaker notes only, do not create files.
2. If the user asks to make an actual deck or slide artifact, create a polished artifact and save it as a new file.
3. Never overwrite an existing presentation unless the user explicitly confirms the exact path.

## Slide Strategy

Before writing slide files, form a compact slide spec:

- Audience and use case.
- One-sentence main message.
- Storyline with 3-5 sections.
- Slide count and per-slide purpose.
- Visual system: background, text color, accent color, surface color, font family, spacing scale.
- Asset plan: real screenshots, product images, charts, diagrams, or simple shapes where they help.

Each slide must have one clear point. Avoid turning every slide into a wall of bullets.

## Visual Quality Rules

Reject and revise the deck before finalizing if any slide has:

- Overlapping text, shapes, images, or controls.
- Clipped text, off-canvas elements, or unreadable small type.
- Decorative outline text, shadow-heavy text, WordArt-like effects, or random font mixing.
- Low contrast between text and background.
- Large dark blocks without enough breathing room.
- Crowded grids without alignment or equal spacing.
- A one-color palette that makes the deck feel flat.
- Hero-scale titles inside cramped panels.

Use a stable 16:9 canvas. Keep safe margins. Use grid or section-based layouts rather than freehand placement. Prefer 1-2 font families and consistent font sizes. For Chinese text, use common system CJK fonts and keep line lengths comfortable.

## Implementation Guidance

When generating HTML slides:

- Use explicit slide dimensions or aspect-ratio and responsive scaling.
- Use CSS grid/flex/absolute layout only with fixed safe areas.
- Set `box-sizing: border-box` globally.
- Avoid negative margins and text-shadow decoration.
- Ensure every text container can wrap without overlapping the next element.
- Create print/export-friendly slides, not just a web page that happens to look like slides.

When generating PPTX:

- Use the available project/runtime library if one exists.
- Keep coordinates and dimensions deterministic.
- Use theme constants for colors, fonts, margins, and spacing.
- Do not rely on random placement or auto-fit guessing.

## Required Self-Check

Before reporting completion:

1. Inspect the generated artifact if possible.
2. Check every slide for overlap, clipping, contrast, alignment, and consistent typography.
3. Fix obvious visual issues immediately.
4. Report the output path and a short validation summary.

Do not call a rough mockup "done". If the available environment cannot create a polished artifact, say so and provide a high-quality slide plan instead.
