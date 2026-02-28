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
