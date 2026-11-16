# Requirements Document

## Introduction

Patchwork is a daily, asynchronous community puzzle game for Reddit's Game of the Day Hackathon, built on Devvit Web (Interactive Posts) from a fresh React-template project. Target prize is Best Daily Game, with an honourable mention as fallback. The submission deadline is 8 Dec 2026, 6:00 PM PT (9 Dec 2026, 7:30 AM IST).

Each UTC day, a scheduled job creates one post holding a hidden mosaic made of an 8×8 grid of 64 tiles. Each tile is a small nonogram (5×5 Monday to Wednesday, 6×6 Thursday and Friday, 7×7 Saturday and Sunday). A player who opens the post receives one tile, solves the tile from row and column clues, and "stitches" the tile into the shared mosaic. Once all 64 tiles are stitched, later players reinforce the weakest tiles. The mosaic art is generated procedurally and deterministically from the date (never AI-generated), except on Sundays when a community-voted, hand-drawn submission can be used.

This document also captures the build-process hard rules (documentation verification, no publishing, free tiers only, plan-first workflow), non-functional targets, safety rules, and the required deliverable documents. Open questions where the request is ambiguous are listed at the end, each with a working assumption that the design phase will use unless the user decides otherwise.

## Glossary

- **Patchwork_App**: The complete Devvit Web application (client, server, shared logic, configuration) described by this document.
- **Client**: The React web view running inside the Reddit Interactive Post, located in `src/client/`.
- **Server**: The Devvit Web server code located in `src/server/`, which owns Redis access, validation, and Reddit API calls.
- **Shared_Logic**: Pure, side-effect-free TypeScript modules in `src/shared/` (generator, slicer, solver, scoring, streak rules, emoji grid).
- **Development_Agent**: The coding agent that builds Patchwork_App under the hard rules in this document.
- **Day_Key**: The UTC calendar date of a puzzle in `yyyy-mm-dd` format; used as the namespace for all per-day Redis keys.
- **Day_Number**: The 1-based count of days from the configured Start_Date to the Day_Key (Start_Date is Day 1).
- **Start_Date**: The moderator-configured UTC date treated as Day 1.
- **Mosaic**: The full hidden image for one Day_Key, composed of 8×8 Tiles. Mosaic pixel size equals 8 × Tile_Size per side (40×40, 48×48, or 56×56).
- **Tile**: One of the 64 sub-images of a Mosaic, identified by a Tile_Index from 0 to 63, presented as a nonogram.
- **Tile_Size**: The side length in cells of every Tile on a given Day_Key: 5 (Mon–Wed), 6 (Thu–Fri), 7 (Sat–Sun), using the UTC weekday of the Day_Key.
- **Cell**: One square in a Tile; a player sets each Cell to filled, marked-X, or empty.
- **Clues**: The row and column run-length numbers of a Tile, the only Tile data sent to the Client before submission.
- **Solution**: The stored correct fill pattern of a Tile, held only on the Server.
- **Palette**: The fixed set of 4 colours, each paired with a distinct pattern, used for Mosaic art and Cell rendering.
- **Motif**: A named, symmetric, seeded procedural design family (for example quilt block, tessellation, mirrored pixel glyph) used to generate a Mosaic.
- **Mosaic_Generator**: The Shared_Logic function `generateMosaic(dateUTC)` that deterministically produces a Mosaic and Motif name from a Day_Key.
- **Slicer**: The Shared_Logic function `sliceToTiles()` that deterministically splits a Mosaic into 64 Tiles with Clues and Solutions.
- **Solver**: The Shared_Logic function `solveNonogram()` that proves whether a Tile has exactly one Solution and computes a Difficulty_Score.
- **Difficulty_Score**: A numeric measure of solving effort produced by the Solver for one Tile.
- **Par**: The target solve time and mistake allowance for a Tile, derived from Difficulty_Score and Tile_Size.
- **Perturbation**: A deterministic, seeded modification of a Tile's pixels applied when the Tile lacks a unique Solution.
- **Tile_Assigner**: The Server component that atomically assigns a Tile to a player.
- **Assignment_Counter**: The per-Day_Key Redis integer incremented with INCR to drive round-robin Tile assignment.
- **Stitch**: A successful, Server-validated solve of a Tile by a player.
- **Solve_Count**: The number of Stitches recorded for one Tile on one Day_Key.
- **First_Stitcher**: The first user whose Stitch of a given Tile was recorded on that Day_Key.
- **Stitched_Total**: The number of distinct Tiles on a Day_Key with a Solve_Count of at least 1.
- **Complete_Mosaic**: The state of a Day_Key in which Stitched_Total equals 64.
- **Weak_Tile**: A Tile whose Solve_Count is the minimum among all 64 Tiles on the Day_Key.
- **Scored_Attempt**: The single, scored Tile assignment a user receives per Day_Key.
- **Extra_Tile**: Any Tile a user solves on a Day_Key after the user's Scored_Attempt; Extra_Tiles count as Stitches but are not scored.
- **Help_Count**: The number of Stitches (Scored_Attempt plus Extra_Tiles) a user made on a Day_Key.
- **Mistake**: A counted error during a Scored_Attempt, as defined in Open Question OQ-2.
- **Score_Engine**: The Shared_Logic module that computes a score from solve time, Mistakes, and Par.
- **Validator**: The Server component that compares a submitted fill grid against the stored Solution.
- **Leaderboard**: The per-Day_Key Redis sorted set of user scores.
- **Time_Distribution**: The global Redis-backed histogram of Scored_Attempt solve times, normalized by Par, used for percentile display.
- **Streak_Tracker**: The Server component that maintains each user's current streak and best streak under the Grace_Rule.
- **Grace_Rule**: The documented rule allowing one missed UTC day without resetting a streak, as defined in Open Question OQ-1.
- **Grace_Use**: A record, stored per user against a Day_Key, that the Grace_Rule was applied to continue that user's streak on that Day_Key. Written as "grace use" in the criteria.
- **Scheduler**: The Devvit scheduled job that creates each day's post.
- **Splash_Screen**: The custom Interactive Post entry view shown in the feed before the player opens the game.
- **Play_Screen**: The Client screen where the player solves a Tile.
- **Mosaic_View**: The Client canvas rendering of the shared Mosaic with stitched and unstitched Tiles.
- **Stitch_Animation**: The animation that moves a solved Tile into its position in the Mosaic_View.
- **End_Card**: The Client screen shown after a Scored_Attempt Stitch.
- **Credits_View**: The Client view shown for a Complete_Mosaic listing First_Stitchers and top helpers.
- **Heat_Overlay**: A Mosaic_View layer that shades each Tile by Solve_Count.
- **Emoji_Grid**: A spoiler-safe text summary of a user's result that reveals no Solution cells.
- **Ghost_Hand**: The zero-text onboarding animation in which an animated hand fills one row.
- **Pixel_Editor**: The Client tool in which an eligible user draws a UGC_Mosaic.
- **UGC_Mosaic**: A user-submitted, hand-drawn mosaic image between 32×32 and 56×56 pixels.
- **UGC_Queue**: The moderator review queue of pending UGC_Mosaics.
- **Sunday_Vote**: The community upvote vote among approved UGC_Mosaics that selects the next Sunday's Mosaic.
- **Regeneration_Seed**: The seed, recorded against a Day_Key when a moderator regenerates that Day_Key's Mosaic, that together with the Day_Key determines the regenerated Mosaic. A Day_Key that has never been regenerated uses a default seed. Written as "regeneration seed" in the criteria.
- **Flair_Manager**: The Server component that assigns opt-in streak flair through the documented Reddit flair API.
- **Flair_Tier**: One of Thread (3-day streak), Quilter (7-day streak), Weaver (30-day streak).
- **Flair_Opt_In**: A per-user stored choice, defaulting to opted out, that permits the Flair_Manager to assign Patchwork flair to that user. Written as "opted in to flair" / "opts out of flair" in the criteria.
- **Analytics_Tracker**: The `track()` wrapper that records analytics events, backed by Journeys if the Devvit docs provide Journeys, otherwise a documented stub.
- **Mod_Menu**: The moderator-only Devvit menu actions for Patchwork_App.
- **App_Settings**: The Devvit app/installation settings for Patchwork_App, including Start_Date.

## Requirements

### Requirement 1: Build-Process Hard Rules

**User Story:** As the project owner, I want the Development_Agent to follow strict process rules, so that the app is built on verified APIs and nothing is published without my consent.

#### Acceptance Criteria

1. WHEN the Development_Agent is about to use a Devvit or Reddit API (a function, hook, configuration key, CLI command, or capability) in code for the first time, THE Development_Agent SHALL first confirm that API against the Devvit MCP server (`devvit_search`) or https://developers.reddit.com/docs, and SHALL list the documentation source used for each confirmed API in that step's summary report.
2. IF the Devvit documentation and the Development_Agent's prior knowledge disagree about an API's name, signature, behaviour, or availability, THEN THE Development_Agent SHALL implement the behaviour stated in the Devvit documentation and SHALL note the disagreement in that step's summary report.
3. THE Development_Agent SHALL create Patchwork_App as a new Devvit Web project from the React template, using the creation method stated in the current Devvit documentation, and SHALL NOT copy application source code from any pre-existing project in the workspace into Patchwork_App.
4. THE Patchwork_App SHALL declare Node.js 24.18 as its minimum supported runtime version in the project configuration, and the commands `npm test` and `npm run build` SHALL complete without error on Node.js 24.18.
5. THE Development_Agent SHALL run only `npm run dev`, `npm run deploy`, `devvit upload` (private upload only), `npm test`, and `npm run build` as deploy, upload, and test operations, and SHALL run no other command that deploys, uploads, or tests Patchwork_App.
6. IF a task would require running `npm run launch`, `devvit publish`, or any other command that submits Patchwork_App for review or makes it publicly available, THEN THE Development_Agent SHALL leave the command unrun, stop work on that task, and report the blocked step and the command it would have needed to the project owner.
7. IF a step requires `devvit login` or any other Reddit account authentication, THEN THE Development_Agent SHALL stop and ask the project owner to run `devvit login` in the owner's own terminal, and SHALL resume that step only after the project owner confirms the login is complete.
8. THE Patchwork_App SHALL use only services that cost nothing at the usage levels described in this document, and SHALL make zero paid API calls and zero LLM calls at runtime, at build time, and in any scheduled job.
9. THE Development_Agent SHALL write PLAN.md with one section each for architecture, Redis data model, tile-assignment algorithm, Mosaic_Generator, screens, analytics events, test plan, and risks, and SHALL write no application code until the project owner explicitly approves PLAN.md.
10. THE Development_Agent SHALL perform work in this order, starting a step only after the previous step is reported complete: (1) PLAN.md; (2) Shared_Logic (generator, slicer, solver, tests); (3) Play_Screen, Stitch_Animation, End_Card; (4) Scheduler, Tile_Assigner, Validator, Leaderboard, Streak_Tracker, Flair_Manager; (5) Mosaic_View, Credits_View, completed state; (6) Pixel_Editor, UGC_Queue, Sunday_Vote; (7) polish, accessibility, performance; (8) documentation.
11. WHEN the Development_Agent completes a step in the work order, THE Development_Agent SHALL run `npm test` and `npm run build` and SHALL report a summary that names the completed step, lists the files changed, and gives the number of tests passed and failed plus the build pass/fail result.
12. IF `npm test` reports one or more failing tests or `npm run build` exits with an error at the end of a step, THEN THE Development_Agent SHALL mark that step incomplete, include the failure output in the summary report, and SHALL NOT start the next step in the work order until both commands pass.
13. IF the project owner requests changes to PLAN.md instead of approving it, THEN THE Development_Agent SHALL revise PLAN.md, resubmit it for approval, and continue to write no application code until the project owner explicitly approves it.
14. IF a Devvit or Reddit API that a feature needs cannot be found in either the Devvit MCP server or https://developers.reddit.com/docs, THEN THE Development_Agent SHALL not use that API, SHALL record the missing API and the affected feature in the step's summary report, and SHALL either use a documented alternative or a documented stub (as permitted for Analytics_Tracker) and state which one it chose.

