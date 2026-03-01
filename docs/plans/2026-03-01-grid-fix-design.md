# Grid Layout Fix + Codec Fallback — Design Document

Date: 2026-03-01

## Problems

1. **Black screens on mobile**: iOS Safari can't decode AV1 on most devices (only iPhone 15 Pro+ has hardware AV1 decoding). Participants joining from phones see black video for laptop participants.

2. **Stretched/distorted tiles on desktop**: The current flexbox grid forces tiles to fill arbitrary percentages of the container, ignoring video aspect ratio. Tiles become tall portrait rectangles for landscape video.

## Solutions

### Fix 1: Codec Fallback (backupCodec)

Add `backupCodec: true` to LiveKit `publishDefaults`. When a subscriber can't decode AV1, LiveKit's SFU automatically requests the publisher to send a VP8 fallback track. No black screens, no manual codec negotiation.

### Fix 2: Zoom-style Area-Maximization Grid

Replace the naive `getGridDimensions` + flexBasis approach with a brute-force algorithm that finds the optimal column count to maximize total video area while maintaining 16:9 aspect ratio.

**Algorithm:**
```
for cols = 1 to count:
  rows = ceil(count / cols)
  tileWidth = containerWidth / cols
  tileHeight = containerHeight / rows

  // Constrain to 16:9 aspect ratio
  if tileWidth / tileHeight > 16/9:
    tileWidth = tileHeight * 16/9
  else:
    tileHeight = tileWidth / (16/9)

  totalArea = tileWidth * tileHeight * count
  track best → return { tileWidth, tileHeight, cols }
```

**Rendering:**
- Grid container: centered flexbox (`justify-content: center`, `flex-wrap: wrap`, `align-content: center`)
- Each tile: explicit width/height in pixels (not percentages), fixed 16:9
- `object-fit: cover` on video element
- `ResizeObserver` on container to recompute on window resize

## Files Changed

- `app/room/[slug]/page.tsx` — backupCodec, new grid algorithm, ResizeObserver
- `app/globals.css` — update .group-grid to centered flexbox, remove tile flex stretch

## Files Unchanged

- `ParticipantTile` component (rendering logic stays the same)
- Local PiP overlay
- Control bar
- Pre-join screen
- Token API

## References

- [Zoom grid algorithm](https://dev.to/antondosov/building-a-video-gallery-just-like-in-zoom-4mam)
- [Google Meet dynamic layouts](https://support.google.com/meet/answer/10550593?hl=en)
- [LiveKit backupCodec docs](https://docs.livekit.io/reference/client-sdk-js/interfaces/TrackPublishDefaults.html)
- [LiveKit codec guide](https://docs.livekit.io/home/client/tracks/advanced/)
