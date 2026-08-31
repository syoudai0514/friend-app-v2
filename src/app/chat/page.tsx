"use client";

import { useEffect } from "react";
import {
  installLiveAudioFetchBridge,
  primeLiveVoiceSession,
  setLiveVoiceMode,
} from "@/lib/live-audio-fetch-bridge";
import { useStore } from "@/lib/store";
import ChatPageBase from "./chat-page-base";

export default function ChatPage() {
  const { state, ready } = useStore();

  useEffect(() => installLiveAudioFetchBridge(), []);

  useEffect(() => {
    const enabled = ready && state.voice.enabled && state.voice.autoplay;
    setLiveVoiceMode(enabled);
    if (!enabled) return;
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
