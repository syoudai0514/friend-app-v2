"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CharacterStage } from "@/components/character/CharacterStage";
import { RarityBadge } from "@/components/ui";
import { backgroundUrl } from "@/lib/backgrounds";
import { MOTION, SCENE } from "@/lib/catalog";
import { PRESETS } from "@/lib/personas";
import { useStore } from "@/lib/store";
import type { Look, OutfitRef, PartOption } from "@/lib/types";
import { variantsFor, VRM_MANIFEST } from "@/lib/vrm-manifest";

type TabId = "variant" | "hair" | "face" | "motion" | "scene";
type ScalarLookKey = "variantId" | "motionId" | "scene";
type FaceLookKey = "iris" | "brows" | "mouth";

const FACE_PARTS: { key: FaceLookKey; label: string; icon: string }[] = [
  { key: "iris", label: "瞳", icon: "👁️" },
  { key: "brows", label: "眉", icon: "〰️" },
  { key: "mouth", label: "口", icon: "👄" },
];

const TABS: { id: TabId; label: string; icon: string; key?: ScalarLookKey }[] = [
  { id: "variant", label: "衣装", icon: "👗", key: "variantId" },
  { id: "hair", label: "髪型", icon: "💇" },
  { id: "face", label: "顔", icon: "😊" },
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

  const borrowedOutfits = useMemo(
    () =>
      Object.entries(VRM_MANIFEST).flatMap(([personaId, variants]) => {
        if (personaId === state.persona.id) return [];
        const owner = PRESETS.find((preset) => preset.persona.id === personaId)?.persona.name;
        return variants.map((variant) => ({ ...variant, personaId, owner: owner ?? personaId }));
      }),
    [state.persona.id],
  );

  const borrowedHair = useMemo(
    () =>
      PRESETS.flatMap((preset) => {
        const personaId = preset.persona.id;
        const variants = VRM_MANIFEST[personaId];
        if (personaId === state.persona.id || !variants?.length) return [];
        const preferred = variants.some((variant) => variant.id === preset.look.variantId)
          ? preset.look.variantId
          : variants[0].id;
        return [
          {
            personaId,
            variantId: preferred,
            owner: preset.persona.name,
            name: `${preset.persona.name}の髪型`,
            rarity: "NR" as const,
          },
        ];
      }),
    [state.persona.id],
  );

  if (!ready) return <div className="flex-1 bg-[#12121a]" />;

  const variants = variantsFor(state.persona.id, draft.variantId);
  const options: PartOption[] = tabId === "motion" ? MOTION : SCENE;

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
          {tabId === "variant" ? (
            <div className="space-y-3">
              <section>
                <h2 className="mb-1.5 px-0.5 text-[10px] font-bold text-[#777789]">
                  {state.persona.name}の衣装
                </h2>
                <div className="grid grid-cols-4 gap-2">
                  {variants.map((opt) => {
                    const selected = !draft.outfit && draft.variantId === opt.id;
                    return (
                      <button
                        key={opt.id}
                        onClick={() =>
                          setEdited({ ...draft, variantId: opt.id, outfit: null })
                        }
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
              </section>

              {borrowedOutfits.length > 0 && (
                <section className="rounded-xl bg-[#fff4f8] p-2">
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <h2 className="text-[10px] font-bold text-[#e34c82]">
                      ほかのキャラの服を試着
                    </h2>
                    <span className="text-[8px] font-bold text-[#a77788]">試作版</span>
                  </div>
                  <p className="mb-2 text-[9px] leading-relaxed text-[#8d7180]">
                    顔・髪・肌はそのまま。体型差がある服は少しずれることがあります。
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {borrowedOutfits.map((opt) => {
                      const outfit: OutfitRef = {
                        personaId: opt.personaId,
                        variantId: opt.id,
                      };
                      const selected =
                        draft.outfit?.personaId === outfit.personaId &&
                        draft.outfit?.variantId === outfit.variantId;
                      return (
                        <button
                          key={`${opt.personaId}:${opt.id}`}
                          onClick={() => setEdited({ ...draft, outfit })}
                          title={`${opt.owner}の${opt.name}`}
                          className={`relative overflow-hidden rounded-xl border-2 bg-gradient-to-b
                                      from-[#fffafd] to-[#f5ddea] transition active:scale-95 ${
                                        selected ? "border-pink-cta" : "border-transparent"
                                      }`}
                        >
                          <div className="grid aspect-square w-full place-items-center pb-3 text-[22px]">
                            👗
                          </div>
                          <span className="absolute top-0.5 right-1">
                            <RarityBadge rarity={opt.rarity} />
                          </span>
                          <span className="absolute inset-x-0 bottom-[14px] truncate px-1 text-[7px] font-bold text-[#9c6d80]">
                            {opt.owner}
                          </span>
                          <span
                            className="absolute inset-x-0 bottom-0 truncate bg-[#a9617e]/80 px-1 py-[2px]
                                       text-[9px] font-bold text-white"
                          >
                            {opt.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          ) : tabId === "hair" ? (
            <div className="space-y-3">
              <section>
                <h2 className="mb-1.5 px-0.5 text-[10px] font-bold text-[#777789]">
                  髪型
                </h2>
                <div className="grid grid-cols-4 gap-2">
                  <button
                    onClick={() => setEdited({ ...draft, hair: null })}
                    title={`${state.persona.name}の髪型`}
                    className={`relative overflow-hidden rounded-xl border-2 bg-gradient-to-b
                                from-[#eef6fd] to-[#d9e9f7] transition active:scale-95 ${
                                  !draft.hair ? "border-pink-cta" : "border-transparent"
                                }`}
                  >
                    <div className="grid aspect-square w-full place-items-center pb-3 text-[22px]">
                      💇
                    </div>
                    <span className="absolute top-0.5 right-1">
                      <RarityBadge rarity="NR" />
                    </span>
                    <span
                      className="absolute inset-x-0 bottom-0 truncate bg-black/45 px-1 py-[2px]
                                 text-[9px] font-bold text-white"
                    >
                      いつもの髪
                    </span>
                  </button>
                </div>
              </section>

              {borrowedHair.length > 0 && (
                <section className="rounded-xl bg-[#f2f7ff] p-2">
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <h2 className="text-[10px] font-bold text-[#4385bf]">
                      ほかのキャラの髪型を試着
                    </h2>
                    <span className="text-[8px] font-bold text-[#7895ae]">試作版</span>
                  </div>
                  <p className="mb-2 text-[9px] leading-relaxed text-[#6f8294]">
                    頭の位置と身長差を自動で合わせます。衣装との同時試着は負荷が増えます。
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {borrowedHair.map((opt) => {
                      const hair: OutfitRef = {
                        personaId: opt.personaId,
                        variantId: opt.variantId,
                      };
                      const selected =
                        draft.hair?.personaId === hair.personaId &&
                        draft.hair?.variantId === hair.variantId;
                      return (
                        <button
                          key={`${opt.personaId}:${opt.variantId}`}
                          onClick={() => setEdited({ ...draft, hair })}
                          title={opt.name}
                          className={`relative overflow-hidden rounded-xl border-2 bg-gradient-to-b
                                      from-[#f8fbff] to-[#dcecff] transition active:scale-95 ${
                                        selected ? "border-pink-cta" : "border-transparent"
                                      }`}
                        >
                          <div className="grid aspect-square w-full place-items-center pb-3 text-[22px]">
                            💇
                          </div>
                          <span className="absolute top-0.5 right-1">
                            <RarityBadge rarity={opt.rarity} />
                          </span>
                          <span className="absolute inset-x-0 bottom-[14px] truncate px-1 text-[7px] font-bold text-[#5f7f9a]">
                            {opt.owner}
                          </span>
                          <span
                            className="absolute inset-x-0 bottom-0 truncate bg-[#5887af]/80 px-1 py-[2px]
                                       text-[9px] font-bold text-white"
                          >
                            髪型
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          ) : tabId === "face" ? (
            <div className="space-y-3">
              <div className="rounded-xl bg-[#fff8ee] px-2.5 py-2 text-[9px] leading-relaxed text-[#8e7657]">
                顔の輪郭と表情はそのまま、瞳・眉・口の画像だけを交換します。
              </div>
              {FACE_PARTS.map((part) => (
                <section key={part.key}>
                  <h2 className="mb-1.5 px-0.5 text-[10px] font-bold text-[#777789]">
                    {part.icon} {part.label}
                  </h2>
                  <div className="grid grid-cols-4 gap-2">
                    <button
                      onClick={() => setEdited({ ...draft, [part.key]: null })}
                      title={`いつもの${part.label}`}
                      className={`relative overflow-hidden rounded-xl border-2 bg-gradient-to-b
                                  from-[#eef6fd] to-[#d9e9f7] transition active:scale-95 ${
                                    !draft[part.key]
                                      ? "border-pink-cta"
                                      : "border-transparent"
                                  }`}
                    >
                      <div className="grid aspect-square w-full place-items-center pb-3 text-[22px]">
                        {part.icon}
                      </div>
                      <span className="absolute top-0.5 right-1">
                        <RarityBadge rarity="NR" />
                      </span>
                      <span
                        className="absolute inset-x-0 bottom-0 truncate bg-black/45 px-1 py-[2px]
                                   text-[9px] font-bold text-white"
                      >
                        いつもの{part.label}
                      </span>
                    </button>

                    {borrowedHair.map((opt) => {
                      const source: OutfitRef = {
                        personaId: opt.personaId,
                        variantId: opt.variantId,
                      };
                      const current = draft[part.key];
                      const selected =
                        current?.personaId === source.personaId &&
                        current?.variantId === source.variantId;
                      return (
                        <button
                          key={`${part.key}:${opt.personaId}`}
                          onClick={() => setEdited({ ...draft, [part.key]: source })}
                          title={`${opt.owner}の${part.label}`}
                          className={`relative overflow-hidden rounded-xl border-2 bg-gradient-to-b
                                      from-[#fffaf1] to-[#f7e4c4] transition active:scale-95 ${
                                        selected ? "border-pink-cta" : "border-transparent"
                                      }`}
                        >
                          <div className="grid aspect-square w-full place-items-center pb-3 text-[22px]">
                            {part.icon}
                          </div>
                          <span className="absolute top-0.5 right-1">
                            <RarityBadge rarity="NR" />
                          </span>
                          <span className="absolute inset-x-0 bottom-[14px] truncate px-1 text-[7px] font-bold text-[#8e7045]">
                            {opt.owner}
                          </span>
                          <span
                            className="absolute inset-x-0 bottom-0 truncate bg-[#a9824f]/85 px-1 py-[2px]
                                       text-[9px] font-bold text-white"
                          >
                            {part.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {options.map((opt) => {
                const selected = tab.key ? draft[tab.key] === opt.id : false;
                return (
                  <button
                    key={opt.id}
                    onClick={() => tab.key && setEdited({ ...draft, [tab.key]: opt.id })}
                    title={opt.name}
                    className={`relative overflow-hidden rounded-xl border-2 bg-gradient-to-b
                                from-[#eef6fd] to-[#d9e9f7] transition active:scale-95 ${
                                  selected ? "border-pink-cta" : "border-transparent"
                                }`}
                  >
                    <div
                      className={`aspect-square w-full ${
                        tabId === "scene" ? "bg-cover bg-center" : ""
                      }`}
                      style={
                        tabId === "scene"
                          ? { backgroundImage: `url(${backgroundUrl(opt.id)})` }
                          : undefined
                      }
                    />
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
          )}
        </div>
      </div>
    </div>
  );
}
