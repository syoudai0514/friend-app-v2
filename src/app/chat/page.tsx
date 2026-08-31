"use client";

import { useEffect } from "react";
import {
  installLiveAudioFetchBridge,
  primeLiveVoiceSession,
  setLiveVoiceMode,
} from "@/lib/live-audio-fetch-bridge";
import { installShizukuTsukuyomiBridge } from "@/lib/shizuku-tsukuyomi-bridge";
import {
  isTsukuyomiPersona,
  prepareTsukuyomiVoice,
} from "@/lib/tsukuyomi-local-tts";
import { useStore } from "@/lib/store";
import ChatPageBase from "./chat-page-base";

export default function ChatPage() {
  const { state, ready } = useStore();

  useEffect(() => {
    // Tsukuyomi bridge must be installed after the Live bridge so Shizuku can
    // bypass Gemini audio while every other persona keeps the existing Live path.
    const uninstallLive = installLiveAudioFetchBridge();
    const uninstallTsukuyomi = installShizukuTsukuyomiBridge();
    return () => {
      uninstallTsukuyomi();
      uninstallLive();
    };
  }, []);

  useEffect(() => {
    const voiceEnabled = ready && state.voice.enabled;
    const tsukuyomi = isTsukuyomiPersona(state.persona.id);
    const liveEnabled = voiceEnabled && state.voice.autoplay && !tsukuyomi;

    setLiveVoiceMode(liveEnabled);

    if (voiceEnabled && tsukuyomi) {
      // ManaEvo と同じく初回だけモデルを端末へ取得し、以後は IndexedDB を再利用する。
      // 失敗しても /api/tts の既存フォールバックがあるため文字会話は止めない。
      void prepareTsukuyomiVoice().catch(() => {});
      return;
    }

    if (!liveEnabled) return;
    void primeLiveVoiceSession({
      persona: state.persona,
      userName: state.userName,
      affection: state.affection,
      messages: state.messages,
      memories: state.memories,
    });
  }, [
    ready,
    state.affection,
    state.memories,
    state.messages,
    state.persona,
    state.userName,
    state.voice.autoplay,
    state.voice.enabled,
  ]);

  return <ChatPageBase />;
}
