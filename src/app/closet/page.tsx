"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CharacterStage } from "@/components/character/CharacterStage";
import { RarityBadge } from "@/components/ui";
import { MOTION, SCENE } from "@/lib/catalog";
import { useStore } from "@/lib/store";
import type { Look, PartOption } from "@/lib/types";
import { variantsFor } from "@/lib/vrm-manifest";

type TabId = "variant" | "motion" | "scene";

const TABS: { id: TabId; label: string; icon: string; key: keyof Look }[] = [
  { id: "variant", label: "衣装", icon: "👗", key: "variantId" },
  { id: "motion", label: "モーション", icon: "🕺", key: "motionId" },
  { id: "scene", label: "背景", icon: "🖼", key: "scene" },
];

export default function ClosetPage() {
  const router = useRouter();
  const { state, ready, setLook } = useStore();

  // 何も触っていないうちは保存済みの見た目をそのまま映す。
  // 一度でも触ったら edited が下書きになる（localStorage の読み込み待ちも兼ねる）
  const [edited, setEdited] = useState<Look | null>(null);
  const draft = edited ?? state.look;

  const [tabId, setTabId] = useState<TabId>("variant");
  const tab = TABS.find((t) => t.id === tabId) ?? TABS[0];

  const dirty = useMemo(
    () => edited !== null && JSON.stringify(edited) !== JSON.stringify(state.look),
    [edited, state.look],
  );

  if (!ready) return <div className="flex-1 bg-[#12121a]" />;

  const variants = variantsFor(state.persona.id, draft.variantId);
  const options: PartOption[] =
    tabId === "variant" ? variants : tabId === "motion" ? MOTION : SCENE;

  const save = () => {
    setLook(draft);
    router.push("/");
  };

  return (
    <div className="flex h-full flex-col">
      {/* ------------------------------ プレビュー ------------------------------ */}
      <div className="relative flex-1 overflow-hidden">
        <CharacterStage look={draft} personaId={state.persona.id} />

        <div className="safe-top absolute inset-x-0 top-0 flex items-start justify-between px-3 pb-3">
          <button
            onClick={() => router.push("/")}
            className="grid h-11 w-11 place-items-center rounded-full bg-white/92 text-[19px]
                       font-bold text-[#5c5c6b] shadow-[0_2px_8px_rgba(0,0,0,.28)] active:scale-90"
            aria-label="閉じる"
          >
            ✕
          </button>
          <button
            onClick={save}
            className="rounded-full bg-gradient-to-b from-[#ff8fb2] to-pink-cta-deep px-7 py-2.5
                       text-[15px] font-bold text-white shadow-[0_3px_10px_rgba(240,68,124,.45)]
                       transition active:scale-95"
          >
            保存する
          </button>
        </div>

        <div className="absolute right-3 bottom-4 flex flex-col gap-2.5">
          <button
            onClick={() => setEdited(null)}
            disabled={!dirty}
            className="grid h-12 w-12 place-items-center rounded-full bg-white/92 text-[19px]
                       text-[#5c5c6b] shadow-[0_2px_8px_rgba(0,0,0,.28)] transition
                       active:scale-90 disabled:opacity-40"
            aria-label="やり直す"
          >
            ↺
          </button>
        </div>
      </div>

      {/* ------------------------------ 選択パネル ------------------------------ */}
      <div className="h-[46%] shrink-0 bg-white">
        {/* タブ */}
        <div className="flex border-b border-[#e8e8ef]">
          {TABS.map((t) => {
            const active = t.id === tabId;
            return (
              <button
                key={t.id}
                onClick={() => setTabId(t.id)}
                className={`relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px]
                            font-bold transition ${active ? "text-blue-menu" : "text-[#a0a0b0]"}`}
              >
                <span className={`text-[19px] ${active ? "" : "grayscale opacity-60"}`}>
                  {t.icon}
                </span>
                {t.label}
                {active && (
                  <span className="absolute inset-x-3 -bottom-px h-[3px] rounded-full bg-blue-menu" />
                )}
              </button>
            );
          })}
        </div>

        {/* アイテム一覧 */}
        <div className="no-scrollbar h-[calc(100%-52px)] overflow-y-auto px-2.5 py-2.5">
          <div className="grid grid-cols-4 gap-2">
            {options.map((opt) => {
              const selected = draft[tab.key] === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => setEdited({ ...draft, [tab.key]: opt.id })}
                  title={opt.name}
                  className={`relative overflow-hidden rounded-xl border-2 bg-gradient-to-b
                              from-[#eef6fd] to-[#d9e9f7] transition active:scale-95 ${
                                selected ? "border-pink-cta" : "border-transparent"
                              }`}
                >
                  <div className="aspect-square w-full" />
                  <span className="absolute top-0.5 right-1">
                    <RarityBadge rarity={opt.rarity} />
                  </span>
                  <span
                    className="absolute inset-x-0 bottom-0 truncate bg-black/45 px-1 py-[2px]
                               text-[9px] font-bold text-white"
                  >
                    {opt.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
