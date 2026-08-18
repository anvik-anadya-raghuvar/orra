# CLAUDE.md — Anvik Ops

Standing rules for every session in this repository.

## What this is

An internal operations portal for exactly two people — Anadya and Raghuvar — running a startup across India and Italy. It replaces Notion, Slack, Trello, and a notes app. It is not a product for sale, has no customers, and will never have a third user.

## Stack

Vite + React 18 + TypeScript + Tailwind + Framer Motion. Supabase for Postgres, Auth, Storage, Realtime. Vercel for hosting (linked via `.vercel/project.json`, deployed from the `anvik-anadya-raghuvar/anvik-ops` GitHub repo — not Cloudflare Pages, despite earlier plans). Everything on free tiers. Target cost: ₹0 recurring — flag anything that risks leaving a free tier rather than silently accepting it.

## Non-negotiable principles

1. **The portal stays whole.** No global workspace mode that hides parts of the app. Project filtering is local to a screen and never changes which navigation exists or what Home shows.
2. **No role gating.** Both users see everything, including Money. Per-user curation of one's own Home is a preference stored in `profiles.personalization`, never a permission. Do not write an "owners only" check anywhere.
3. **The audit trail is append-only at the database level.** `UPDATE` and `DELETE` are revoked on `audit_trail` for every role. Never add an edit or delete path.
4. **The export generator is a pure function.** No LLM anywhere in the export pipeline. Identical task state must produce byte-identical output, proven by test.
5. **Personal life never feeds the business ranking algorithm.** Two separate systems.
6. **Task type changes what the task page renders**, not just a badge.
7. **Tags are free-form and user-invented.** Never hard-code a tag list.
8. **Projects are seeded database rows**, never enum constants in code.

## Working rules

- **Plan before building.** Show the plan, then execute. Loop plan → execute → verify until the phase gate passes.
- **Verify, don't assert.** Before calling anything done, run the check and paste the output. "It should work" is not evidence.
- **Walk the layer ladder when something breaks:** input → compute → persist → read. Check each before touching business logic.
- **Treat every phase gate as blocking.** Do not start the next phase until the current gate has pasted evidence.
- **Commit after each passing gate.** Small, labelled commits — they're the restore points.
- **Ask rather than guess** when the spec is genuinely ambiguous or self-contradictory on something consequential. Do not silently decide.
- **Never put the `service_role` key in client code.** Edge functions only, and justify any use in a comment at the call site.

## Mandatory gates before any phase is "done"

**Security pass** — RLS verified with an actual failing query from a non-allowlisted JWT; storage returns 403 without a signed URL; `grep -rn "service_role" ./dist` returns nothing; input caps enforced server-side.

**Performance pass** — p95 list fetch under 300 ms with 500 seeded rows; production bundle ≤300 KB gzipped; images lazy-loaded; no layout shift.

**Responsive pass** — verified at 375px, 768px, and 1440px. Not "should work" — actually checked.

**Motion pass** — every animation respects `prefers-reduced-motion`; nothing janky under 60fps; no hover-only interactions.

## Responsive rules — strict

- **Mobile-first.** Write the mobile layout first, then widen. Never desktop-down.
- **Breakpoints:** mobile ≤640px · tablet 641–1024px · desktop >1024px. Every screen must be genuinely designed at all three, not just reflowed.
- **Touch targets minimum 44×44px** everywhere on mobile and tablet.
- **No hover-only interactions ever.** Anything reachable by hover must also be reachable by tap or focus.
- **Navigation:** bottom tab bar on mobile, side rail or top tabs on tablet and desktop.
- **Tables become cards on mobile.** Never horizontally scroll a data table on a phone.
- **Modals become full-screen sheets on mobile**, centered dialogs on desktop.
- **Respect safe areas** — `env(safe-area-inset-*)` for notches and home indicators.
- **Never rely on viewport width alone for layout inside components** — use container queries or flex/grid that adapts.

## Motion rules — strict

- **Framer Motion for everything.** No raw CSS transitions except for simple color and opacity changes.
- **Durations:** micro-interactions 120–180ms · element entrances 250–350ms · page transitions 350–450ms. Nothing longer than 500ms.
- **Easing:** `cubic-bezier(0.22, 1, 0.36, 1)` for entrances and general movement. Spring physics (`stiffness: 400, damping: 30`) for anything the user directly manipulates — annotation pins, sliders, drag.
- **Lists stagger** their children by 30–50ms. Never animate all rows in at once.
- **Page transitions** are a shared layout fade-and-rise, never a hard cut.
- **Cards lift on interaction** with a subtle translate and shadow increase — depth should feel physical, not decorative.
- **Every state change is animated** — a task moving columns, a bar filling, a warmth meter draining, a pin selecting. Nothing snaps.
- **Loading states are skeletons**, never spinners, never blank screens.
- **Numbers count up** when they first appear rather than popping in.
- **`prefers-reduced-motion: reduce` disables all of it** and falls back to instant state changes. This is not optional.

## Kill criteria

If the export feature does not drive a coding session cleanly by the end of Phase 4, stop and reassess — that feature is the entire reason this is built rather than bought. If the system isn't in daily use before the Italy move, freeze the repo and fall back to ClickUp Free.
