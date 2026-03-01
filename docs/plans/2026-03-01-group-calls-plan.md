# Group Calls Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the 1-on-1 `MeetLayout` with an adaptive grid layout supporting up to 8 participants where tiles fill all available space with no gaps.

**Architecture:** Use LiveKit's `<GridLayout>` for track management with custom CSS overrides to ensure tiles in incomplete rows stretch to fill the container width. The local participant becomes an equal tile in the grid (no PiP). Control bar remains the same glass bar at bottom center.

**Tech Stack:** LiveKit `@livekit/components-react` (GridLayout, useTracks, VideoTrack, TrackToggle, ParticipantTile), CSS Grid, Next.js App Router

---

### Task 1: Add grid CSS overrides to globals.css

**Files:**
- Modify: `app/globals.css:1-29`

**Step 1: Add the grid override CSS**

Append after line 29 (after the `pulse-dot` keyframe):

```css
/* ---- Group call grid overrides ---- */
.group-grid {
  display: flex !important;
  flex-wrap: wrap;
  width: 100%;
  height: 100%;
  padding: 4px;
  gap: 4px;
  box-sizing: border-box;
}

.group-grid .participant-tile {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  border-radius: var(--radius-md);
  overflow: hidden;
  position: relative;
  background: var(--bg-elevated);
}
```

**Step 2: Verify the file saved correctly**

Run: `head -60 app/globals.css`
Expected: The new CSS classes appear after the keyframe block.

**Step 3: Verify build still passes**

Run: `npm run build`
Expected: Build succeeds with no errors.

---

### Task 2: Create the ParticipantTile component

**Files:**
- Modify: `app/room/[slug]/page.tsx` — add `ParticipantTile` component after the `CustomPreJoin` component (after line 480)

**Step 1: Add the ParticipantTile component**

Insert after line 480 (after the closing `}` of `CustomPreJoin`). This component renders a single participant — video when camera is on, avatar+name when off:

```tsx
/* ------------------------------------------------------------------ */
/*  ParticipantTile                                                    */
/* ------------------------------------------------------------------ */

interface ParticipantTileProps {
  trackRef: import('@livekit/components-react').TrackReferenceOrPlaceholder;
  participant: import('livekit-client').Participant;
  style?: React.CSSProperties;
}

function ParticipantTile({ trackRef, participant, style }: ParticipantTileProps) {
  const hasVideo =
    isTrackReference(trackRef) && participant.isCameraEnabled;

  return (
    <div className="participant-tile" style={style}>
      {hasVideo ? (
        <VideoTrack
          trackRef={trackRef}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: participant.isLocal ? 'scaleX(-1)' : undefined,
          }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            background: 'var(--bg-elevated)',
          }}
        >
          <div
            style={{
              width: 'clamp(48px, 8vw, 96px)',
              height: 'clamp(48px, 8vw, 96px)',
              borderRadius: '50%',
              background: 'var(--bg-surface)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              width="50%"
              height="50%"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle cx="12" cy="8" r="4" fill="var(--text-secondary)" />
              <path
                d="M4 20c0-3.3 2.7-6 6-6h4c3.3 0 6 2.7 6 6"
                fill="var(--text-secondary)"
              />
            </svg>
          </div>
          <span
            style={{
              color: 'var(--text-secondary)',
              fontSize: 'clamp(0.75rem, 1.5vw, 1rem)',
              fontWeight: 500,
            }}
          >
            {participant.name || (participant.isLocal ? 'You' : 'Participant')}
          </span>
        </div>
      )}

      {/* Name overlay — always visible when video is on */}
      {hasVideo && (
        <div
          style={{
            position: 'absolute',
            bottom: '0.5rem',
            left: '0.5rem',
            background: 'rgba(0,0,0,0.6)',
            borderRadius: 'var(--radius-sm)',
            padding: '2px 8px',
            fontSize: 'clamp(0.625rem, 1.2vw, 0.8rem)',
            color: 'var(--text-primary)',
            fontWeight: 500,
          }}
        >
          {participant.name || (participant.isLocal ? 'You' : 'Participant')}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Add the missing import type**

At the top of the file (line 6), add `TrackReferenceOrPlaceholder` to the livekit imports. Update the import from `@livekit/components-react`:

```tsx
import {
  LiveKitRoom,
  RoomAudioRenderer,
  ConnectionStateToast,
  TrackToggle,
  DisconnectButton,
  StartMediaButton,
  VideoTrack,
  useTracks,
  useParticipants,
  useRoomContext,
} from '@livekit/components-react';
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react';
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds. The component is defined but not yet used — that's fine.

---

