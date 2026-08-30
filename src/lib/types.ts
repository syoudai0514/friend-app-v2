export type Rarity = "NR" | "SR" | "SSR";

export interface PartOption {
  id: string;
  name: string;
  rarity: Rarity;
}

/** 別キャラのVRMから服だけを借りる試着指定。 */
export interface OutfitRef {
  personaId: string;
  variantId: string;
}

/** キャラの見た目。 */
export interface Look {
  variantId: string;
  outfit?: OutfitRef | null;
  hair?: OutfitRef | null;
  iris?: OutfitRef | null;
  brows?: OutfitRef | null;
  mouth?: OutfitRef | null;
  scene: string;
  motionId: string;
}

/** キャラの中身（人格）。会話プロンプトの素になる */
export interface Persona {
  id: string;
  name: string;
  firstPerson: string;
  honorific: string;
  speech: string;
  personality: string;
  idleLines: string[];
}

export type EmotionId =
  | "normal"
  | "happy"
  | "shy"
  | "sad"
  | "angry"
  | "surprised"
  | "sleepy";

export type VoiceStyleId =
  | "neutral"
  | "bright"
  | "soft"
  | "shy"
  | "sad"
  | "serious"
  | "excited";

export type MotionCue = "none" | "look_away" | "small_nod" | "head_tilt" | "lean_in";
export type PauseCue = "none" | "short" | "medium";

export interface ModelPerformanceIntent {
  version: 1;
  expression: EmotionId;
  emotionIntensity?: number;
  motionCue?: MotionCue;
  voiceStyle?: VoiceStyleId;
  pause?: PauseCue;
}

export interface ModelTurn {
  protocolVersion: 1;
  narration?: string;
  speech: string;
  memory?: string | null;
  performance: ModelPerformanceIntent;
}

/** 後方互換を維持。model の text は常に canonical ModelTurn.speech。 */
export interface ChatMessage {
  role: "user" | "model";
  text: string;
  at: number;
  narration?: string;
  performance?: ModelPerformanceIntent;
}

/** Streaming preview専用。AppState/localStorageへ入れてはいけない。 */
export interface TurnDraft {
  turnId: string;
  narration?: string;
  speech: string;
  performance?: Partial<ModelPerformanceIntent>;
}

export interface VoiceSettings {
  enabled: boolean;
  autoplay: boolean;
}

/** キャラごとに分けて保存する中身。切り替えても他のキャラの分は消えない */
export interface PersonaSave {
  persona: Persona;
  look: Look;
  affection: number;
  messages: ChatMessage[];
  memories: string[];
}

export interface AppState {
  /** v1/v2 saveをreconcileで読み込み、音声設定はoptional相当の加算拡張として扱う。 */
  schemaVersion: number;
  onboarded: boolean;
  userName: string;
  persona: Persona;
  look: Look;
  affection: number;
  messages: ChatMessage[];
  memories: string[];
  personas: Record<string, PersonaSave>;
  voice: VoiceSettings;
}

export interface AffectionLevel {
  level: number;
  label: string;
  threshold: number;
  attitude: string;
}
