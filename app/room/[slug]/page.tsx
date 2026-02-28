'use client';

import { useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  LiveKitRoom,
  PreJoin,
  RoomAudioRenderer,
  ConnectionStateToast,
  TrackToggle,
  DisconnectButton,
  StartMediaButton,
  VideoTrack,
  useTracks,
  useParticipants,
  type LocalUserChoices,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { isTrackReference } from '@livekit/components-core';
import '@livekit/components-styles';

function MeetLayout() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.Microphone, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  const participants = useParticipants();
  const localParticipant = participants.find((p) => p.isLocal);
  const remoteParticipant = participants.find((p) => !p.isLocal);

  const localTrack = tracks.find(
    (t) =>
      t.participant?.isLocal && t.source === Track.Source.Camera,
  );
  const remoteTrack = tracks.find(
    (t) =>
      !t.participant?.isLocal && t.source === Track.Source.Camera,
  );

  const localHasVideo =
    localTrack && isTrackReference(localTrack) && localParticipant?.isCameraEnabled;
  const remoteHasVideo =
    remoteTrack && isTrackReference(remoteTrack) && remoteParticipant?.isCameraEnabled;

  return (
    <div
      data-lk-theme="default"
      style={{
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background: '#1a1a2e',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Main area — remote video or waiting message */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
        }}
      >
        {remoteParticipant ? (
          remoteHasVideo ? (
            <div
              style={{
                width: '100%',
                height: '100%',
                maxWidth: '960px',
                borderRadius: '12px',
                overflow: 'hidden',
                background: '#000',
              }}
            >
              <VideoTrack
                trackRef={remoteTrack}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                maxWidth: '960px',
                borderRadius: '12px',
                background: '#2d2d44',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1rem',
              }}
            >
              <div
                style={{
                  width: '120px',
                  height: '120px',
                  borderRadius: '50%',
                  background: '#5b5b8a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="8" r="4" fill="#d1d5db" />
                  <path d="M4 20c0-3.3 2.7-6 6-6h4c3.3 0 6 2.7 6 6" fill="#d1d5db" />
                </svg>
              </div>
              <span style={{ color: '#d1d5db', fontSize: '1.125rem', fontWeight: 500 }}>
                {remoteParticipant.name || 'Participant'}
              </span>
            </div>
          )
        ) : (
          <p style={{ color: '#9ca3af', fontSize: '1.125rem' }}>
            Waiting for someone to join...
          </p>
        )}
      </div>

      {/* Local PiP — bottom-right */}
      <div
        style={{
          position: 'absolute',
          bottom: '5.5rem',
          right: '1rem',
          width: '8rem',
          height: '10.5rem',
          borderRadius: '12px',
          overflow: 'hidden',
          background: '#2d2d44',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
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
                background: '#5b5b8a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8" r="4" fill="#d1d5db" />
                <path d="M4 20c0-3.3 2.7-6 6-6h4c3.3 0 6 2.7 6 6" fill="#d1d5db" />
              </svg>
            </div>
            <span style={{ color: '#d1d5db', fontSize: '0.625rem', fontWeight: 500 }}>
              {localParticipant?.name || 'You'}
            </span>
          </div>
        )}
      </div>

      {/* Control bar — bottom center */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '1rem',
        }}
      >
        <TrackToggle source={Track.Source.Microphone} />
        <TrackToggle source={Track.Source.Camera} />
        <DisconnectButton
          style={{
            background: '#ea4335',
            borderRadius: '24px',
            padding: '0.5rem 1.25rem',
          }}
        >
          Leave
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

  // Connected state — show the Meet-style layout
  if (token) {
    return (
      <LiveKitRoom
        token={token}
        serverUrl={liveKitUrl}
        onDisconnected={handleDisconnected}
        options={{
          publishDefaults: {
            videoCodec: 'av1',
            videoEncoding: {
              maxBitrate: 400_000,
            },
          },
          adaptiveStream: true,
        }}
      >
        <MeetLayout />
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
