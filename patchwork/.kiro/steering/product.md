---
inclusion: always
---

# Product: Patchwork

Rules restated from `../.kiro/specs/patchwork-daily-mosaic/requirements.md` (paths here are relative to `patchwork/`). "Req 9.2" means Requirement 9, criterion 2; "D12" is an owner sign-off decision in design.md. If this file and requirements.md disagree, requirements.md wins and this file is updated and committed before the next work step (Req 29.7).

## What it is

Patchwork is a daily, asynchronous community nonogram game for Reddit, built as a Devvit Web Interactive Post. Each UTC day's post holds one hidden Mosaic. A player who opens the post gets one Tile, solves it from row and column Clues, and "stitches" it into the shared Mosaic, which everyone sees fill in through the day.

## Target and deadline

- Hackathon: Reddit's Game of the Day Hackathon.
- Target prize: **Best Daily Game**; an honourable mention is the fallback.
- Deadline: 8 Dec 2026, 6:00 PM PT (9 Dec 2026, 7:30 AM IST).

## Judging criteria (equal weight, as stated by the owner)

| Criterion | What it means for Patchwork | Requirements |
|---|---|---|
| Delightful UX | The player is filling Cells within 3 seconds of opening. Zero-text onboarding: an animated Ghost_Hand fills one row. Mobile first: tap to fill, long-press or a toggle to mark X, drag to fill a run, big tap targets. | Req 10, Req 26.7, Req 27.2 |
| Polish | A custom Splash_Screen showing the Mosaic so far. One Palette and one type scale. A satisfying Stitch_Animation as the Tile flies into the Mosaic. Sound off by default. Light and dark modes. No console errors. | Req 16, Req 25 |
| Reddit-y | The shared Mosaic, credits, community-chosen Sunday art, comments and flair. No Snoo or karma theming. | Req 17.11, Req 19, Req 20, Req 21, Req 23, Req 2.8 |
| Daily content | A new Mosaic every UTC day, posted by a Scheduler, with difficulty rising from Monday to Sunday. | Req 3, Req 6, Req 7 |

## The daily UTC puzzle cycle

- Every Day_Key is a UTC date `yyyy-mm-dd`. A Scheduler creates exactly one post per Day_Key, visible by 00:05:00 UTC, titled "Day N · <Motif name>", where N counts from the moderator-set Start_Date (Day 1) (Req 7.1 to Req 7.3, Req 22.6). The title cannot change after creation; live progress "Day N · S/64 stitched" shows on the launch screen and in the text fallback (B1, D8).
- All 64 Tiles, Clues, Solutions and Par values are generated and stored before the post is visible (Req 7.4).
- After the UTC day ends the post still hands out Tiles; those Stitches count for the Mosaic and Help_Count but are not scored (Req 31.6).

## The Mosaic and its Tiles

- Each Mosaic is an **8×8 grid of 64 Tiles**, Tile_Index 0 to 63 in row-major order (Req 4.1).
- **Tile_Size follows the UTC weekday** of the Day_Key, never the player's time zone: 5×5 Monday to Wednesday, 6×6 Thursday and Friday, 7×7 Saturday and Sunday. The Mosaic is 40×40, 48×48 or 56×56 pixels (Req 3.1, Req 6.1, Req 6.2).
- Each Tile is a binary nonogram with exactly one Solution, proven by the Solver. A non-unique Tile is perturbed deterministically and re-checked, with a fallback pattern as the last resort (Req 4.4 to Req 4.6, OQ-6).
- Difficulty rises through the week: each day's mean Difficulty_Score is at least 95% of the previous day's, Thursday is harder than Wednesday and Sunday harder than Monday (Req 6.4, Req 6.5).

## Mosaic art: procedural and never AI-generated

- Every procedural Mosaic is generated deterministically from the Day_Key with a seeded PRNG: the same Day_Key always gives the same pixels and Motif name, on any machine (Req 2.2, Req 3.2).
- Motifs are symmetric, seeded designs from at least the families quilt block, tessellation and mirrored pixel glyph (Req 3.4). Every pixel uses one of 4 fixed Palette colours, each paired with its own pattern (Req 3.5, Req 26.1).
- No AI-generated images or text anywhere (Req 2.1).

## The Sunday UGC_Mosaic exception

