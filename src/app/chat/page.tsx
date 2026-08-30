"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AffectionGauge, BackButton, Dots, Stage } from "@/components/ui";
import { AudioSessionController, type AudioSessionState } from "@/lib/audio-session";
import { parseDialogueEvent } from "@/lib/dialogue";
import { enhanceExpression, type Expression } from "@/lib/expressions";
import { PENDING_KEY } from "@/app/page";
import { performanceRuntime } from "@/lib/performance";
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
  return `${message.at}:${index}`;
}

function audioCacheKey(personaId: string, message: ChatMessage): string {
  return JSON.stringify([
    personaId,
    message.text,
    message.performance?.voiceStyle ?? "neutral",
    message.performance?.emotionIntensity ?? null,
  ]);
}

export default function ChatPage() {
  const {
    state,
    ready,
    commitAck,
    addMessage,
    commitModelTurn,
    clearCommitAck,
    clearMessages,
  } = useStore();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [turnDraft, setTurnDraft] = useState<TurnDraft | null>(null);
  const [audioState, setAudioState] = useState<AudioSessionState>("locked");
  const [lipSync, setLipSync] = useState(0);
  const [audioError, setAudioError] = useState("");
  const [chatError, setChatError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const pendingDone = useRef(false);
  const activeTurnId = useRef<string | null>(null);
  const commitPendingTurnId = useRef<string | null>(null);
  const pendingCanonicalTurns = useRef(new Map<string, ModelTurn>());
  const generationAbort = useRef<AbortController | null>(null);
  const ttsAbort = useRef<AbortController | null>(null);
  const audioRequestSerial = useRef(0);
  const autoplayTurns = useRef(new Set<string>());
  const personaId = useRef(state.persona.id);
  const audio = useRef<AudioSessionController | null>(null);
  const audioCache = useRef(new Map<string, Blob>());

  if (!audio.current && typeof window !== "undefined") {
    audio.current = new AudioSessionController();
  }

  const invalidateAudio = useCallback((interrupted = false) => {
    audioRequestSerial.current += 1;
    ttsAbort.current?.abort();
    ttsAbort.current = null;
    if (interrupted) audio.current?.interrupt();
    else audio.current?.stop();
  }, []);

  const invalidateGeneration = useCallback(() => {
    const invalidatedTurnId = activeTurnId.current;
    generationAbort.current?.abort();
    generationAbort.current = null;
    activeTurnId.current = null;
    if (invalidatedTurnId) pendingCanonicalTurns.current.delete(invalidatedTurnId);
    if (commitPendingTurnId.current === invalidatedTurnId) commitPendingTurnId.current = null;
    setTurnDraft(null);
    setBusy(false);
  }, []);

  const invalidateActiveTurn = useCallback(
    (interrupted = false) => {
      invalidateGeneration();
      invalidateAudio(interrupted);
    },
    [invalidateAudio, invalidateGeneration],
  );

  useEffect(() => {
    const session = audio.current;
    if (!session) return;
    return session.subscribe((next, level) => {
      setAudioState(next);
      setLipSync(next === "playing" ? level : 0);
    });
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") invalidateActiveTurn(true);
    };
    const onPageHide = () => invalidateActiveTurn(true);
    const onPageShow = () => {
      // foreground復帰で旧音声を勝手に再開しない。
      invalidateAudio(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [invalidateActiveTurn, invalidateAudio]);

  // persona切替ではgeneration・draft・TTS request・audioをすべて無効化する。
  useEffect(() => {
    if (personaId.current !== state.persona.id) {
      personaId.current = state.persona.id;
      invalidateActiveTurn(true);
    }
  }, [state.persona.id, invalidateActiveTurn]);

  // route change / unmountも同じ境界で止める。
  useEffect(
    () => () => {
      generationAbort.current?.abort();
      ttsAbort.current?.abort();
      audio.current?.dispose();
    },
    [],
  );

  const onSpeechResult = useCallback((text: string) => {
    setInput((previous) => (previous ? `${previous}${text}` : text));
  }, []);
  const { supported: micSupported, listening, toggle: toggleMic } = useSpeechInput(onSpeechResult);
  const greeting = state.messages.length === 0
    ? idleLine(state.persona, state.userName, state.affection)
    : null;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [state.messages, turnDraft]);

  const playMessage = useCallback(
    async (message: ChatMessage, index: number, mode: "manual" | "autoplay" = "manual") => {
      const session = audio.current;
      if (!session || !state.voice.enabled || message.role !== "model" || !message.text.trim()) return;
      const requestedPersonaId = state.persona.id;
      if (mode === "manual") await session.unlock();
      if (!session.isUnlocked()) return;

      setAudioError("");
      audioRequestSerial.current += 1;
      const serial = audioRequestSerial.current;
      ttsAbort.current?.abort();
      const controller = new AbortController();
      ttsAbort.current = controller;
      session.stop();

      const key = audioCacheKey(requestedPersonaId, message);
      let blob = audioCache.current.get(key);
      let requestStartedAt: number | undefined;

      if (!blob) {
        requestStartedAt = performance.now();
        session.beginLoading();
        let response: Response;
        try {
          response = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            // privacy boundary: canonical model speech + semantic voice intentだけ。
            body: JSON.stringify({
              personaId: requestedPersonaId,
              speech: message.text,
              ...(message.performance?.voiceStyle
                ? { style: message.performance.voiceStyle }
                : {}),
              ...(typeof message.performance?.emotionIntensity === "number"
                ? { emotionIntensity: message.performance.emotionIntensity }
                : {}),
            }),
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          setAudioError("音声サービスに接続できませんでした");
          return;
        }

        if (
          serial !== audioRequestSerial.current ||
          personaId.current !== requestedPersonaId ||
          controller.signal.aborted
        ) {
          return;
        }
        if (!response.ok) {
          setAudioError(
            response.status === 409
              ? "このキャラクターの音声はまだ設定・承認されていません"
              : "音声を生成できませんでした。文字会話はそのまま使えます",
          );
          session.stop();
          return;
        }
        blob = await response.blob();
        if (
          !blob.size ||
          serial !== audioRequestSerial.current ||
          personaId.current !== requestedPersonaId
        ) {
          session.stop();
          return;
        }
        audioCache.current.set(key, blob);
      }

      if (
        serial !== audioRequestSerial.current ||
        personaId.current !== requestedPersonaId ||
        controller.signal.aborted
      ) {
        return;
      }

      const pauseMs = performanceRuntime(message.performance).pauseMs;
      session.beginLoading();
      const played = await session.play(`${key}:${index}`, blob, {
        delayMs: pauseMs,
        requestStartedAt,
      });
      if (!played && serial === audioRequestSerial.current && mode === "manual") {
        setAudioError("音声を再生できませんでした。もう一度🔊を押してください");
      }
    },
    [state.persona.id, state.voice.enabled],
  );

  const commitTurn = useCallback(
    (turnId: string, turn: ModelTurn) => {
      const expectedPersonaId = personaId.current;
      if (activeTurnId.current !== turnId || expectedPersonaId !== state.persona.id) return;

      // canonical turnはsession内で待機させ、永続transactionと同じReact state transitionで
      // commitAckが発行されるまでTTS eligibilityを成立させない。
      pendingCanonicalTurns.current.set(turnId, turn);
      commitPendingTurnId.current = turnId;
      commitModelTurn(turnId, expectedPersonaId, turn);
    },
    [commitModelTurn, state.persona.id],
  );

  // commitAckはpersistent AppStateと同じstate transitionでだけ生成されるsession-only証跡。
  // ここへ到達して初めてmodel/memory/affectionのcommit成立とTTS eligibilityを同一視できる。
  useEffect(() => {
    if (!commitAck) return;
    const turn = pendingCanonicalTurns.current.get(commitAck.turnId);
    const isActiveCommittedTurn =
      Boolean(turn) &&
      activeTurnId.current === commitAck.turnId &&
      commitPendingTurnId.current === commitAck.turnId &&
      personaId.current === commitAck.personaId &&
      state.persona.id === commitAck.personaId;

    pendingCanonicalTurns.current.delete(commitAck.turnId);
    if (commitPendingTurnId.current === commitAck.turnId) commitPendingTurnId.current = null;
    clearCommitAck(commitAck.turnId);

    if (!isActiveCommittedTurn || !turn) return;

    generationAbort.current = null;
    setTurnDraft(null);
    activeTurnId.current = null;
    setBusy(false);

    const canonicalMessage = state.messages[commitAck.messageIndex];
    if (
      canonicalMessage?.role === "model" &&
      state.voice.enabled &&
      state.voice.autoplay &&
      !autoplayTurns.current.has(commitAck.turnId)
    ) {
      autoplayTurns.current.add(commitAck.turnId);
      void playMessage(canonicalMessage, commitAck.messageIndex, "autoplay");
    }
  }, [
    clearCommitAck,
    commitAck,
    playMessage,
    state.messages,
    state.persona.id,
    state.voice.autoplay,
    state.voice.enabled,
  ]);

  const sendText = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;

      // 新規送信前に旧generation/TTS/audioを止める。
      invalidateActiveTurn();
      // iPhone autoplay用unlockはuser gestureである送信イベントの中でだけ行う。
      if (state.voice.enabled && state.voice.autoplay) void audio.current?.unlock();

      const turnId = newTurnId();
      const controller = new AbortController();
      activeTurnId.current = turnId;
      generationAbort.current = controller;
      const userMessage: ChatMessage = { role: "user", text, at: Date.now() };
      const history = [...state.messages, userMessage];

      addMessage(userMessage);
      setInput("");
      setChatError("");
      setAudioError("");
      setBusy(true);
      setTurnDraft({ turnId, speech: "" });

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            turnId,
            messages: history,
            persona: state.persona,
            userName: state.userName,
            affection: state.affection,
            look: state.look,
            memories: state.memories,
          }),
        });
        if (!response.body) throw new Error("missing body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line) continue;
            let event: ReturnType<typeof parseDialogueEvent> = null;
            try {
              event = parseDialogueEvent(JSON.parse(line));
            } catch {
              continue;
            }
            if (!event || event.turnId !== activeTurnId.current) continue;

            if (event.type === "turn_started") {
              // structured retry / legacy fallbackごとにpreviewを完全resetする。
              setTurnDraft({ turnId, speech: "" });
            } else if (event.type === "performance_preview") {
              setTurnDraft((draft) =>
                draft?.turnId === turnId ? { ...draft, performance: event.performance } : draft,
              );
            } else if (event.type === "narration_preview") {
              setTurnDraft((draft) =>
                draft?.turnId === turnId ? { ...draft, narration: event.narration } : draft,
              );
            } else if (event.type === "speech_delta") {
              setTurnDraft((draft) =>
                draft?.turnId === turnId
                  ? { ...draft, speech: `${draft.speech}${event.text}` }
                  : draft,
              );
            } else if (event.type === "turn_error") {
              setChatError(event.message);
              invalidateGeneration();
            } else if (event.type === "turn_complete") {
              commitTurn(turnId, event.turn);
            }
          }
        }

        // complete/errorなしでstreamが切れた場合だけpartial draftを破棄する。
        // turn_complete受信済みならsession-only commitAckを待つ。
        if (
          activeTurnId.current === turnId &&
          commitPendingTurnId.current !== turnId
        ) {
          setChatError("（返事の途中で通信が切れたみたい。もう一度送ってね）");
          invalidateGeneration();
        }
      } catch (error) {
        if (
          !(error instanceof DOMException && error.name === "AbortError") &&
          activeTurnId.current === turnId &&
          commitPendingTurnId.current !== turnId
        ) {
          setChatError("（通信がうまくいかなかったみたい。電波を確認してね）");
          invalidateGeneration();
        }
      }
    },
    [
      addMessage,
      commitTurn,
      invalidateActiveTurn,
      invalidateGeneration,
      state.affection,
      state.look,
      state.memories,
      state.messages,
      state.persona,
      state.userName,
      state.voice.autoplay,
      state.voice.enabled,
    ],
  );

  useEffect(() => {
    if (!ready || pendingDone.current) return;
    pendingDone.current = true;
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(PENDING_KEY);
      sessionStorage.removeItem(PENDING_KEY);
    } catch {
      pending = null;
    }
    if (pending) {
      const timer = window.setTimeout(() => void sendText(pending), 0);
      return () => clearTimeout(timer);
    }
  }, [ready, sendText]);

  if (!ready) return <div className="flex-1 bg-[#12121a]" />;

  const lastModel = [...state.messages].reverse().find((message) => message.role === "model");
  const activePerformance = turnDraft?.performance ?? lastModel?.performance;
  const baseExpression: Expression = activePerformance?.expression ?? "normal";
  const stageExpression = greeting ? enhanceExpression(baseExpression, greeting) : baseExpression;
  const isPlaying = audioState === "playing";

  return (
    <Stage
      look={state.look}
      personaId={state.persona.id}
      dim={0.12}
      lift={56}
      expression={stageExpression}
      talking={isPlaying}
      lipSync={lipSync}
      performance={activePerformance}
    >
      <div className="safe-top absolute inset-x-0 top-0 z-10 flex items-start justify-between px-3 pb-3">
        <div className="flex items-center gap-2">
          <BackButton />
          <AffectionGauge affection={state.affection} />
        </div>
        <button
          onClick={() => {
            if (confirm("会話の履歴を消しますか？（好感度は残ります）")) clearMessages();
          }}
          className="grid h-11 w-11 place-items-center rounded-full bg-white/85 text-[15px] text-[#5c5c6b] shadow-[0_2px_8px_rgba(0,0,0,.28)] active:scale-90"
          aria-label="履歴を消す"
        >
          🗑
        </button>
      </div>

      <div
        ref={listRef}
        className="safe-chat-log no-scrollbar absolute inset-x-0 bottom-[76px] z-10 flex flex-col overflow-y-auto px-3 pb-2"
      >
        <div className="mt-auto space-y-2.5">
          {state.messages.length === 0 && greeting && (
            <div className="flex flex-col items-start">
              <span className="name-tag mb-1">{state.persona.name}</span>
              <div className="bubble chat-bubble animate-rise max-w-[86%]">{greeting}</div>
            </div>
          )}

          {state.messages.map((message, index) =>
            message.role === "user" ? (
              <div key={messageKey(message, index)} className="flex justify-end">
                <div className="chat-bubble-user max-w-[80%] rounded-[18px] rounded-br-[6px] px-4 py-2.5 text-[15px] leading-[1.6] text-white shadow-[0_3px_10px_rgba(0,0,0,.22)]">
                  {message.text}
                </div>
              </div>
            ) : (
              <ModelMessage
                key={messageKey(message, index)}
                message={message}
                index={index}
                name={state.persona.name}
                voiceEnabled={state.voice.enabled}
                playing={isPlaying}
                onPlay={playMessage}
              />
            ),
          )}
          {turnDraft && <DraftMessage draft={turnDraft} name={state.persona.name} />}
        </div>
      </div>

      {(chatError || audioError) && (
        <div role="status" className="absolute inset-x-5 bottom-[80px] z-20 rounded-xl bg-black/70 px-3 py-2 text-center text-[11px] text-white">
          {chatError || audioError}
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 bg-gradient-to-t from-black/45 to-transparent p-3 pt-5">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) void sendText(input);
          }}
          placeholder={listening ? "聞いてるよ…" : busy ? "考えてる…" : "お話ししよう！"}
          disabled={busy}
          className="h-12 flex-1 rounded-full border-2 border-white/70 bg-white/95 px-5 text-[15px] text-[#2b2b33] outline-none placeholder:text-[#a8a8b6] focus:border-pink-cta disabled:opacity-70"
        />
        {micSupported && (
          <button
            onClick={toggleMic}
            disabled={busy}
            aria-pressed={listening}
            className={`grid h-12 w-12 shrink-0 place-items-center rounded-full text-[18px] shadow-[0_3px_10px_rgba(0,0,0,.2)] transition active:scale-90 disabled:opacity-45 ${
              listening
                ? "animate-pulse bg-pink-cta-deep text-white"
                : "bg-white/95 text-[#5c5c6b]"
            }`}
            aria-label={listening ? "音声で入力を止める" : "音声で入力する"}
          >
            🎤
          </button>
        )}
        <button
          onClick={() => void sendText(input)}
          disabled={busy || !input.trim()}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-b from-[#ff8fb2] to-pink-cta-deep text-[18px] text-white shadow-[0_3px_10px_rgba(240,68,124,.5)] transition active:scale-90 disabled:opacity-45"
          aria-label="送信"
        >
          ➤
        </button>
      </div>
    </Stage>
  );
}

