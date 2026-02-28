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
            videoEncoding: {
              maxBitrate: 400_000,
            },
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
