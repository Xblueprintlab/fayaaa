// Looping bonfire ambience that reacts to the pointer and the fire dials.
// Graph: source -> lowpass filter -> flicker gain (LFO) -> dynamics gain
//        -> stereo panner -> master gain -> destination.
// The AudioContext is created lazily on the first enable so it always starts
// from a user gesture and autoplay policies never block it.

export type FireAudioDials = {
  intensity: number; // 0..100
  speed: number; // 0..100
  flicker: number; // 0..100
  grain: number; // 0..100
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export class FireAudio {
  enabled = false;

  private context: AudioContext | undefined;
  private buffer: AudioBuffer | undefined;
  private loading: Promise<AudioBuffer> | undefined;
  private source: AudioBufferSourceNode | undefined;
  private filter: BiquadFilterNode | undefined;
  private flickerGain: GainNode | undefined;
  private lfo: OscillatorNode | undefined;
  private lfoDepth: GainNode | undefined;
  private dynamics: GainNode | undefined;
  private panner: StereoPannerNode | undefined;
  private master: GainNode | undefined;
  private suspendTimer = 0;

  private dials: FireAudioDials = { intensity: 53, speed: 40, flicker: 24, grain: 44 };
  private proximity = 0; // 0 = far from the fire, 1 = right on it
  private pan = 0; // -1 left .. 1 right of the fire center
  private hovering = false;

  constructor(private readonly url: string) {}

  async setEnabled(on: boolean): Promise<void> {
    this.enabled = on;
    if (!on) {
      if (this.context && this.master) {
        const now = this.context.currentTime;
        this.master.gain.cancelScheduledValues(now);
        this.master.gain.setTargetAtTime(0, now, 0.12);
        window.clearTimeout(this.suspendTimer);
        this.suspendTimer = window.setTimeout(() => {
          if (!this.enabled && this.context?.state === "running") void this.context.suspend();
        }, 600);
      }
      return;
    }

    window.clearTimeout(this.suspendTimer);
    const context = this.ensureContext();
    if (context.state === "suspended") await context.resume();
    const buffer = await this.loadBuffer(context);
    if (!this.enabled) return; // toggled off while the mp3 was decoding
    this.ensureGraph(context, buffer);
    this.apply(true);
  }

  setPointer(proximity: number, pan: number): void {
    this.proximity = clamp(proximity, 0, 1);
    this.pan = clamp(pan, -1, 1);
    this.apply();
  }

  setHovering(hovering: boolean): void {
    this.hovering = hovering;
    if (!hovering) this.proximity = 0;
    this.apply();
  }

  setDials(dials: FireAudioDials): void {
    this.dials = dials;
    this.apply();
  }

  dispose(): void {
    window.clearTimeout(this.suspendTimer);
    try {
      this.source?.stop();
      this.lfo?.stop();
    } catch {
      // already stopped
    }
    void this.context?.close();
    this.context = undefined;
    this.source = undefined;
    this.lfo = undefined;
    this.master = undefined;
  }

  private ensureContext(): AudioContext {
    if (!this.context) this.context = new AudioContext();
    return this.context;
  }

  private loadBuffer(context: AudioContext): Promise<AudioBuffer> {
    if (this.buffer) return Promise.resolve(this.buffer);
    this.loading ??= (async () => {
      const response = await fetch(this.url);
      if (!response.ok) throw new Error(`fire sound request failed: ${response.status}`);
      const decoded = await context.decodeAudioData(await response.arrayBuffer());
      this.buffer = decoded;
      return decoded;
    })().catch((error) => {
      this.loading = undefined;
      throw error;
    });
    return this.loading;
  }

  private ensureGraph(context: AudioContext, buffer: AudioBuffer): void {
    if (this.source) return;

    this.master = context.createGain();
    this.master.gain.value = 0;
    this.master.connect(context.destination);

    this.panner = context.createStereoPanner();
    this.panner.connect(this.master);

    this.dynamics = context.createGain();
    this.dynamics.gain.value = 0.3;
    this.dynamics.connect(this.panner);

    this.flickerGain = context.createGain();
    this.flickerGain.gain.value = 1;
    this.flickerGain.connect(this.dynamics);

    // A slow, uneven wobble on the flicker gain reads as crackling surges.
    this.lfoDepth = context.createGain();
    this.lfoDepth.gain.value = 0;
    this.lfoDepth.connect(this.flickerGain.gain);
    this.lfo = context.createOscillator();
    this.lfo.type = "sine";
    this.lfo.frequency.value = 6.3;
    this.lfo.connect(this.lfoDepth);
    this.lfo.start();

    this.filter = context.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 1400;
    this.filter.Q.value = 0.7;
    this.filter.connect(this.flickerGain);

    this.source = context.createBufferSource();
    this.source.buffer = buffer;
    this.source.loop = true;
    this.source.connect(this.filter);
    this.source.start();
  }

  private apply(justEnabled = false): void {
    const context = this.context;
    if (!context || !this.master || !this.dynamics || !this.filter || !this.panner) return;
    if (!this.enabled) return;

    const now = context.currentTime;
    const intensity = clamp(this.dials.intensity / 100, 0, 1);
    const speed = clamp(this.dials.speed / 100, 0, 1);
    const flicker = clamp(this.dials.flicker / 100, 0, 1);
    const grain = clamp(this.dials.grain / 100, 0, 1);
    const closeness = this.hovering ? this.proximity : 0;

    // Louder fire when the dials burn hotter; leaning in with the pointer
    // brings the crackle right up to the ear.
    const ambient = 0.14 + 0.3 * intensity;
    const volume = clamp(ambient + closeness * (0.4 + 0.35 * intensity), 0, 1);
    this.dynamics.gain.setTargetAtTime(volume, now, 0.14);

    this.master.gain.setTargetAtTime(1, now, justEnabled ? 0.3 : 0.12);

    // Approaching the flame opens the filter so the hiss and crackle sharpen;
    // grain keeps a little extra resonance in the rumble.
    const cutoff = 700 + intensity * 2200 + closeness * 7500;
    this.filter.frequency.setTargetAtTime(cutoff, now, 0.18);
    this.filter.Q.setTargetAtTime(0.5 + grain * 1.6, now, 0.25);

    // Motion speed nudges the loop's pitch, so a lazy fire rumbles low and a
    // fast one rushes slightly.
    this.source?.playbackRate.setTargetAtTime(0.82 + speed * 0.42 + closeness * 0.08, now, 0.25);

    this.lfoDepth?.gain.setTargetAtTime(flicker * 0.34 * (0.35 + 0.65 * closeness), now, 0.2);
    this.lfo?.frequency.setTargetAtTime(3.5 + speed * 7, now, 0.3);

    this.panner.pan.setTargetAtTime(this.hovering ? this.pan * 0.55 : 0, now, 0.2);
  }
}
