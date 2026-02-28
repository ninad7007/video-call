# Video Call MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a low-bandwidth 1-on-1 video calling web app using Next.js and LiveKit Cloud.

**Architecture:** Two-page flow — landing page (`/`) with "Start Call" button that generates a random room slug, and a room page (`/room/[slug]`) with pre-join screen (name input + camera preview) that transitions to a full LiveKit video conference. Token minting happens server-side in a Next.js API route.

**Tech Stack:** Next.js 14+ (App Router), TypeScript, Tailwind CSS, LiveKit Cloud (`@livekit/components-react`, `livekit-server-sdk`), `nanoid`, Vercel

**Design doc:** `docs/plans/2026-02-28-video-call-mvp-design.md`

---

### Task 1: Bootstrap Next.js Project

**Files:**
- Create: entire project scaffold via `create-next-app`
- Create: `.env.local`
- Create: `.env.example`

**Step 1: Initialize the project**

Run:
```bash
cd /Users/ninaddighe/Dev/personal/video-call
npx create-next-app@latest . --typescript --tailwind --app --eslint --src-dir=false --import-alias="@/*" --use-npm
```

Expected: Next.js project scaffolded in current directory with `app/` directory, `tailwind.config.ts`, `tsconfig.json`, `package.json`.

Note: If prompted about overwriting existing files (PRD.md, CLAUDE.md, docs/), accept — `create-next-app` won't touch those.

**Step 2: Install LiveKit and nanoid dependencies**

Run:
```bash
npm install livekit-server-sdk @livekit/components-react @livekit/components-styles livekit-client nanoid
```

Expected: All packages installed, `package.json` updated.

**Step 3: Create environment files**

Create `.env.local`:
```
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
NEXT_PUBLIC_LIVEKIT_URL=
```

Create `.env.example` (committed to git, no secrets):
```
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
NEXT_PUBLIC_LIVEKIT_URL=
```

**Step 4: Initialize git and commit**

Run:
```bash
git init
git add -A
git commit -m "chore: bootstrap Next.js project with LiveKit dependencies"
```

**Step 5: Verify dev server starts**

Run:
```bash
npm run dev
```

Expected: Dev server starts on `http://localhost:3000`, default Next.js page renders.

---

### Task 2: Token API Route

**Files:**
- Create: `app/api/token/route.ts`

**Step 1: Create the token route**

Create `app/api/token/route.ts`:
```typescript
import { AccessToken } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const roomName = request.nextUrl.searchParams.get('roomName');
  const participantName = request.nextUrl.searchParams.get('participantName');

  if (!roomName || !participantName) {
    return NextResponse.json(
      { error: 'Missing roomName or participantName' },
      { status: 400 },
    );
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 },
    );
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity: participantName,
    ttl: '10m',
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
  });

  const token = await at.toJwt();

  return NextResponse.json({ token });
}
```

**Step 2: Verify the route with curl**

Fill in `.env.local` with your LiveKit Cloud credentials first, then run:
```bash
curl "http://localhost:3000/api/token?roomName=test&participantName=user1"
```

Expected: `{"token":"eyJ..."}` — a valid JWT string.

**Step 3: Verify error handling**

Run:
```bash
curl "http://localhost:3000/api/token"
```

Expected: `{"error":"Missing roomName or participantName"}` with 400 status.

**Step 4: Commit**

```bash
git add app/api/token/route.ts
git commit -m "feat: add LiveKit token minting API route"
```

---

### Task 3: Landing Page

**Files:**
- Modify: `app/page.tsx` (replace default Next.js content)
- Modify: `app/layout.tsx` (update metadata, dark theme)
- Modify: `app/globals.css` (clean up default styles)

**Step 1: Update the root layout**

Modify `app/layout.tsx` — update metadata and add dark background:
```typescript
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

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
      <body className={`${inter.className} bg-gray-950 text-white min-h-screen`}>
        {children}
      </body>
    </html>
  );
}
```

**Step 2: Clean up globals.css**

Replace `app/globals.css` with only the Tailwind directives (remove all default Next.js styles):
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**Step 3: Build the landing page**

Replace `app/page.tsx`:
```typescript
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
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <h1 className="text-4xl font-bold">Video Call</h1>
      <p className="text-gray-400 text-center max-w-md">
        Lightweight, low-bandwidth 1-on-1 video calls
      </p>
      <button
        onClick={startCall}
        className="rounded-lg bg-blue-600 px-8 py-3 text-lg font-medium hover:bg-blue-500 transition-colors"
      >
        Start Call
      </button>
    </main>
  );
}
```

**Step 4: Verify in browser**

