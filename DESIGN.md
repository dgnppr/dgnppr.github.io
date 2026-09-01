# DRAGONAPPEAR Design System

## 1. Visual Theme & Atmosphere

A separate portfolio workspace that treats work as evidence, not advertising. It uses a warm-paper canvas, quiet graphite navigation, a selected-case preview, and restrained terracotta emphasis. It intentionally omits the blog header, footer, and dark theme so it reads like a polished companion to the resume.

## 2. Color Palette & Roles

- Graphite Ink (#171A18) — primary headings and active controls.
- Sage Copy (#59605B) — readable supporting text.
- Terracotta Signal (#D9552A) — selected-case emphasis, links, and focus context.
- Terracotta Wash (#F4DFD6) — public-outcome surface.
- Paper Surface (#F9F9F7) — portfolio workspace surface.
- Mist Canvas (#E7E9E6) — surrounding portfolio page canvas.
- Hairline Divider (#D5D8D3) — quiet separation between cases.
- Active Graphite (#1D2420) — selected project in the navigation rail.

## 3. Typography Rules

| Role | Font | Size | Weight | Line Height | Letter Spacing | Features | Notes |
|---|---|---:|---:|---:|---:|---|---|
| Work title | Pretendard Variable, system fallback | clamp(30px, 5vw, 44px) | 700 | 1.2 | -0.03em | kern | One per page |
| Case title | Pretendard Variable, system fallback | clamp(20px, 3vw, 28px) | 650 | 1.32 | -0.02em | kern | Linked case heading |
| Body | Pretendard Variable, system fallback | 16px | 400 | 1.8 | 0 | kern | Never below 16px on mobile |
| Metadata | Pretendard Variable, system fallback | 13px | 600 | 1.45 | 0.04em | tnum | Uppercase English labels only |

Korean body copy uses a relaxed line height. Headings may tighten slightly; paragraph tracking stays neutral.

## 4. Component Stylings

- **Project selector:** A semantic button rail with a numbered project, category, and active graphite state. It switches the preview without navigation.
- **Work filter:** 40px minimum touch height, pill radius, 8px 12px padding. Active state uses Graphite Ink with white text. Focus ring is 3px Terracotta Signal at 38% opacity.
- **Case preview:** A responsive detail surface with role, organization, focus, public outcomes, stack, and an explicit full-case link.
- **Outcome marker:** Small blue square marker, never the only way to convey a result.
- **Back link:** Plain text link with a leading arrow; no decorative button treatment.

## 5. Layout Principles

Use an 8px spacing rhythm. The portfolio workspace uses a 1440px maximum canvas, distinct from the blog’s 800px reading column. Mobile stacks the selector before the preview; from 768px upward it becomes a two-pane selector / preview workspace.

## 6. Depth & Elevation

Portfolio content is flat. Dividers and the active graphite rail provide hierarchy; elevation is not used. No glass cards, shadows, decorative gradients, site header, or footer are introduced.

## 7. Do's and Don'ts

- DO: Lead each case with a concrete outcome and the work context.
- DO: Keep the portfolio’s own light workspace tokens independent from the blog theme.
- DO: Make the entire case row and each filter usable by keyboard and touch.
- DON'T: Add dashboards, metric-count hero blocks, gradients, or fake product mockups.
- DON'T: Present confidential detail as public portfolio evidence.
- DON'T: Nest cards inside cards or hide important information behind hover states.

## 8. Responsive Behavior

- **320–767px:** Selector buttons stack above the selected preview; filters scroll horizontally without visible scrollbars.
- **768–1023px:** A two-pane selector / preview workspace appears; outcomes become a three-part fact line.
- **1024px+:** The selector grows to a readable 345px rail and the preview uses a 64px internal gutter. Details use a sticky metadata column and reading column.
- Transitions respect `prefers-reduced-motion`.

## 9. Agent Prompt Guide

### Quick Color Reference

- Primary CTA and focus: Terracotta Signal (#D9552A)
- Canvas: Mist Canvas (#E7E9E6)
- Document surface: Paper Surface (#F9F9F7)
- Heading and active control: Graphite Ink (#171A18)
- Body: Sage Copy (#59605B)
- Divider: Hairline Divider (#D5D8D3)

### Example Component Prompts

- "Build a standalone portfolio workspace on #E7E9E6 with a #F9F9F7 document surface. Do not include the blog header or footer. Use Pretendard Variable and a 1440px maximum width."
- "Build a two-pane project workspace: a #F1F2EF selector rail and a #F9F9F7 selected-case preview. The active selector is #1D2420 with #F7F7F2 text; use #D9552A only for emphasis and focus context."
- "Build a project detail page without a card: a back link, one H1, a 16px summary, and role / period / organization metadata in a sticky left column on desktop."
- "Build category filters with real buttons, 40px minimum height, pill radius, `aria-pressed`, and a reduced-motion-safe 150ms color transition."

### Iteration Guide

1. Keep the portfolio in its own 1440px workspace canvas; never render the blog chrome on a work route.
2. Use only the standalone portfolio tokens for work pages.
3. Use dividers and spacing before adding boxes or shadows.
4. Keep body text at 16px or larger on mobile.
5. Never make evidence dependent on a hover state.
6. Keep all outcome statements traceable to public source material.
7. Keep the portfolio light-only and respect reduced motion.
