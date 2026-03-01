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
    identity: `${participantName}-${Date.now()}`,
    name: participantName,
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
