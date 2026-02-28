# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A lightweight, data-efficient 1-on-1 video calling web app designed for low-bandwidth connections between UAE and India. Uses WebRTC via LiveKit Cloud to bypass UAE telecom restrictions.

## Stack

- **Framework:** Next.js 14+ (App Router), TypeScript, Tailwind CSS
- **Video/WebRTC:** LiveKit Cloud — `@livekit/components-react`, `@livekit/components-styles`, `livekit-client`, `livekit-server-sdk`
- **Hosting:** Vercel (frontend + API routes)
- **Database/Auth:** None for MVP (Supabase optional for later phases)

## Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run lint         # Run linter
```

## Architecture

```
app/
  api/token/route.ts    # GET handler — mints LiveKit JWTs using livekit-server-sdk
  room/page.tsx         # Client component — LiveKitRoom + VideoConference
```

- **Token minting** happens server-side in a Next.js Route Handler (no external serverless functions)
- **Media routing** is handled entirely by LiveKit Cloud (SFU + TURN tunneling over TCP/443)
- The React client connects via WebSocket directly to LiveKit Cloud

## Critical Media Constraints

These constraints are non-negotiable for the MVP — they ensure <350 MB/hour data usage:

```typescript
options={{
  publishDefaults: {
    videoCodec: 'av1',
    videoBitrate: 400000,  // 400 kbps cap
  },
  adaptiveStream: true,    // pauses off-screen video tracks
}}
```

## Environment Variables

```
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
NEXT_PUBLIC_LIVEKIT_URL=
```

## Development Workflow

- Use **Explore-Plan-Code-Commit** pattern — do not jump to the next phase before completing and testing the current one
- Create isolated feature branches for each phase; squash commits before merging into `main`
- The developer works in a `tmux` terminal environment — output shell commands that can be run directly in adjacent panes
- Prioritize connection stability and low bandwidth over UI polish
