# Verification record

Measured values from test runs and manual checks, newest first. Every entry names the
method and the date. The step report copies its numbers from here.

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