function ModelMessage({
  message,
  index,
  name,
  voiceEnabled,
  playing,
  onPlay,
}: {
  message: ChatMessage;
  index: number;
  name: string;
  voiceEnabled: boolean;
  playing: boolean;
  onPlay: (message: ChatMessage, index: number, mode?: "manual" | "autoplay") => Promise<void>;
}) {
  return (
    <div className="flex flex-col items-start">
      {message.narration && (
        <p className="mb-1 max-w-[86%] pl-1 text-[12px] leading-relaxed text-white/70">
          {message.narration}
        </p>
      )}
      <span className="name-tag mb-1">{name}</span>
      <div className="flex items-end gap-1">
        <div className="bubble chat-bubble max-w-[86%]">{message.text}</div>
        <button
          disabled={!voiceEnabled}
          onClick={() => void onPlay(message, index, "manual")}
          className="grid h-8 w-8 place-items-center rounded-full bg-white/80 text-[14px] shadow active:scale-90 disabled:opacity-40"
          aria-label={
            voiceEnabled
              ? playing
                ? "音声を再生し直す"
                : "音声を再生"
              : "設定でキャラクター音声をオンにする"
          }
        >
          🔊
        </button>
      </div>
    </div>
  );
}

function DraftMessage({ draft, name }: { draft: TurnDraft; name: string }) {
  return (
    <div className="flex flex-col items-start" aria-live="polite">
      {draft.narration && (
        <p className="mb-1 max-w-[86%] pl-1 text-[12px] leading-relaxed text-white/70">
          {draft.narration}
        </p>
      )}
      <span className="name-tag mb-1">{name}</span>
      <div className="bubble chat-bubble max-w-[86%]">
        {draft.speech || (
          <span className="text-[#9a9aa8]">
            <Dots />
          </span>
        )}
      </div>
    </div>
  );
}
