# Video Call MVP — Design Document

Date: 2026-02-28

## Problem

Video calling between UAE and India is either data-heavy (Google Meet) or unreliable due to UAE telecom throttling (Botim). This MVP provides a lightweight, low-bandwidth 1-on-1 video call that reliably bypasses UAE ISP restrictions.

## Stack

- **Framework:** Next.js 14+ (App Router), TypeScript, Tailwind CSS
- **Video/WebRTC:** LiveKit Cloud — `@livekit/components-react`, `@livekit/components-styles`, `livekit-client`, `livekit-server-sdk`
- **Slug generation:** `nanoid`
- **Hosting:** Vercel (frontend + API routes)
- **Auth/DB:** None (MVP)

## Architecture

```
app/
  page.tsx                  # Landing page — "Start Call" button
  room/
    [slug]/
      page.tsx              # Pre-join + active call (client component)
  api/
    token/
      route.ts              # GET — mints LiveKit JWT
```

### Route: `/` (Landing Page)

Server component. Minimal UI with app title and a "Start Call" button. On click, generates a random slug via `nanoid` and navigates to `/room/[slug]`.

### Route: `/room/[slug]` (Pre-Join + Call)

Client component with two states:

1. **Pre-join:** Name input, camera/mic preview (via LiveKit's `usePreviewDevice`), "Join Room" button, "Copy Link" button for sharing the URL.
2. **Connected:** Full `<LiveKitRoom>` + `<VideoConference>` component with built-in mute/unmute, video toggle, and disconnect controls.

On "Join Room" click: fetches token from `/api/token?roomName=[slug]&participantName=[name]`, then connects.

### Route: `/api/token` (Token Minting)

GET handler. Takes `roomName` and `participantName` query params. Uses `livekit-server-sdk` `AccessToken` to mint a JWT with `roomJoin` and `roomCreate` grants. Returns `{ token: "..." }`.

## Media Configuration

```typescript
{
  publishDefaults: {
    videoCodec: 'av1',
    videoBitrate: 400_000,  // 400 kbps cap — <350 MB/hour
  },
  adaptiveStream: true,     // pauses off-screen video tracks
}
```

- **AV1** is valid for the target devices (modern flagships: iPhone 15+, Pixel 7+, Galaxy S23+)
- LiveKit auto-falls back to VP8 if AV1 is unsupported in the browser
- LiveKit Cloud handles TURN tunneling over TCP/443 (bypasses UAE UDP blocks)
- Built-in reconnection logic handles network interruptions

## Error Handling

- **Token API:** Missing params → 400. Missing env vars → 500 (no secrets leaked).
- **Token fetch fails:** Error message on pre-join screen with retry button.
- **Connection lost:** LiveKit auto-reconnects. If it gives up, show "Call ended" with "Rejoin" button.
- **Camera/mic denied:** Clear message explaining how to grant permission.
- **Room lifecycle:** Ephemeral — LiveKit Cloud auto-destroys rooms when last participant leaves.

## UI Design

- Dark theme, Tailwind CSS
- Landing page: app title, one-line description, "Start Call" button
- Pre-join: centered camera preview, name input, "Join" + "Copy Link" buttons
- In-call: `<VideoConference>` component handles all controls out of the box

## Environment Variables

```
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
NEXT_PUBLIC_LIVEKIT_URL=
```

`.env.local` for development (gitignored). Set in Vercel dashboard for production.

## Deployment

Vercel via GitHub integration. Push to `main` triggers deployment.

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Codec | AV1 | Best compression for 400 kbps target; target devices support it |
| UX flow | Two-page (landing + room) | Minimal pages, slug in URL path for clean shareable links |
| Room naming | Auto-generated random slug | Simpler UX, no collision risk |
| User identity | Pre-join screen with name input | Camera/mic preview + name entry in one step |
| Access control | URL-only (no auth) | Personal tool, ephemeral rooms |
| Pre-join preview | LiveKit `usePreviewDevice` | Stays within LiveKit ecosystem, no raw `getUserMedia` |
