/**
 * Audio Sequencer — The Pulse Component
 *
 * Reads music from a 16x16 or 32x32 pixel grid that acts as a visual
 * MIDI piano roll:
 *   X-axis  → time-step / sequence duration
 *   Y-axis  → pitch / frequency  (top = highest pitch)
 *   Brightness → velocity / volume
 *
 * Instrument samples are loaded from URLs declared in the .msc script.
 * The sequencer fires the correct sample on each step.
 */

export type GridSize = 16 | 32;

export interface SequencerNote {
  /** Column index (time step). */
  step: number;
  /** Row index from top (0 = highest pitch). */
  pitch: number;
  /** Normalised velocity 0–1 (derived from pixel brightness). */
  velocity: number;
}

/**
 * Parse notes from a flat RGBA grid buffer.
 * Non-transparent, non-black pixels are treated as active notes.
 */
export function parseSequencerGrid(
  data: Uint8ClampedArray,
  size: GridSize
): SequencerNote[] {
  const notes: SequencerNote[] = [];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const base = (y * size + x) * 4;
      const r = data[base];
      const g = data[base + 1];
      const b = data[base + 2];
      const a = data[base + 3];

      if (a < 128) continue; // transparent — inactive
      const brightness = (r + g + b) / (3 * 255);
      if (brightness < 0.05) continue; // near-black — inactive

      notes.push({ step: x, pitch: y, velocity: brightness });
    }
  }

  return notes;
}

export interface SequencerOptions {
  /** Beats per minute — controls step timing. */
  bpm: number;
  size: GridSize;
  /** Map of pitch index → AudioBuffer or sample URL. */
  samples: Map<number, AudioBuffer>;
  audioCtx: AudioContext;
}

export class Sequencer {
  private readonly notes: SequencerNote[];
  private readonly options: SequencerOptions;
  private currentStep = 0;
  private nextStepTime = 0;
  private timerId: ReturnType<typeof setTimeout> | null = null;

  constructor(notes: SequencerNote[], options: SequencerOptions) {
    this.notes = notes;
    this.options = options;
  }

  /** Start playback from the current step. */
  start(): void {
    this.nextStepTime = this.options.audioCtx.currentTime;
    this.schedule();
  }

  /** Stop playback. */
  stop(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private schedule(): void {
    const { bpm, size, audioCtx, samples } = this.options;
    const stepDuration = 60 / bpm / (size / 4); // quarter-note subdivisions

    while (this.nextStepTime < audioCtx.currentTime + 0.1) {
      this.fireStep(this.currentStep, this.nextStepTime, samples, audioCtx);
      this.currentStep = (this.currentStep + 1) % size;
      this.nextStepTime += stepDuration;
    }

    this.timerId = setTimeout(() => this.schedule(), 25);
  }

  private fireStep(
    step: number,
    time: number,
    samples: Map<number, AudioBuffer>,
    audioCtx: AudioContext
  ): void {
    for (const note of this.notes) {
      if (note.step !== step) continue;
      const buffer = samples.get(note.pitch);
      if (!buffer) continue;

      const source = audioCtx.createBufferSource();
      source.buffer = buffer;

      const gainNode = audioCtx.createGain();
      gainNode.gain.value = note.velocity;

      source.connect(gainNode).connect(audioCtx.destination);
      source.start(time);
    }
  }
}
