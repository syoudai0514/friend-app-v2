"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AffectionGauge, SideMenu, Stage } from "@/components/ui";
import { idleLine } from "@/lib/prompt";
import { useStore } from "@/lib/store";

const MENU = [
  { href: "/closet", icon: "👗", label: "クローゼット", accent: true },
  { href: "/characters", icon: "💞", label: "キャラ" },
  { href: "/chat", icon: "💬", label: "トーク" },
  { href: "/settings", icon: "⚙️", label: "せってい" },
];

/** ホームで打った言葉をトーク画面に引き継ぐための置き場所 */
export const PENDING_KEY = "friend-app:pending";

export default function Home() {
  const router = useRouter();
  const { state, ready, update } = useStore();
  const [nameInput, setNameInput] = useState("");
  const [draft, setDraft] = useState("");

  /** ホームから話しかける。打った言葉を持ったままトーク画面へ移る */
  const startTalk = () => {
    const text = draft.trim();
    if (text) {
      try {
        sessionStorage.setItem(PENDING_KEY, text);
      } catch {
        // 使えない環境ではトーク画面を開くだけにする
      }
    }
    router.push("/chat");
  };
  // ↻ を押すたびに次のセリフへ。好感度を起点にすることで、
  // 開くたびに違うセリフから始まる
  const [step, setStep] = useState(0);
  const line = idleLine(state.persona, state.userName, state.affection + step);

  if (!ready) {
    return <div className="flex-1 bg-[#12121a]" />;
  }

  /* ------------------------- 初回の名前入力 ------------------------- */
  if (!state.onboarded) {
    const submit = () => {
      const name = nameInput.trim();
      update({ userName: name || "あなた", onboarded: true });
    };
    return (
      <Stage look={state.look} personaId={state.persona.id} dim={0.45}>
        <div className="absolute inset-0 flex flex-col items-center justify-center px-7">
          <div className="w-full rounded-3xl bg-white/95 p-6 shadow-2xl">
            <h1 className="text-center text-[19px] font-bold text-[#2b2b33]">はじめまして</h1>
            <p className="mt-3 text-center text-[13px] leading-relaxed text-[#5c5c6b]">
              {state.persona.name}はあなたを
              <br />
              なんて呼べばいい？
            </p>
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="なまえ"
              maxLength={12}
              autoFocus
              className="mt-5 w-full rounded-full border-2 border-[#ffd0de] bg-white px-5 py-3
                         text-center text-[16px] text-[#2b2b33] outline-none focus:border-pink-cta"
            />
            <p className="mt-2 text-center text-[11px] text-[#9a9aa8]">
              あとから「せってい」で変えられます
            </p>
            <button onClick={submit} className="cta mt-5">
              はじめる
            </button>
          </div>
        </div>
      </Stage>
    );
  }

  /* ----------------------------- ホーム ----------------------------- */
  return (
    <Stage look={state.look} personaId={state.persona.id} lift={56}>
      {/* 上部 */}
      <div className="safe-top absolute inset-x-0 top-0 flex items-start justify-between px-3 pb-3">
        <AffectionGauge affection={state.affection} />
        <Link
          href="/settings"
          className="grid h-11 w-11 place-items-center rounded-full bg-blue-menu
                     shadow-[0_2px_8px_rgba(0,0,0,.3)] active:scale-90"
          aria-label="メニュー"
        >
          <span className="flex flex-col gap-[3px]">
            <span className="block h-[2px] w-[17px] rounded bg-white" />
            <span className="block h-[2px] w-[17px] rounded bg-white" />
            <span className="block h-[2px] w-[17px] rounded bg-white" />
          </span>
        </Link>
      </div>

      <SideMenu items={MENU} />

      {/* 下部のセリフ＋CTA。
          名前タグと↻を吹き出しに重ねて段を減らし、そのぶん脚を見せる */}
      <div className="absolute inset-x-0 bottom-0 px-3 pt-3 pb-3.5">
        <div className="relative">
          <span className="name-tag absolute -top-2.5 left-1 z-10">{state.persona.name}</span>
          <button
            onClick={() => setStep((s) => s + 1)}
            className="absolute -top-2.5 right-1 z-10 grid h-8 w-8 place-items-center rounded-full
                       bg-white/90 text-[14px] text-[#5c5c6b] shadow-[0_2px_6px_rgba(0,0,0,.25)]
                       active:scale-90"
            aria-label="セリフを変える"
          >
            ↻
          </button>
          <div key={line} className="bubble animate-rise min-h-[56px] pt-4">
            {line}
          </div>
        </div>

        {/* 参考アプリと同じく、ここから直接話しかけられる */}
        <div className="mt-2.5 flex items-center gap-2">
          <div
            className="flex flex-1 items-center rounded-full bg-gradient-to-r
                       from-[#ff8fb2] via-[#c9a0f0] to-[#7ec8f5] p-[2px]"
          >
            <div className="flex flex-1 items-center rounded-full bg-white/95 pr-1 pl-4">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) startTalk();
                }}
                placeholder="お話ししよう！"
                className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-[#2b2b33]
                           outline-none placeholder:text-[#a8a8b6]"
              />
              <button
                onClick={startTalk}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[17px]
                           text-pink-cta-deep transition active:scale-90"
                aria-label="送る"
              >
                ➤
              </button>
            </div>
          </div>
          <Link
            href="/chat"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/95
                       text-[19px] shadow-[0_2px_8px_rgba(0,0,0,.25)] active:scale-90"
            aria-label="トークを開く"
          >
            💬
          </Link>
        </div>
      </div>
    </Stage>
  );
}
