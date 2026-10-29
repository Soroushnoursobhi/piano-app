import * as Tone from "tone";

/*
  A small synthesised drum kit and a handful of patterns.
  No samples: every sound is generated, so it works offline and loads instantly.

  A pattern is a list of hits per drum, as positions within one bar. Positions
  are in "grid steps": grid = 4 means 16th notes (4 per beat), grid = 3 means
  triplets (3 per beat, for swing). A bar of 4/4 at grid 4 has 16 steps, 0..15.
*/

export type DrumStyle = "off" | "rock" | "pop" | "jazz" | "waltz" | "latin";
export const DRUM_STYLES: { value: DrumStyle; label: string }[] = [
  { value: "off", label: "No drums" },
  { value: "rock", label: "Rock" },
  { value: "pop", label: "Pop" },
  { value: "jazz", label: "Jazz brushes" },
  { value: "waltz", label: "Waltz" },
  { value: "latin", label: "Bossa" },
];

type Voice = "kick" | "snare" | "rim" | "hihat" | "ride";
export type Pattern = { grid: number; hits: Partial<Record<Voice, number[]>> };

// Meter families: "4" = beats in quarters or halves (4/4, 2/4, 3/4 is its own),
// "3" = three-beat bars, "6" = compound meters (6/8, 9/8, 12/8) where the beat is an eighth.
type Family = "4" | "3" | "6";

const every = (n: number, upTo: number, from = 0) => Array.from({ length: Math.ceil((upTo - from) / n) }, (_, i) => from + i * n);

const PATTERNS: Record<Exclude<DrumStyle, "off">, Record<Family, Pattern>> = {
  rock: {
    "4": { grid: 4, hits: { kick: [0, 8], snare: [4, 12], hihat: every(2, 16) } },
    "3": { grid: 4, hits: { kick: [0], snare: [8], hihat: every(2, 12) } },
    "6": { grid: 2, hits: { kick: [0, 6], snare: [6], hihat: every(2, 12) } },
  },
  pop: {
    "4": { grid: 4, hits: { kick: [0, 7, 8, 10], snare: [4, 12], hihat: every(2, 16) } },
    "3": { grid: 4, hits: { kick: [0, 7], snare: [8], hihat: every(2, 12) } },
    "6": { grid: 2, hits: { kick: [0, 4, 6], snare: [6], hihat: every(2, 12) } },
  },
  jazz: {
    "4": { grid: 3, hits: { ride: [0, 3, 5, 6, 9, 11], hihat: [3, 9], kick: [0] } },
    "3": { grid: 3, hits: { ride: [0, 3, 5, 6, 8], hihat: [3, 6] } },
    "6": { grid: 2, hits: { ride: [0, 4, 6, 10], hihat: [6] } },
  },
  waltz: {
    "4": { grid: 4, hits: { kick: [0, 8], rim: [4, 12], hihat: every(4, 16) } },
    "3": { grid: 4, hits: { kick: [0], rim: [4, 8], hihat: every(4, 12) } },
    "6": { grid: 2, hits: { kick: [0], rim: [6], hihat: every(2, 12) } },
  },
  latin: {
    "4": { grid: 4, hits: { kick: [0, 6, 8, 14], rim: [0, 6, 10], hihat: every(2, 16) } },
    "3": { grid: 4, hits: { kick: [0, 6], rim: [4, 10], hihat: every(2, 12) } },
    "6": { grid: 2, hits: { kick: [0, 6], rim: [4, 10], hihat: every(2, 12) } },
  },
};

export function familyOf(numerator: number, denominator: number): Family {
  if (denominator >= 8 && numerator % 3 === 0) return "6";
  if (numerator === 3) return "3";
  return "4";
}

export function getPattern(style: DrumStyle, numerator: number, denominator: number): Pattern | null {
  if (style === "off") return null;
  return PATTERNS[style][familyOf(numerator, denominator)];
}

// ---- the kit ----
export type Kit = {
  play: (voice: Voice, time: number, velocity?: number) => void;
  volume: Tone.Volume;
  dispose: () => void;
};

export function createKit(): Kit {
  const volume = new Tone.Volume(-8).toDestination();

  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.05, octaves: 6, envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.1 },
  }).connect(volume);

  const snare = new Tone.NoiseSynth({
    noise: { type: "pink" }, envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.05 },
  }).connect(volume);
  snare.volume.value = 4;
  kick.volume.value = 4;

  const rim = new Tone.MembraneSynth({
    pitchDecay: 0.01, octaves: 2, envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 },
  }).connect(volume);

  const hihat = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.05, release: 0.02 },
    harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5,
  }).connect(volume);
  hihat.volume.value = -8;

  const ride = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.5, release: 0.3 },
    harmonicity: 3.5, modulationIndex: 20, resonance: 3000, octaves: 1,
  }).connect(volume);
  ride.volume.value = -10;

  const play = (voice: Voice, time: number, velocity = 1) => {
    switch (voice) {
      case "kick": kick.triggerAttackRelease("C1", 0.2, time, velocity); break;
      case "snare": snare.triggerAttackRelease(0.15, time, velocity * 0.8); break;
      case "rim": rim.triggerAttackRelease("A4", 0.05, time, velocity * 0.7); break;
      case "hihat": hihat.triggerAttackRelease("C6", 0.05, time, velocity); break;
      case "ride": ride.triggerAttackRelease("E6", 0.4, time, velocity); break;
    }
  };

  return {
    play,
    volume,
    dispose: () => [kick, snare, rim, hihat, ride, volume].forEach((n) => n.dispose()),
  };
}