### Requirement 2: Content Integrity and Honesty

**User Story:** As a judge and player, I want all art and stats to be genuine, so that I can trust what the game shows me.

#### Acceptance Criteria

1. THE Mosaic_Generator SHALL produce Mosaic art for every Day_Key using only deterministic seeded procedural algorithms. It SHALL use zero AI-generated images or text. The one exception is a Sunday Day_Key on which an approved UGC_Mosaic selected by the Sunday_Vote is used.
2. WHEN the Mosaic_Generator is called 2 or more times with the same Day_Key, THE Mosaic_Generator SHALL return a pixel-identical Mosaic and the same Motif name on every call.
3. THE Patchwork_App SHALL display only statistics, player names, and counts that are read from recorded Redis data for the relevant Day_Key or user, with zero hard-coded, placeholder, seeded, or simulated values. This applies to the Leaderboard, Stitched_Total, Solve_Count, Heat_Overlay, Time_Distribution percentiles, Help_Count, streaks, First_Stitchers, and the Credits_View.
4. IF the Server cannot read the Redis data behind a displayed statistic, THEN THE Client SHALL show an unavailable indicator in place of that statistic, SHALL NOT display a fabricated or cached-default value, and SHALL leave the rest of the screen usable.
5. THE Development_Agent SHALL write documentation and submission materials in which every number, player name, and quote can be traced to a test result, recorded Redis data, or cited Devvit documentation. The materials SHALL contain zero invented numbers, players, or testimonials.
6. WHILE a data set shown to the player contains zero entries, THE Client SHALL display an empty state for that data set in place of the list, chart, or count. The empty state SHALL contain an invitation message (for example "Be the first stitch today") and zero placeholder rows, sample names, or zero-filled fake entries. Such data sets include a Leaderboard with no scores, a Credits_View with no First_Stitchers, and a Mosaic_View with a Stitched_Total of 0.
7. IF the Time_Distribution holds fewer than 10 Scored_Attempts, THEN THE Client SHALL omit the percentile figure and SHALL display a message stating that not enough solves have been recorded yet (threshold per OQ-14).
8. THE Patchwork_App SHALL exclude Snoo imagery from all screens and shipped assets, including the template file `public/snoo.png`. It SHALL also exclude the word "karma" and any karma-themed scoring visuals from all screens and assets.

### Requirement 3: Deterministic Mosaic Generation

**User Story:** As a player, I want a new mosaic every UTC day, so that each day's puzzle is fresh and identical for everyone.

#### Acceptance Criteria

1. WHEN `generateMosaic` is called with a valid Day_Key, THE Mosaic_Generator SHALL return a square Mosaic whose side length in pixels equals 8 × Tile_Size for that Day_Key's UTC weekday: 40×40 for Monday to Wednesday, 48×48 for Thursday and Friday, and 56×56 for Saturday and Sunday.
2. THE Mosaic_Generator SHALL return identical Mosaic pixels and an identical Motif name for every call with the same Day_Key, regardless of the wall-clock time of the call, the calling user, the host time zone, or whether the call runs on the Client or the Server.
3. WHEN `generateMosaic` is called with two different Day_Keys that are consecutive UTC days, THE Mosaic_Generator SHALL return Mosaics that differ in at least one pixel.
4. THE Mosaic_Generator SHALL compose each procedural Mosaic from a Motif drawn from a set that contains at least the 3 families quilt block, tessellation, and mirrored pixel glyph. Each generated Motif SHALL be symmetric, which means its pixel pattern is identical under reflection across at least one of the Mosaic's vertical, horizontal, or diagonal centre axes.
5. THE Mosaic_Generator SHALL colour every Mosaic pixel, both procedural and UGC_Mosaic-sourced, with exactly one of the 4 Palette colours. No pixel SHALL use a colour outside the Palette.
6. WHEN `generateMosaic` returns a Mosaic, THE Mosaic_Generator SHALL also return a human-readable Motif name of 1 to 40 characters made of letters, digits, spaces, and hyphens, and the Scheduler SHALL include that name in the day's post title.
7. WHERE a winning UGC_Mosaic exists for a Sunday Day_Key, THE Mosaic_Generator SHALL use the winning UGC_Mosaic as the Mosaic for that Day_Key. A UGC_Mosaic smaller than 56×56 SHALL be fitted to exactly 56×56 pixels by a deterministic method, so that repeated calls for that Day_Key return identical pixels.
8. IF no winning UGC_Mosaic exists for a Sunday Day_Key, THEN THE Mosaic_Generator SHALL produce a procedural 56×56 Mosaic for that Day_Key that satisfies criteria 2, 4, and 5.
9. IF `generateMosaic` is called with a value that is not a real calendar date in `yyyy-mm-dd` format (for example `2026-02-30`, `2026-1-5`, or an empty string), THEN THE Mosaic_Generator SHALL reject the call with an error indicating an invalid Day_Key and SHALL return no Mosaic and no Motif name.

### Requirement 4: Slicing Into Uniquely Solvable Tiles

**User Story:** As a player, I want every tile to have exactly one answer, so that the puzzle is fair and solvable by logic alone.

#### Acceptance Criteria

1. WHEN `sliceToTiles` is called with a Mosaic whose side equals 8 × Tile_Size for the Day_Key, THE Slicer SHALL return exactly 64 Tiles with Tile_Index 0 to 63 in row-major order. Tile_Index i SHALL cover Mosaic rows floor(i / 8) × Tile_Size to floor(i / 8) × Tile_Size + Tile_Size − 1 and Mosaic columns (i mod 8) × Tile_Size to (i mod 8) × Tile_Size + Tile_Size − 1. Each Tile SHALL be Tile_Size × Tile_Size Cells and SHALL carry a binary (foreground/background) Solution, Tile_Size row Clues, and Tile_Size column Clues.
2. FOR ALL Mosaics, calling `sliceToTiles` twice with the same Mosaic and Day_Key SHALL return Tiles, Clues, Solutions, and perturbation records that are equal value for value, including after a process restart (determinism property).
3. FOR ALL Tiles returned by the Slicer, deriving Clues from the Tile Solution, solving those Clues with the Solver, and deriving Clues from the Solver's single output grid SHALL produce row and column Clues identical to the first set, and the Solver output grid SHALL equal the Tile Solution cell for cell (clue round-trip property).
4. WHEN the Slicer produces a Tile, THE Solver SHALL return one of two results for the Tile Clues: "unique", meaning exactly one Solution, or "not unique", meaning two or more Solutions. THE Solver SHALL return the result within 50 milliseconds per Tile of side up to 7.
5. IF a Tile's Clues admit more than one Solution, THEN THE Slicer SHALL apply a Perturbation seeded only by Day_Key and Tile_Index that changes between 1 and 3 Cells of the Tile, and SHALL re-check uniqueness with the Solver. THE Slicer SHALL repeat this for at most 8 Perturbation attempts per Tile and SHALL stop at the first attempt the Solver reports as unique.
6. IF a Tile is still not unique after 8 Perturbation attempts, THEN THE Slicer SHALL replace the Tile with a fallback pattern chosen deterministically from Day_Key and Tile_Index. THE Solver SHALL report the fallback pattern as unique. THE Slicer SHALL return a Tile set in which all 64 Tiles are reported unique by the Solver and no Tile is left non-unique.
7. WHEN Perturbation or the fallback pattern changes a Tile, THE Slicer SHALL record for that Tile_Index whether it was unchanged, perturbed, or replaced by fallback. THE Slicer SHALL also return the final Tile pixels, so that the Mosaic_View cells for that Tile match the final Solution cell for cell.
8. IF `sliceToTiles` receives a Mosaic whose side is not 8 × Tile_Size for the Day_Key, or whose pixels cannot be mapped to foreground/background, THEN THE Slicer SHALL reject the input with an error indicating invalid Mosaic dimensions or content and SHALL return no Tiles.
9. IF a Tile's Solution has every Cell filled or every Cell empty, so that the Tile could be solved without at least one logic step per OQ-7, THEN THE Slicer SHALL apply the same deterministic Perturbation process as criterion 5 until the Tile has at least 1 filled Cell, at least 1 empty Cell, and a unique Solution as reported by the Solver.
10. WHEN `sliceToTiles` is called for a Mosaic of Tile_Size 7, THE Slicer SHALL return all 64 Tiles, including the uniqueness checks, Perturbations, and fallbacks, within 5 seconds.

### Requirement 5: Nonogram Solver and Difficulty

**User Story:** As a game designer, I want a solver that proves uniqueness and scores difficulty, so that par is fair and difficulty rises through the week.

#### Acceptance Criteria

1. WHEN `solveNonogram` is called with the Clues of a Tile whose Tile_Size is 5, 6, or 7, THE Solver SHALL return exactly one of three results: unique, multiple, or unsolvable. A unique result includes the single Solution. A multiple result means at least 2 distinct fill patterns satisfy every Clue. An unsolvable result means no fill pattern satisfies every Clue.
2. WHEN `solveNonogram` returns unique, THE Solver SHALL return a Difficulty_Score that is an integer from 1 to 100 inclusive, and SHALL return no Difficulty_Score for multiple or unsolvable results.
3. FOR ALL Tiles produced by the Slicer, including Tiles that received a Perturbation, the Solution returned by the Solver SHALL match the Slicer's stored Solution cell for cell and SHALL satisfy every row and column Clue of the Tile.
4. WHEN the Score_Engine computes Par for a Tile from the Tile's Difficulty_Score and Tile_Size, THE Score_Engine SHALL produce a target solve time as an integer number of seconds from 10 to 600 inclusive and a mistake allowance as an integer from 0 to 5 inclusive.
5. THE Solver SHALL complete uniqueness checking of every 7×7 Tile within 50 ms per call on the test machine, measured as the maximum single-call duration across all 64 Tiles of one Mosaic, so that generating 64 Tiles completes within the Server request time limit stated in the Devvit documentation.
6. WHEN `solveNonogram` is called twice with identical Clues, THE Solver SHALL return the same result type, the same Solution, and the same Difficulty_Score both times.
7. WHEN two Tiles have the same Tile_Size and different Difficulty_Scores, THE Score_Engine SHALL assign the Tile with the higher Difficulty_Score a Par target solve time greater than or equal to that of the other Tile. WHEN two Tiles have the same Difficulty_Score and different Tile_Sizes, THE Score_Engine SHALL assign the Tile with the larger Tile_Size a Par target solve time greater than or equal to that of the other Tile.
8. IF `solveNonogram` is called with malformed Clues (a row or column clue count that differs from the Tile_Size, a Tile_Size outside 5 to 7, or a negative or zero run length), THEN THE Solver SHALL return an error result indicating invalid input, without returning a Solution or Difficulty_Score and without throwing an uncaught exception.

