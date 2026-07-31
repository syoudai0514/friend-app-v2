"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AffectionGauge, BackButton, Dots, Stage } from "@/components/ui";
import { isTagIncomplete, splitExpression, type Expression } from "@/lib/expressions";
import { finalizeMemory, splitMemory } from "@/lib/memory";
import { PENDING_KEY } from "@/app/page";
import { idleLine } from "@/lib/prompt";
import { useSpeechInput } from "@/lib/speech";
import { useStore } from "@/lib/store";
import type { ChatMessage } from "@/lib/types";

export default function ChatPage() {
  const { state, ready, addMessage, replaceLastModel, gainAffection, addMemory, clearMessages } =
    useStore();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [expression, setExpression] = useState<Expression>("normal");
  const listRef = useRef<HTMLDivElement>(null);
  const pendingDone = useRef(false);
  const onSpeechResult = useCallback((text: string) => {
    setInput((prev) => (prev ? `${prev}${text}` : text));
  }, []);
  const { supported: micSupported, listening, toggle: toggleMic } = useSpeechInput(onSpeechResult);
  // 会話がまだ無いときだけ、ホームと同じ待機セリフから始める
  const greeting =
    state.messages.length === 0
      ? idleLine(state.persona, state.userName, state.affection)
      : null;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [state.messages]);

  const sendText = useCallback(
    async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;

    const userMsg: ChatMessage = { role: "user", text, at: Date.now() };
    const history = [...state.messages, userMsg];

    addMessage(userMsg);
    addMessage({ role: "model", text: "", at: Date.now() });
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          persona: state.persona,
          userName: state.userName,
          affection: state.affection,
          look: state.look,
          memories: state.memories,
        }),
      });

      if (!res.body) {
        replaceLastModel("（返事が返ってこなかったみたい。もう一度試してみて）");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        // 先頭の表情タグ・末尾の記憶タグを読み取って、本文だけを吹き出しに出す。
        // タグが途中までしか届いていないときは、出しかけの `[ha` や
        // `[memory: ...` が見えないように表示を待つ
        const { expression: ex, body: afterExpression } = splitExpression(acc);
        const { body } = splitMemory(afterExpression);
        setExpression(ex);
        if (!isTagIncomplete(acc)) replaceLastModel(body);
      }
      acc += decoder.decode();
      const final = splitExpression(acc);
      const memory = finalizeMemory(final.body);
      setExpression(final.expression);
      replaceLastModel(memory.body);
      if (memory.learned) addMemory(memory.learned);

      // 会話が成立したら好感度が上がる
      if (res.headers.get("X-Chat-Error") !== "1") gainAffection(1);
    } catch {
      replaceLastModel("（通信がうまくいかなかったみたい。電波を確認してね）");
    } finally {
      setBusy(false);
    }
    },
    [busy, state.messages, state.persona, state.userName, state.affection, state.look,
     state.memories, addMessage, replaceLastModel, gainAffection, addMemory],
  );

  // ホームの入力欄から来たときは、その言葉を開いてすぐ送る
  useEffect(() => {
    if (!ready || pendingDone.current) return;
    pendingDone.current = true;
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(PENDING_KEY);
      sessionStorage.removeItem(PENDING_KEY);
    } catch {
      // sessionStorage が使えない環境では何もしない
    }
    if (!pending) return;
    // 描画が落ち着いてから送る
    const t = setTimeout(() => sendText(pending), 0);
    return () => clearTimeout(t);
  }, [ready, sendText]);

  if (!ready) return <div className="flex-1 bg-[#12121a]" />;

  const lastIsEmptyModel =
    state.messages.length > 0 &&
    state.messages[state.messages.length - 1].role === "model" &&
    state.messages[state.messages.length - 1].text === "";

  return (
    <Stage
      look={state.look}
      personaId={state.persona.id}
      dim={0.22}
      expression={expression}
      talking={busy}
    >
      {/* 上部 */}
      <div className="safe-top absolute inset-x-0 top-0 z-10 flex items-start justify-between px-3 pb-3">
        <div className="flex items-center gap-2">
          <BackButton />
          <AffectionGauge affection={state.affection} />
        </div>
        <button
          onClick={() => {
            if (confirm("会話の履歴を消しますか？（好感度は残ります）")) clearMessages();
          }}
          className="grid h-11 w-11 place-items-center rounded-full bg-white/85 text-[15px]
                     text-[#5c5c6b] shadow-[0_2px_8px_rgba(0,0,0,.28)] active:scale-90"
          aria-label="履歴を消す"
        >
          🗑
        </button>
      </div>

      {/* 会話ログ */}
      <div
        ref={listRef}
        className="safe-chat-log no-scrollbar absolute inset-x-0 bottom-[76px] z-10 flex flex-col
                   overflow-y-auto px-3 pb-2"
      >
        {/* 少ないうちは下寄せ。増えたら普通に上から流れる */}
        <div className="mt-auto space-y-2.5">
        {state.messages.length === 0 && greeting && (
          <div className="flex flex-col items-start">
            <span className="name-tag mb-1">{state.persona.name}</span>
            <div className="bubble animate-rise max-w-[86%]">{greeting}</div>
          </div>
        )}

        {state.messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div
                className="max-w-[80%] rounded-[18px] rounded-br-[6px] bg-gradient-to-b
                           from-[#ff8fb2] to-pink-cta px-4 py-2.5 text-[15px] leading-[1.6]
                           text-white shadow-[0_3px_10px_rgba(0,0,0,.22)]"
              >
                {m.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex flex-col items-start">
              <span className="name-tag mb-1">{state.persona.name}</span>
              <div className="bubble max-w-[86%]">
                {m.text || (
                  <span className="text-[#9a9aa8]">
                    <Dots />
                  </span>
                )}
              </div>
            </div>
          ),
        )}
        </div>
      </div>

      {/* 入力欄 */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 bg-gradient-to-t
                      from-black/45 to-transparent p-3 pt-5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) sendText(input);
          }}
          placeholder={
            listening ? "聞いてるよ…" : busy && lastIsEmptyModel ? "考えてる…" : "お話ししよう！"
          }
          disabled={busy}
          className="h-12 flex-1 rounded-full border-2 border-white/70 bg-white/95 px-5
                     text-[15px] text-[#2b2b33] outline-none placeholder:text-[#a8a8b6]
                     focus:border-pink-cta disabled:opacity-70"
        />
        {micSupported && (
          <button
            onClick={toggleMic}
            disabled={busy}
            aria-pressed={listening}
            className={`grid h-12 w-12 shrink-0 place-items-center rounded-full text-[18px]
                       shadow-[0_3px_10px_rgba(0,0,0,.2)] transition active:scale-90
                       disabled:opacity-45 ${
                         listening
                           ? "animate-pulse bg-pink-cta-deep text-white"
                           : "bg-white/95 text-[#5c5c6b]"
                       }`}
            aria-label={listening ? "音声入力を止める" : "音声で入力する"}
          >
            🎤
          </button>
        )}
        <button
          onClick={() => sendText(input)}
          disabled={busy || !input.trim()}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full
                     bg-gradient-to-b from-[#ff8fb2] to-pink-cta-deep text-[18px] text-white
                     shadow-[0_3px_10px_rgba(240,68,124,.5)] transition active:scale-90
                     disabled:opacity-45"
          aria-label="送信"
        >
          ➤
        </button>
      </div>
    </Stage>
  );
}
