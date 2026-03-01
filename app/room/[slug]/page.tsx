'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
import { Track } from 'livekit-client';
import { isTrackReference } from '@livekit/components-core';
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react';
import '@livekit/components-styles';

/* ------------------------------------------------------------------ */
/*  CustomPreJoin                                                      */
/* ------------------------------------------------------------------ */

interface PreJoinSettings {
  username: string;
  cameraOn: boolean;
  micOn: boolean;
}

interface CustomPreJoinProps {
  onJoin: (settings: PreJoinSettings) => void;
  onCopyLink: () => void;
  error?: string;
}

function CustomPreJoin({ onJoin, onCopyLink, error }: CustomPreJoinProps) {
  const router = useRouter();

  // Form state
  const [username, setUsername] = useState('');

  // Restore saved name from localStorage after mount (avoids SSR hydration mismatch)
  useEffect(() => {
    const saved = localStorage.getItem('connekt-username');
    if (saved) setUsername(saved);
  }, []);

  // Device state
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [selectedMic, setSelectedMic] = useState('');
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Acquire / replace media stream whenever device selection or toggle changes
  useEffect(() => {
    let cancelled = false;

    async function acquireStream() {
      // Stop previous tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }

      // If both off, nothing to acquire
      if (!cameraOn && !micOn) {
        if (videoRef.current) videoRef.current.srcObject = null;
        return;
      }

      try {
        const constraints: MediaStreamConstraints = {};
        if (cameraOn) {
          constraints.video = selectedCamera
            ? { deviceId: { exact: selectedCamera } }
            : true;
        }
        if (micOn) {
          constraints.audio = selectedMic
            ? { deviceId: { exact: selectedMic } }
            : true;
        }

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = cameraOn ? stream : null;
        }
      } catch {
        // Permission denied or device unavailable — degrade gracefully
      }
    }

    acquireStream();

    return () => {
      cancelled = true;
    };
  }, [cameraOn, micOn, selectedCamera, selectedMic]);

  // Enumerate devices once on mount (after first getUserMedia grants labels)
  useEffect(() => {
    async function enumerate() {
      try {
        // Need an initial getUserMedia to get labelled devices in most browsers
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        tempStream.getTracks().forEach((t) => t.stop());
      } catch {
        // ignore
      }

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setCameras(devices.filter((d) => d.kind === 'videoinput'));
        setMics(devices.filter((d) => d.kind === 'audioinput'));
      } catch {
        // ignore
      }
    }
    enumerate();
  }, []);

  // Cleanup all tracks on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;
    // Persist name for next visit
    localStorage.setItem('connekt-username', username.trim());
    // Stop preview tracks before joining
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    onJoin({ username: username.trim(), cameraOn, micOn });
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem 1rem',
        position: 'relative',
        background: 'var(--bg-primary)',
      }}
    >
      {/* Back arrow */}
      <button
        onClick={() => router.push('/')}
        aria-label="Back to home"
        style={{
          position: 'absolute',
          top: '1rem',
          left: '1rem',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          opacity: 0.6,
          transition: 'opacity var(--transition)',
          padding: '4px',
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.6')}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      {/* Main flex container */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '2rem',
          maxWidth: '900px',
          width: '100%',
        }}
      >
        {/* Camera preview */}
        <div
          style={{
            flex: 3,
            minWidth: '300px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-elevated)',
            overflow: 'hidden',
            position: 'relative',
            aspectRatio: undefined,
          }}
        >
          <style>{`
            .prejoin-camera-preview {
              min-height: 320px;
            }
            @media (max-width: 768px) {
              .prejoin-camera-preview {
                aspect-ratio: 4 / 3;
                min-height: unset;
              }
            }
          `}</style>
          <div
            className="prejoin-camera-preview"
            style={{
              width: '100%',
              height: '100%',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {cameraOn ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: 'scaleX(-1)',
                }}
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--bg-elevated)',
                }}
              >
                <div
                  style={{
                    width: '96px',
                    height: '96px',
                    borderRadius: '50%',
                    background: '#5b5b8a',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <svg width="52" height="52" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="8" r="4" fill="#d1d5db" />
                    <path d="M4 20c0-3.3 2.7-6 6-6h4c3.3 0 6 2.7 6 6" fill="#d1d5db" />
                  </svg>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Form panel */}
        <form
          onSubmit={handleSubmit}
          style={{
            flex: 2,
            minWidth: '280px',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
            justifyContent: 'center',
          }}
        >
          {error && (
            <p
              style={{
                background: 'rgba(153,27,27,0.5)',
                color: '#fca5a5',
                borderRadius: 'var(--radius-sm)',
                padding: '0.5rem 1rem',
              }}
            >
              {error}
            </p>
          )}

          {/* Name input */}
          <input
            type="text"
            placeholder="Your name"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              padding: '12px 14px',
              fontSize: '1.1rem',
              outline: 'none',
              width: '100%',
              transition: 'border-color var(--transition)',
            }}
            onFocus={(e) =>
              (e.currentTarget.style.borderColor = 'var(--accent)')
            }
            onBlur={(e) =>
              (e.currentTarget.style.borderColor = 'var(--border-subtle)')
            }
          />

          {/* Camera select */}
          {cameras.length > 0 && (
            <select
              value={selectedCamera}
              onChange={(e) => setSelectedCamera(e.target.value)}
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                padding: '10px 12px',
                width: '100%',
              }}
            >
              {cameras.map((cam) => (
                <option key={cam.deviceId} value={cam.deviceId}>
                  {cam.label || `Camera ${cameras.indexOf(cam) + 1}`}
                </option>
              ))}
            </select>
          )}

          {/* Mic select */}
          {mics.length > 0 && (
            <select
              value={selectedMic}
              onChange={(e) => setSelectedMic(e.target.value)}
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                padding: '10px 12px',
                width: '100%',
              }}
            >
              {mics.map((mic) => (
                <option key={mic.deviceId} value={mic.deviceId}>
                  {mic.label || `Microphone ${mics.indexOf(mic) + 1}`}
                </option>
              ))}
            </select>
          )}

          {/* Camera / mic toggle row */}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={() => setCameraOn((v) => !v)}
              style={{
                background: 'var(--bg-surface)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 16px',
                cursor: 'pointer',
                opacity: cameraOn ? 1 : 0.5,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: 'var(--text-primary)',
                transition: 'opacity var(--transition)',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 7l-7 5 7 5V7z" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
              {cameraOn ? 'Cam On' : 'Cam Off'}
            </button>

            <button
              type="button"
              onClick={() => setMicOn((v) => !v)}
              style={{
                background: 'var(--bg-surface)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 16px',
                cursor: 'pointer',
                opacity: micOn ? 1 : 0.5,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: 'var(--text-primary)',
                transition: 'opacity var(--transition)',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
              {micOn ? 'Mic On' : 'Mic Off'}
            </button>
          </div>

          {/* Join button */}
          <button
            type="submit"
            disabled={!username.trim()}
            style={{
              background: 'var(--accent)',
              color: '#111',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: '14px 32px',
              fontWeight: 600,
              fontSize: '1rem',
              cursor: username.trim() ? 'pointer' : 'not-allowed',
              opacity: username.trim() ? 1 : 0.6,
              transition: 'background var(--transition), transform var(--transition)',
            }}
            onMouseEnter={(e) => {
              if (username.trim()) {
                (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-hover)';
                (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.02)';
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)';
              (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
            }}
          >
            Join call
          </button>

          {/* Copy invite link */}
          <button
            type="button"
            onClick={onCopyLink}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              textDecoration: 'underline',
              fontSize: '0.875rem',
              cursor: 'pointer',
              padding: 0,
              textAlign: 'center',
            }}
          >
            Copy invite link
          </button>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ParticipantTile                                                    */
/* ------------------------------------------------------------------ */

interface ParticipantTileProps {
  trackRef: TrackReferenceOrPlaceholder;
  participant: import('livekit-client').Participant;
  style?: React.CSSProperties;
}

function ParticipantTile({ trackRef, participant, style }: ParticipantTileProps) {
  const displayName = participant.name || (participant.isLocal ? 'You' : 'Participant');
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
            <svg width="50%" height="50%" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="8" r="4" fill="var(--text-secondary)" />
              <path d="M4 20c0-3.3 2.7-6 6-6h4c3.3 0 6 2.7 6 6" fill="var(--text-secondary)" />
            </svg>
          </div>
          <span
            style={{
              color: 'var(--text-secondary)',
              fontSize: 'clamp(0.75rem, 1.5vw, 1rem)',
              fontWeight: 500,
            }}
          >
            {displayName}
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
          {displayName}
        </div>
      )}
    </div>
  );
}

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
    navigator.mediaDevices.addEventListener('devicechange', enumerateCameras);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', enumerateCameras);
    };
  }, []);

  async function switchCamera() {
    if (cameras.length < 2) return;
    const nextIndex = (cameraIndex + 1) % cameras.length;
    try {
      await room.switchActiveDevice('videoinput', cameras[nextIndex].deviceId);
      setCameraIndex(nextIndex);
    } catch {
      // Device switch failed — index stays unchanged
    }
  }

  async function toggleQuality() {
    const newHD = !isHD;
    try {
      await room.localParticipant.republishAllTracks(
        {
          videoEncoding: { maxBitrate: newHD ? 1_500_000 : 800_000 },
          videoCodec: 'av1',
        },
        false,
      );
      setIsHD(newHD);
    } catch {
      // Republish failed — keep current quality state
    }
  }

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.Microphone, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  const participants = useParticipants();
  const localParticipant = participants.find((p) => p.isLocal);

  // Split tracks: local PiP + remote grid
  const cameraTracks = tracks.filter(
    (t) => t.source === Track.Source.Camera,
  );
  const localTrack = cameraTracks.find((t) => t.participant?.isLocal);
  const remoteTracks = cameraTracks.filter((t) => !t.participant?.isLocal);

  const localHasVideo =
    localTrack && isTrackReference(localTrack) && localParticipant?.isCameraEnabled;

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
        ref={gridRef}
        className="group-grid"
        style={{
          flex: 1,
          paddingBottom: 'clamp(4.5rem, 10vh, 5.5rem)',
        }}
      >
        {remoteCount === 0 ? (
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
          remoteTracks.map((trackRef) => {
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
        )}
      </div>

      {/* Local PiP — bottom-right */}
      <div
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
      >
        {localHasVideo ? (
          <VideoTrack
            trackRef={localTrack}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: 'scaleX(-1)',
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
              gap: '0.25rem',
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: 'var(--bg-surface)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8" r="4" fill="var(--text-secondary)" />
                <path d="M4 20c0-3.3 2.7-6 6-6h4c3.3 0 6 2.7 6 6" fill="var(--text-secondary)" />
              </svg>
            </div>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.625rem', fontWeight: 500 }}>
              {localParticipant?.name || 'You'}
            </span>
          </div>
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
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 18.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2.5l1.5-2h4l1.5 2H18a2 2 0 0 1 2 2v9z" />
              <path d="M15.5 14.5a3.5 3.5 0 0 1-6.15 2.3" />
              <path d="M8.5 13.5a3.5 3.5 0 0 1 6.15-2.3" />
              <polyline points="9.5 18 8.5 16.5 10.2 15.8" />
              <polyline points="14.5 10 15.5 11.5 13.8 12.2" />
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

export default function RoomPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [token, setToken] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [preJoinCamera, setPreJoinCamera] = useState(true);
  const [preJoinMic, setPreJoinMic] = useState(true);

  const liveKitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

  const handlePreJoinSubmit = useCallback(
    async (settings: PreJoinSettings) => {
      setError('');
      setPreJoinCamera(settings.cameraOn);
      setPreJoinMic(settings.micOn);
      try {
        const res = await fetch(
          `/api/token?roomName=${encodeURIComponent(slug)}&participantName=${encodeURIComponent(settings.username)}`,
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

  // Connected state — show the group grid layout
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
            backupCodec: true,
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

  // Pre-join state — show name input + camera/mic preview
  return (
    <CustomPreJoin
      onJoin={handlePreJoinSubmit}
      onCopyLink={copyLink}
      error={error || undefined}
    />
  );
}
