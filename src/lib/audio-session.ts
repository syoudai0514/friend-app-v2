"use client";

export type AudioSessionState = "locked" | "idle" | "loading" | "playing" | "paused" | "interrupted" | "error";

export class AudioSessionController {
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private unlocked = false;
  private currentKey: string | null = null;
  private readonly listeners = new Set<(state: AudioSessionState, level: number) => void>();
  private state: AudioSessionState = "locked";
  private analyser: AnalyserNode | null = null;
  private audioContext: AudioContext | null = null;
  private frame: number | null = null;

  subscribe(listener: (state: AudioSessionState, level: number) => void) {
    this.listeners.add(listener);
    listener(this.state, 0);
    return () => { this.listeners.delete(listener); };
  }

  private emit(state: AudioSessionState, level = 0) {
    this.state = state;
    for (const listener of this.listeners) listener(state, level);
  }

  async unlock() {
    this.unlocked = true;
    // iOSではユーザーgesture内にresumeを呼べない場合があるため、失敗しても手動再生を妨げない。
    if (typeof AudioContext !== "undefined") {
      this.audioContext ??= new AudioContext();
      await this.audioContext.resume().catch(() => undefined);
    }
    this.emit("idle");
  }

  async play(key: string, blob: Blob): Promise<void> {
    if (!this.unlocked) await this.unlock();
    this.stop();
    this.currentKey = key;
    this.objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(this.objectUrl);
    this.audio = audio;
    audio.preload = "auto";
    audio.onplaying = () => { if (this.audio === audio) { this.emit("playing"); this.startMeter(audio); } };
    audio.onpause = () => { if (this.audio === audio && !audio.ended) this.emit("paused"); };
    audio.onended = () => { if (this.audio === audio) { this.stopMeter(); this.emit("idle"); } };
    audio.onerror = () => { if (this.audio === audio) { this.stopMeter(); this.emit("error"); } };
    try {
      await audio.play();
    } catch {
      if (this.audio === audio) this.emit("error");
    }
  }

  pause() { this.audio?.pause(); }
  stop() {
    this.stopMeter();
    if (this.audio) { this.audio.pause(); this.audio.src = ""; this.audio = null; }
    if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
    this.currentKey = null;
    this.emit(this.unlocked ? "idle" : "locked");
  }
  interrupt() { this.stop(); this.emit("interrupted"); }
  dispose() { this.stop(); this.listeners.clear(); this.audioContext?.close().catch(() => undefined); }

  private startMeter(audio: HTMLAudioElement) {
    if (!this.audioContext || this.analyser) return;
    try {
      const source = this.audioContext.createMediaElementSource(audio);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser); this.analyser.connect(this.audioContext.destination);
      const data = new Uint8Array(this.analyser.fftSize);
      const tick = () => {
        if (!this.analyser || this.audio !== audio) return;
        this.analyser.getByteTimeDomainData(data);
        const rms = Math.sqrt(data.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / data.length);
        this.emit("playing", Math.min(1, rms * 5));
        this.frame = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* audio playback is retained when Web Audio cannot be attached */ }
  }
  private stopMeter() { if (this.frame !== null) cancelAnimationFrame(this.frame); this.frame = null; this.analyser = null; }
}
