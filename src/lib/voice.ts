import type { VoiceStyleId } from "./types";

export type VoiceProviderId = "aivis" | "coeiroink" | "elevenlabs";

export interface VoiceProfile {
  voiceProfileId: string;
  provider: VoiceProviderId;
  voiceId: string;
  modelId?: string;
  modelVersion?: string;
  baseSpeed: number;
  basePitch: number;
  styleMap: Partial<Record<VoiceStyleId, string>>;
  fallbackVoiceProfileId?: string;
  license: {
    url: string;
    commercialScope: string;
    otherCharacterUse: string;
    attributionRequired: boolean;
    attributionText?: string;
    contentRestrictions?: string;
    redistributionRestrictions?: string;
    reviewedAt: string;
  };
  productionApproved: boolean;
}

export interface VoiceCastingDirection {
  personaId: string;
  direction: string;
  dailyListening: string;
  baseSpeed: number;
  basePitch: number;
}

/** CURRENT personaの性格から決めた声の方向性。実在voice IDはここでは決めない。 */
export const VOICE_CASTING: Record<string, VoiceCastingDirection> = {
  aimi: {
    personaId: "aimi",
    direction: "明るく親しみやすい若い声。テンションは高めでも甲高すぎず、照れ・落ち込みでも同一人物に聞こえること。",
    dailyListening: "長時間でも疲れにくい中高域。語尾の勢いを出しすぎない。",
    baseSpeed: 1.06,
    basePitch: 0,
  },
  shizuku: {
    personaId: "shizuku",
    direction: "柔らかく落ち着いた透明感のある声。丁寧で少しゆっくり、近距離で安心感があること。",
    dailyListening: "息成分を強くしすぎず、静かな音量でも言葉が明瞭。",
    baseSpeed: 0.93,
    basePitch: 0,
  },
  nagi: {
    personaId: "nagi",
    direction: "クールで短い言葉が映える低め寄りの声。冷たすぎず、照れたときの温度差が自然に出ること。",
    dailyListening: "低域を重くしすぎず、無表情でも聞き疲れしない。",
    baseSpeed: 0.98,
    basePitch: 0,
  },
  hinata: {
    personaId: "hinata",
    direction: "元気で反応が速い後輩らしい声。明るいが子どもっぽくなりすぎず、日常会話の自然さを優先。",
    dailyListening: "速度感は出すが常時ハイテンションにはしない。",
    baseSpeed: 1.1,
    basePitch: 0,
  },
  rena: {
    personaId: "rena",
    direction: "大人っぽく余裕のある落ち着いた声。からかいと優しさを同じ声質のまま表現できること。",
    dailyListening: "低めでもこもらず、長文を聞いても圧迫感がない。",
    baseSpeed: 0.95,
    basePitch: 0,
  },
};

function unconfigured(personaId: string): VoiceProfile {
  const casting = VOICE_CASTING[personaId] ?? { baseSpeed: 1, basePitch: 0 };
  return {
    voiceProfileId: `${personaId}:unconfigured`,
    provider: "aivis",
    voiceId: "",
    baseSpeed: casting.baseSpeed,
    basePitch: casting.basePitch,
    styleMap: {},
    license: {
      url: "",
      commercialScope: "未確認",
      otherCharacterUse: "未確認",
      attributionRequired: false,
      reviewedAt: "未確認",
    },
    productionApproved: false,
  };
}

/** client-safe registry。serverの環境設定で承認されたprofileは voice-server.ts が構築する。 */
export const VOICE_REGISTRY: Record<string, VoiceProfile> = Object.fromEntries(
  Object.keys(VOICE_CASTING).map((personaId) => [personaId, unconfigured(personaId)]),
);

/** 表示speechを変更せず、TTS入力だけを安全に読みやすくする。 */
export function ttsTextNormalizer(speech: string): string {
  return speech
    .normalize("NFKC")
    .replace(/https?:\/\/[^\s]+/giu, "リンク")
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "")
    .replace(/[★☆♪♫♥♡]/g, "")
    .replace(/([!！?？。…])\1{1,}/g, "$1")
    .replace(/[「」『』]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([!！?？。…])/g, "$1")
    .trim();
}

const VOICE_STYLES: VoiceStyleId[] = ["neutral", "bright", "soft", "shy", "sad", "serious", "excited"];
const TTS_KEYS = new Set(["personaId", "speech", "style", "emotionIntensity"]);

export interface TtsRequestBody {
  personaId: string;
  speech: string;
  style?: VoiceStyleId;
  emotionIntensity?: number;
}

/** privacy boundary: narration/user text/history等の余分なfieldを含むrequestは丸ごと拒否する。 */
export function validTtsRequest(value: unknown): TtsRequestBody | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !TTS_KEYS.has(key))) return null;
  if (typeof raw.personaId !== "string" || !VOICE_CASTING[raw.personaId] || typeof raw.speech !== "string") return null;
  const speech = raw.speech.trim();
  if (!speech || speech.length > 360) return null;
  if (raw.style !== undefined && (typeof raw.style !== "string" || !VOICE_STYLES.includes(raw.style as VoiceStyleId))) return null;
  if (
    raw.emotionIntensity !== undefined &&
    (typeof raw.emotionIntensity !== "number" || !Number.isFinite(raw.emotionIntensity) || raw.emotionIntensity < 0 || raw.emotionIntensity > 1)
  ) return null;
  return {
    personaId: raw.personaId,
    speech,
    ...(raw.style ? { style: raw.style as VoiceStyleId } : {}),
    ...(typeof raw.emotionIntensity === "number" ? { emotionIntensity: raw.emotionIntensity } : {}),
  };
}

export function approvedFallback(
  primary: VoiceProfile,
  profiles: Record<string, VoiceProfile>,
): VoiceProfile | null {
  if (!primary.fallbackVoiceProfileId) return null;
  const profile = Object.values(profiles).find((candidate) => candidate.voiceProfileId === primary.fallbackVoiceProfileId);
  return profile?.productionApproved && profile.voiceId ? profile : null;
}
