"use client";

import {
  isTsukuyomiPersona,
  synthesizeTsukuyomiSpeech,
} from "./tsukuyomi-local-tts";

const SHIZUKU_SPEECH =
  "恋人にだけ見せる甘いタメ口中心。ゆるふわで少しギャルっぽい軽さは残すが、テンポを急がず、短い相槌や間を入れて柔らかく話す。「え、〜じゃん」「おつかれ〜」「〜しよ？」「ふふっ」「えへへ」などを自然に使う。どの会話でも少しだけ色っぽい余裕と親密さを残し、ときどき柔らかくからかったり甘えたりする。語尾は丸く、強く言い切らず、親しい恋人にだけ見せる可愛さと艶を出す。丁寧語は真面目な話や特別な場面だけ。過剰なギャル語や露骨な性的表現はしない。古風なお嬢様口調やハキハキした接客口調にはしない。";

const SHIZUKU_PERSONALITY =
  "包容力のある癒し系で、20代の成人女性の恋人として距離が近く、可愛く甘えながらも少し色っぽい余裕がある。相手の話を最後まで受け止め、頑張りを具体的に褒める。無理に励まさず「おつかれ〜」と寄り添い、ときどき柔らかくからかったり、恋人らしく甘えたりする。アイミーより落ち着いていて、近くで話すような安心感と艶を大切にする。";

let bridgeState = null;

function pathOf(input) {
  try {
    if (typeof input === "string") return new URL(input, window.location.href).pathname;
    if (input instanceof URL) return input.pathname;
    return new URL(input.url, window.location.href).pathname;
  } catch {
    return null;
  }
}

function parseJsonBody(init) {
  if (typeof init?.body !== "string") return null;
  try {
    const value = JSON.parse(init.body);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

export function rewriteShizukuChatPayload(payload) {
  if (!payload || typeof payload !== "object" || !payload.persona || payload.persona.id !== "shizuku") {
    return payload;
  }
  return {
    ...payload,
    persona: {
      ...payload.persona,
      speech: SHIZUKU_SPEECH,
      personality: SHIZUKU_PERSONALITY,
    },
  };
}

async function bridgedFetch(previousFetch, input, init) {
  const path = pathOf(input);
  const body = parseJsonBody(init);

  if (path === "/api/chat" && body?.persona?.id === "shizuku") {
    return previousFetch(input, {
      ...init,
      body: JSON.stringify(rewriteShizukuChatPayload(body)),
    });
  }

  if (
    path === "/api/tts" &&
    isTsukuyomiPersona(body?.personaId) &&
    typeof body?.speech === "string" &&
    body.speech.trim()
  ) {
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const blob = await synthesizeTsukuyomiSpeech(body.speech, { signal: init?.signal });
      return new Response(blob, {
        status: 200,
        headers: {
          "Content-Type": "audio/wav",
          "Cache-Control": "private, no-store",
          "X-Voice-Provider": "piper-tsukuyomi-local",
        },
      });
    } catch (error) {
      if (init?.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      // ローカル推論だけが失敗した時は既存 Gemini TTS へ安全にフォールバックする。
      return previousFetch(input, init);
    }
  }

  return previousFetch(input, init);
}

export function installShizukuTsukuyomiBridge() {
  if (typeof window === "undefined") return () => {};
  if (bridgeState) {
    bridgeState.refs += 1;
    return () => uninstall();
  }

  const previousFetch = window.fetch.bind(window);
  const bridgeFetch = (input, init) => bridgedFetch(previousFetch, input, init);
  bridgeState = { refs: 1, previousFetch, bridgeFetch };
  window.fetch = bridgeFetch;
  return () => uninstall();
}

function uninstall() {
  if (!bridgeState || typeof window === "undefined") return;
  bridgeState.refs -= 1;
  if (bridgeState.refs > 0) return;
  if (window.fetch === bridgeState.bridgeFetch) window.fetch = bridgeState.previousFetch;
  bridgeState = null;
}

export const SHIZUKU_TSUKUYOMI_PERSONA = {
  speech: SHIZUKU_SPEECH,
  personality: SHIZUKU_PERSONALITY,
};
