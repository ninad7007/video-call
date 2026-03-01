# Grid Layout Fix + Codec Fallback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix black screens on mobile (AV1 codec fallback) and fix stretched/distorted tiles on desktop (Zoom-style 16:9 grid algorithm).

**Architecture:** Add `backupCodec: true` to LiveKit options for codec compatibility. Replace the naive flexBasis grid sizing with a brute-force area-maximization algorithm that finds the optimal column count for a given container size and 16:9 aspect ratio. Use a ResizeObserver to recompute on window resize.

**Tech Stack:** LiveKit `backupCodec`, CSS flexbox (centered), ResizeObserver, TypeScript

---

### Task 1: Add backupCodec to fix black screens on mobile

**Files:**
- Modify: `app/room/[slug]/page.tsx:964-970`

**Step 1: Add backupCodec to publishDefaults**

Find the `publishDefaults` block in the `RoomPage` component (line 965-970) and add `backupCodec: true`:

```tsx
          publishDefaults: {
            videoCodec: 'av1',
            backupCodec: true,
            videoEncoding: {
              maxBitrate: 800_000,
            },
          },
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

---

### Task 2: Replace grid algorithm with Zoom-style area maximization

**Files:**
- Modify: `app/room/[slug]/page.tsx:574-675` (Grid helpers + tile sizing in GroupLayout)

**Step 1: Replace `getGridDimensions` with `computeGridLayout`**

Delete the `getGridDimensions` function (lines 574-584) and replace with:

```tsx
/* ------------------------------------------------------------------ */
/*  Grid helpers                                                       */
/* ------------------------------------------------------------------ */

const TILE_ASPECT_RATIO = 16 / 9;
const GRID_GAP = 8;

function computeGridLayout(
  containerWidth: number,
  containerHeight: number,
  count: number,
): { tileWidth: number; tileHeight: number; columns: number } {
  if (count === 0) return { tileWidth: 0, tileHeight: 0, columns: 1 };

  let bestLayout = { tileWidth: 0, tileHeight: 0, columns: 1 };
  let bestArea = 0;

  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const availW = (containerWidth - GRID_GAP * (cols + 1)) / cols;
    const availH = (containerHeight - GRID_GAP * (rows + 1)) / rows;

    let tileW: number;
    let tileH: number;

    if (availW / availH > TILE_ASPECT_RATIO) {
      // Cell is wider than 16:9 — constrain by height
      tileH = availH;
      tileW = tileH * TILE_ASPECT_RATIO;
    } else {
      // Cell is taller than 16:9 — constrain by width
      tileW = availW;
      tileH = tileW / TILE_ASPECT_RATIO;
    }

    if (tileW <= 0 || tileH <= 0) continue;

    const totalArea = tileW * tileH * count;
    if (totalArea > bestArea) {
      bestArea = totalArea;
      bestLayout = { tileWidth: Math.floor(tileW), tileHeight: Math.floor(tileH), columns: cols };
    }
  }

  return bestLayout;
}
```

**Step 2: Update GroupLayout to use ResizeObserver and computeGridLayout**

In the `GroupLayout` function, replace the grid sizing block (lines 661-675):

```tsx
  const remoteCount = remoteTracks.length;
  const { columns, rows: totalRows } = getGridDimensions(remoteCount);

  // Compute per-tile flex basis so the last row stretches to fill
  const lastRowCount = remoteCount % columns || columns;
  const tileStyles: React.CSSProperties[] = remoteTracks.map((_, i) => {
    const row = Math.floor(i / columns);
    const isLastRow = row === totalRows - 1;
    const itemsInThisRow = isLastRow ? lastRowCount : columns;

    return {
      flexBasis: `calc(${100 / itemsInThisRow}% - 4px)`,
      height: `calc(${100 / totalRows}% - 4px)`,
    };
  });
```

Replace with:

```tsx
  const remoteCount = remoteTracks.length;

  // Measure grid container for Zoom-style layout
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridSize, setGridSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setGridSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { tileWidth, tileHeight } = computeGridLayout(
    gridSize.width,
    gridSize.height,
    remoteCount,
  );

  const tileStyle: React.CSSProperties = {
    width: tileWidth > 0 ? `${tileWidth}px` : undefined,
    height: tileHeight > 0 ? `${tileHeight}px` : undefined,
  };
```

**Step 3: Add `ref={gridRef}` to the grid container div**

Find the grid container div (has `className="group-grid"`). Add the ref:

```tsx
      <div
        ref={gridRef}
        className="group-grid"
        style={{
          flex: 1,
          paddingBottom: 'clamp(4.5rem, 10vh, 5.5rem)',
        }}
      >
```

**Step 4: Update tile rendering to use the single `tileStyle`**

Replace `style={tileStyles[i]}` with `style={tileStyle}` in the `remoteTracks.map(...)` block:

```tsx
          remoteTracks.map((trackRef, i) => {
            const participant = participants.find(
              (p) => p.identity === trackRef.participant?.identity,
            );
            if (!participant) return null;
            return (
              <ParticipantTile
                key={participant.identity}
                trackRef={trackRef}
                participant={participant}
                style={tileStyle}
              />
            );
          })
```

**Step 5: Verify build**

Run: `npm run build`
Expected: Build succeeds.

---

### Task 3: Update CSS for centered grid

**Files:**
- Modify: `app/globals.css:31-50`

**Step 1: Update .group-grid and .participant-tile CSS**

Replace the entire group call grid section (lines 31-50) with:

```css
/* ---- Group call grid ---- */
.group-grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-content: center;
  width: 100%;
  height: 100%;
  gap: 8px;
  padding: 8px;
  box-sizing: border-box;
}

.group-grid .participant-tile {
  flex: 0 0 auto;
  border-radius: var(--radius-md);
  overflow: hidden;
  position: relative;
  background: var(--bg-elevated);
}
```

Key changes:
- `justify-content: center` + `align-content: center` — tiles are centered in the container
- Removed `!important` from display
- `flex: 0 0 auto` instead of `flex: 1 1 auto` — tiles don't stretch, they use explicit dimensions
- Gap increased to 8px to match the GRID_GAP constant in the algorithm
- Removed `min-width: 0` and `min-height: 0` (no longer needed with explicit sizing)

**Step 2: Verify build and lint**

Run: `npm run build && npm run lint`
Expected: Both pass.

---

### Task 4: Verify and commit

**Step 1: Run full build**

Run: `npm run build`
Expected: Build succeeds with no errors.

**Step 2: Run lint**

Run: `npm run lint`
Expected: No errors.

**Step 3: Commit (do NOT push — wait for user)**

```bash
git add app/globals.css app/room/\[slug\]/page.tsx docs/plans/2026-03-01-grid-fix-design.md docs/plans/2026-03-01-grid-fix-plan.md
git commit -m "fix: Zoom-style 16:9 grid layout + AV1 codec fallback for mobile

- Add backupCodec: true so mobile Safari gets VP8 fallback (fixes black screens)
- Replace naive flexBasis grid with area-maximization algorithm
- Tiles maintain 16:9 aspect ratio, centered in container
- ResizeObserver recomputes layout on window resize
- Gap increased to 8px for visual breathing room"
```