### Requirement 6: Weekly Difficulty Curve

**User Story:** As a returning player, I want difficulty to rise from Monday to Sunday, so that the week has a satisfying arc.

#### Acceptance Criteria

1. THE Patchwork_App SHALL set Tile_Size from the UTC weekday of the Day_Key, never from the player's local time zone: 5 for UTC Monday, Tuesday, and Wednesday; 6 for UTC Thursday and Friday; 7 for UTC Saturday and Sunday.
2. THE Patchwork_App SHALL use one Tile_Size for all 64 Tiles of a Day_Key, so that the Mosaic is 40×40, 48×48, or 56×56 pixels.
3. THE Patchwork_App SHALL use the 120-day test window, which is 120 consecutive Day_Keys starting on a fixed UTC Monday recorded in the test suite. The window SHALL contain 17 complete Monday-to-Sunday weeks plus 1 trailing Monday.
4. FOR ALL complete Monday-to-Sunday weeks in the 120-day test window, the mean Difficulty_Score of each procedurally generated Day_Key's 64 Tiles SHALL be at least 95% of the previous day's mean in the same week. A day's mean SHALL be computed from the final Tiles after any Perturbation.
5. FOR ALL complete Monday-to-Sunday weeks in the 120-day test window, the mean Difficulty_Score of the Sunday Day_Key SHALL be strictly greater than that of the Monday Day_Key, and the mean of the Thursday Day_Key SHALL be strictly greater than that of the Wednesday Day_Key.
6. THE Mosaic_Generator SHALL use the UTC weekday of the Day_Key as an input when it selects Motif density. Two calls to `generateMosaic` with the same Day_Key SHALL return identical Mosaics and Motif names.
7. IF a Sunday Day_Key uses a UGC_Mosaic selected by the Sunday_Vote, THEN THE Patchwork_App SHALL still use a Tile_Size of 7 for that Day_Key, and the test suite SHALL leave that Day_Key out of the checks in criteria 4 and 5.

### Requirement 7: Daily Post Scheduler

**User Story:** As a subreddit member, I want a new Patchwork post every UTC day, so that the game is always waiting for me.

#### Acceptance Criteria

1. WHEN a new UTC day begins, THE Scheduler SHALL create exactly one Interactive Post for the new Day_Key, with the post visible in the subreddit no later than 00:05:00 UTC on that Day_Key.
2. WHEN the Scheduler creates a post, THE Scheduler SHALL set the post title to "Day N · <Motif name>". N SHALL be the Day_Number written as a base-10 integer without leading zeros. <Motif name> SHALL be the Motif name that the Mosaic_Generator returns for that Day_Key.
3. IF a post already exists for a Day_Key, THEN THE Scheduler SHALL skip creating another post for that Day_Key, so that exactly one post exists per Day_Key even when two or more Scheduler runs execute for the same Day_Key, including runs that execute at the same time.
4. WHEN the Scheduler creates a post, THE Scheduler SHALL generate and store all 64 Tiles, their Clues, their Solutions, and their Par values for the Day_Key on the Server before the post becomes visible to subreddit members.
5. THE Scheduler SHALL register the daily job through the scheduler API documented by Devvit, set to run once per day at 00:00 UTC.
6. IF Tile generation, data storage, or post creation fails for a Day_Key, THEN THE Scheduler SHALL retry the full creation sequence up to 3 attempts in total, with every attempt starting no later than 00:05:00 UTC.
7. IF all 3 attempts for a Day_Key fail, THEN THE Scheduler SHALL leave no visible post and no partially stored Tile data for that Day_Key, so that a later Scheduler run can create the Day_Key's post from a clean state.
8. IF the Day_Key is earlier than the effective Start_Date determined under Requirement 22 criteria 6 and 7, THEN THE Scheduler SHALL skip creating a post and store no Tile data for that Day_Key.

### Requirement 8: Splash Screen and Feed Preview

**User Story:** As a feed scroller, I want to see the mosaic's progress before opening the post, so that I'm drawn in to help.

#### Acceptance Criteria

1. WHEN the Splash_Screen loads, THE Splash_Screen SHALL render the Mosaic_View state for the post's Day_Key as stored on the Server at the moment of loading. Each Tile with a Solve_Count of at least 1 SHALL show its Solution pixels in the Palette. Each Tile with a Solve_Count of 0 SHALL show as a uniform blank placeholder. The result SHALL be an all-blank grid when Stitched_Total is 0, a partly filled grid when Stitched_Total is from 1 to 63, and the full Mosaic image when the Day_Key is a Complete_Mosaic.
2. THE Server SHALL send the Splash_Screen pixel data only for Tiles with a Solve_Count of at least 1, so that no Solution cells of unstitched Tiles reach the Client.
3. WHEN the Splash_Screen loads, THE Splash_Screen SHALL display progress text in the form "Day N · S/64 stitched". N SHALL be the Day_Number of the post's Day_Key. S SHALL be the integer Stitched_Total, from 0 to 64, as read at load time.
4. WHILE Stitched_Total is 0, THE Splash_Screen SHALL display the text "Be the first stitch today" in addition to the progress text from criterion 3.
5. WHERE the Devvit documentation provides a way to update post preview or title-adjacent text after the post is created, THE Server SHALL update that preview with the current Stitched_Total within 60 seconds of each change to Stitched_Total. The post title SHALL stay "Day N · <Motif>" (see OQ-5: post titles likely cannot be edited).
6. IF updating the post preview fails, THEN THE Server SHALL still record the Stitch that changed Stitched_Total, SHALL leave the previous preview text in place, and SHALL try the update again on the next change to Stitched_Total.
7. IF the Splash_Screen cannot get Mosaic state from the Server within 5 seconds of loading, THEN THE Splash_Screen SHALL show an all-blank 8×8 grid, SHALL show "Day N" without a stitched count, and SHALL keep the control for opening the game available.

### Requirement 9: Tile Assignment

**User Story:** As a player, I want to get a meaningful tile instantly, even if I arrive late, so that I always contribute.

#### Acceptance Criteria

1. WHEN a user without a Scored_Attempt opens a Day_Key's post, THE Tile_Assigner SHALL increment that Day_Key's Assignment_Counter with Redis INCR exactly once and take (returned value − 1) modulo 64 as the candidate Tile_Index, so the first assignment of the Day_Key has candidate Tile_Index 0.
2. WHILE Stitched_Total is below 64, WHEN the Tile_Assigner assigns a Scored_Attempt Tile, THE Tile_Assigner SHALL assign the candidate Tile_Index if that Tile's Solve_Count is 0, and otherwise SHALL assign the first Tile with a Solve_Count of 0 found by checking Tile_Indexes in ascending order from the candidate Tile_Index, wrapping from 63 to 0.
3. WHILE the Day_Key is a Complete_Mosaic, WHEN the Tile_Assigner assigns a Scored_Attempt Tile, THE Tile_Assigner SHALL assign a Weak_Tile, choosing among tied Weak_Tiles the first one found by checking Tile_Indexes in ascending order from the candidate Tile_Index, wrapping from 63 to 0.
4. WHEN a user with an existing Scored_Attempt reopens the Day_Key's post, THE Tile_Assigner SHALL return the same Tile_Index previously assigned to that user for that Day_Key, SHALL NOT increment the Assignment_Counter, and SHALL do so whether or not the user has stitched that Tile.
5. WHEN a user who has stitched the Scored_Attempt Tile requests an Extra_Tile, THE Tile_Assigner SHALL assign a Tile the user has not already stitched on that Day_Key, choosing first a Tile with a Solve_Count of 0 and, if none exists, the Tile with the lowest Solve_Count among the Tiles the user has not stitched, with ties broken by the ascending-from-candidate, wrap-from-63-to-0 order of criterion 2.
6. IF a user requests an Extra_Tile after having stitched all 64 Tiles on a Day_Key, THEN THE Tile_Assigner SHALL return a completion state containing no Tile, SHALL NOT increment the Assignment_Counter, and SHALL leave all Solve_Counts unchanged.
7. THE Tile_Assigner SHALL perform every assignment using atomic Redis operations (INCR, transactions, or other atomic commands confirmed in the Devvit Redis docs) and SHALL contain zero read-modify-write sequences outside an atomic operation.
8. FOR ALL simulated sequences of concurrent assignment requests from N distinct users (N from 1 to 1,000), THE Tile_Assigner SHALL give each user exactly one Scored_Attempt Tile, and the first 64 assignments of a Day_Key SHALL cover 64 distinct Tile_Indexes when no Stitches occur between them (concurrency property).
9. WHEN the Tile_Assigner returns an assigned Tile, THE Server SHALL send the Client only the Tile's Clues, Tile_Size, and Tile_Index, and the response SHALL contain no Solution cells.
10. THE Tile_Assigner SHALL keep no reservation or timeout for an assigned but unstitched Tile, so a Tile whose assignment was abandoned stays at its current Solve_Count and remains eligible for assignment to other users under criteria 2, 3, and 5 (OQ-10).
11. WHEN 1,000 assignment requests for one Day_Key arrive concurrently, THE Tile_Assigner SHALL return a Tile or completion state to 95% of them within 500 ms, measured at the Server.
12. IF a Redis operation fails or does not complete within 2 seconds during assignment, THEN THE Server SHALL return to the Client an error indicating the Tile could not be assigned. In that case it SHALL record no Scored_Attempt for the user and SHALL leave Solve_Counts unchanged, and the Client SHALL show a retry option.
13. IF a user who has not stitched the Scored_Attempt Tile requests an Extra_Tile, THEN THE Tile_Assigner SHALL reject the request with an error indicating the Scored_Attempt must be completed first, and SHALL return the user's existing Scored_Attempt Tile_Index.

### Requirement 10: Tile Play Screen and Input

**User Story:** As a mobile player, I want to start filling cells immediately with comfortable controls, so that solving feels effortless.

#### Acceptance Criteria

