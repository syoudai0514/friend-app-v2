"use client";

export type AudioSessionState =
  | "locked"
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "interrupted"
  | "error";

export interface AudioLatencyStats {
  samples: number[];
  p50: number | null;
  p95: number | null;
}

interface PlayOptions {
  delayMs?: number;
  requestStartedAt?: number;
}

interface NavigatorAudioHints {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
}

function percentile(samples: number[], ratio: number): number | null {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return Math.round(sorted[index]);
}

export function isAppleMobileWebKit(hints?: NavigatorAudioHints): boolean {
  const current = hints ?? (typeof navigator !== "undefined" ? navigator : undefined);
  if (!current) return false;
  const ua = current.userAgent ?? "";
  const platform = current.platform ?? "";
  const maxTouchPoints = current.maxTouchPoints ?? 0;
  return /iPad|iPhone|iPod/i.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1);
}

function makeSilentWavBlob(): Blob {
  const sampleRate = 8000;
  const sampleCount = 320;
  const buffer = new ArrayBuffer(44 + sampleCount);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      bytes[offset + index] = text.charCodeAt(index);
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + sampleCount, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeAscii(36, "data");
  view.setUint32(40, sampleCount, true);
  bytes.fill(128, 44);
  return new Blob([buffer], { type: "audio/wav" });
}

export class AudioSessionController {
  private audio: HTMLAudioElement | null = null;
  private iosAudio: HTMLAudioElement | null = null;
  private iosAudioPrimed = false;
  private objectUrl: string | null = null;
  private unlocked = false;
  private serial = 0;
  private readonly listeners = new Set<(state: AudioSessionState, level: number) => void>();
  private state: AudioSessionState = "locked";
  private analyser: AnalyserNode | null = null;
  private audioContext: AudioContext | null = null;
  private frame: number | null = null;
  private smoothedLevel = 0;
  private readonly latencySamples: number[] = [];
  private readonly appleMobileWebKit = isAppleMobileWebKit();

  subscribe(listener: (state: AudioSessionState, level: number) => void) {
    this.listeners.add(listener);
    listener(this.state, 0);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(state: AudioSessionState, level = 0) {
    this.state = state;
    for (const listener of this.listeners) listener(state, level);
  }

  isUnlocked(): boolean {
    return this.unlocked;
  }

  async unlock(): Promise<boolean> {
    // 呼び出し側は音声ON/再生/送信などuser gesture内で呼ぶ。
    this.unlocked = true;

    // iOS Safariは、user gestureから数秒後に生成した新しいaudio要素のplay()が
    // 拒否されたり、MediaElementAudioSourceNode経由で無音になることがある。
    // gesture中に再利用するaudio要素を一度だけ無音再生して権限を確立し、
    // iOSではWeb Audio graphへ接続せずHTMLMediaElementの直接出力を維持する。
    if (this.appleMobileWebKit) {
      this.iosAudio ??= new Audio();
      this.iosAudio.preload = "auto";
      if (!this.iosAudioPrimed) {
        const silentUrl = URL.createObjectURL(makeSilentWavBlob());
        const audio = this.iosAudio;
        audio.src = silentUrl;
        audio.volume = 0;
        try {
          const prime = audio.play();
          await prime;
          this.iosAudioPrimed = true;
        } catch {
          // 実音声のmanual playで再試行できるためunlock自体は失敗扱いにしない。
        } finally {
          audio.pause();
          audio.currentTime = 0;
          audio.volume = 1;
          URL.revokeObjectURL(silentUrl);
        }
      }
      this.emit("idle");
      return true;
    }

    if (typeof AudioContext !== "undefined") {
      this.audioContext ??= new AudioContext();
      await this.audioContext.resume().catch(() => undefined);
    }
    this.emit("idle");
    return true;
  }

  beginLoading() {
    this.stopPlaybackOnly();
    this.emit(this.unlocked ? "loading" : "locked");
  }

  async play(key: string, blob: Blob, options: PlayOptions = {}): Promise<boolean> {
    if (!this.unlocked) {
      this.emit("locked");
      return false;
    }

    this.stopPlaybackOnly();
    const token = this.serial;
    const delayMs = Math.max(0, Math.min(800, Math.round(options.delayMs ?? 0)));
    if (delayMs > 0) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
      if (token !== this.serial) return false;
    }

    if (token !== this.serial) return false;
    this.objectUrl = URL.createObjectURL(blob);
    const audio = this.appleMobileWebKit
      ? (this.iosAudio ??= new Audio())
      : new Audio();
    audio.dataset.sessionKey = key;
    audio.preload = "auto";
    audio.volume = 1;
    audio.src = this.objectUrl;
    this.audio = audio;

    let latencyRecorded = false;
    audio.onplaying = () => {
      if (this.audio !== audio || token !== this.serial) return;
      this.emit("playing");
      if (!this.appleMobileWebKit) this.startMeter(audio);
      if (!latencyRecorded && typeof options.requestStartedAt === "number") {
        latencyRecorded = true;
        this.recordLatency(performance.now() - options.requestStartedAt);
      }
    };
    audio.onpause = () => {
      if (this.audio === audio && token === this.serial && !audio.ended) this.emit("paused");
    };
    audio.onended = () => {
      if (this.audio !== audio || token !== this.serial) return;
      this.stopMeter();
      this.releaseAudio(audio);
      this.emit("idle");
    };
    audio.onerror = () => {
      if (this.audio !== audio || token !== this.serial) return;
      this.stopMeter();
      this.releaseAudio(audio);
      this.emit("error");
    };

    try {
      await audio.play();
      return token === this.serial && this.audio === audio;
    } catch {
      if (this.audio === audio && token === this.serial) {
        this.stopMeter();
        this.releaseAudio(audio);
        this.emit("error");
      }
      return false;
    }
  }