- A player whose current streak is 7 or more can draw a UGC_Mosaic of 32×32 to 56×56 pixels in the 4 Palette colours in the Pixel_Editor (Req 20.1 to Req 20.5).
- Submissions are checked on the Server, fitted to 56×56, made uniquely solvable, and queued for moderators (Req 20.6 to Req 20.10). Moderators approve or reject them (Req 21.1, Req 21.2).
- Approved entries enter the Sunday_Vote, open from Monday 00:00 to Saturday 12:00 UTC, one upvote per user per entry. The winner (ties to the earliest submission) becomes the next Sunday's Mosaic, credited to its creator. With no approved entries, Sunday uses a procedural Mosaic (Req 21.3 to Req 21.5, Req 3.7, Req 3.8, Req 19.4).
- This is the only case where Mosaic art is not procedural (Req 2.1).

## Play and scoring

- On opening the post a player gets a Tile through atomic round-robin assignment: an INCR counter mod 64, falling back to the next unstitched Tile, and after all 64 are stitched, to a Weak_Tile (fewest Solve_Counts). Latecomers always get a Tile whose Stitch counts (Req 9.1 to Req 9.3, Req 31.5).
- One Scored_Attempt per user per Day_Key; reopening returns the same Tile (Req 9.4, Req 13.4). "Help another tile" gives Extra_Tiles that count as Stitches and Help_Count but are not scored (Req 9.5, Req 13.6).
- The score uses Server-measured solve time and Server-counted Mistakes against Par, which scales with Tile_Size and Difficulty_Score; equal time-to-Par ratios score the same on every Tile_Size (Req 13, OQ-13). A Mistake is a Server-rejected submission for the Scored_Attempt Tile (OQ-2, D4).
- The End_Card shows score against Par, a percentile chart (hidden below 10 solves), rank, the player's Tile highlighted in the Mosaic, Help_Count, streak, "Share as comment" (a spoiler-safe Emoji_Grid, posted only on tap), a countdown to 00:00 UTC, and "Help another tile" (Req 14, Req 17).
- Streaks: a gap of 1 day continues the streak; a gap of 2 days continues it once per rolling 7 Day_Keys (one Grace_Use), and the missed day adds nothing; any other gap resets to 1 (Req 15, OQ-1).
- Opt-in flair tiers: Thread (3-day streak), Quilter (7), Weaver (30) (Req 23).
- The live Mosaic_View updates through the day, with a Heat_Overlay of Solve_Counts. A Complete_Mosaic shows the finished image and credits: the First_Stitcher of each Tile and the top 10 helpers (Req 18, Req 19).
- Moderators can regenerate or skip today's Mosaic and approve or reject UGC_Mosaics from the Mod_Menu, and set the Start_Date in the App_Settings (Req 21, Req 22).

## Content integrity (Requirement 2)

- **Req 2.1** Mosaic art uses only deterministic seeded procedural algorithms and zero AI-generated images or text, except an approved, Sunday_Vote-selected UGC_Mosaic on a Sunday.
- **Req 2.2** The same Day_Key always produces a pixel-identical Mosaic and the same Motif name.
- **Req 2.3** Every statistic, player name and count shown is read from recorded Redis data, with zero hard-coded, placeholder, seeded or simulated values (Leaderboard, Stitched_Total, Solve_Count, Heat_Overlay, percentiles, Help_Count, streaks, First_Stitchers, credits).
- **Req 2.4** If the data behind a statistic cannot be read, the Client shows an unavailable indicator, never a fabricated or cached default, and the rest of the screen stays usable.
- **Req 2.5** Documentation and submission materials contain zero invented numbers, players or testimonials; every number, name and quote traces to a test result, recorded Redis data or cited Devvit documentation.
- **Req 2.6** An empty data set shows an empty state with an invitation (for example "Be the first stitch today") and zero placeholder rows, sample names or zero-filled entries.
- **Req 2.7** With fewer than 10 Scored_Attempts in the Time_Distribution, no percentile figure is shown; a message says not enough solves have been recorded yet.
- **Req 2.8** No Snoo imagery on any screen or shipped asset (including the template's `public/snoo.png`), and no word "karma" or karma-themed scoring visuals.

## Scope (Requirement 31)

- Fully asynchronous: no lobbies, matchmaking, waiting-for-player states or synchronous sessions (Req 31.1, Req 31.2).
- No trivia, platformer, space-shooter or cloned mechanics beyond standard nonogram clue rules (Req 31.3). The only mechanics are nonogram Tile solving, Stitching and the UGC_Mosaic features (Req 31.4).

## Accessibility and feel

- Colour-blind-safe Palette, with a pattern for every colour; full keyboard play on desktop; reduced-motion support; 44×44 CSS px targets; visible focus rings (Req 26).
- Light and dark modes follow the system scheme; one type scale; sound off at every open (Req 16.7, Req 25).