1. WHEN a user opens the post, THE Client SHALL display a Play_Screen that accepts Cell input within 3 seconds of the open action, measured on a mobile device with at least 4 GB RAM, released within the previous 4 years, over a 4G connection of at least 9 Mbps downlink.
2. WHILE the mark-X toggle is inactive, WHEN a user taps an empty Cell, THE Play_Screen SHALL set the Cell to filled within 100 ms of the tap.
3. WHEN a user taps a filled Cell, THE Play_Screen SHALL set the Cell to empty within 100 ms of the tap.
4. WHEN a user presses a Cell for at least 400 ms without moving the touch point off that Cell, THE Play_Screen SHALL set the Cell to marked-X and SHALL NOT also apply the tap behaviour of criteria 2, 3, 5, or 12 to that press.
5. WHILE the mark-X toggle is active, WHEN a user taps an empty Cell, THE Play_Screen SHALL set the Cell to marked-X instead of filled.
6. WHEN a user presses a Cell and drags across adjacent Cells in the same row or column as the starting Cell, THE Play_Screen SHALL apply the starting Cell's resulting state (filled, marked-X, or empty) to every Cell between the starting Cell and the current touch point in that row or column, and SHALL ignore Cells outside that row or column for the rest of the drag.
7. THE Play_Screen SHALL render every Cell tap target at a minimum of 44×44 CSS pixels on a 360-CSS-pixel-wide viewport for Tile_Sizes 5, 6, and 7, with Clues and the full Tile grid visible without horizontal scrolling.
8. THE Play_Screen SHALL display each row's Clues to the left of that row and each column's Clues above that column, and WHEN the sequence of filled-Cell run lengths in a row or column exactly equals that line's Clues, THE Play_Screen SHALL display that line's Clues in a satisfied style that differs from the unsatisfied style by a property other than colour alone (for example reduced opacity or strikethrough).
9. WHEN a Cell change results in every row and every column of the Tile exactly matching their Clues, THE Client SHALL submit the fill grid to the Validator once and SHALL ignore further Cell input until the Validator responds.
10. WHEN a user sees the Play_Screen for the first time on their Reddit account, THE Client SHALL play the Ghost_Hand animation filling one row of the Tile, with zero instructional text on screen, and SHALL NOT play the Ghost_Hand animation on later visits by that account.
11. WHEN a user touches any Cell while the Ghost_Hand animation is playing, THE Client SHALL stop the Ghost_Hand animation within 100 ms, SHALL remove any Cell states the animation displayed, and SHALL apply the user's input normally.
12. WHEN a user taps a marked-X Cell, THE Play_Screen SHALL set the Cell to empty within 100 ms of the tap.
13. IF the fill grid submission to the Validator fails because of a network error or does not respond within 10 seconds, THEN THE Client SHALL keep every Cell state unchanged, SHALL display an error indicating the submission did not go through, SHALL re-enable Cell input, and SHALL offer a retry action that resubmits the same fill grid.

### Requirement 11: Server-Side Validation

**User Story:** As a fair-play player, I want solves verified by the server, so that nobody can fake stitches.

#### Acceptance Criteria

1. WHEN the Client submits a fill grid for a Tile, THE Validator SHALL compare the set of filled Cells in the submitted grid against the stored Solution identified by the Day_Key and Tile_Index of that submission, using only Server-held data and no correctness flag supplied by the Client.
2. WHEN the submitted filled Cells match the Solution exactly at every Cell position, THE Validator SHALL record exactly one Stitch for that user, Day_Key and Tile_Index. Recording the Stitch SHALL increase that Tile's Solve_Count by 1 and the user's Help_Count by 1, set the user as First_Stitcher if the Tile's Solve_Count was 0 before the submission, and return a success response containing the updated Solve_Count.
3. IF the submitted fill grid differs from the Solution in one or more Cells, THEN THE Validator SHALL reject the submission, record zero Stitches, leave Solve_Count, Help_Count and First_Stitcher unchanged, and return a failure response that does not reveal which Cells, rows or columns are wrong or how many Cells are wrong.
4. IF a rejected submission under criterion 3 belongs to the user's Scored_Attempt, THEN THE Server SHALL add 1 to that user's Mistake count for that Day_Key, store the count server-side, and ignore any Mistake count supplied by the Client.
5. IF the submitted Tile_Index is outside the range 0 to 63, or is not currently assigned to the submitting user for that Day_Key, THEN THE Validator SHALL reject the submission with an error indicating the Tile is not assigned, record zero Stitches, and leave the Mistake count unchanged.
6. IF the submitted fill grid has dimensions other than Tile_Size × Tile_Size for that Day_Key, or contains any Cell value other than filled, marked-X or empty, THEN THE Validator SHALL reject the submission with a validation error, record zero Stitches, and leave the Mistake count unchanged.
7. THE Validator SHALL treat marked-X Cells and empty Cells as equivalent unfilled Cells when comparing against the Solution.
8. THE Server SHALL send the Solution of a Tile to the Client only after the Validator has recorded the requesting user's Stitch of that Tile, and only to that user.
9. THE Validator SHALL accept a submission equal to the stored Solution for every Tile_Index 0 to 63 on any Day_Key, and SHALL reject every submission that differs from the stored Solution by one or more Cells (validator property).
10. WHEN a user submits a matching fill grid for a Tile that user has already stitched on that Day_Key, including two or more matching submissions received at the same time, THE Validator SHALL return success and record at most one Stitch in total for that user, Day_Key and Tile_Index.
11. IF a submission arrives without an authenticated Reddit user, THEN THE Validator SHALL reject the submission with an error indicating authentication is required and record zero Stitches and zero Mistakes.
12. IF the submitted Day_Key does not match the Day_Key of the post the submission came from, THEN THE Validator SHALL reject the submission with an error indicating a day mismatch, record zero Stitches, and leave the Mistake count unchanged.

### Requirement 12: Stitch Recording

**User Story:** As a community member, I want every solve tracked per tile, so that the mosaic and credits reflect real contributions.

#### Acceptance Criteria

1. WHEN the Validator records a Stitch, THE Server SHALL atomically increment the Tile's Solve_Count for that Day_Key by exactly 1, whether the Stitch is a Scored_Attempt or an Extra_Tile.
2. WHEN the Validator records a Stitch, THE Server SHALL set the First_Stitcher of that Tile for that Day_Key to the submitting user using a set-if-absent operation, so that an existing First_Stitcher value is never overwritten.
3. WHEN the Validator records a Stitch, THE Server SHALL increment the submitting user's Help_Count for that Day_Key by exactly 1, whether the Stitch is a Scored_Attempt or an Extra_Tile.
4. WHEN the Validator records a Stitch that raises a Tile's Solve_Count from 0 to 1, THE Server SHALL increment Stitched_Total for that Day_Key by exactly 1. Stitches of a Tile whose Solve_Count is already 1 or more SHALL leave Stitched_Total unchanged.
5. WHEN Stitched_Total for a Day_Key reaches 64, THE Server SHALL mark the Day_Key as a Complete_Mosaic and record the completion timestamp as a UTC time with at least 1-second precision.
6. IF a Day_Key is already marked as a Complete_Mosaic, THEN THE Server SHALL keep the original completion timestamp unchanged when later Stitches are recorded for that Day_Key.
7. THE Server SHALL ensure that for any number of concurrent Stitches of the same Tile on the same Day_Key, from 2 up to at least 100 simulated simultaneous submissions, exactly one First_Stitcher is recorded and the Solve_Count equals the number of accepted Stitches.
8. IF any Redis write in criteria 1 to 5 fails while a Stitch is being recorded, THEN THE Server SHALL return an error response to the Client saying the Stitch was not saved, and SHALL leave Solve_Count, First_Stitcher, Help_Count, Stitched_Total, and Complete_Mosaic state as they were before that Stitch.

### Requirement 13: Scoring

**User Story:** As a competitive player, I want a score based on time and mistakes against par, so that my result is comparable across tile sizes.

#### Acceptance Criteria

1. WHEN the Server accepts a Scored_Attempt submission, THE Score_Engine SHALL compute the score from three inputs: solve time in seconds, Mistake count, and the Par target time in seconds for the assigned Tile. The score SHALL be an integer of at least 0, and a higher score SHALL rank as better. The formula is the one fixed in the design per OQ-13 (working assumption: max(0, 1000 × Par_time / solve_time − 100 × Mistakes), rounded down to an integer).
2. THE Server SHALL measure solve time as the interval, at 1-millisecond resolution, between the Server-recorded Tile assignment time and the Server-recorded accepted submission time (see OQ-3). Idle time within that interval counts toward solve time. Any solve time below 1 second SHALL be treated as 1 second.
3. THE Score_Engine SHALL count as Mistakes only the Server-rejected submissions (per OQ-2) made for the user's Scored_Attempt Tile on that Day_Key before the accepted submission. The Mistake count SHALL be an integer of at least 0.
4. THE Patchwork_App SHALL record at most one Scored_Attempt score per user per Day_Key.
5. IF a Scored_Attempt score already exists for the user on the Day_Key when another accepted submission arrives, THEN THE Server SHALL keep the first recorded score unchanged and SHALL NOT write a second score to the Leaderboard.
6. WHEN a user stitches an Extra_Tile, THE Server SHALL increment the user's Help_Count by exactly 1 and SHALL leave the user's recorded score and Leaderboard entry unchanged.
7. THE Server SHALL ignore any solve time, Mistake count, or score value supplied by the Client, and SHALL compute the score only from Server-recorded data.
8. IF the Server has no recorded assignment time or no Par for the submitted Scored_Attempt Tile, THEN THE Server SHALL record no score, SHALL return an error indicating the score could not be computed, and SHALL leave the Leaderboard and the recorded Stitch unchanged.
9. FOR ALL pairs of attempts with equal Par and equal Mistakes, the attempt with the shorter solve time SHALL receive a score at least as high (monotonicity property).
10. FOR ALL pairs of attempts with equal Par and equal solve time, the attempt with fewer Mistakes SHALL receive a score at least as high (monotonicity property).
11. FOR ALL pairs of attempts with any Tile_Sizes (5, 6, or 7), equal Mistake counts, and equal ratios of solve time to Par target time, the Score_Engine SHALL return scores that differ by no more than 1 point (cross-size comparability property). It SHALL also return the same score each time it is given the same solve time, Mistake count, and Par (determinism property).

### Requirement 14: Leaderboard and Time Distribution

**User Story:** As a player, I want to see how I rank and where my time falls, so that I want to come back and improve.

#### Acceptance Criteria

1. WHEN the Server records a Scored_Attempt score, THE Server SHALL add exactly one entry for that user to the Day_Key Leaderboard sorted set, keyed by the user and valued by the score computed by the Score_Engine.
2. WHEN the Server records a Scored_Attempt score, THE Server SHALL atomically increment by 1 the single Time_Distribution bucket that contains the attempt's solve time divided by Par, where buckets are 0.1 Par wide from 0.0 to 5.0 Par and every ratio of 5.0 Par or higher falls into one final overflow bucket.
3. IF a Stitch is an Extra_Tile, or the user already has a Leaderboard entry for the Day_Key, THEN THE Server SHALL leave both the Leaderboard and the Time_Distribution unchanged for that Stitch.
4. WHEN the End_Card requests a percentile, THE Server SHALL return the user's percentile as an integer from 0 to 100, equal to the percentage of Time_Distribution entries in buckets slower than the user's bucket, plus half of the other entries in the user's own bucket, rounded to the nearest integer.
5. WHEN the End_Card requests the user's rank, THE Server SHALL return the user's 1-based position on the Day_Key Leaderboard and the total number of Leaderboard entries for that Day_Key, where users with equal scores share the same position.
6. WHILE the Time_Distribution holds fewer than 10 Scored_Attempts, THE End_Card SHALL display an empty-state message for the percentile chart saying that not enough solves have been recorded yet to compare, and SHALL display no percentile number (threshold per OQ-14).
7. IF the Server fails to read the Leaderboard or Time_Distribution within 3 seconds, THEN THE End_Card SHALL display the user's own score and solve time with a message saying ranking is temporarily unavailable, and the Server SHALL keep any Leaderboard and Time_Distribution entries it has already recorded unchanged.

### Requirement 15: Streaks

**User Story:** As a daily player, I want my streak tracked with a small grace allowance, so that one missed day doesn't erase my progress.

#### Acceptance Criteria

