# Patchwork

Patchwork is a daily cooperative nonogram built as a
[Devvit Web Interactive Post](https://developers.reddit.com/docs). A daily post
contains one hidden 8×8 mosaic of 64 tiles. A player solves one tile from its row
and column clues to reveal that part of the shared image.

## Play a tile

1. Open the day's post and choose **Play**. The numbers beside a row or column
   give the lengths of its filled runs in order. For example, `2 1` means a run
   of two filled cells, at least one gap, then a single filled cell.
2. Tap or drag to fill cells. Use the X toggle or a long press to mark cells you
   know are empty. Use the arrow keys to move with a keyboard, Space to fill,
   X to mark empty, and Backspace or Delete to clear.
3. When the grid satisfies its clues, Patchwork submits the tile. After a
   verified stitch, open the mosaic to see the reveal or **Help another tile**
   to keep stitching. Sharing a comment is a separate, optional action.

Guest practice asks the player to sign in before recording a stitch. The daily
post supports one scored tile per signed-in player. Extra tiles and tiles
solved after that UTC day help complete the mosaic without adding a daily
score. Once the mosaic is complete, visitors can reinforce a tile with fewer
solves. The completed view shows stitcher credits when available.

## Daily puzzle and streaks

Each day's scheduled post uses a UTC date. The generator seeds a procedural
pattern from that date, and the slicer checks every tile for a unique
solution. It adjusts a tile deterministically and rechecks it if needed.
Tiles are 5×5 Monday to Wednesday, 6×6 Thursday and Friday, and 7×7 on
Saturday and Sunday. See the [plan](PLAN.md#4-mosaic_generator) and the
[generator verification](docs/verification.md).

A score on the next UTC day extends a streak. A single missed day can be
forgiven once in a rolling seven-day window. The missed day adds no point.
For example, scores on Monday, Tuesday and Thursday count as a streak of
three using grace on Thursday. If Saturday is the player's next score, a
second single-day gap in that window resets the streak to one.

## Verify the code

Run from this directory with Node.js 24.18 or newer. The pinned version is in
[`.nvmrc`](.nvmrc).

```sh
npm ci
npm test
npm run build
```

The tests use local Devvit mocks. The build checks TypeScript and the launch
and full-client compressed JavaScript budgets. See the
[verification record](docs/verification.md) for exact results and for the
scope of earlier browser checks. These checks require no Reddit login.

## Judge access and owner playtest

Patchwork is unpublished. The
[Devpost entry](https://devpost.com/software/patchwork-daily) is a draft.
There is no verified listing, judge-accessible Reddit demo post or public
video for this build. The editor for community art and the Sunday vote are
planned work.

The owner registers the app with Devvit and signs in from their own terminal.
Once the app is registered and an authorized test community is ready, run
these commands from this directory.

```sh
devvit login
npm run deploy
npm run dev
```

`npm run deploy` uploads a testable version. Follow the
[Devvit playtest guide](https://developers.reddit.com/docs/guides/tools/playtest)
to find the test subreddit. Use the live post to check the tap-through from
the feed, a scored stitch, mosaic progress in another session, a guest
practice solve, and next-day rollover. Record any failures before the owner
submits. The [event rules](https://redditgameofday2026.devpost.com/rules)
require the app listing and the test subreddit and game-post links. A video
is optional in those rules. If the owner supplies one, capture the real post
and keep it under one minute.

## Implementation

- [`src/shared/`](src/shared/) contains the deterministic generator, tile
  slicer, nonogram solver and rules.
- [`src/server/`](src/server/) assigns tiles, validates solutions, and stores
  stitches, progress, scores and credits in Devvit Redis.
- [`src/client/`](src/client/) contains the inline preview, responsive board,
  stitch animation, results and shared mosaic. Devvit realtime updates the
  mosaic with periodic refresh as a fallback.
- The app uses [Devvit Journeys](https://developers.reddit.com/docs/capabilities/analytics/devvit-journeys)
  for analytics. Journeys records nothing while this app is unpublished, and
  there are no recorded adoption figures to report.
