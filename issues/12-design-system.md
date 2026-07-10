# 12 — Design system: theme tokens + shared UI components

_Ready for agent. Source: UI/UX grilling session, 2026-07-10 (see [CONTEXT.md](../CONTEXT.md))._

## What to build

The foundation of the "playful board-game" redesign: a `src/ui/` library of theme
tokens and shared components that issues 13–16 restyle every screen with. Direction:
tabletop *Guess Who?* energy — warm palette, tactile tiles, physical drop shadows,
chunky friendly buttons. One rich light theme; tokens use semantic names
(surface/ink/accent…) so dark mode stays a future add, not a rewrite. Pokémon flavor
comes from content (sprites, type colors), not chrome.

Hand-rolled: plain StyleSheet + Reanimated, **zero new dependencies**. Presentation
layer only — no reducer/RPC/DB changes.

- **Tokens** (`src/ui/theme.ts`): semantic colors, spacing scale, radii, type scale,
  shadow/elevation presets. The old flat `constants/colors.ts` palette is replaced;
  `typeColors` survives (it's content, not chrome).
- **Components** (`src/ui/`): `Screen` (safe-area scaffold + themed background),
  `Button` (primary/secondary/destructive/disabled + busy state, press-bounce),
  `Card` (tactile surface), `PixelModal`-style card modal over dimmed backdrop
  (the pattern the chat modal and existing panels adopt in 13), `Badge`
  (your-move / online chips), `TextField` (themed input).
- Prove the system on the two simplest screens so it ships used, not speculative:
  restyle **new-game** and **profile** minimally with the shared components (full
  UX rework of those screens still belongs to issues 15/16).

## Acceptance criteria

- [ ] `src/ui/theme.ts` exports semantic tokens (colors, spacing, radii, type scale, shadows). The legacy `constants/colors.ts` names become deprecated aliases re-pointed at theme values (so unmigrated screens pick up the warm palette immediately); each later issue removes its screens' use of the aliases. `typeColors` survives as content.
- [ ] Shared `Screen`, `Button`, `Card`, `Modal`, `Badge`, `TextField` components exist and are the only way new-game/profile build their UI.
- [ ] Buttons give press feedback (Reanimated scale/bounce) and support busy/disabled states.
- [ ] No new dependencies in package.json.
- [ ] `tsc`, `npm run lint`, and the full jest suite stay green.

## Blocked by

- Nothing (foundation).
