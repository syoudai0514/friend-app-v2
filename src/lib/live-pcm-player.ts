"use client";

export type LivePcmState = "idle" | "loading" | "playing" | "interrupted" | "error";

export interface LivePcmStats {
  underruns: number;
  startedAt: number | null;
}

type StateListener = (state: LivePcmState, level: number, stats: LivePcmStats) => void;

function pcmRate(mimeType: string | undefined): number {
  const match = mimeType?.match(/rate=(\d+)/i);
  const parsed = match ? Number.parseInt(match[1], 10) : 24_000;
  return Number.isFinite(parsed) && parsed >= 8_000 && parsed <= 96_000 ? parsed : 24_000;
}

function decodeBase64Pcm16(encoded: string): Float32Array | null {
  try {
    const binary = atob(encoded);
    if (!binary.length || binary.length % 2 !== 0) return null;
    const samples = new Float32Array(binary.length / 2);
    for (let index = 0; index < samples.length; index += 1) {
      const low = binary.charCodeAt(index * 2) & 0xff;
      const high = binary.charCodeAt(index * 2 + 1) & 0xff;
      let value = low | (high << 8);
      if (value & 0x8000) value -= 0x10000;
      samples[index] = value / 32768;
    }
    return samples;
  } catch {
    return null;
  }
}

/**
 * Live APIのraw PCMをwhole-WAV化せず再生する専用engine。
 * AudioContextは事前生成し、resume()は送信tapのcall stack内から呼び出す。
 */
export class LivePcmPlayer {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private preparePromise: Promise<boolean> | null = null;
  private listener: StateListener | null = null;
  private state: LivePcmState = "idle";
  private level = 0;
  private stats: LivePcmStats = { underruns: 0, startedAt: null };
  private sourceRate = 24_000;
  private disposed = false;

  constructor(listener?: StateListener) {
    this.listener = listener ?? null;
  }

  setListener(listener: StateListener | null) {
    this.listener = listener;
  }

  private emit(state = this.state, level = this.level) {
    this.state = state;
    this.level = level;
    this.listener?.(state, level, { ...this.stats });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("live-voice-audio-state", {
        detail: { state, level, stats: { ...this.stats } },
      }));
    }
  }

  isSupported(): boolean {
    return typeof window !== "undefined" &&
      typeof AudioContext !== "undefined" &&
      typeof AudioWorkletNode !== "undefined";
  }

  prepare(): Promise<boolean> {
    if (this.preparePromise) return this.preparePromise;
    this.preparePromise = this.prepareInternal();
    return this.preparePromise;
  }

  private async prepareInternal(): Promise<boolean> {
    if (!this.isSupported() || this.disposed) return false;
    try {
      this.context ??= new AudioContext({ latencyHint: "interactive" });
      await this.context.audioWorklet.addModule("/live-pcm-worklet.js");
      if (this.disposed) return false;
      this.node = new AudioWorkletNode(this.context, "live-pcm-player", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      this.node.connect(this.context.destination);
      this.node.port.onmessage = (event: MessageEvent) => {
        const message = event.data as { type?: string; level?: number } | undefined;
        if (!message?.type) return;
        if (message.type === "started") {
          this.stats.startedAt ??= performance.now();
          this.emit("playing", this.level);
        } else if (message.type === "level" && typeof message.level === "number") {
          this.emit(this.state, message.level);
        } else if (message.type === "underrun") {
          this.stats.underruns += 1;
          this.emit(this.state, this.level);
        } else if (message.type === "drained") {
          this.emit("idle", 0);
        }
      };
      this.configure(this.sourceRate);
      this.emit(this.context.state === "running" ? "idle" : "loading", 0);
      return true;
    } catch {
      this.emit("error", 0);
      return false;
    }
  }

  /** 必ずuser gesture由来の処理から呼ぶ。 */
  async unlock(): Promise<boolean> {
    if (!this.isSupported() || this.disposed) return false;
    const prepared = await this.prepare();
    if (!prepared || !this.context) return false;
    try {
      if (this.context.state !== "running") await this.context.resume();
      return this.context.state === "running";
    } catch {
      this.emit("error", 0);
      return false;
    }
  }

  private configure(sourceRate: number) {
    this.sourceRate = sourceRate;
    this.node?.port.postMessage({
      type: "configure",
      sourceRate,
      startBufferMs: 220,
    });
  }

  beginTurn() {
    this.stats = { underruns: 0, startedAt: null };
    this.level = 0;
    this.node?.port.postMessage({ type: "flush" });
    this.emit("loading", 0);
  }

  pushBase64Pcm(encoded: string, mimeType?: string): boolean {
    if (!this.node || !encoded) return false;
    const samples = decodeBase64Pcm16(encoded);
    if (!samples?.length) return false;
    const rate = pcmRate(mimeType);
    if (rate !== this.sourceRate) this.configure(rate);
    this.node.port.postMessage({ type: "pcm", samples: samples.buffer }, [samples.buffer]);
    return true;
  }

  endTurn() {
    this.node?.port.postMessage({ type: "end" });
  }

  interrupt() {
    this.node?.port.postMessage({ type: "flush" });
    this.stats = { underruns: 0, startedAt: null };
    this.emit("interrupted", 0);
  }

  async dispose() {
    this.disposed = true;
    try { this.node?.disconnect(); } catch { /* already disconnected */ }
    this.node = null;
    const context = this.context;
    this.context = null;
    if (context) {
      try { await context.close(); } catch { /* already closed */ }
    }
  }
}

export { decodeBase64Pcm16, pcmRate };