### Task 3: Create the GroupLayout component (replace MeetLayout)

**Files:**
- Modify: `app/room/[slug]/page.tsx` — replace `MeetLayout` (lines 482-784) with `GroupLayout`

**Step 1: Compute grid dimensions helper**

Add this helper function right before the `GroupLayout` component:

```tsx
/* ------------------------------------------------------------------ */
/*  Grid helpers                                                       */
/* ------------------------------------------------------------------ */

function getGridDimensions(count: number): { columns: number; rows: number } {
  if (count <= 1) return { columns: 1, rows: 1 };
  if (count <= 2) return { columns: 2, rows: 1 };
  if (count <= 4) return { columns: 2, rows: 2 };
  if (count <= 6) return { columns: 3, rows: 2 };
  return { columns: 4, rows: 2 }; // 7-8
}
```

**Step 2: Write the GroupLayout component**

Replace the entire `MeetLayout` function (lines 482-784) with:

```tsx
/* ------------------------------------------------------------------ */
/*  GroupLayout                                                        */
/* ------------------------------------------------------------------ */

function GroupLayout() {
  const room = useRoomContext();
  const [isHD, setIsHD] = useState(false);

  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraIndex, setCameraIndex] = useState(0);

  useEffect(() => {
    async function enumerateCameras() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setCameras(devices.filter((d) => d.kind === 'videoinput'));
      } catch {
        // ignore
      }
    }
    enumerateCameras();
  }, []);

  async function switchCamera() {
    if (cameras.length < 2) return;
    const nextIndex = (cameraIndex + 1) % cameras.length;
    setCameraIndex(nextIndex);
    await room.switchActiveDevice('videoinput', cameras[nextIndex].deviceId);
  }

  async function toggleQuality() {
    const newHD = !isHD;
    setIsHD(newHD);
    await room.localParticipant.republishAllTracks(
      {
        videoEncoding: { maxBitrate: newHD ? 1_500_000 : 800_000 },
        videoCodec: 'av1',
      },
      false,
    );
  }

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.Microphone, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  const participants = useParticipants();

  // Get camera tracks per participant
  const cameraTracks = tracks.filter(
    (t) => t.source === Track.Source.Camera,
  );

  const count = cameraTracks.length;
  const { columns, rows } = getGridDimensions(count);

  // Compute per-tile flex basis so the last row stretches to fill
  const lastRowCount = count % columns || columns;
  const tileStyles: React.CSSProperties[] = cameraTracks.map((_, i) => {
    const row = Math.floor(i / columns);
    const totalRows = Math.ceil(count / columns);
    const isLastRow = row === totalRows - 1;
    const itemsInThisRow = isLastRow ? lastRowCount : columns;

    return {
      flexBasis: `calc(${100 / itemsInThisRow}% - 4px)`,
      height: `calc(${100 / totalRows}% - 4px)`,
    };
  });

  return (
    <div
      data-lk-theme="default"
      style={{
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--bg-primary)',
      }}
    >
      {/* Video grid */}
      <div
        className="group-grid"
        style={{
          flex: 1,
          paddingBottom: 'clamp(4.5rem, 10vh, 5.5rem)',
        }}
      >
        {count === 0 ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: 'var(--text-secondary)',
                fontSize: '1.125rem',
              }}
            >
              <span>Waiting for someone to join</span>
              <span
                style={{
                  display: 'inline-block',
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: 'var(--text-secondary)',
                  animation: 'pulse-dot 1.5s ease-in-out infinite',
                }}
              />
            </div>
          </div>
        ) : (
          cameraTracks.map((trackRef, i) => {
            const participant = participants.find(
              (p) => p.identity === trackRef.participant?.identity,
            );
            if (!participant) return null;
            return (
              <ParticipantTile
                key={participant.identity}
                trackRef={trackRef}
                participant={participant}
                style={tileStyles[i]}
              />
            );
          })
        )}
      </div>

      {/* Glass control bar — bottom center */}
      <div
        style={{
          position: 'absolute',
          bottom: 'clamp(1rem, 3vh, 1.5rem)',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 'clamp(0.5rem, 2vw, 0.75rem)',
          padding: 'clamp(8px, 1.5vw, 12px) clamp(16px, 3vw, 24px)',
          background: 'var(--glass-bg)',
          backdropFilter: 'var(--glass-blur)',
          WebkitBackdropFilter: 'var(--glass-blur)',
          borderRadius: 'var(--radius-pill)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <TrackToggle source={Track.Source.Microphone} />
        <TrackToggle source={Track.Source.Camera} />
        {cameras.length >= 2 && (
          <button
            type="button"
            onClick={switchCamera}
            style={{
              background: 'rgba(255,255,255,0.15)',
              color: '#fff',
              borderRadius: '50%',
              width: 'clamp(40px, 6vw, 48px)',
              height: 'clamp(40px, 6vw, 48px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              border: 'none',
              cursor: 'pointer',
              transition: 'background var(--transition)',
            }}
            title="Switch camera"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
              <path d="M17 2l-3 3 3 3" />
              <path d="M7 2l3 3-3 3" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={toggleQuality}
          style={{
            background: isHD ? 'var(--accent)' : 'rgba(255,255,255,0.15)',
            color: isHD ? '#111' : '#fff',
            borderRadius: '50%',
            width: 'clamp(40px, 6vw, 48px)',
            height: 'clamp(40px, 6vw, 48px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            border: 'none',
            cursor: 'pointer',
            fontSize: 'clamp(11px, 1.5vw, 13px)',
            fontWeight: 700,
            letterSpacing: '0.5px',
            transition: 'background var(--transition), color var(--transition)',
          }}
          title={isHD ? 'Switch to SD (800kbps)' : 'Switch to HD (1.5Mbps)'}
        >
          {isHD ? 'HD' : 'SD'}
        </button>
        <DisconnectButton
          style={{
            background: '#EA4335',
            borderRadius: '50%',
            width: 'clamp(40px, 6vw, 48px)',
            height: 'clamp(40px, 6vw, 48px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
            <line x1="23" y1="1" x2="1" y2="23" />
          </svg>
        </DisconnectButton>
      </div>

      <RoomAudioRenderer />
      <ConnectionStateToast />
      <StartMediaButton />
    </div>
  );
}
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds but will warn about `MeetLayout` being referenced in `RoomPage`. We fix that in the next task.

---

### Task 4: Update RoomPage to use GroupLayout and new room options

**Files:**
- Modify: `app/room/[slug]/page.tsx` — update `RoomPage` component (lines 786-866)

**Step 1: Update the LiveKitRoom configuration**

In the `RoomPage` function, replace the `<LiveKitRoom>` block (the `if (token)` branch). Change:
- `<MeetLayout />` → `<GroupLayout />`
- `maxBitrate: 400_000` → `maxBitrate: 800_000`
- Add `dynacast: true`

The updated block:

```tsx
  if (token) {
    return (
      <LiveKitRoom
        token={token}
        serverUrl={liveKitUrl}
        onDisconnected={handleDisconnected}
        video={preJoinCamera}
        audio={preJoinMic}
        options={{
          publishDefaults: {
            videoCodec: 'av1',
            videoEncoding: {
              maxBitrate: 800_000,
            },
          },
          adaptiveStream: true,
          dynacast: true,
        }}
      >
        <GroupLayout />
      </LiveKitRoom>
    );
  }
