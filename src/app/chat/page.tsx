"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AffectionGauge, BackButton, Dots, Stage } from "@/components/ui";
import { AudioSessionController, type AudioSessionState } from "@/lib/audio-session";
import { parseDialogueEvent } from "@/lib/dialogue";
import { enhanceExpression, type Expression } from "@/lib/expressions";
import { PENDING_KEY } from "@/app/page";
import { idleLine } from "@/lib/prompt";
import { useSpeechInput } from "@/lib/speech";
import { useStore } from "@/lib/store";
import type { ChatMessage, ModelTurn, TurnDraft } from "@/lib/types";

function newTurnId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `turn_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function messageKey(message: ChatMessage, index: number): string {
  return message.turnId ?? `${message.at}:${index}`;
}

export default function ChatPage() {
  const { state, ready, addMessage, commitModelTurn, clearMessages } = useStore();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [turnDraft, setTurnDraft] = useState<TurnDraft | null>(null);
  const [audioState, setAudioState] = useState<AudioSessionState>("locked");
  const [lipSync, setLipSync] = useState(0);
  const [audioError, setAudioError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const pendingDone = useRef(false);
  const activeTurnId = useRef<string | null>(null);
  const abortController = useRef<AbortController | null>(null);
  const committedTurns = useRef(new Set<string>());
  const personaId = useRef(state.persona.id);
  const audio = useRef<AudioSessionController | null>(null);
  const audioCache = useRef(new Map<string, Blob>());

  if (!audio.current && typeof window !== "undefined") audio.current = new AudioSessionController();

  const invalidateActiveTurn = useCallback(() => {
    abortController.current?.abort();
    abortController.current = null;
    activeTurnId.current = null;
    setTurnDraft(null);
    setBusy(false);
    audio.current?.stop();
  }, []);

  useEffect(() => {
    const session = audio.current;
    if (!session) return;
    return session.subscribe((next, level) => { setAudioState(next); setLipSync(next === "playing" ? level : 0); });
  }, []);

  useEffect(() => {
    const stopForLifecycle = () => { if (document.visibilityState !== "visible") audio.current?.interrupt(); };
    const stop = () => audio.current?.interrupt();
    document.addEventListener("visibilitychange", stopForLifecycle);
    window.addEventListener("pagehide", stop);
    window.addEventListener("pageshow", stop); // foregroundで勝手に途中再開しない
    return () => {
      document.removeEventListener("visibilitychange", stopForLifecycle);
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("pageshow", stop);
    };
  }, []);

  // persona切替またはroute unmount時は、旧turn/audioを無効化する。
  useEffect(() => {
    if (personaId.current !== state.persona.id) {
      personaId.current = state.persona.id;
      invalidateActiveTurn();
    }
  }, [state.persona.id, invalidateActiveTurn]);
  useEffect(() => () => { invalidateActiveTurn(); audio.current?.dispose(); }, [invalidateActiveTurn]);

  const onSpeechResult = useCallback((text: string) => setInput((prev) => (prev ? `${prev}${text}` : text)), []);
  const { supported: micSupported, listening, toggle: toggleMic } = useSpeechInput(onSpeechResult);
  const greeting = state.messages.length === 0 ? idleLine(state.persona, state.userName, state.affection) : null;

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [state.messages, turnDraft]);

  const playMessage = useCallback(async (message: ChatMessage, index: number) => {
    if (!state.voice.enabled || message.role !== "model" || !message.text.trim()) return;
    setAudioError("");
    await audio.current?.unlock();
    const key = messageKey(message, index);
    let blob = audioCache.current.get(key);
    const started = performance.now();
    if (!blob) {
      const response = await fetch("/api/tts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        // speechだけを送る。narration/performance以外の会話データは渡さない。
        body: JSON.stringify({ personaId: state.persona.id, speech: message.text, style: message.performance?.voiceStyle, emotionIntensity: message.performance?.emotionIntensity }),
      }).catch(() => null);
      if (!response?.ok) { setAudioError("このキャラクターの音声はまだ設定されていません"); return; }
      blob = await response.blob();
      if (!blob.size) { setAudioError("音声を再生できませんでした"); return; }
      audioCache.current.set(key, blob);
    }
    await audio.current?.play(key, blob);
    // first audioの実測は再生開始イベントを持つprovider設定後に計測する。本文は記録しない。
    void started;
  }, [state.persona.id, state.voice.enabled]);

  const commitTurn = useCallback((turnId: string, turn: ModelTurn) => {
    if (activeTurnId.current !== turnId || personaId.current !== state.persona.id || committedTurns.current.has(turnId)) return;
    committedTurns.current.add(turnId);
    commitModelTurn(turnId, turn);
    setTurnDraft(null);
    activeTurnId.current = null;
    setBusy(false);
    if (state.voice.enabled && state.voice.autoplay) {
      // transaction成立後のみautoplay eligible。draft/speech_deltaからは開始しない。
      const message: ChatMessage = { role: "model", text: turn.speech, at: Date.now(), narration: turn.narration, performance: turn.performance, turnId };
      void playMessage(message, state.messages.length);
    }
  }, [commitModelTurn, playMessage, state.messages.length, state.persona.id, state.voice.autoplay, state.voice.enabled]);

  const sendText = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    // 送信タップもiOSでは自然なuser gesture。autoplayを選んだ場合だけここでunlockする。
    if (state.voice.enabled && state.voice.autoplay) void audio.current?.unlock();
    invalidateActiveTurn();
    const turnId = newTurnId();
    const controller = new AbortController();
    activeTurnId.current = turnId;
    abortController.current = controller;
    const userMsg: ChatMessage = { role: "user", text, at: Date.now() };
    const history = [...state.messages, userMsg];
    addMessage(userMsg); // user inputは即時保存してよい。model draftは絶対に保存しない。
    setInput(""); setAudioError(""); setBusy(true); setTurnDraft({ turnId, speech: "" });
    try {
      const response = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ turnId, messages: history, persona: state.persona, userName: state.userName, affection: state.affection, look: state.look, memories: state.memories }),
      });
      if (!response.body) throw new Error("missing body");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          let event: ReturnType<typeof parseDialogueEvent> = null;
          try { event = parseDialogueEvent(JSON.parse(line)); } catch { continue; }
          if (!event || event.turnId !== activeTurnId.current) continue; // stale event discard
          if (event.type === "performance_preview") setTurnDraft((d) => d?.turnId === turnId ? { ...d, performance: event.performance } : d);
          if (event.type === "narration_preview") setTurnDraft((d) => d?.turnId === turnId ? { ...d, narration: event.narration } : d);
          if (event.type === "speech_delta") setTurnDraft((d) => d?.turnId === turnId ? { ...d, speech: `${d.speech}${event.text}` } : d);
          if (event.type === "turn_error") { setAudioError(event.message); invalidateActiveTurn(); }
          if (event.type === "turn_complete") commitTurn(turnId, event.turn);
        }
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError") && activeTurnId.current === turnId) {
        setAudioError("（通信がうまくいかなかったみたい。電波を確認してね）");
        invalidateActiveTurn();
      }
    }
  }, [addMessage, commitTurn, invalidateActiveTurn, state.affection, state.look, state.memories, state.messages, state.persona, state.userName, state.voice.autoplay, state.voice.enabled]);

  useEffect(() => {
    if (!ready || pendingDone.current) return;
    pendingDone.current = true;
    const pending = sessionStorage.getItem(PENDING_KEY); sessionStorage.removeItem(PENDING_KEY);
    if (pending) { const timer = window.setTimeout(() => void sendText(pending), 0); return () => clearTimeout(timer); }
  }, [ready, sendText]);

  if (!ready) return <div className="flex-1 bg-[#12121a]" />;
  const draftExpression: Expression = turnDraft?.performance?.expression ?? "normal";
  const stageExpression = greeting ? enhanceExpression(draftExpression, greeting) : draftExpression;
  const isPlaying = audioState === "playing";

  return <Stage look={state.look} personaId={state.persona.id} dim={0.12} lift={56} expression={stageExpression} talking={isPlaying} lipSync={lipSync} performance={turnDraft?.performance}>
    <div className="safe-top absolute inset-x-0 top-0 z-10 flex items-start justify-between px-3 pb-3">
      <div className="flex items-center gap-2"><BackButton /><AffectionGauge affection={state.affection} /></div>
      <button onClick={() => { if (confirm("会話の履歴を消しますか？（好感度は残ります）")) clearMessages(); }} className="grid h-11 w-11 place-items-center rounded-full bg-white/85 text-[15px] text-[#5c5c6b] shadow-[0_2px_8px_rgba(0,0,0,.28)] active:scale-90" aria-label="履歴を消す">🗑</button>
    </div>
    <div ref={listRef} className="safe-chat-log no-scrollbar absolute inset-x-0 bottom-[76px] z-10 flex flex-col overflow-y-auto px-3 pb-2"><div className="mt-auto space-y-2.5">
      {state.messages.length === 0 && greeting && <div className="flex flex-col items-start"><span className="name-tag mb-1">{state.persona.name}</span><div className="bubble chat-bubble animate-rise max-w-[86%]">{greeting}</div></div>}
      {state.messages.map((m, i) => m.role === "user" ? <div key={messageKey(m, i)} className="flex justify-end"><div className="chat-bubble-user max-w-[80%] rounded-[18px] rounded-br-[6px] px-4 py-2.5 text-[15px] leading-[1.6] text-white shadow-[0_3px_10px_rgba(0,0,0,.22)]">{m.text}</div></div> : <ModelMessage key={messageKey(m, i)} message={m} index={i} name={state.persona.name} voiceEnabled={state.voice.enabled} playing={isPlaying} onPlay={playMessage} />)}
      {turnDraft && <DraftMessage draft={turnDraft} name={state.persona.name} />}
    </div></div>
    {audioError && <div role="status" className="absolute inset-x-5 bottom-[80px] z-20 rounded-xl bg-black/70 px-3 py-2 text-center text-[11px] text-white">{audioError}</div>}
    <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 bg-gradient-to-t from-black/45 to-transparent p-3 pt-5">
      <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void sendText(input); }} placeholder={listening ? "聞いてるよ…" : busy ? "考えてる…" : "お話ししよう！"} disabled={busy} className="h-12 flex-1 rounded-full border-2 border-white/70 bg-white/95 px-5 text-[15px] text-[#2b2b33] outline-none placeholder:text-[#a8a8b6] focus:border-pink-cta disabled:opacity-70" />
      {micSupported && <button onClick={toggleMic} disabled={busy} aria-pressed={listening} className={`grid h-12 w-12 shrink-0 place-items-center rounded-full text-[18px] shadow-[0_3px_10px_rgba(0,0,0,.2)] transition active:scale-90 disabled:opacity-45 ${listening ? "animate-pulse bg-pink-cta-deep text-white" : "bg-white/95 text-[#5c5c6b]"}`} aria-label={listening ? "音声で入力を止める" : "音声で入力する"}>🎤</button>}
      <button onClick={() => void sendText(input)} disabled={busy || !input.trim()} className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-b from-[#ff8fb2] to-pink-cta-deep text-[18px] text-white shadow-[0_3px_10px_rgba(240,68,124,.5)] transition active:scale-90 disabled:opacity-45" aria-label="送信">➤</button>
    </div>
  </Stage>;
}

function ModelMessage({ message, index, name, voiceEnabled, playing, onPlay }: { message: ChatMessage; index: number; name: string; voiceEnabled: boolean; playing: boolean; onPlay: (message: ChatMessage, index: number) => Promise<void> }) {
  return <div className="flex flex-col items-start">
    {message.narration && <p className="mb-1 max-w-[86%] pl-1 text-[12px] leading-relaxed text-white/70">{message.narration}</p>}
    <span className="name-tag mb-1">{name}</span>
    <div className="flex items-end gap-1"><div className="bubble chat-bubble max-w-[86%]">{message.text}</div><button disabled={!voiceEnabled} onClick={() => void onPlay(message, index)} className="grid h-8 w-8 place-items-center rounded-full bg-white/80 text-[14px] shadow active:scale-90 disabled:opacity-40" aria-label={voiceEnabled ? (playing ? "音声を再生し直す" : "音声を再生") : "設定でキャラクター音声をオンにする"}>🔊</button></div>
  </div>;
}

function DraftMessage({ draft, name }: { draft: TurnDraft; name: string }) {
  return <div className="flex flex-col items-start" aria-live="polite">
    {draft.narration && <p className="mb-1 max-w-[86%] pl-1 text-[12px] leading-relaxed text-white/70">{draft.narration}</p>}
    <span className="name-tag mb-1">{name}</span><div className="bubble chat-bubble max-w-[86%]">{draft.speech || <span className="text-[#9a9aa8]"><Dots /></span>}</div>
  </div>;
}
