# Quiet Dark Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign all 3 screens (landing, pre-join, in-call) with a "Quiet Dark" aesthetic — deep charcoal, warm amber accent, glass controls — responsive across phone, tablet, and web.

**Architecture:** 4 files changed total. Global design tokens in CSS variables. DM Sans via next/font/google. Custom pre-join replaces LiveKit's `<PreJoin />` using raw `getUserMedia` + `enumerateDevices`. MeetLayout gets glass controls and edge-to-edge remote video.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS 4, LiveKit components-react, livekit-client, next/font/google (DM Sans)

---

### Task 1: Global foundations — font, CSS tokens, layout

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`

**Step 1: Update `app/globals.css` with design tokens**

```css
@import "tailwindcss";

:root {
  --bg-primary: #111111;
  --bg-elevated: #1a1a1a;
  --bg-surface: #222222;
  --accent: #E5A54B;
  --accent-hover: #f0b45e;
  --text-primary: #FAFAFA;
  --text-secondary: #888888;
  --text-muted: #666666;
  --glass-bg: rgba(0, 0, 0, 0.5);
  --glass-blur: blur(20px);
  --border-subtle: rgba(255, 255, 255, 0.1);
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-pill: 48px;
  --transition: 150ms ease;
}

body {
  background: var(--bg-primary);
  color: var(--text-primary);
}
```

**Step 2: Update `app/layout.tsx` — swap Inter for DM Sans**

```tsx
import type { Metadata } from 'next';
import { DM_Sans } from 'next/font/google';
import './globals.css';

const dmSans = DM_Sans({ subsets: ['latin'], weight: ['400', '500', '600'] });

export const metadata: Metadata = {
  title: 'Video Call',
  description: 'Lightweight 1-on-1 video calls',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${dmSans.className} min-h-screen`}>
        {children}
      </body>
    </html>
  );
}
```

**Step 3: Verify**

Run: `npm run build`
Expected: PASS — pages render with new font and tokens

**Step 4: Commit**

```bash
git add app/layout.tsx app/globals.css
git commit -m "feat: add DM Sans font and CSS design tokens"
```

---

### Task 2: Landing page redesign

**Files:**
- Modify: `app/page.tsx`

**Step 1: Rewrite landing page**

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { nanoid } from 'nanoid';

export default function Home() {
  const router = useRouter();

  function startCall() {
    const slug = nanoid(10);
    router.push(`/room/${slug}`);
  }

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1.5rem',
        padding: '1.5rem',
      }}
    >
      <h1
        style={{
          fontSize: 'clamp(2rem, 5vw, 3rem)',
          fontWeight: 500,
          color: 'var(--text-primary)',
          letterSpacing: '-0.02em',
        }}
      >
        Video Call
      </h1>
      <p
        style={{
          color: 'var(--text-secondary)',
          fontSize: '1rem',
          textAlign: 'center',
          maxWidth: '24rem',
        }}
      >
        Lightweight, low-bandwidth 1-on-1 video calls
      </p>
      <button
        onClick={startCall}
        style={{
          background: 'var(--accent)',
          color: '#111',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          padding: '14px 32px',
          fontSize: '1rem',
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'var(--transition)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--accent-hover)';
          e.currentTarget.style.transform = 'scale(1.02)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--accent)';
          e.currentTarget.style.transform = 'scale(1)';
        }}
      >
        Start Call
      </button>
    </main>
  );
}
```

Key details:
- `clamp(2rem, 5vw, 3rem)` for fluid title sizing — no media query needed
- `100dvh` for mobile Safari
- CSS variable references for all design tokens
- Inline hover handlers for scale + brightness (no extra CSS needed)

**Step 2: Verify**

Run: `npm run build && npm run lint`
Expected: PASS

**Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: redesign landing page with Quiet Dark theme"
```

---

### Task 3: Custom pre-join screen

**Files:**
- Modify: `app/room/[slug]/page.tsx`

This is the largest task. Replace the `<PreJoin />` prefab with a custom component that uses raw browser APIs for camera preview and device enumeration.

**Step 1: Add `CustomPreJoin` component**

Add this component inside `app/room/[slug]/page.tsx`, above the existing `MeetLayout` component. It needs:

- `useState` for: `username`, `videoDeviceId`, `audioDeviceId`, `videoDevices`, `audioDevices`, `localStream`, `cameraOn`, `micOn`
- `useEffect` to call `enumerateDevices()` on mount and populate device lists
- `useEffect` to call `getUserMedia()` when selected devices or on/off toggles change, and attach stream to a `<video>` ref
- A cleanup function to stop all tracks when unmounting
- On submit: stop the preview stream, call the token API, then set token state (which mounts LiveKitRoom)

The component receives these props:
```tsx
interface CustomPreJoinProps {
  onJoin: (username: string, videoDeviceId?: string, audioDeviceId?: string) => void;
  onCopyLink: () => void;
  error?: string;
}
```

Layout structure:
```
<div> (full screen container, 100dvh)
  <button> (back arrow, top-left absolute)
  <div> (content wrapper, flex row on desktop, column on mobile)
    <div> (left: camera preview, 60% width desktop)
      <video ref={videoRef} /> OR <avatar placeholder>
    </div>
    <div> (right: form, 40% width desktop)
      <input name />
      <select camera />
      <select mic />
      <div> (camera/mic toggle row)
      <button Join />
      <button Copy link />
    </div>
  </div>
</div>
```

Responsive: Use a CSS media query via `window.matchMedia` or simply use `flex-wrap: wrap` on the content wrapper so it stacks naturally on narrow screens. The camera preview div gets `min-width: 300px; flex: 3` and the form div gets `min-width: 280px; flex: 2`.

