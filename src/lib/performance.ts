import type { ModelPerformanceIntent } from "./types";

export interface RuntimePerformance {
  expression: ModelPerformanceIntent["expression"];
  intensity: number;
  motionCue: NonNullable<ModelPerformanceIntent["motionCue"]>;
  pauseMs: number;
  // semantic overlayだけをここで解決し、VRM外へbone値を漏らさない。
  head: [number, number, number];
  eyes: [number, number, number];
}

export function performanceRuntime(intent?: Partial<ModelPerformanceIntent>): RuntimePerformance {
  const intensity = Math.max(0, Math.min(1, intent?.emotionIntensity ?? 0.65));
  const motionCue = intent?.motionCue ?? "none";
  const base = intent?.expression === "shy" ? { head: [-9, 3.5, -1.5] as [number, number, number], eyes: [-7, -3, 0] as [number, number, number] } : { head: [0, 0, 0] as [number, number, number], eyes: [0, 0, 0] as [number, number, number] };
  const cue = motionCue === "look_away" ? { head: [0, 10, 0], eyes: [0, 7, 0] }
    : motionCue === "small_nod" ? { head: [-5, 0, 0], eyes: [0, 0, 0] }
    : motionCue === "head_tilt" ? { head: [0, 0, -8], eyes: [0, 0, 0] }
    : { head: [0, 0, 0], eyes: [0, 0, 0] };
  const sum = (a: [number, number, number], b: number[]) => [a[0] + b[0] * intensity, a[1] + b[1] * intensity, a[2] + b[2] * intensity] as [number, number, number];
  return {
    expression: intent?.expression ?? "normal", intensity, motionCue,
    pauseMs: intent?.pause === "medium" ? 480 : intent?.pause === "short" ? 200 : 0,
    head: sum(base.head, cue.head), eyes: sum(base.eyes, cue.eyes),
  };
}