Open `http://localhost:3000`. Expected: dark page with "Video Call" title, description, and a "Start Call" button. Clicking the button navigates to `/room/<random-slug>` (will 404 for now — that's fine).

**Step 5: Commit**

```bash
git add app/page.tsx app/layout.tsx app/globals.css
git commit -m "feat: add landing page with Start Call button"
```

---

### Task 4: Room Page — Pre-Join Screen

**Files:**
- Create: `app/room/[slug]/page.tsx`

**Step 1: Create the room page with pre-join and call states**

Create `app/room/[slug]/page.tsx`:
```typescript
'use client';

import { useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  LiveKitRoom,
  VideoConference,
  PreJoin,
  type LocalUserChoices,
} from '@livekit/components-react';
import '@livekit/components-styles';

export default function RoomPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [token, setToken] = useState<string>('');
  const [error, setError] = useState<string>('');

  const liveKitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

  const handlePreJoinSubmit = useCallback(
    async (values: LocalUserChoices) => {
      setError('');
      try {
        const res = await fetch(
          `/api/token?roomName=${encodeURIComponent(slug)}&participantName=${encodeURIComponent(values.username)}`,
        );
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to get token');
        }
        const data = await res.json();
        setToken(data.token);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect');
      }
    },
    [slug],
  );

  const handleDisconnected = useCallback(() => {
    setToken('');
  }, []);

  function copyLink() {
    navigator.clipboard.writeText(window.location.href);
  }

  if (!liveKitUrl) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <p className="text-red-400">LiveKit URL not configured</p>
      </div>
    );
  }

  // Connected state — show the video conference
  if (token) {
    return (
      <LiveKitRoom
        token={token}
        serverUrl={liveKitUrl}
        onDisconnected={handleDisconnected}
        options={{
          publishDefaults: {
            videoCodec: 'av1',
            videoBitrate: 400_000,
          },
          adaptiveStream: true,
        }}
        style={{ height: '100vh' }}
      >
        <VideoConference />
      </LiveKitRoom>
    );
  }

  // Pre-join state — show name input + camera/mic preview
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      {error && (
        <p className="rounded bg-red-900/50 px-4 py-2 text-red-300">{error}</p>
      )}
      <PreJoin
        onSubmit={handlePreJoinSubmit}
        onError={(err) => setError(err.message)}
      />
      <button
        onClick={copyLink}
        className="text-sm text-gray-400 underline hover:text-gray-300"
      >
        Copy invite link
      </button>
    </div>
  );
}
```

**Step 2: Verify pre-join screen**

1. Start dev server: `npm run dev`
2. Open `http://localhost:3000`
3. Click "Start Call" — should navigate to `/room/<slug>`
4. Expected: LiveKit PreJoin component renders with camera preview, microphone selector, and username input
5. The "Copy invite link" button should be visible below

**Step 3: Verify the full call flow**

1. Fill in `.env.local` with real LiveKit Cloud credentials
2. Enter a name in the PreJoin component and click Join
3. Expected: token fetched from API, LiveKitRoom connects, VideoConference UI renders with mute/video/disconnect controls
4. Open the same room URL in a second browser tab with a different name — both participants should see each other

**Step 4: Commit**

```bash
git add app/room/\[slug\]/page.tsx
git commit -m "feat: add room page with pre-join screen and video conference"
```

---

### Task 5: Polish and Build Verification

**Files:**
- Possibly modify: `app/room/[slug]/page.tsx` (minor fixes from testing)
- No new files

**Step 1: Run the production build**

```bash
npm run build
```

Expected: Build succeeds with no errors. Fix any TypeScript or build errors that surface.

**Step 2: Run the linter**

```bash
npm run lint
```

Expected: No lint errors. Fix any that appear.

**Step 3: Test the production build locally**

```bash
npm start
```

Open `http://localhost:3000`, go through the full flow (landing → pre-join → call). Verify everything works in production mode.

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve build and lint issues"
```

(Skip this commit if there were no issues.)

---

### Task 6: Deployment Setup

**Files:**
- No code changes — deployment configuration only

**Step 1: Ensure `.gitignore` excludes secrets**

Verify `.env.local` is in `.gitignore` (create-next-app should have added it). Check:
```bash
grep ".env.local" .gitignore
```

Expected: `.env.local` or `.env*.local` is listed.

**Step 2: Push to GitHub**

```bash
git remote add origin <your-github-repo-url>
git push -u origin main
```

**Step 3: Deploy to Vercel**

1. Go to [vercel.com](https://vercel.com), import the GitHub repo
2. Set environment variables in Vercel dashboard:
   - `LIVEKIT_API_KEY`
   - `LIVEKIT_API_SECRET`
   - `NEXT_PUBLIC_LIVEKIT_URL`
3. Deploy

**Step 4: Verify the deployed app**

Open the Vercel URL, go through the full flow. Test from both UAE and India connections if possible.