  pause() {
    this.audio?.pause();
  }

  stop() {
    this.serial += 1;
    this.stopPlaybackOnly();
    this.emit(this.unlocked ? "idle" : "locked");
  }

  interrupt() {
    this.serial += 1;
    this.stopPlaybackOnly();
    this.emit("interrupted");
  }

  dispose() {
    this.serial += 1;
    this.stopPlaybackOnly();
    if (this.iosAudio) {
      this.iosAudio.pause();
      this.iosAudio.removeAttribute("src");
      this.iosAudio = null;
    }
    this.listeners.clear();
    this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
  }

  latencyStats(): AudioLatencyStats {
    return {
      samples: [...this.latencySamples],
      p50: percentile(this.latencySamples, 0.5),
      p95: percentile(this.latencySamples, 0.95),
    };
  }

  private stopPlaybackOnly() {
    this.stopMeter();
    if (this.audio) {
      const audio = this.audio;
      this.audio = null;
      audio.pause();
      if (audio === this.iosAudio) audio.removeAttribute("src");
      else audio.src = "";
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  private releaseAudio(audio: HTMLAudioElement) {
    if (this.audio !== audio) return;
    this.audio = null;
    if (audio === this.iosAudio) audio.removeAttribute("src");
    else audio.src = "";
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  private recordLatency(sampleMs: number) {
    if (!Number.isFinite(sampleMs) || sampleMs < 0) return;
    this.latencySamples.push(Math.round(sampleMs));
    if (this.latencySamples.length > 100) this.latencySamples.shift();
    const stats = this.latencyStats();
    console.info(JSON.stringify({
      metric: "tts_first_audio",
      sampleMs: Math.round(sampleMs),
      p50: stats.p50,
      p95: stats.p95,
      samples: stats.samples.length,
    }));
  }

  private startMeter(audio: HTMLAudioElement) {
    if (!this.audioContext || this.audioContext.state !== "running" || this.analyser) return;
    try {
      const source = this.audioContext.createMediaElementSource(audio);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.72;
      source.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);
      const data = new Uint8Array(this.analyser.fftSize);
      const tick = () => {
        if (!this.analyser || this.audio !== audio) return;
        this.analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const value of data) {
          const centered = (value - 128) / 128;
          sum += centered * centered;
        }
        const rms = Math.sqrt(sum / data.length);
        const target = Math.min(1, rms * 5.2);
        this.smoothedLevel += (target - this.smoothedLevel) * 0.35;
        this.emit("playing", this.smoothedLevel);
        this.frame = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // Web Audioが使えなくてもaudio playbackは維持する。lip syncだけ0のまま。
    }
  }

  private stopMeter() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.analyser = null;
    this.smoothedLevel = 0;
  }
}
