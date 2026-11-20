# Verification record

Measured values from test runs and manual checks, newest first. Every entry names the
method and the date. The step report copies its numbers from here.

## Step 3: Play_Screen, Stitch_Animation, End_Card (2026-11-20, date of the runs)

Machine: macOS (darwin), Node v24.22.1, run from `patchwork/`.

| What | Value | Method |
|---|---|---|
| `npm test` | 97 passed, 0 failed, 0 skipped; 18 files | `vitest --run` summary line, run 3 times in a row after the last change, all green. The 3 repository checks skipped in step 2 now run. |
| `npm run build` | pass | `tsc --build` (0 errors), `vite build`, `tools/check-bundle.mjs`. |
| Client JavaScript total, Req 27.3 | 85,732 bytes gzipped of 133,120 | `check-bundle.mjs`: gzip level 9 of every `.js` file in `dist/client` (`game.js` 75,029, `track.js` 10,121, `default.js` 582). |
| Launch screen JavaScript, Req 27.3 | 10,703 bytes gzipped of 15,360 | same script: `default.js` (582) plus its static import `track.js` (10,121, the shared chunk with the Journeys client, tokens and the client-side Shared_Logic). |
| 360 px layout, Tile_Size 7, Req 10.7, Req 26.7 | Cells 44×44 CSS px spanning x = 48 to 356 (308 px), first row level with the first row Clue (y = 136); page `scrollWidth` 360 = viewport width (no horizontal scroll) | `format.test.ts` (`playLayout(7, 360)`) and the built `game.html` in Chromium (Playwright) at 360×740, reading `getBoundingClientRect` of the Cells. |
| Full flow in a browser, light and dark | Ghost_Hand plays and stops; a drag-solved Tile submits once; Stitch_Animation flies the Tile into the Mosaic; End_Card shows; "Help another tile" opens a new Tile; launch screen paints from `postData`. 0 console errors and 0 warnings after the favicon fix. | Built `dist/client` served by a scratch Node server outside the workspace that answered `/api/*` with Tiles from `generateMosaic`/`sliceToTiles` for 2026-11-21 and fixed End_Card values; deleted after the run. This is a layout and flow check only, not a playtest: the real Server routes come in step 4. |
| Analytics isolation, Property 47 | `track` returns synchronously with no escaped rejection and no leftover timer when the Journeys client resolves, rejects, throws or never settles (100 generated cases) | `src/client/lib/track.test.ts` with the Journeys client module mocked. |

Found and fixed during the step: the grid's 2 px border pushed the Cells 2 px off the Clues and the pointer maths (now an outline); the missing favicon caused one console error (now `<link rel="icon" href="data:,">`); Property 50's generator could produce an all-empty grid, which no real Tile is (Req 4.9), and failed on seed 1058802080 (now filtered).

## Step 2: Shared_Logic (2026-11-16, date of the run)

Machine: macOS (darwin), Node v24.22.1, run from `patchwork/`.

| What | Value | Method |
|---|---|---|
| `npm test` | 70 passed, 0 failed, 3 skipped; 13 files; about 6 s | `vitest --run` summary line. The 3 skips are the `tools/repo.test.ts` checks for `tokens.css`, `src/client/` and `devvit.json`, which do not exist until the owner-created template lands (D3). |
| `npm run build` | pass | `tsc --build`, 0 errors. |
| 120-day window, Req 28.3 | 7,680 Tiles, each uniquely solvable by a fresh `solveNonogram` call equal to the stored Solution | `src/shared/day120.test.ts` over 2026-11-30 to 2027-03-29. |
| Solver timing, Req 4.4/5.5 | longest single `solveNonogram` 0.13 ms (limit 50 ms) | `performance.now()` inside the window test, one untimed warm-up day first. A cold first run measured 12.70 ms. |
| Slicer timing, Req 4.10 | longest `sliceToTiles` 4.9 ms (limit 5 s) | same test; a cold first run measured 128.4 ms. |
| Weekly curve, Req 28.4 | 0 failures over the window's 17 complete weeks; mean per-Tile difficulty Monday to Sunday: 15.8, 17.7, 19.0, 26.4, 28.8, 39.2, 41.4 | Property 18 in `day120.test.ts`. |
| Curve robustness beyond the window | 0 failures over 104 weeks from 2025-01-06 | calibration search run before the candidate settings were frozen (D29); the calibration files were deleted after the constants were frozen. |
| Perturbation mix over the window | 6,470 unchanged (84.2%), 1,108 perturbed (14.4%), 102 fallback (1.3%) of 7,680 Tiles | counters in `day120.test.ts`. |
| Largest `postData` case | 1,186 bytes (limit 2,000) | `wire.test.ts`: complete 56×56 Mosaic, Day_Number 99,999, generation 999, 40-character Motif name. Matches the 1,186 bytes computed in design.md (h). |
| Palette, Req 26 (D31) | `checkPalette` and `checkTextContrast` pass in light and dark mode; a deliberately bad palette fails both checkers | `palette.test.ts` (Property 66). Frozen values: Navy #0e192f/#a8bde6, Rust #ce7955/#a65430, Teal #15473b/#b6f7ee, Ochre #826026/#c18215. The search kept a margin of about 8% (light) and 4% (dark) above the 1.5:1 pairwise floor under the worst colour-vision simulation. |

Later steps append their playtest and performance records below this line.