1. WHEN a user records a Scored_Attempt on a Day_Key that is exactly 1 day after the user's most recent previous Scored_Attempt Day_Key, THE Streak_Tracker SHALL increase the user's current streak by 1 and set the user's best streak to the greater of the existing best streak and the new current streak.
2. THE Streak_Tracker SHALL apply each streak update atomically, so that any number of concurrent requests from the same user for the same Day_Key change the current streak by at most 1 in total. IF a streak update fails partway, THEN THE Streak_Tracker SHALL leave both the current streak and the best streak at their values from before the update.
3. FOR ALL sequences of play dates, THE Streak_Tracker SHALL keep the best streak greater than or equal to the current streak, and SHALL keep the current streak at 1 or more after any Scored_Attempt (invariant).
4. THE Development_Agent SHALL document the Grace_Rule in README.md, including the allowed gap of 1 or 2 days, the limit of one grace use in any rolling 7 consecutive Day_Keys, the rule that the missed day adds nothing to the count, and at least one worked example of a streak that continues and one that resets.
5. WHEN a user who recorded a Scored_Attempt on the previous UTC Day_Key records a Scored_Attempt on the current Day_Key, THE Analytics_Tracker SHALL record exactly one `return_next_day` event for that user and the current Day_Key.
6. WHEN a user records a Scored_Attempt on a Day_Key that is exactly 2 days after the user's most recent previous Scored_Attempt Day_Key, and no grace use is recorded for that user on any of the 6 Day_Keys before the current Day_Key, THE Streak_Tracker SHALL increase the current streak by 1 without counting the missed day, record a grace use for the current Day_Key, and set the best streak to the greater of the existing best streak and the new current streak.
7. IF a user records a Scored_Attempt and the user has no previous Scored_Attempt, or the gap to the previous Scored_Attempt Day_Key is 3 or more days, or the gap is 2 days and a grace use is already recorded for that user on one of the 6 Day_Keys before the current Day_Key, THEN THE Streak_Tracker SHALL set the current streak to 1 and leave the best streak unchanged unless the best streak is 0, in which case the best streak becomes 1.
8. IF a user completes an Extra_Tile, or submits a request that would record a second Scored_Attempt on a Day_Key that already has one for that user, THEN THE Streak_Tracker SHALL leave the current streak, the best streak, and the grace-use record unchanged.

### Requirement 16: Stitch Animation

**User Story:** As a player, I want a satisfying moment when my tile joins the mosaic, so that solving feels rewarding.

#### Acceptance Criteria

1. WHEN the Validator accepts a submission, THE Client SHALL play the Stitch_Animation, which moves the solved Tile from the Play_Screen to its Tile_Index position in the Mosaic_View within a total duration of no less than 400 ms and no more than 1,200 ms.
2. WHEN the Stitch_Animation or its reduced-motion fade finishes, THE Client SHALL render the solved Tile in the Mosaic_View as stitched at its Tile_Index position, using the same Palette colours and patterns as the other stitched Tiles.
3. WHERE the user's system requests reduced motion, THE Client SHALL replace the Stitch_Animation with a fade of 200 ms or less that involves no movement, scaling, or rotation of the Tile.
4. WHILE the Stitch_Animation or its reduced-motion fade is playing, THE Client SHALL ignore Cell input and submission input on the Play_Screen.
5. WHEN the Stitch_Animation or its reduced-motion fade for a Scored_Attempt finishes, THE Client SHALL display the End_Card within 500 ms.
6. IF the Validator rejects a submission, THEN THE Client SHALL not play the Stitch_Animation, SHALL keep the Play_Screen displayed, and SHALL keep every Cell state the player entered.
7. THE Client SHALL keep sound off each time a user opens the post until that user enables sound with the sound toggle.
8. THE Client SHALL show a sound toggle wherever the Stitch_Animation can play. The toggle SHALL show whether sound is on or off, and switching it SHALL change the sound state before the next Stitch_Animation plays.
9. WHILE sound is off, THE Client SHALL play no audio during the Stitch_Animation or the reduced-motion fade.

### Requirement 17: End Card

**User Story:** As a player who just stitched, I want a rich end card, so that I see my result, my place in the mosaic, and what to do next.

#### Acceptance Criteria

1. WHEN the Server confirms that the user's Scored_Attempt Stitch has been recorded, THE Client SHALL display the End_Card within 1 second of receiving the confirmation, before playing or after finishing the Stitch_Animation.
2. WHEN the End_Card is displayed, THE End_Card SHALL display the user's score, the user's solve time next to the Par target time, and the user's Mistake count next to the Par mistake allowance, all using the values the Server recorded for that Scored_Attempt.
3. WHEN the End_Card is displayed, THE End_Card SHALL display a percentile chart built from the Time_Distribution, marking the user's Par-normalized solve time and stating the user's percentile as a whole number from 0 to 100.
4. IF the Time_Distribution holds fewer than 10 Scored_Attempts, or the Time_Distribution cannot be retrieved, THEN THE End_Card SHALL show a message saying the percentile is not yet available in place of the percentile chart, and SHALL keep every other End_Card element visible and usable (threshold per OQ-14).
5. WHEN the End_Card is displayed, THE End_Card SHALL display the Mosaic_View for the current Day_Key with the user's Tile highlighted by an outline or pattern that no other Tile shows, and with every Stitch recorded up to the moment the End_Card loaded.
6. WHEN the End_Card is displayed, THE End_Card SHALL display the user's Help_Count for the current Day_Key and the user's current streak, both counting the Stitch just recorded.
7. WHILE the End_Card is displayed, THE End_Card SHALL display a countdown in hours, minutes, and seconds to the next 00:00 UTC and update it once per second.
8. WHEN the countdown reaches zero, THE End_Card SHALL replace the countdown with a message saying that a new day's puzzle is available.
9. WHEN the user taps "Help another tile", THE Client SHALL request an Extra_Tile from the Server and, once the Server returns an assigned Tile, open the Play_Screen for that Tile.
10. IF the Extra_Tile request fails or the Server returns no Tile, THEN THE Client SHALL keep the End_Card displayed, show an error message saying no extra Tile could be assigned, and leave the "Help another tile" control enabled so the user can retry.
11. WHEN the user taps "Share as comment", THE Server SHALL post the user's Emoji_Grid as a comment on the Day_Key post through the comment API documented by Devvit. The comment SHALL be posted as the user if Devvit documents a run-as-user mechanism. Otherwise it SHALL be posted as the app with the user's username included in the comment text (OQ-12).
12. THE Server SHALL post a share comment only in response to an explicit user tap on "Share as comment", and SHALL post at most one share comment per tap.
13. WHILE a share comment request is pending, THE Client SHALL disable the "Share as comment" control. WHEN the comment is posted successfully, THE Client SHALL show a confirmation that the comment was posted.
14. FOR ALL results, THE Emoji_Grid SHALL contain zero Cell-level Solution information (spoiler-safety property). No row, column, or Cell of any Solution may be reconstructable from the Emoji_Grid text.
15. IF posting the share comment fails, THEN THE Client SHALL display an error message saying the comment was not posted, re-enable the "Share as comment" control for retry, and keep every other End_Card element displayed and usable with its data unchanged.

### Requirement 18: Live Mosaic View and Heat Overlay

**User Story:** As a community member, I want to watch the mosaic fill in through the day, so that I feel part of a shared effort.

#### Acceptance Criteria

1. THE Mosaic_View SHALL render the Mosaic for the current Day_Key on a single HTML canvas element as an 8×8 grid of 64 Tiles, positioned by Tile_Index in row-major order (Tile_Index 0 at top-left, Tile_Index 63 at bottom-right), with each Tile drawn as Tile_Size × Tile_Size Cells using the Palette colours and their paired patterns.
2. THE Mosaic_View SHALL draw each Tile with a Solve_Count of at least 1 using that Tile's image pixels, and SHALL draw each Tile with a Solve_Count of 0 as a blank placeholder that has one uniform appearance for all unstitched Tiles and reveals no Solution Cell information.
3. THE Mosaic_View SHALL display Stitched_Total as a count out of 64 (for example "37/64"), matching the number of Tiles drawn with image pixels.
4. WHILE the Mosaic_View is visible, THE Client SHALL refresh Stitched_Total, the set of stitched Tiles, and each Tile's Solve_Count through the realtime API if the Devvit documentation provides one, and otherwise by polling the Server at an interval of no more than 30 seconds, so that a Stitch recorded by any user appears in the Mosaic_View within 30 seconds of being recorded.
5. WHILE the Mosaic_View is not visible, THE Client SHALL make no Mosaic refresh requests to the Server.
6. IF a Mosaic refresh request fails or receives no response within 10 seconds, THEN THE Client SHALL keep the last successfully loaded Mosaic state on screen, retry at the next refresh interval, and, after 3 consecutive failed refreshes, show a non-blocking indicator that the Mosaic may be out of date until the next successful refresh removes it.
7. WHEN the user enables the Heat_Overlay, THE Mosaic_View SHALL shade every one of the 64 Tiles according to its Solve_Count using 5 fixed bands (0, 1, 2–3, 4–7, and 8 or more), each band distinguishable by both shade and pattern, and SHALL display a legend that lists each band with its Solve_Count range.
8. WHEN the user disables the Heat_Overlay, THE Mosaic_View SHALL remove the shading and the legend and return to the rendering described in criteria 1 and 2 without reloading the Mosaic from the Server.
9. THE Server SHALL include image pixel data in responses to the Client only for Tiles with a Solve_Count of at least 1 on the requested Day_Key, and SHALL send only the Tile_Index and a Solve_Count of 0 for every unstitched Tile.

### Requirement 19: Completed Mosaic and Credits

**User Story:** As a contributor, I want credit on the finished mosaic, so that my effort is recognized publicly.

#### Acceptance Criteria

1. WHILE the Day_Key is a Complete_Mosaic, THE Splash_Screen SHALL display the finished Mosaic with all 64 Tiles rendered in their stitched state and no unstitched Tile placeholders.
2. WHEN a user opens the Credits_View for a Day_Key that is a Complete_Mosaic, THE Credits_View SHALL list exactly 64 entries, one per Tile_Index from 0 to 63, each showing the Tile_Index and the Reddit username of that Tile's First_Stitcher.
3. WHEN a user opens the Credits_View for a Day_Key that is a Complete_Mosaic, THE Credits_View SHALL list up to 10 top helpers for that Day_Key, ranked by Help_Count in descending order, with each entry showing the Reddit username and Help_Count, and with ties broken by the earlier time of the user's first recorded Stitch on that Day_Key.
4. WHERE the Mosaic is a UGC_Mosaic, THE Credits_View SHALL display the Reddit username of the UGC_Mosaic creator, labelled as the creator of the Mosaic art.
5. IF the Day_Key is not a Complete_Mosaic, THEN THE Client SHALL not offer an entry point to the Credits_View for that Day_Key.
6. IF the username of a First_Stitcher, top helper, or UGC_Mosaic creator cannot be retrieved because the account is deleted, suspended, or otherwise unavailable, THEN THE Credits_View SHALL show a placeholder indicating an unavailable user in that entry's position and SHALL keep the entry's rank and Tile_Index unchanged.
7. IF the Credits_View data fails to load from the Server, THEN THE Credits_View SHALL display an error message indicating that credits could not be loaded and a retry control, and the finished Mosaic SHALL remain displayed.

### Requirement 20: UGC Mosaic Submission

**User Story:** As a dedicated player, I want to draw my own mosaic, so that the community might play my art on a Sunday.

#### Acceptance Criteria

