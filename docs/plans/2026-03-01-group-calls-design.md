# Group Calls — Design Document

Date: 2026-03-01

## Problem

The app currently supports only 1-on-1 video calls. The `MeetLayout` component assumes exactly one remote participant (full-screen remote video + local PiP). We need to support group calls with up to 8 participants in an adaptive grid layout where tiles fill all available space with no gaps.

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Max participants | 8 | Medium group size; manageable bandwidth and grid complexity |
| Bandwidth limit | None (was 350 MB/hr for 1-on-1) | User opted for quality over data savings in group calls |
| Layout | Adaptive grid, no empty space | Tiles resize dynamically; last row stretches to fill width |
| 1-on-1 calls | Use same grid layout | Unified codebase — 1-on-1 is just a 2-tile grid |
| Access control | Anyone with link joins | No lobby/host approval needed |
| Extras | None | No participant list, no speaker highlight, no chat |

## Approach: Hybrid (LiveKit GridLayout + CSS Overrides)

Use LiveKit's `<GridLayout>` component for track management, pagination, and tile rendering. Override the grid CSS to guarantee tiles always fill the container with no empty cells.

## Architecture

### Files Changed

- **`app/room/[slug]/page.tsx`** — Replace `MeetLayout` with `GroupLayout` + custom `ParticipantTile`
- **`app/globals.css`** — CSS overrides for grid gap-filling behavior

### Files Unchanged

- `app/page.tsx` — Landing page (no changes)
- `app/api/token/route.ts` — Token API (already supports N participants per room)
- `CustomPreJoin` component — Pre-join screen (no changes)

## Grid Layout Algorithm

Custom grid definitions passed to `useGridLayout` to minimize empty cells:

| Participants | Columns x Rows | Empty Cells |
|---|---|---|
| 1 | 1x1 | 0 |
| 2 | 2x1 | 0 |
| 3 | 2x2 or 3x1 | 0-1 |
| 4 | 2x2 | 0 |
| 5 | 3x2 | 1 (last row stretches) |
| 6 | 3x2 | 0 |
| 7 | 4x2 | 1 (last row stretches) |
| 8 | 4x2 | 0 |

For odd participant counts (5, 7), the last row's tiles stretch to fill the remaining width via CSS — no visible empty space.

## Participant Tile

Each tile renders one participant (including local user):

**Camera ON:**
- `<VideoTrack>` filling the tile with `object-fit: cover`
- Local participant video mirrored (`scaleX(-1)`)
- Name overlaid in bottom-left corner (semi-transparent background)

**Camera OFF:**
- Dark background (`var(--bg-elevated)`)
- Centered avatar circle (SVG person icon, existing pattern)
- Name below avatar

Name is always visible on every tile.

## Control Bar

Same glass bar at bottom center. Buttons:
- Mic toggle (`TrackToggle`)
- Camera toggle (`TrackToggle`)
- HD/SD quality toggle (existing `republishAllTracks` logic)
- Leave button (red `DisconnectButton`)

No PiP — local user is an equal tile in the grid.

## Room Options

```typescript
options={{
  publishDefaults: {
    videoCodec: 'av1',
    videoEncoding: {
      maxBitrate: 800_000,  // 800 kbps default (up from 400k)
    },
  },
  adaptiveStream: true,   // pause off-screen/paginated tiles
  dynacast: true,          // only encode quality layers subscribers need
}}
```

- `dynacast: true` — key addition for group calls. Senders only encode the resolution subscribers request. In an 8-person grid, tiles are small so subscribers request low quality, saving CPU/bandwidth.
- `adaptiveStream` — still useful if pagination occurs.
- Default bitrate raised to 800 kbps since there's no strict bandwidth limit.

## What This Does NOT Include

- Participant list sidebar
- Dominant speaker highlight
- Lobby / access control
- Screen sharing
- Chat
- Mobile-specific layouts