Style details:
- Camera preview: `border-radius: var(--radius-md)`, `background: var(--bg-elevated)`, `overflow: hidden`, video element has `transform: scaleX(-1)`, `object-fit: cover`, `width: 100%`, `aspect-ratio: 4/3`
- Name input: `background: transparent`, `border: none`, `border-bottom: 1px solid var(--border-subtle)`, `color: var(--text-primary)`, `padding: 12px 0`, `font-size: 1.1rem`, `outline: none`. On focus: `border-bottom-color: var(--accent)`
- Device selects: `background: var(--bg-surface)`, `border: 1px solid var(--border-subtle)`, `border-radius: var(--radius-sm)`, `color: var(--text-primary)`, `padding: 10px 12px`, `width: 100%`
- Camera/mic toggle buttons: small pill toggles in a row, `background: var(--bg-surface)`, icon + label
- Join button: identical to landing CTA — amber, 8px radius, 600 weight
- Copy link: `color: var(--text-secondary)`, underline, `font-size: 0.875rem`
- Back arrow: `position: absolute`, `top: 1rem`, `left: 1rem`, white SVG arrow, `opacity: 0.6`, hover to `1`

**Step 2: Update `RoomPage` to use `CustomPreJoin`**

Replace the pre-join section at the bottom of `RoomPage`. The `handlePreJoinSubmit` callback changes signature — it now receives `(username, videoDeviceId, audioDeviceId)` instead of `LocalUserChoices`. The token fetch stays the same, just uses the username string directly.

Remove the `PreJoin` import from `@livekit/components-react` and the `LocalUserChoices` type import.

**Step 3: Verify**

Run: `npm run build && npm run lint`
Expected: PASS

Test manually:
- Camera preview shows in pre-join
- Device selectors populate
- Name input works
- Join triggers token fetch and enters call
- Back arrow returns to landing
- Mobile: layout stacks vertically

**Step 4: Commit**

```bash
git add app/room/[slug]/page.tsx
git commit -m "feat: custom pre-join screen with camera preview and device selectors"
```

---

### Task 4: Redesign MeetLayout — edge-to-edge video + glass controls

**Files:**
- Modify: `app/room/[slug]/page.tsx` (the `MeetLayout` component)

**Step 1: Rewrite MeetLayout styles**

Key changes to the existing `MeetLayout`:

**Root container** — keep `100dvh`, change background to `var(--bg-primary)`.

**Remote video area** — remove `padding: 1rem`, `maxWidth: 960px`, and `borderRadius: 12px`. Make it fill the entire viewport:
```tsx
style={{
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--bg-primary)',
}}
```
VideoTrack gets `width: 100%`, `height: 100%`, `objectFit: 'cover'`.

**Camera-off avatar** — same SVG + name, centered in the full area. Background: `var(--bg-primary)`.

**Waiting state** — centered text with pulsing dot animation. Add a CSS keyframe animation inline:
```tsx
<span style={{
  display: 'inline-block',
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  background: 'var(--text-secondary)',
  marginLeft: '8px',
  animation: 'pulse 1.5s ease-in-out infinite',
}} />
```
Add `@keyframes pulse { 0%,100% { opacity: 0.3 } 50% { opacity: 1 } }` to `globals.css`.

**Local PiP** — responsive sizing using CSS clamp or media-query-like approach:
```tsx
style={{
  position: 'absolute',
  bottom: 'clamp(5rem, 12vh, 6rem)',
  right: 'clamp(0.5rem, 2vw, 0.75rem)',
  width: 'clamp(100px, 15vw, 180px)',
  height: 'clamp(133px, 20vw, 240px)',
  borderRadius: 'var(--radius-md)',
  overflow: 'hidden',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
}}
```

**Control bar** — glass pill, centered at bottom:
```tsx
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
```

**Control buttons** — replace `<TrackToggle>` and `<DisconnectButton>` with custom styled buttons that still use LiveKit hooks underneath. We need `useLocalParticipant()` to get mute state and toggle methods. Each button is a circle:
- Mic/Camera active: `background: rgba(255,255,255,0.15)`, white SVG icon
- Mic/Camera muted: `background: rgba(255,255,255,0.08)`, icon with red slash
- Leave: `background: #EA4335`, phone-down icon
- Size: `clamp(40px, 6vw, 48px)` width/height

Actually — keep `<TrackToggle>` and `<DisconnectButton>` from LiveKit (they handle all the mute/unmute/disconnect logic correctly) but override their styles with inline styles and add `data-lk-theme="default"` on the root so the icons still render. The LiveKit buttons accept `style` props.

**Step 2: Verify**

Run: `npm run build && npm run lint`
Expected: PASS

Test manually:
- Remote video fills entire screen
- Local PiP responsive sizes: check at 375px, 768px, 1440px widths
- Glass control bar floats at bottom, pill shape
- Buttons have correct active/muted states
- Waiting message with pulsing dot
- Camera-off shows avatar

**Step 3: Commit**

```bash
git add app/room/[slug]/page.tsx app/globals.css
git commit -m "feat: glass controls and edge-to-edge video in MeetLayout"
```

---

### Task 5: Final verification and polish

**Step 1: Full build + lint**

Run: `npm run build && npm run lint`
Expected: PASS with no warnings

**Step 2: Responsive spot-check**

Test in browser dev tools at these widths:
- 375px (iPhone SE)
- 390px (iPhone 14)
- 768px (iPad)
- 1024px (iPad landscape)
- 1440px (desktop)

Check each screen: landing, pre-join, in-call.

**Step 3: Commit any polish fixes**

```bash
git add -A
git commit -m "fix: responsive polish and visual tweaks"
```