1. WHILE a user's current streak, as recorded by the Streak_Tracker, is 7 or more, THE Client SHALL show a control that opens the Pixel_Editor.
2. WHILE a user's current streak, as recorded by the Streak_Tracker, is below 7, THE Client SHALL hide the control that opens the Pixel_Editor.
3. IF a user whose current streak is below 7 requests the Pixel_Editor or submits a UGC_Mosaic, THEN THE Server SHALL reject the request with an error indicating the 7-day streak requirement, and SHALL add nothing to the UGC_Queue.
4. THE Pixel_Editor SHALL offer square canvas sizes with an integer side length from 32 to 56 pixels inclusive, and SHALL let the user choose only colours from the 4-colour Palette.
5. WHEN an eligible user submits a UGC_Mosaic, THE Server SHALL check that the image is square, that its side length is an integer from 32 to 56 pixels inclusive, and that every pixel uses one of the 4 Palette colours.
6. WHEN a submitted UGC_Mosaic passes the dimension and Palette checks and the solvability check, THE Server SHALL add the UGC_Mosaic to the UGC_Queue with pending status, record the submitting user, and return a confirmation to the Client.
7. IF a submitted UGC_Mosaic is not square, has a side length below 32 or above 56 pixels, or contains any pixel colour outside the Palette, THEN THE Server SHALL reject the submission with an error message that names the failed check, SHALL add nothing to the UGC_Queue, and THE Client SHALL keep the user's drawing in the Pixel_Editor.
8. WHEN a UGC_Mosaic passes the dimension and Palette checks, THE Server SHALL map the image onto a 56×56 Mosaic of 8×8 Tiles at Tile_Size 7. If 56 is an exact multiple of the side length, the Server SHALL upscale the image with nearest-neighbour scaling. Otherwise the Server SHALL centre the image on a 56×56 canvas filled with one Palette colour (per OQ-4).
9. WHEN a UGC_Mosaic has been mapped to Tiles, THE Server SHALL run the Solver on all 64 Tiles and apply Perturbation to each Tile that lacks a unique Solution, until all 64 Tiles are uniquely solvable.
10. IF any Tile of a submitted UGC_Mosaic still lacks a unique Solution after Perturbation, THEN THE Server SHALL reject the submission with an error message indicating the art cannot be made into solvable puzzles, SHALL add nothing to the UGC_Queue, and THE Client SHALL keep the user's drawing in the Pixel_Editor.
11. THE Pixel_Editor SHALL let mobile users set a pixel by tapping it and set every pixel along a path by dragging across them.
12. THE Pixel_Editor SHALL let desktop users move a visible cursor with the arrow keys and set the pixel under the cursor to the selected Palette colour with a key press, without using a mouse.

### Requirement 21: Moderation and Sunday Vote

**User Story:** As a moderator, I want to approve UGC and run a community vote, so that Sunday art is safe and community-chosen.

#### Acceptance Criteria

1. WHEN a moderator approves a UGC_Mosaic in pending status through the Mod_Menu, THE Server SHALL set the UGC_Mosaic to approved status, remove the UGC_Mosaic from the pending entries of the UGC_Queue, and include the UGC_Mosaic in the Sunday_Vote that is open at the time of approval, or, if no Sunday_Vote is open, in the next Sunday_Vote to open.
2. WHEN a moderator rejects a UGC_Mosaic in pending status through the Mod_Menu, THE Server SHALL set the UGC_Mosaic to rejected status, remove the UGC_Mosaic from the pending entries of the UGC_Queue, and exclude the UGC_Mosaic from every Sunday_Vote.
3. WHILE a Sunday_Vote is open, from Monday 00:00 UTC until Saturday 12:00 UTC of the same week, THE Client SHALL show every approved UGC_Mosaic in the weekly vote view and let each user cast at most one upvote per UGC_Mosaic.
4. WHEN the Sunday_Vote closes at Saturday 12:00 UTC, THE Server SHALL select the approved UGC_Mosaic with the highest upvote count as the Mosaic for the Sunday Day_Key immediately after the close. If two or more UGC_Mosaics share the highest count, THE Server SHALL select the one with the earliest submission time.
5. IF the Sunday_Vote contains zero approved UGC_Mosaics when the Sunday_Vote closes, THEN THE Server SHALL use the procedural Mosaic produced by the Mosaic_Generator for the next Sunday's Day_Key.
6. THE Server SHALL restrict Mod_Menu actions to moderators of the subreddit where Patchwork_App is installed, verified through the permission mechanism in the Devvit documentation.
7. IF a user submits an upvote for a UGC_Mosaic the user has already upvoted, or submits an upvote while no Sunday_Vote is open, THEN THE Server SHALL reject the upvote and leave the stored upvote count unchanged, and THE Client SHALL show an error message saying the upvote was not counted.
8. IF a user who is not a subreddit moderator invokes a Mod_Menu approve or reject action, THEN THE Server SHALL reject the action, leave the status of the UGC_Mosaic unchanged, and return an error message saying moderator permission is required.
9. IF a moderator approves or rejects a UGC_Mosaic that is not in pending status, THEN THE Server SHALL leave the status of the UGC_Mosaic unchanged and return an error message saying the UGC_Mosaic has already been reviewed.

### Requirement 22: Moderator Tools and Settings

**User Story:** As a moderator, I want to control today's mosaic and the start date, so that I can fix problems and run the game on my schedule.

#### Acceptance Criteria

1. WHEN a moderator selects "Regenerate today's mosaic" from the Mod_Menu, THE Server SHALL generate a new Mosaic variant for the current Day_Key from the Day_Key and a new regeneration seed, record that seed against the Day_Key, and record the same Mosaic, Tiles, Clues, and Solutions each time the Mosaic_Generator and Slicer are rerun with that Day_Key and recorded seed.
2. WHEN a moderator selects "Skip today's mosaic" from the Mod_Menu, THE Server SHALL replace the current Day_Key Mosaic with a Mosaic generated from the next Motif in the Mosaic_Generator's deterministic Motif sequence for that Day_Key, and record the Motif name used against the Day_Key.
3. WHEN a regenerated or skipped Mosaic is produced, THE Server SHALL pass all 64 replacement Tiles through the Solver (and Perturbation where a Tile lacks a unique Solution) before the replacement Mosaic becomes active, and THE Server SHALL keep the previous Mosaic active until all 64 replacement Tiles have exactly one Solution.
4. WHEN a regenerate or skip action completes, THE Server SHALL show the moderator a confirmation stating the action performed, the Day_Key, and the new Motif name. IF the action fails, THEN THE Server SHALL show the moderator an error message indicating the failure and SHALL leave the previous Mosaic, its assignments, and its Stitches unchanged.
5. IF a user who is not a moderator of the subreddit invokes the regenerate or skip action, THEN THE Server SHALL reject the action, leave the Day_Key Mosaic, assignments, and Stitches unchanged, and return an error indicating insufficient permission.
6. THE App_Settings SHALL include a Start_Date setting, entered as a UTC date in `yyyy-mm-dd` format, which THE Server SHALL use to compute Day_Number as (Day_Key − Start_Date in whole UTC days) + 1.
7. IF the Start_Date setting is absent, is not a valid calendar date in `yyyy-mm-dd` format, or is later than the current UTC date, THEN THE Server SHALL use the UTC date of app installation on the subreddit as Start_Date.
8. WHEN a moderator regenerates or skips a Day_Key Mosaic, THE Server SHALL set every Tile's Solve_Count, the Stitched_Total, the First_Stitcher records, and the Assignment_Counter for that Day_Key to zero or empty, and SHALL discard all outstanding Tile assignments for that Day_Key, as defined in OQ-8.
9. WHEN a moderator regenerates or skips a Day_Key Mosaic, THE Server SHALL keep each user's Scored_Attempt status, score, Leaderboard entry, and streak for that Day_Key, so that any user who already had a Scored_Attempt receives only Extra_Tiles from the replacement Mosaic.
10. IF a player submits a fill grid for a Tile assigned from a Mosaic that has since been regenerated or skipped, THEN THE Server SHALL reject the submission without recording a Stitch, and THE Client SHALL tell the player that the mosaic changed and offer a Tile from the replacement Mosaic.

### Requirement 23: Opt-In Flair

**User Story:** As a streaker, I want optional flair for my streak, so that I can show my dedication in the subreddit.

#### Acceptance Criteria

1. WHERE a user has opted in to flair, WHEN the Streak_Tracker updates that user's current streak, THE Flair_Manager SHALL set the user's Patchwork flair to the Flair_Tier matching the updated current streak: Thread for a streak of 3 to 6 days, Quilter for 7 to 29 days, and Weaver for 30 days or more.
2. WHERE a user has opted in to flair, IF the user's updated current streak is below 3 days, THEN THE Flair_Manager SHALL remove any Patchwork flair from that user and SHALL assign no Flair_Tier.
3. THE Flair_Manager SHALL assign flair only to users who have explicitly opted in, and THE Patchwork_App SHALL treat every user as opted out until that user opts in.
4. WHEN a user opts in to flair, THE Flair_Manager SHALL assign the Flair_Tier matching the user's current streak at that moment, using the streak ranges in criterion 1, without waiting for the next streak update.
5. WHEN a user opts out of flair, THE Flair_Manager SHALL remove the Patchwork flair from that user, and THE Flair_Manager SHALL assign no further flair to that user until the user opts in again.
6. THE Patchwork_App SHALL keep a user's opt-in or opt-out choice across Day_Keys until the user changes it.
7. THE Flair_Manager SHALL use the user flair API documented by Devvit.
8. IF the flair API call fails or flair is disabled in the subreddit, THEN THE Flair_Manager SHALL log the failure on the Server, the Streak_Tracker SHALL keep the user's streak values and the user's Stitch unchanged, and the Client SHALL continue without displaying an error to the player.
9. IF a flair API call failed for an opted-in user, THEN THE Flair_Manager SHALL attempt the flair assignment again on that user's next streak update or opt-in action, and SHALL make no more than 1 flair API call per user per streak update.

### Requirement 24: Analytics

**User Story:** As the developer, I want key funnel events tracked, so that I can understand engagement without breaking privacy.

#### Acceptance Criteria

1. THE Analytics_Tracker SHALL expose exactly one function, `track(eventName, properties)`, and THE Patchwork_App SHALL emit every analytics event through that function only.
2. THE Analytics_Tracker SHALL record exactly these 7 events at these trigger points:
   - `post_view` when the Splash_Screen is first rendered for a user in a post.
   - `first_interaction` when the user first taps or clicks inside the post on a Day_Key.
   - `tile_assigned` when the Tile_Assigner returns a Tile to the user.
   - `tile_solved` when the Validator accepts the user's Scored_Attempt as a Stitch.
   - `extra_tile_solved` when the Validator accepts an Extra_Tile as a Stitch.
   - `share_comment` when the user's Emoji_Grid comment is successfully posted.
   - `return_next_day` when a user who recorded a Scored_Attempt on the previous UTC Day_Key records a Scored_Attempt on the current Day_Key (same definition as Requirement 15 criterion 5).

   Each event SHALL be recorded at most once per trigger occurrence.
