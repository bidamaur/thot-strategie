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

export async function animateOpponentMove(
  board: HTMLElement | null,
  from: string,
  to: string,
  piece: string,
  durationMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  if (!board || signal.aborted) return false;
  const squares = Array.from(
    board.querySelectorAll<HTMLElement>("[data-square]"),
  );
  const fromSquare = squares.find((square) => square.dataset.square === from);
  const toSquare = squares.find((square) => square.dataset.square === to);
  if (!fromSquare || !toSquare) return false;

  const fromRect = fromSquare.getBoundingClientRect();
  const toRect = toSquare.getBoundingClientRect();
  const overlay = document.createElement("span");
  overlay.textContent = piece;
  Object.assign(overlay.style, {
    position: "fixed",
    left: `${fromRect.left + fromRect.width / 2}px`,
    top: `${fromRect.top + fromRect.height / 2}px`,
    width: `${Math.min(fromRect.width, fromRect.height) * 0.8}px`,
    height: `${Math.min(fromRect.width, fromRect.height) * 0.8}px`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: "60",
    pointerEvents: "none",
    fontSize: `${Math.min(fromRect.width, fromRect.height) * 0.72}px`,
    lineHeight: "1",
    color: "#171d19",
    filter: "drop-shadow(0 3px 4px rgba(0,0,0,.5))",
  });
  document.body.append(overlay);

  const dx =
    toRect.left + toRect.width / 2 - (fromRect.left + fromRect.width / 2);
  const dy =
    toRect.top + toRect.height / 2 - (fromRect.top + fromRect.height / 2);
  const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 0
    : durationMs;
  const animation = overlay.animate(
    [
      { transform: "translate(-50%, -50%) translate(0px, 0px) scale(1)" },
      {
        transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(1.05)`,
      },
    ],
    { duration, easing: "cubic-bezier(.35,.05,.25,1)", fill: "forwards" },
  );

  return new Promise((resolve) => {
    let settled = false;
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      overlay.remove();
      resolve(completed);
    };
    const abort = () => {
      animation.cancel();
      finish(false);
    };
    animation.onfinish = () => finish(true);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
