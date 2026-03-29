let audioContext: AudioContext | null = null

function getAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext()
  }
  return audioContext
}

/**
 * Ringback tone (caller hears) — classic phone "ring... ring..." pattern
 * 440Hz tone, 1s on / 3s off
 */
export function playRingback(): () => void {
  const ctx = getAudioContext()
  let stopped = false
  let timeout: ReturnType<typeof setTimeout>
  let oscillator: OscillatorNode | null = null
  let gainNode: GainNode | null = null

  function ring() {
    if (stopped) return

    oscillator = ctx.createOscillator()
    gainNode = ctx.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = 440
    gainNode.gain.value = 0.15
    oscillator.connect(gainNode)
    gainNode.connect(ctx.destination)
    oscillator.start()

    // Stop after 1 second
    timeout = setTimeout(() => {
      oscillator?.stop()
      oscillator = null
      gainNode = null
      // Pause for 3 seconds then ring again
      timeout = setTimeout(ring, 3000)
    }, 1000)
  }

  ring()

  return () => {
    stopped = true
    clearTimeout(timeout)
    try { oscillator?.stop() } catch {}
    oscillator = null
    gainNode = null
  }
}

/**
 * Incoming call ringtone (callee hears) — alternating two-tone pattern
 * 523Hz + 659Hz, 0.4s each alternating, repeating with 2s gap
 */
export function playRingtone(): () => void {
  const ctx = getAudioContext()
  let stopped = false
  let timeout: ReturnType<typeof setTimeout>
  let oscillator: OscillatorNode | null = null
  let gainNode: GainNode | null = null

  function burst(freq: number, duration: number): Promise<void> {
    return new Promise((resolve) => {
      if (stopped) { resolve(); return }

      oscillator = ctx.createOscillator()
      gainNode = ctx.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = freq
      gainNode.gain.value = 0.2
      oscillator.connect(gainNode)
      gainNode.connect(ctx.destination)
      oscillator.start()

      timeout = setTimeout(() => {
        try { oscillator?.stop() } catch {}
        oscillator = null
        gainNode = null
        resolve()
      }, duration)
    })
  }

  async function ringPattern() {
    if (stopped) return
    // Play alternating tones: high-low-high-low
    await burst(523, 200)
    if (stopped) return
    await burst(659, 200)
    if (stopped) return
    await burst(523, 200)
    if (stopped) return
    await burst(659, 200)
    if (stopped) return
    // Pause then repeat
    timeout = setTimeout(ringPattern, 2000)
  }

  ringPattern()

  return () => {
    stopped = true
    clearTimeout(timeout)
    try { oscillator?.stop() } catch {}
    oscillator = null
    gainNode = null
  }
}
