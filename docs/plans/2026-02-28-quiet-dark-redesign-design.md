# Quiet Dark Redesign

Date: 2026-02-28

## Overview

Redesign all 3 screens of the video calling app with a "Quiet Dark" aesthetic — deep charcoal, warm amber accent, glass controls, video-forward. Responsive across phone, tablet, and web.

## Aesthetic

- **Background**: `#111111`
- **Accent**: amber `#E5A54B` (CTAs)
- **Text**: `#FAFAFA` primary, `#888888` secondary
- **Font**: DM Sans (Google Fonts), weights 400/500/600
- **Radii**: 8px general, 12px video containers, 48px pill controls
- **Glass**: `backdrop-filter: blur(20px)` + `rgba(0,0,0,0.5)` for floating controls
- **Transitions**: 150ms ease on hovers, subtle scale(1.02) on buttons

## Screen 1: Landing Page

Vertically centered, single column. Same layout at all breakpoints.

- Title: "Video Call", DM Sans weight 500, 2rem mobile / 3rem desktop, `#FAFAFA`
- Subtitle: "Lightweight, low-bandwidth 1-on-1 video calls", 1rem, `#888`
- CTA: amber `#E5A54B` bg, `#111` text, 8px radius, `14px 32px` padding
- Hover: brightness increase + scale(1.02), 150ms

No other elements.

## Screen 2: Custom Pre-join

Replaces LiveKit's `<PreJoin />` prefab with fully custom UI.

### Desktop/Tablet (>768px)
Two-column layout. Left (60%): live camera preview, 12px rounded, mirrored. Right (40%): name input, device selectors, Join button.

### Mobile (<768px)
Stacked. Camera preview top (16:9 aspect ratio), form below.

### Elements
- Camera preview: 12px corners, `scaleX(-1)`, dark bg + silhouette avatar when off
- Name input: transparent bg, bottom-border-only, white text, placeholder "Your name" in `#666`
- Device selectors: dark bg dropdowns, subtle border
- Join button: amber CTA matching landing
- "Copy invite link": underline text in `#888` below Join
- Back arrow: top-left, returns to landing

### Implementation
Uses `navigator.mediaDevices.getUserMedia()` and `enumerateDevices()` directly. Passes selected device IDs + username to LiveKitRoom when joining.

## Screen 3: In-call (MeetLayout)

### Remote Video
Full viewport, edge-to-edge, no max-width, no padding, no rounded corners. Video IS the background.

### Local PiP
- Desktop: 180x240px, 12px from edges, 12px radius, `1px rgba(255,255,255,0.1)` border
- Tablet: 140x186px
- Mobile: 100x133px, 8px from edges
- Mirrored, subtle shadow

### Control Bar
- Floating pill: `backdrop-filter: blur(20px)`, `rgba(0,0,0,0.5)` bg, 48px radius
- 3 buttons: mic (48px circle), camera (48px circle), leave (48px circle)
- Active: `rgba(255,255,255,0.15)` bg, white icon
- Muted: `rgba(255,255,255,0.08)` bg, red slash
- Leave: `#EA4335` bg, phone-down icon
- Mobile: buttons shrink to 40px

### Waiting State
Centered "Waiting for someone to join..." in `#888`, subtle pulsing dot animation.

### Camera-off Avatar
Human silhouette SVG + participant name, centered in the remote area.

## Responsive Breakpoints

- Mobile: <768px
- Tablet: 768px-1024px
- Desktop: >1024px

## Files Changed

- `app/layout.tsx` — DM Sans font, updated global styles
- `app/globals.css` — CSS custom properties for design tokens
- `app/page.tsx` — redesigned landing page
- `app/room/[slug]/page.tsx` — custom pre-join + redesigned MeetLayout

## Constraints

- Must keep LiveKit media constraints (AV1, 400kbps cap, adaptive stream)
- Must keep `100dvh` for mobile Safari
- Must keep `RoomAudioRenderer`, `ConnectionStateToast`, `StartMediaButton`
- No additional dependencies beyond DM Sans (Google Fonts via next/font)
