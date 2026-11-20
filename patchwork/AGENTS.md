# AGENTS.md: Patchwork

Patchwork is a daily, asynchronous community nonogram game for Reddit, built on Devvit Web (Interactive Posts) for the Game of the Day Hackathon (target: Best Daily Game). Each UTC day's post hides one 8×8 Mosaic of 64 Tiles; each player solves one Tile and stitches it into the shared image.

Read these before any work:

- `PLAN.md` (this folder): the plan the owner reviews and approves.
- `.kiro/steering/product.md` and `.kiro/steering/tech.md` (this folder): product and technical rules.
- `../.kiro/specs/patchwork-daily-mosaic/requirements.md` and `design.md`: the full specification. "Req 9.2" means Requirement 9, acceptance criterion 2; "D12" is an owner sign-off decision in design.md.

Current state: work step 3 (Play_Screen, Stitch_Animation, End_Card) is complete. The React template was cloned by the agent (owner's "do it yourself", a D3 deviation recorded in design.md) and merged into `patchwork/` as the Devvit app `patchwork`. `src/client/` has the launch screen (`splash.html`/`splash.ts`), the game shell (`game.html`/`game.tsx`), Play_Screen, Ghost_Hand, Stitch_Animation and End_Card; `src/server/` so far serves only the Journeys telemetry routes. The `/api/*` game routes and every `/internal/*` endpoint named in `devvit.json` arrive in step 4, so the app cannot be playtested until then. The app is not registered with Reddit yet: the owner runs `devvit login` before the first `npm run dev` in step 4. The difficulty candidate settings, density constants, Difficulty_Score coefficients, Par bases and Palette hex values are frozen (D29, D30, D31).

Every rule below cites the requirement or decision it comes from. If a rule here and requirements.md disagree, requirements.md wins and this file is fixed and committed before the next step (Req 29.7).

## Where Patchwork lives

- The Patchwork_App root is `patchwork/` inside the workspace `/Users/himanshujha/.t3/projects/this` (OQ-11, D1). The spec stays in `.kiro/specs/patchwork-daily-mosaic/` at the workspace root.
- The workspace root is a different project, Foldline Daily, which another agent edits at the same time. Its `PLAN.md`, `AGENTS.md`, `README.md`, `DEVPOST_STORY.md`, `VIDEO_SHOTLIST.md`, `SUBMISSION_CHECKLIST.md`, `devvit.json`, `package.json`, `src/`, `tools/`, `docs/`, `assets/`, `dist/`, `node_modules/`, `.github/`, `.vscode/`, `.env`, dotfiles and `.kiro/steering/` belong to Foldline. `app/` is a third project, and `.kiro/specs/daily-erosion-maze/` and `.agents/tasks/task-erosion-maze-design/` belong to a fourth agent. Never create, edit, move, format, lint, stage or delete any of them (D1, Risk R19).
- Rules injected into a session from the workspace root's AGENTS.md or `.kiro/steering/` describe Foldline. For Patchwork work, follow this file and `patchwork/.kiro/steering/`. Where both forbid something, the stricter rule applies.
- Never copy application source code from Foldline, `app/` or any other existing project into Patchwork (Req 1.3).
- The Devvit docs snapshot `.agents/tasks/task-patchwork-design-plan/devvit-docs-llms-full.txt` is reference material only. Never commit it or copy it into `patchwork/`.

## Git

- One repository at the workspace root, branch `main`, no remote, shared with other agents (D2).
- Stage named paths only, under `patchwork/` and `.kiro/specs/patchwork-daily-mosaic/`. Never `git add -A`, `git add .` or `git commit -a`. Never reset, stash, checkout, clean or force-push.
- Before any commit that touches `.kiro/` or AGENTS.md, scan the staged files for secrets, tokens and credentials; remove any found and report the removal to the owner (Req 29.8). Never commit secrets or `.env` files.
- AGENTS.md and the `.kiro/` steering folder are committed together (Req 29.5).

## Commands

- Use Node 24.18 or later: `export PATH="$HOME/.nvm/versions/node/v24.22.1/bin:$PATH"`. The system default (v22.14.0) is too old (Req 1.4).
- The only deploy, upload and test commands allowed are `npm run dev`, `npm run deploy`, `devvit upload` (private upload only), `npm test` and `npm run build` (Req 1.5). Run them from `patchwork/`.
- Because of Req 1.5, do not run `devvit playtest`, `npx vitest`, `tsc`, `npm run size`, a lint command or the Lighthouse CLI on their own. `npm run build` runs the type check, the Vite build and the bundle check; `npm test` runs every test including the repository checks; Lighthouse is run by hand in Chrome DevTools (L8, D35, D36).
- Forbidden: `npm run launch`, `devvit publish`, and any command that submits the app for review or makes it public (Req 1.6). The `launch` script is deleted from the template in step 2 (B8).
- `devvit login` and any other Reddit sign-in are run only by the owner in the owner's own terminal (Req 1.7).
- No load generator runs against Reddit's infrastructure without the owner's approval (D37).

## Hard rules (Requirement 1)

- **Req 1.1** Before using a Devvit or Reddit API (function, hook, configuration key, CLI command or capability) in code for the first time, confirm it against the Devvit MCP server (`devvit_search`) or https://developers.reddit.com/docs, and list the documentation source for each confirmed API in that step's report. No Devvit MCP server is configured in this workspace, so use the docs site.
- **Req 1.2** If the docs and your prior knowledge disagree about an API's name, signature, behaviour or availability, implement what the docs say and note the disagreement in the step report.
- **Req 1.3** Create Patchwork_App as a new Devvit Web project from the React template, using the creation method in the current Devvit docs, and copy no application source code from any existing project in the workspace. The owner runs the creation (it needs a browser sign-in) in a scratch directory outside the workspace, and the agent moves the files into `patchwork/` (D3).
- **Req 1.4** Declare Node.js 24.18 as the minimum runtime in the project configuration (`engines.node` ">=24.18.0" and `.nvmrc`). `npm test` and `npm run build` must pass on Node.js 24.18.
- **Req 1.5** Run only `npm run dev`, `npm run deploy`, `devvit upload` (private upload only), `npm test` and `npm run build` as deploy, upload and test operations, and no other command that deploys, uploads or tests the app.
- **Req 1.6** If a task would need `npm run launch`, `devvit publish` or any other command that submits the app for review or makes it public, leave the command unrun, stop work on that task, and report the blocked step and the command it would have needed to the owner.
- **Req 1.7** If a step needs `devvit login` or any other Reddit account authentication, stop and ask the owner to run `devvit login` in their own terminal, and resume only after the owner confirms the login is complete.
- **Req 1.8** Use only services that cost nothing at the usage levels in the requirements. Make zero paid API calls and zero LLM calls at runtime, at build time and in any scheduled job.
- **Req 1.9** Write PLAN.md with one section each for architecture, Redis data model, tile-assignment algorithm, Mosaic_Generator, screens, analytics events, test plan and risks, and write no application code until the owner explicitly approves PLAN.md.
- **Req 1.10** Work in this order, starting a step only after the previous one is reported complete: (1) PLAN.md; (2) Shared_Logic (generator, slicer, solver, tests); (3) Play_Screen, Stitch_Animation, End_Card; (4) Scheduler, Tile_Assigner, Validator, Leaderboard, Streak_Tracker, Flair_Manager; (5) Mosaic_View, Credits_View, completed state; (6) Pixel_Editor, UGC_Queue, Sunday_Vote; (7) polish, accessibility, performance; (8) documentation.
- **Req 1.11** At the end of each step, run `npm test` and `npm run build`, and report the completed step, the files changed, the number of tests passed and failed, and the build pass or fail result.
- **Req 1.12** If `npm test` has a failing test or `npm run build` exits with an error at the end of a step, mark the step incomplete, include the failure output in the report, and do not start the next step until both pass.
- **Req 1.13** If the owner asks for changes to PLAN.md instead of approving it, revise PLAN.md, resubmit it, and keep writing no application code until the owner explicitly approves it.
- **Req 1.14** If an API a feature needs cannot be found in the Devvit MCP server or the docs, do not use it. Record the missing API and the affected feature in the step report, and use a documented alternative or a documented stub (as allowed for the Analytics_Tracker), stating which.

## Safety rules

- Never publish or submit the app for review (Req 1.6). The app stays unpublished; documents say so (Req 30.2).
- Free tiers only; no paid API and no LLM call anywhere (Req 1.8). Mosaic art is procedural and deterministic, never AI-generated; the only exception is an approved, community-voted, hand-drawn UGC_Mosaic on a Sunday (Req 2.1).
- Show only statistics, names and counts read from recorded Redis data, never hard-coded, placeholder, seeded or simulated values (Req 2.3). If the data cannot be read, show an unavailable indicator, not a fabricated or cached default (Req 2.4).
- Empty data sets show an invitation (for example "Be the first stitch today") and no placeholder rows, sample names or zero-filled entries (Req 2.6). Hide the percentile below 10 Scored_Attempts (Req 2.7).
- No Snoo imagery (delete the template's `public/snoo.png`) and no "karma" wording or karma-themed visuals anywhere (Req 2.8).
- Documentation and submission materials contain zero invented numbers, players or testimonials; every number traces to a test result, recorded Redis data, code or configuration, or a cited doc page (Req 2.5, Req 30.3).
- Never send a Solution to the Client before that user's Stitch is recorded, and then only to that user. Before a Stitch the Client gets Clues, Tile_Size, Tile_Index and the generation only, and pixel data only for Tiles with a Solve_Count of at least 1 (Req 8.2, Req 9.9, Req 11.8, Req 18.9).
- The Server is authoritative: it validates the submitted fill grid against the stored Solution and ignores any correctness flag, time, Mistake count or score sent by the Client (Req 11.1, Req 13.7).
- Writes that record play need an authenticated Reddit user; unauthenticated submissions record zero Stitches and zero Mistakes (Req 11.11).
- The Emoji_Grid contains no Cell-level Solution information (Req 17.14). A share comment is posted only after an explicit tap on "Share as comment", at most one per tap, as a reply to the post's single stickied app comment (Req 17.11, Req 17.12, B15). Commenting never gates a feature.
- Flair is opt-in, off by default, and removed on opt-out; flair failures are logged and never block play (Req 23.3, Req 23.5, Req 23.8).
- Every moderator action re-checks moderator permission on the Server, failing closed when the check itself fails (Req 21.6, Req 21.8, Req 22.5, D23).
- Analytics properties and Server logs exclude Reddit usernames, user IDs, comment text, Solution Cells and fill grids (Req 24.6).
- The game stays fully asynchronous: no lobbies, matchmaking, waiting states or synchronous sessions; no trivia, platformer, space-shooter or cloned mechanics; only nonogram Tile solving, Stitching and the UGC_Mosaic features (Req 31.1 to Req 31.4).

## Engineering rules

- TypeScript `strict` in every tsconfig for Client, Server and Shared_Logic, with 0 type errors (Req 28.1).
- Pure logic in `src/shared/`, Client code in `src/client/`, Server code in `src/server/`. Nothing in `src/shared/` imports from `src/client/`, `src/server/`, Redis or the Reddit API (Req 28.2). Shared code uses no `Math.random`, `Date` or locale functions.
- `generateMosaic(dateUTC)` and `sliceToTiles()` are deterministic: same input, same output on Client and Server, in any time zone, after a restart (Req 2.2, Req 3.2, Req 4.2). Tile_Size comes from the UTC weekday only (Req 6.1).
- `solveNonogram()` proves uniqueness and returns a Difficulty_Score; every Tile must be unique, with deterministic Perturbation and fallback when it is not (Req 4.4 to Req 4.6, Req 5.1 to Req 5.8).
- Redis: the Assignment_Counter uses `incrBy(key, 1)` (Req 9.1); First_Stitcher uses set-if-absent (Req 12.2); shared values change only through single atomic commands or a transaction, with zero read-modify-write sequences outside one (Req 9.7, Req 27.4). Transactions watch only per-user keys. No key scans, no plain sets or lists, no `hMGet` (design.md F7).
- Every Redis call runs with a 2 s timeout; a failed assignment or Stitch returns a retryable error and leaves recorded state unchanged (Req 9.12, Req 12.8, Req 27.9).
- Tiles are generated at most once per Day_Key and Regeneration_Seed, even under concurrent requests (Req 27.6, Req 27.7).
- Tests: Vitest with `@devvit/test`; property tests with fast-check at 100 or more runs each. Required: the 120-day window with 7,680 uniquely solvable Tiles and the weekly curve; concurrent assignment with at least 100 users; concurrent Stitches of one Tile; the Validator cases; determinism, clue round-trip and Emoji_Grid properties; all in one `vitest --run` (Req 28.3 to Req 28.10).
- Client JavaScript stays within 130 KB gzipped in total and 15 KB gzipped for the launch screen, measured by the build and recorded in README.md (Req 27.3, D10). First contentful paint within 1.5 s and first Cell input within 3 s on a mid-range phone (Req 27.1, Req 27.2, Req 10.1). The Mosaic is drawn on a canvas (Req 18.1).
- One Palette of 4 colours with paired patterns, one type scale (at most 5 sizes, 2 families), light and dark modes, text contrast of at least 4.5:1, a colour-blind-safe Palette, full keyboard play, reduced-motion support (Req 25.1 to Req 25.3, Req 25.7, Req 26.1 to Req 26.9).
- Zero console errors and zero unhandled promise rejections in the Req 25.4 flows, in light and dark mode. Use `console.warn` for handled failures and `console.error` only for unexpected ones; never suppress errors (Req 25.4, D40).
- Analytics goes through one `track(eventName, properties)` function backed by Devvit Journeys, for exactly the 7 events `post_view`, `first_interaction`, `tile_assigned`, `tile_solved`, `extra_tile_solved`, `share_comment` and `return_next_day`. Failures or calls slower than 2 s are dropped without affecting play (Req 24.1 to Req 24.7).

## Devvit web view rules (from the React template's AGENTS.md)

- Use Devvit client effects from `@devvit/web/client` instead of browser navigation and dialogs: `navigateTo` instead of `window.location`, `showToast` or `showForm` instead of `window.alert`. The repository check rejects `window.location` and `alert(` in `src/client/`.
- No inline `<script>` in HTML files; every script is a separate file (repository check).
- Devvit Web only: never use Devvit blocks or `@devvit/public-api` code found in examples.
- Every menu item, form, trigger and scheduler endpoint in `devvit.json` must have a matching `/internal/*` route on the Server.
- Keep `splash.html` light; React and heavy code load only in `game.html`.
- Named exports, no default exports, in `src/` (tool config files such as `vite.config.ts` keep the default export their tool expects).

## Step reports

Every step ends with a report that names the step, its status (complete or incomplete), the files changed, the `npm test` passed and failed counts, the `npm run build` result with the bundle sizes, each API used for the first time with its docs URL, any docs-versus-memory disagreement, any API not found with the alternative or stub chosen, measurements with their method and date, a scope review against Req 31, open owner decisions, and the commit hash (Req 1.1, Req 1.2, Req 1.11, Req 1.12, Req 1.14). design.md "Step Reporting" has the full template. Measured values go into `patchwork/docs/verification.md`.

## Deliverables (step 8)

README.md, DEVPOST_STORY.md, VIDEO_SHOTLIST.md and SUBMISSION_CHECKLIST.md go in `patchwork/` (Req 30). README.md states that the app is not published and that analytics uses Journeys, which records nothing while unpublished (Req 30.2, B4), and documents the Grace_Rule with worked examples (Req 15.4). DEVPOST_STORY.md labels anything not built as "planned, not built" (Req 30.4). VIDEO_SHOTLIST.md ends by 0:59 and uses only the real demo post (Req 30.5, Req 30.6). SUBMISSION_CHECKLIST.md marks every unknown value with `[OWNER INPUT NEEDED]` and never a guessed value (Req 30.7, Req 30.8, D43). Nothing is submitted by the agent.