3. WHERE the Devvit documentation provides Journeys, THE Analytics_Tracker SHALL send every event listed in criterion 2 through Journeys.
4. IF the Devvit documentation provides no Journeys API, THEN THE Analytics_Tracker SHALL use a stub implementation that accepts the same `track(eventName, properties)` signature, makes no network call, and returns without error. THE Development_Agent SHALL add a note to README.md saying that analytics is stubbed and that events are not persisted.
5. IF an analytics call fails or has not completed within 2 seconds, THEN THE Analytics_Tracker SHALL discard the event without retrying and without raising an error to the caller. The gameplay action that triggered the event (assignment, validation, Stitch, or comment) SHALL complete with the same result and persisted state as it would with analytics disabled.
6. THE Analytics_Tracker SHALL exclude Reddit usernames, Reddit user IDs, comment text, Solution cells, and submitted fill grids from event properties. Properties SHALL be limited to Day_Key, Day_Number, Tile_Index, Tile_Size, solve time in whole seconds, Mistake count, and whether the solve was an Extra_Tile.
7. IF `track` is called with an eventName not listed in criterion 2, or with more than 10 properties, or with any string property value longer than 64 characters, THEN THE Analytics_Tracker SHALL discard the event without sending it and without raising an error to the caller.

### Requirement 25: Visual Polish and Theming

**User Story:** As a player, I want a cohesive, polished look, so that the game feels crafted.

#### Acceptance Criteria

1. THE Client SHALL draw all Mosaic art, Tile art, and Cell fills using only the 4 Palette colours and their paired patterns on every screen: Splash_Screen, Play_Screen, Mosaic_View, End_Card, Credits_View, and Pixel_Editor.
2. THE Client SHALL draw all text from one type scale, defined once and shared by every screen, with no more than 5 font sizes and no more than 2 font families.
3. WHEN the Client loads, THE Client SHALL use dark mode if the user's system colour scheme reports dark, and SHALL use light mode if the scheme reports light or reports no preference.
4. THE Patchwork_App SHALL log zero console errors and zero unhandled promise rejections while running these flows in order: open post, solve Tile, view End_Card, share comment, help another Tile, open Credits_View. The flows SHALL be run once in light mode and once in dark mode.
5. WHEN the Splash_Screen is displayed, THE Splash_Screen SHALL show a custom design (not the default template view) that renders the current Day_Key's Mosaic. Each stitched Tile SHALL show its art, each unstitched Tile SHALL show a uniform placeholder, and the Splash_Screen SHALL show Stitched_Total out of 64.
6. WHEN the user's system colour scheme changes while the Client is open, THE Client SHALL switch to the matching mode within 1 second without reloading. The switch SHALL keep the current Cell states and the solve timer value.
7. THE Client SHALL display all text with a contrast ratio of at least 4.5:1 against its background in both light and dark modes.
8. IF Stitched_Total for the current Day_Key is 0, THEN THE Splash_Screen SHALL show all 64 Tiles as unstitched placeholders and show a Stitched_Total of 0 out of 64.

### Requirement 26: Accessibility

**User Story:** As a player with colour-vision deficiency, motor, or motion sensitivities, I want accessible controls and visuals, so that I can play comfortably.

#### Acceptance Criteria

1. THE Client SHALL render each of the 4 Palette colours with its own pattern, in both the Mosaic_View and Cell rendering, so that a viewer of a greyscale render of the Client can tell all 4 Palette entries apart by pattern alone.
2. THE Palette SHALL keep all 4 colours as pairwise distinct under protanopia, deuteranopia, and tritanopia simulation. Each pair of simulated colours SHALL have a contrast ratio of at least 1.5:1, and each colour SHALL have a contrast ratio of at least 3:1 against the empty-Cell background.
3. WHILE the Client runs on a device with a keyboard, THE Play_Screen SHALL move Cell focus by exactly one Cell in the arrow direction when an arrow key is pressed. Focus SHALL stay on the current Cell when the arrow points beyond the Tile edge.
4. WHILE the Client runs on a device with a keyboard, THE Play_Screen SHALL set the focused Cell to filled when the Space key is pressed, to marked-X when the X key is pressed, and to empty when the Backspace or Delete key is pressed. Focus SHALL not move after any of these keys.
5. WHILE the Client runs on a device with a keyboard, THE Client SHALL let the user reach every interactive control on the Play_Screen, End_Card, Mosaic_View, and Credits_View in a fixed order using the Tab key and Shift+Tab, and SHALL let the user activate the focused control with the Enter key.
6. THE Client SHALL show a visible focus indicator on the focused Cell and on every interactive control. The indicator SHALL be at least 2 CSS pixels thick and SHALL have a contrast ratio of at least 3:1 against the colours next to it.
7. THE Client SHALL give every interactive control a touch or click target of at least 44×44 CSS pixels, and SHALL size Cell targets as specified in Requirement 10 criterion 7.
8. WHERE the user's operating system or browser reports a reduced-motion preference, THE Client SHALL show a static image of the Ghost_Hand instead of the looping Ghost_Hand animation.
9. WHERE the user's operating system or browser reports a reduced-motion preference, THE Client SHALL replace the Stitch_Animation with a fade of 200 ms or less that involves no movement, scaling, or rotation of the Tile (as in Requirement 16 criterion 3), and SHALL disable every other animation whose duration exceeds 200 milliseconds. Game state SHALL stay the same as it is without the reduced-motion preference.

### Requirement 27: Performance and Scale

**User Story:** As a player on a mid-range phone, I want the game to load fast and stay responsive under heavy traffic, so that playing is smooth.

#### Acceptance Criteria

1. WHEN the Client is loaded in a Lighthouse mobile audit using the "Moto G Power" class device profile with 4G throttling, THE Client SHALL reach first contentful paint within 1.5 seconds, measured as the median of 5 consecutive audit runs.
2. WHEN the user opens the post under the same device profile and throttling as criterion 1, THE Client SHALL render the Play_Screen with Clues and accept a Cell state change from a tap within 3 seconds of the open action, measured as the median of 5 consecutive runs.
3. THE Development_Agent SHALL define the gzipped Client JavaScript bundle budget as a single numeric value in kilobytes in the design document, record the measured gzipped Client JavaScript bundle size from the production build in README.md, and keep the measured size at or below the defined budget.
4. WHILE up to 5,000 players request Tile assignments or submit Stitches for the same Day_Key within the same 60-second window, THE Server SHALL update the Assignment_Counter, Solve_Count, Stitched_Total, Leaderboard, and Help_Count values only through atomic Redis operations (single-command increments, sorted-set updates, or transactions), and SHALL perform no non-atomic read-modify-write sequence on these values.
5. WHEN N concurrent Tile assignment requests are processed for one Day_Key, THE Server SHALL increment the Assignment_Counter exactly N times and return N distinct Assignment_Counter values. Stitched_Total SHALL equal the number of distinct Tiles with a Solve_Count of at least 1, and each Tile's Solve_Count SHALL equal the number of Stitches recorded for that Tile.
6. WHEN a Tile is requested for a Day_Key and regeneration seed whose generated Tiles are already stored in Redis, THE Server SHALL serve the Tile from the stored data without running the Mosaic_Generator, Slicer, or Solver. Tile generation SHALL run at most once per Day_Key per regeneration seed.
7. IF generated Tiles for the current Day_Key and regeneration seed are absent from Redis when a Tile is requested, THEN THE Server SHALL generate and store all 64 Tiles exactly once, even when multiple requests arrive concurrently. Every concurrent request SHALL receive Tiles identical to the stored set.
8. WHILE the load described in criterion 4 is applied, THE Server SHALL return responses to Tile assignment and Stitch submission requests within 1,000 milliseconds at the 95th percentile.
9. IF a Redis operation for Tile assignment or Stitch recording fails, THEN THE Server SHALL return an error response indicating the operation failed, SHALL leave the Assignment_Counter, Solve_Count, Stitched_Total, Leaderboard, and Help_Count values unchanged by the failed request, and THE Client SHALL display a message indicating the action can be retried.

### Requirement 28: Engineering Structure and Tests

**User Story:** As a maintainer, I want strict typing and well-tested pure logic, so that the game is reliable.

#### Acceptance Criteria

1. THE Patchwork_App SHALL compile with TypeScript `strict` mode enabled in every tsconfig used to build the Client, Server, and Shared_Logic, and the type check SHALL report 0 errors.
2. THE Patchwork_App SHALL place pure logic in `src/shared/`, Client code in `src/client/`, and Server code in `src/server/`, and no module in `src/shared/` SHALL import from `src/client/`, `src/server/`, Redis, or the Reddit API.
3. THE Development_Agent SHALL write Vitest tests that generate 120 consecutive Day_Keys, starting from a fixed Day_Key written in the test, and assert that the Solver reports exactly one Solution for each of the 64 Tiles of every Day_Key (7,680 Tiles in total), with the test failing if any Tile has 0 or 2 or more Solutions.
4. THE Development_Agent SHALL write Vitest tests that compute the mean Difficulty_Score of the 64 Tiles for each of the 120 generated Day_Keys and assert that, within each UTC week in the window, the per-day means are non-decreasing from Monday to Sunday within the tolerance defined in the design, as specified in Requirement 6.
5. THE Development_Agent SHALL write Vitest tests that run concurrent Tile assignment requests from at least 100 distinct simulated users against a Redis test double with atomic semantics, and assert that each user receives exactly one Scored_Attempt Tile and that the first 64 assignments cover 64 distinct Tile_Indexes when no Stitches occur in between.
6. THE Development_Agent SHALL write Vitest tests that submit at least 2 concurrent Stitches for the same Tile against the Redis test double, and assert that Solve_Count equals the number of accepted Stitches, Stitched_Total increases by exactly 1 for that Tile, and exactly one First_Stitcher is recorded.
7. THE Development_Agent SHALL write Vitest tests for the Validator covering exact match (accepted), single-Cell mismatch (rejected), a fill grid whose dimensions differ from Tile_Size (rejected), and a Tile_Index not assigned to the submitting user (rejected), and assert that no rejected case increments Solve_Count or records a Stitch.
8. THE Development_Agent SHALL write property-based tests, each running at least 100 generated cases, asserting that `generateMosaic` returns identical output for identical Day_Key input and that `sliceToTiles` returns identical Tiles, Clues, and Solutions for an identical Mosaic.
9. THE Development_Agent SHALL write property-based tests, each running at least 100 generated cases, asserting that Clues computed from a Solution match the Clues stored for that Tile (clue round-trip) and that no Emoji_Grid output contains any Cell value from a Solution.
10. THE Development_Agent SHALL write the tests in criteria 3 to 9 so that they complete in a single non-watch Vitest run (`vitest --run`) with 0 failures.

### Requirement 29: Agent Steering Files

**User Story:** As the project owner, I want the rules restated for future agent sessions, so that every session follows them.

#### Acceptance Criteria

