let moveAudioContext: AudioContext | null = null;

export function playPieceMoveSound(): void {
  if (typeof window === "undefined") return;
  const AudioContextConstructor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextConstructor) return;

  try {
    const context =
      moveAudioContext ?? (moveAudioContext = new AudioContextConstructor());
    if (context.state === "suspended") {
      void context.resume().catch((error: unknown) => {
        console.error("Impossible d’activer le son du jeu :", error);
      });
    }
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(190, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      85,
      context.currentTime + 0.065,
    );
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      context.currentTime + 0.09,
    );
    const noiseBuffer = context.createBuffer(
      1,
      Math.ceil(context.sampleRate * 0.035),
      context.sampleRate,
    );
    const noiseSamples = noiseBuffer.getChannelData(0);
    for (let index = 0; index < noiseSamples.length; index += 1) {
      noiseSamples[index] = Math.random() * 2 - 1;
    }
    const noise = context.createBufferSource();
    const noiseFilter = context.createBiquadFilter();
    const noiseGain = context.createGain();
    noise.buffer = noiseBuffer;
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.value = 1400;
    noiseGain.gain.setValueAtTime(0.08, context.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(
      0.0001,
      context.currentTime + 0.035,
    );
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(context.destination);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.09);
    noise.start();
  } catch (error) {
    console.error("Impossible de jouer le son du coup :", error);
  }
}

export function waitForOpponent(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }

    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve(true);
    }, ms);
    const cancel = () => {
      window.clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener("abort", cancel, { once: true });
  });
}
