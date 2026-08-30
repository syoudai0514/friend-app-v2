"use client";

import { useEffect } from "react";
import { installLiveAudioFetchBridge } from "@/lib/live-audio-fetch-bridge";
import ChatPageBase from "./chat-page-base";

export default function ChatPage() {
  useEffect(() => installLiveAudioFetchBridge(), []);
  return <ChatPageBase />;
}
