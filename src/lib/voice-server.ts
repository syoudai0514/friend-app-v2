import type { VoiceStyleId } from "./types";
import {
  VOICE_CASTING,
  approvedFallback,
  type VoiceProfile,
} from "./voice";

const styles: VoiceStyleId[] = ["neutral", "bright", "soft", "shy", "sad", "serious", "excited"];

function setting(name: string, personaId: string): string {
  return process.env[`AIVIS_${name}_${personaId.toUpperCase()}`]?.trim() ?? "";
}

function buildProfile(personaId: string): VoiceProfile {
  const casting = VOICE_CASTING[personaId];
  const voiceId = setting("MODEL_UUID", personaId);
  const licenseUrl = setting("LICENSE_URL", personaId);
  const commercialScope = setting("LICENSE_COMMERCIAL_SCOPE", personaId);
  const otherCharacterUse = setting("LICENSE_OTHER_CHARACTER_USE", personaId);
  const reviewedAt = setting("LICENSE_REVIEWED_AT", personaId);
  const attributionFlag = setting("ATTRIBUTION_REQUIRED", personaId).toLowerCase();
  const attributionKnown = attributionFlag === "true" || attributionFlag === "false";
  const attributionRequired = attributionFlag === "true";
  const attributionText = setting("ATTRIBUTION_TEXT", personaId);
  const styleMap: Partial<Record<VoiceStyleId, string>> = {};
  for (const style of styles) {
    const configured = setting(`STYLE_${style.toUpperCase()}`, personaId);
    if (configured) styleMap[style] = configured;
  }

  const explicitlyApproved = setting("PRODUCTION_APPROVED", personaId).toLowerCase() === "true";
  const licenseComplete = Boolean(
    licenseUrl && commercialScope && otherCharacterUse && reviewedAt && attributionKnown &&
    (!attributionRequired || attributionText),
  );

  return {
    voiceProfileId: setting("VOICE_PROFILE_ID", personaId) || `aivis:${personaId}`,
    provider: "aivis",
    voiceId,
    modelId: voiceId || undefined,
    baseSpeed: casting?.baseSpeed ?? 1,
    basePitch: casting?.basePitch ?? 0,
    styleMap,
    fallbackVoiceProfileId: setting("FALLBACK_VOICE_PROFILE_ID", personaId) || undefined,
    license: {
      url: licenseUrl,
      commercialScope: commercialScope || "未確認",
      otherCharacterUse: otherCharacterUse || "未確認",
      attributionRequired,
      attributionText: attributionText || undefined,
      contentRestrictions: setting("LICENSE_CONTENT_RESTRICTIONS", personaId) || undefined,
      redistributionRestrictions: setting("LICENSE_REDISTRIBUTION_RESTRICTIONS", personaId) || undefined,
      reviewedAt: reviewedAt || "未確認",
    },
    // IDだけ入っていても発話不可。ライセンス項目と明示approvalを全部満たす必要がある。
    productionApproved: explicitlyApproved && Boolean(voiceId) && licenseComplete,
  };
}

export function serverVoiceProfiles(): Record<string, VoiceProfile> {
  return Object.fromEntries(Object.keys(VOICE_CASTING).map((personaId) => [personaId, buildProfile(personaId)]));
}

export function approvedVoiceFor(personaId: string): VoiceProfile | null {
  const profile = serverVoiceProfiles()[personaId];
  return profile?.productionApproved && profile.voiceId ? profile : null;
}

export function approvedFallbackFor(profile: VoiceProfile): VoiceProfile | null {
  return approvedFallback(profile, serverVoiceProfiles());
}

export function publicVoiceStatus() {
  const profiles = serverVoiceProfiles();
  return Object.fromEntries(Object.entries(profiles).map(([personaId, profile]) => [personaId, {
    personaId,
    voiceProfileId: profile.voiceProfileId,
    provider: profile.provider,
    configured: Boolean(profile.voiceId),
    productionApproved: profile.productionApproved,
    license: profile.productionApproved ? profile.license : undefined,
    casting: VOICE_CASTING[personaId],
  }]));
}
