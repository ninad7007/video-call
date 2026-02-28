### **TL;DR**

Pivoting to a **Next.js (React) Web App** vastly simplifies your MVP architecture. It allows you to drop Supabase Edge Functions entirely, handling token generation natively within Next.js API Route Handlers. Combined with **LiveKit Cloud** for global media routing and bypassing UAE firewalls, this stack lets you move rapidly without leaving your terminal, keeping infrastructure overhead near zero while maintaining high reliability.

Here is the updated Product Requirements Document (PRD) and Technical Design Document (TDD) tailored specifically for a Next.js environment, ready to be digested by Claude Code.

---

## **Instructions for Claude Code (System Context)**

* **Role:** You are an expert Software Engineer and SRE building a high-reliability MVP video calling application. Focus on rapid iteration and a "move fast" execution style.
* **Workflow:** Use the **Explore-Plan-Code-Commit** pattern. Do not jump to the next phase before completing and testing the current phase. Create isolated feature branches for each phase, and squash your commits before merging into `main` to maintain a clean, highly reliable Git history.
* **Environment:** The developer operates entirely in a terminal environment utilizing `tmux`. Output any necessary shell commands for local dev servers, dependency installation, and deployment so they can be run directly in adjacent panes.
* **Constraint:** Prioritize low bandwidth (AV1 codec, max 400 kbps) and network resilience. Do not over-engineer the UI; focus strictly on core connection stability using the Next.js App Router.

---

## **1. Product Requirements Document (PRD)**

### **1.1 Problem Statement**

Current video calling solutions between the UAE and India are either highly data-intensive (Google Meet) or suffer from latency/quality issues due to regional throttling (Botim). There is a need for a lightweight, data-efficient, and resilient video calling MVP that reliably bypasses UAE telecom restrictions without the overhead of managing complex native mobile builds or self-hosted servers.

### **1.2 Scope (Next.js Web MVP)**

* **In Scope:** * 1-on-1 video and audio calling accessible via a web browser URL.
* Mute/Unmute audio, Turn Video On/Off.
* Secure JWT token minting via Next.js Route Handlers.
* Adaptive Bitrate Streaming (ABR) prioritizing framerate stability over high resolution.


* **Out of Scope:** Group calls, chat, screen sharing, native mobile backgrounding (CallKit), and complex user authentication (use simple URL-based room generation for the MVP).

### **1.3 Acceptance Criteria**

* **Data Usage:** The video stream must consume less than 350 MB per hour (capped at ~400 kbps).
* **Connectivity:** Calls must successfully connect when the UAE user is on Etisalat/Du cellular data (LiveKit Cloud handles the TCP/443 TURN tunneling automatically).
* **Infrastructure:** Zero self-hosted servers. The app must run entirely on Vercel (Next.js frontend + API) and LiveKit Cloud (Media SFU).

---

## **2. Technical Design Document (TDD)**

### **2.1 Serverless Web Architecture**

* **Frontend UI:** Next.js 14+ (App Router) using Tailwind CSS and `@livekit/components-react`. This package provides pre-built, tree-shakable React components for WebRTC rendering.
* **Backend Signaling (API):** Next.js Route Handlers (`app/api/token/route.ts`). This removes the need for external serverless functions like Supabase Edge Functions. The route uses `livekit-server-sdk` to mint JWTs.
* **Media Server (SFU) & TURN:** **LiveKit Cloud**. The React client connects via WebSocket directly to LiveKit Cloud, which routes the media globally over its optimized edge network.
* **Database / Auth:** Supabase (Optional for Phase 1). Only introduce Supabase if persistent user accounts or call history logs are required later.

### **2.2 Media Constraints & Configuration**

* **Video Codec:** Force `AV1` via the LiveKit `RoomOptions`.
* **Bitrate:** Capped at 400 kbps.
* **Optimization:** Utilize LiveKit's `adaptiveStream` to automatically pause off-screen video tracks.

---

## **3. Agent Execution Phases**

**Claude:** Execute these phases sequentially on separate Git branches. Run `git commit` after verifying each phase.

### **Phase 1: Next.js Project Initialization & API Setup**

1. Initialize a new Next.js project: `npx create-next-app@latest uae-india-video --typescript --tailwind --app`.
2. Install dependencies: `npm install livekit-server-sdk @livekit/components-react @livekit/components-styles livekit-client`.
3. Create an API route at `app/api/token/route.ts`.
4. Implement a `GET` handler that extracts `roomName` and `participantName` from the URL search params, uses the `AccessToken` class from `livekit-server-sdk`, and returns a signed JWT.

* **Verification:** The developer can `curl http://localhost:3000/api/token?roomName=test&participantName=user1` and receive a valid token.

### **Phase 2: The Video Room UI (React)**

1. Create a new client component at `app/room/page.tsx`.
2. Import `LiveKitRoom` and `VideoConference` from `@livekit/components-react`.
3. Fetch the token from the Phase 1 API route on component mount.
4. **Critical:** Hardcode the `options` prop on `LiveKitRoom` to enforce data savings:
```javascript
options={{
  publishDefaults: {
    videoCodec: 'av1',
    videoBitrate: 400000,
  },
  adaptiveStream: true,
}}

```



* **Verification:** The Next.js dev server runs cleanly, requests hardware permissions, and displays the local camera feed.

### **Phase 3: Deployment & Live Testing**

1. Add `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `NEXT_PUBLIC_LIVEKIT_URL` to `.env.local`.
2. Ensure the Next.js build passes (`npm run build`).
3. Output instructions for the developer to push the repository to GitHub and connect it to Vercel for instant deployment.

* **Verification:** The deployed Vercel URL can be opened on an Etisalat 5G connection in the UAE and a Jio 5G connection in India simultaneously, successfully bridging the WebRTC connection via AV1.

---

**Would you like me to outline the specific shell commands you can run right now in your `tmux` pane to initialize this Next.js project and set up the Git repository before you hand it off to Claude?**

[Building a Voice Assistant with LiveKit and React](https://www.youtube.com/watch?v=Ew7fOQpkKBw)
This tutorial provides a complete walkthrough of integrating LiveKit's React components into a custom frontend, which will be highly useful context when setting up your Next.js client UI.