```

**Step 2: Remove unused imports**

The `useRoomContext` and `useParticipants` imports are still used by `GroupLayout`, so keep them. The `isTrackReference` import from `@livekit/components-core` is still used by `ParticipantTile`. All existing imports should remain.

**Step 3: Verify full build**

Run: `npm run build`
Expected: Build succeeds with zero errors. No references to `MeetLayout` remain.

**Step 4: Run lint**

Run: `npm run lint`
Expected: No lint errors.

---

### Task 5: Manual testing in browser

**Step 1: Start dev server**

Run: `npm run dev`

**Step 2: Test single participant (yourself)**

1. Open `http://localhost:3000`
2. Click "Start Call"
3. Enter name, click "Join call"
4. Verify: You see a single tile filling the full viewport with your video (mirrored) and your name overlaid
5. Toggle camera off — verify avatar + name appears
6. Toggle camera back on — verify video returns

**Step 3: Test two participants**

1. Copy the room URL
2. Open it in a second browser tab or incognito window
3. Join with a different name
4. Verify: Two equal tiles side by side, each filling exactly 50% width
5. Toggle one camera off — verify that tile shows avatar, other shows video

**Step 4: Test control bar**

1. Verify mic toggle, camera toggle, HD/SD toggle, and Leave button all work
2. Click Leave — verify you return to pre-join screen

**Step 5: Commit**

```bash
git add app/globals.css app/room/\[slug\]/page.tsx
git commit -m "feat: replace 1-on-1 MeetLayout with adaptive group call grid

- Support up to 8 participants in adaptive flexbox grid
- Tiles fill all space with no gaps (last row stretches)
- Local user is an equal tile (no PiP)
- Bumped default bitrate to 800kbps, added dynacast
- ParticipantTile shows video or avatar+name"
```
