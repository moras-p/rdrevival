/** A short workbench notification, independent of held gameplay audio. */
export function createPlanReadySound() {
  let context;
  return {
    prepare() {
      try {
        const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContext) return;
        context ||= new AudioContext();
        void context.resume().catch(() => {});
      } catch { /* Audio availability must not affect planning. */ }
    },
    play() {
      if (!context || context.state !== 'running') return;
      const start = context.currentTime;
      for (const [offset, frequency] of [[0, 880], [0.075, 1320]]) {
        const tone = context.createOscillator();
        const envelope = context.createGain();
        tone.type = 'sine';
        tone.frequency.value = frequency;
        envelope.gain.setValueAtTime(0, start + offset);
        envelope.gain.linearRampToValueAtTime(0.1, start + offset + 0.005);
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.22);
        tone.connect(envelope).connect(context.destination);
        tone.onended = () => { tone.disconnect(); envelope.disconnect(); };
        tone.start(start + offset);
        tone.stop(start + offset + 0.23);
      }
    }
  };
}
