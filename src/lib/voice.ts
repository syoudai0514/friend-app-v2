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

/**
 * 実在voice/model IDとライセンスを公式画面で確認するまで発話を許可しない。
 * 推測したIDを置くより、text-onlyに落とす方が声の取り違えとライセンス事故を防げる。
 */
export const VOICE_REGISTRY: Record<string, VoiceProfile> = {
  aimi: unconfigured("aimi"),
  shizuku: unconfigured("shizuku"),
  nagi: unconfigured("nagi"),
  hinata: unconfigured("hinata"),
  rena: unconfigured("rena"),
};

function unconfigured(personaId: string): VoiceProfile {
  return {
    voiceProfileId: `${personaId}:unconfigured`,
    provider: "aivis",
    voiceId: "",
    baseSpeed: 1,
    basePitch: 0,
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

export function voiceProfileFor(personaId: string): VoiceProfile | null {
  const profile = VOICE_REGISTRY[personaId];
  return profile?.productionApproved && profile.voiceId ? profile : null;
}

/** 表示文を変更せず、TTS入力だけを安全に読みやすくする。 */
export function ttsTextNormalizer(speech: string): string {
  return speech
    .replace(/https?:\/\/[^\s]+/g, "リンク")
    .replace(/[😀-🙏🌀-🫶]/gu, "")
    .replace(/[★☆♪♫♥♡]/g, "")
    .replace(/([!！?？。…])\1{1,}/g, "$1")
    .replace(/[「」『』]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([!！?？。…])/g, "$1")
    .trim();
}

export interface TtsRequestBody {
  personaId: string;
  speech: string;
  style?: VoiceStyleId;
  emotionIntensity?: number;
}

export function validTtsRequest(value: unknown): TtsRequestBody | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.personaId !== "string" || typeof raw.speech !== "string") return null;
  const speech = raw.speech.trim();
  if (!speech || speech.length > 360) return null;
  return {
    personaId: raw.personaId,
    speech,
    ...(typeof raw.style === "string" ? { style: raw.style as VoiceStyleId } : {}),
    ...(typeof raw.emotionIntensity === "number" ? { emotionIntensity: Math.max(0, Math.min(1, raw.emotionIntensity)) } : {}),
  };
}
