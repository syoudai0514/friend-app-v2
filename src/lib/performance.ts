import type { ModelPerformanceIntent } from "./types";

export interface RuntimePerformance {
  expression: ModelPerformanceIntent["expression"];
  intensity: number;
  motionCue: NonNullable<ModelPerformanceIntent["motionCue"]>;
  pauseMs: number;
  /** semantic overlayだけをここで解決し、VRM外へbone値を漏らさない。degree値もruntime内部専用。 */
  head: [number, number, number];
  eyes: [number, number, number];
}

function scale(vector: [number, number, number], intensity: number): [number, number, number] {
  return [vector[0] * intensity, vector[1] * intensity, vector[2] * intensity];
}

function add(
  left: [number, number, number],
  right: [number, number, number],
): [number, number, number] {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

/** small_nodは約0.6秒で一度だけ下げて戻す。LLMには時間や角度を決めさせない。 */
function nodPitch(elapsedSeconds: number): number {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0 || elapsedSeconds >= 0.6) return 0;
  return -5.5 * Math.sin(Math.PI * (elapsedSeconds / 0.6));
}

export function performanceRuntime(
  intent?: Partial<ModelPerformanceIntent>,
  cueElapsedSeconds = 0,
): RuntimePerformance {
  // intensity未指定はCURRENT表情強度を維持するため1。指定値だけ0..1にclampする。
  const intensity = Math.max(0, Math.min(1, intent?.emotionIntensity ?? 1));
  const motionCue = intent?.motionCue ?? "none";

  const shyHead: [number, number, number] = intent?.expression === "shy"
    ? [-9, 3.5, -1.5]
    : [0, 0, 0];
  const shyEyes: [number, number, number] = intent?.expression === "shy"
    ? [-7, -3, 0]
    : [0, 0, 0];

  let cueHead: [number, number, number] = [0, 0, 0];
  let cueEyes: [number, number, number] = [0, 0, 0];
  if (motionCue === "look_away") {
    cueHead = [0, 10, 0];
    cueEyes = [0, 7, 0];
  } else if (motionCue === "small_nod") {
    cueHead = [nodPitch(cueElapsedSeconds), 0, 0];
  } else if (motionCue === "head_tilt") {
    cueHead = [0, 0, -8];
  }
  // lean_inはPhase 6では安全側のno-op。torso/camera所有権を増やさない。

  return {
    expression: intent?.expression ?? "normal",
    intensity,
    motionCue,
    pauseMs: intent?.pause === "medium" ? 480 : intent?.pause === "short" ? 200 : 0,
    head: add(scale(shyHead, intensity), scale(cueHead, intensity)),
    eyes: add(scale(shyEyes, intensity), scale(cueEyes, intensity)),
  };
}