1. THE Development_Agent SHALL write AGENTS.md at the root of the Patchwork_App repository, restating every hard rule (Requirement 1, criteria 1 through 14), every safety rule, and every engineering rule of this document, with each restated rule citing the number of the requirement it comes from.
2. THE Development_Agent SHALL write `.kiro/steering/product.md` restating the product rules (the daily UTC puzzle cycle, the 8×8 Mosaic of 64 Tiles, the Tile_Size by UTC weekday, procedural and non-AI Mosaic art, the Sunday UGC_Mosaic exception, and the content integrity rules of Requirement 2), the target prize (Best Daily Game), and the hackathon judging criteria as stated in this document.
3. THE Development_Agent SHALL write `.kiro/steering/tech.md` restating the technical rules, including the Node.js 24.18 or later requirement, documentation-first API verification, the free-tier-only and zero-runtime-LLM-call rules, and the Shared_Logic, Client, and Server boundaries.
4. THE Development_Agent SHALL list in `.kiro/steering/tech.md` the allowed commands `npm run dev`, `npm run deploy`, `devvit upload` (private), `npm test`, and `npm run build`, and SHALL list the forbidden commands `npm run launch`, `devvit publish`, and any command that submits the app for review or publishes the app, together with the rule that `devvit login` is run only by the project owner.
5. WHEN the Development_Agent has written AGENTS.md, `.kiro/steering/product.md`, and `.kiro/steering/tech.md`, THE Development_Agent SHALL commit the `.kiro/` folder and AGENTS.md to the local git repository in the same commit.
6. THE Development_Agent SHALL write the three steering files before writing application code, in the same step as PLAN.md in the Requirement 1 work order.
7. IF a rule in this document is added, changed, or removed after the steering files are written, THEN THE Development_Agent SHALL update the affected steering files to match and commit the update before starting the next step in the work order.
8. IF any file to be committed under `.kiro/` or AGENTS.md contains a secret, token, or credential, THEN THE Development_Agent SHALL remove the secret from the file before committing and SHALL report the removal to the project owner.

### Requirement 30: Deliverable Documents

**User Story:** As the hackathon entrant, I want complete, honest submission documents, so that I can submit without extra work.

#### Acceptance Criteria

1. THE Development_Agent SHALL write README.md with a separate section for each of these topics: what Patchwork_App is; how to play a Tile (filling Cells from Clues and Stitching); the daily loop (Scheduler post creation, Scored_Attempt, Extra_Tiles, Weak_Tile reinforcement after Complete_Mosaic, Streak_Tracker and Grace_Rule); the Reddit and Devvit features used; how Mosaic_Generator generates a Mosaic and how Slicer and Solver produce and validate unique-Solution Tiles; setup and run commands; architecture (Client, Server, Shared_Logic); and the analytics implementation.
2. THE Development_Agent SHALL state in README.md that Patchwork_App is not published, and SHALL state whether Analytics_Tracker is backed by Journeys or by a documented stub.
3. THE Development_Agent SHALL write DEVPOST_STORY.md describing the project so that every number, metric, user count, or performance figure in the document can be traced to the repository's code, configuration, recorded test output, or verification documentation, with zero numbers lacking such a source.
4. THE Development_Agent SHALL write DEVPOST_STORY.md so that every feature it describes as working is implemented in the repository, and SHALL label any described feature that is not implemented as planned or not built.
5. THE Development_Agent SHALL write VIDEO_SHOTLIST.md as an ordered list of shots, each with a start time, an end time, and a description of what appears on screen, where the last shot ends at or before 59 seconds.
6. THE Development_Agent SHALL specify in VIDEO_SHOTLIST.md that every shot is captured from the real demo post in the public test subreddit, with no mocked or edited gameplay screens.
7. THE Development_Agent SHALL write SUBMISSION_CHECKLIST.md as checklist items covering: the app listing URL, the public test-subreddit demo post URL, the presence of README.md, confirmation that the app is not published, and the submission category Best Daily Game.
8. IF a value in SUBMISSION_CHECKLIST.md is unknown when the document is written (for example a URL not yet created), THEN THE Development_Agent SHALL put an explicit placeholder in that value's place that marks it as needing input from the project owner, using the same placeholder marker for every unknown value, and SHALL NOT enter a guessed or example value.

### Requirement 31: Product Scope Exclusions

**User Story:** As the project owner, I want the game to stay within its concept, so that it scores well on originality and daily play.

#### Acceptance Criteria

1. THE Patchwork_App SHALL be fully asynchronous, with zero lobbies, zero matchmaking or waiting-for-player states, and zero synchronous multiplayer sessions, such that a user can complete a Scored_Attempt without any other user being online at the same time.
2. THE Patchwork_App SHALL make every user action available to that user, and SHALL produce the same outcome for that action, whether or not any other user is viewing the same Day_Key post at the same time.
3. THE Patchwork_App SHALL contain zero trivia (question-and-answer) mechanics, zero platformer (character movement and jumping) mechanics, zero space-shooter mechanics, and zero mechanics that clone an existing named game other than the standard nonogram row-and-column clue rules.
4. THE Patchwork_App SHALL offer nonogram Tile solving, Stitching into the Mosaic, and the UGC_Mosaic features described in this document as its only gameplay mechanics.
5. WHEN any user opens a Day_Key post at any time between 00:00:00 and 23:59:59 UTC on that Day_Key, THE Tile_Assigner SHALL provide a Tile, as defined in Requirement 9, whose successful Stitch increments that Tile's Solve_Count by 1, including when the Day_Key is a Complete_Mosaic.
6. IF a user opens a Day_Key post after that Day_Key's UTC day has ended, THEN THE Tile_Assigner SHALL provide a Tile under the same assignment rules as Requirement 9, and that Tile's Stitch SHALL increment the Solve_Count recorded for the original Day_Key. Such late Stitches SHALL count toward Help_Count but SHALL NOT create a Scored_Attempt score, Leaderboard entry, or streak update for that past Day_Key.

## Open Questions

Each question lists a working assumption. The acceptance criteria above already encode these assumptions; the project owner should confirm or override each one, and any override requires updating the referenced criteria.

- **OQ-1 Streak Grace_Rule.** The request says "a documented one-day grace rule" without defining the rule. *Assumption (encoded in Requirement 15):* a streak continues if the gap between consecutive Scored_Attempt Day_Keys is 1 day, or 2 days (one missed day forgiven) provided no grace use is recorded on any of the 6 Day_Keys before the current one, giving at most one grace use per rolling 7 consecutive Day_Keys. The missed day adds nothing to the count. Any other gap resets the current streak to 1. The alternative is unlimited single-day gaps.
- **OQ-2 Definition of Mistake.** The Server sees only the submitted grid, and the Client holds no Solution, so the Client cannot detect wrong Cells in real time. *Assumption (encoded in Requirements 11.4 and 13.3):* a Mistake is a Server-rejected submission for the user's Scored_Attempt Tile, meaning a submitted fill grid that fails Server validation. The Client auto-submits when every line matches its Clues (Requirement 10.9), so a Mistake typically means the grid satisfies all Clues the Client can check but differs from the stored unique Solution (or was submitted by a modified Client). Mistakes are counted on the Server only; submissions rejected for being unassigned, malformed, unauthenticated, or for the wrong day do not count. Alternatives: (a) Client-reported Clue contradictions (untrusted), (b) a per-cell Server check endpoint (costly and leaks the Solution cell by cell).
- **OQ-3 Solve time trust.** *Assumption:* solve time is Server-measured from assignment to accepted submission, which includes idle time. Alternative: Client-measured active time, which is easy to spoof.
- **OQ-4 UGC size vs Sunday grid.** Sunday is 8×8 Tiles of 7×7 Cells, which is a 56×56 Mosaic, but UGC allows 32×32 to 56×56. *Assumption (encoded in Requirements 3.7, 6.7, and 20.8):* Sunday Tile_Size is always 7, and every UGC_Mosaic is fitted to exactly 56×56. If 56 is an exact multiple of the UGC side length (for example 56 itself), the image is upscaled by nearest-neighbour; otherwise the image is centred on a 56×56 canvas filled with one Palette colour. Alternatives: restrict UGC to exactly 56×56, or allow Sunday Tile_Size to vary (5, 6, or 7) with UGC sizes 40, 48, 56 only.
- **OQ-5 Post title progress.** The request asks for the title to show "Day 12 · 41/64 stitched" but also titles the post "Day N · <motif name>". Reddit post titles cannot normally be edited after creation. *Assumption:* the title stays "Day N · <Motif name>" and progress appears in the Splash_Screen and any updatable preview the Devvit docs support. To be confirmed against the docs.
- **OQ-6 Four colours vs binary nonograms.** Classic nonogram Cells are binary, but the Mosaic uses 4 colours. *Assumption:* each Tile is a binary nonogram (foreground vs background); the Mosaic's colour comes from a per-Tile or per-region Palette colour revealed on Stitch, so the solved shape is the puzzle and colour is decoration. Alternative: colour nonograms with coloured Clues, which are harder on mobile and harder to prove unique.
- **OQ-7 Blank or full Tiles.** Symmetric Motifs can produce all-empty or all-filled slices, which are trivially unique but boring. *Assumption:* the Slicer treats Tiles below a minimum Difficulty_Score as needing Perturbation, so every Tile requires at least one logic step.
- **OQ-8 Regenerate or skip mid-day.** *Assumption (encoded in Requirement 22 criteria 8 to 10):* regenerate or skip resets the Day_Key's Solve_Counts, Stitched_Total, First_Stitcher records, and Assignment_Counter, and discards all outstanding Tile assignments. Each user's Scored_Attempt status, score, Leaderboard entry, and streak are kept, so no user gets a second Scored_Attempt; such users receive only Extra_Tiles from the replacement Mosaic. Submissions for Tiles of the replaced Mosaic are rejected and the player is offered a Tile from the replacement. Alternative: allow regeneration only before the first Stitch.
- **OQ-9 Sunday_Vote timing.** *Assumption (encoded in Requirement 21):* the vote runs Monday 00:00 UTC to Saturday 12:00 UTC in a dedicated weekly vote view, and voting uses an in-app upvote stored in Redis (one per user per UGC_Mosaic), not Reddit post votes. A UGC_Mosaic approved while a vote is open joins that vote; one approved while no vote is open joins the next vote. The highest upvote count wins, ties go to the earliest submission, and a vote with zero approved entries falls back to the procedural Mosaic.
- **OQ-10 Abandoned assignments.** A user may receive a Tile and never solve the Tile, leaving the Tile unsolved. *Assumption:* abandoned Tiles stay at Solve_Count 0 and are picked up by the "next unsolved Tile_Index" rule; no reservation or timeout is used.
- **OQ-11 Project location.** The workspace already contains unrelated Devvit projects at the root and in `app/`. *Assumption:* the fresh React-template project is created in a new subdirectory (for example `patchwork/`) and the existing projects are left untouched. The project owner should confirm.
- **OQ-12 Share comment identity.** Posting a comment as the user (rather than as the app account) may require a user-actions permission in Devvit. *Assumption (encoded in Requirement 17.11):* use the documented run-as-user mechanism if Devvit documents one; otherwise post as the app with the user's username in the comment text. Either way, at most one comment is posted per explicit tap. To be confirmed against the docs.
- **OQ-13 Score formula.** *Assumption (encoded in Requirement 13):* score = max(0, 1000 × Par_time / solve_time − 100 × Mistakes), rounded down to an integer, higher is better. Solve time is Server-measured with a 1-second floor. Par_time already scales with Tile_Size and Difficulty_Score (Requirement 5.4 and 5.7), so equal solve-time-to-Par ratios give scores within 1 point across Tile_Sizes. The design will fix the exact formula, which must satisfy the monotonicity, cross-size, and determinism properties of Requirement 13.
- **OQ-14 Percentile threshold.** *Assumption (encoded in Requirements 2.7, 14.6, and 17.4):* the percentile figure is hidden while the Time_Distribution holds fewer than 10 Scored_Attempts. The value 10 is tunable in the design; if changed, it must change in all three criteria together.
