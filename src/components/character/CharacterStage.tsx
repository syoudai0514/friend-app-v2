"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { backgroundUrl } from "@/lib/backgrounds";
import type { Expression } from "@/lib/expressions";
import type { Look, ModelPerformanceIntent } from "@/lib/types";
import { posterUrl, vrmaUrl, vrmUrl } from "@/lib/vrm-assets";
import type { StageViewState } from "./stage-view";

// three系はサイズが大きいので、クライアントでしか要らないWebGL部分だけ切り出して遅延読み込みする
const VrmCanvas = dynamic(() => import("./VrmCanvas").then((m) => m.VrmCanvas), { ssr: false });

// 各キャラのBody_00_SKINベーステクスチャから抽出した肌色の代表値
// （肌色ピクセルの中央値。詳細はAGENTS.mdの「実装で分かった落とし穴」を参照）
export const BODY_SKIN_COLORS: Record<string, string> = {
  aimi: "#f9e7d9",
  shizuku: "#e2c29f",
  nagi: "#cb9771",
  rena: "#f2c7b2",
};
export const DEFAULT_SKIN_COLOR = "#e6c8aa";

// Next.jsの画面切替でCanvasが作り直されても、同じキャラ・衣装なら見ていた位置を戻す。
// 衣装ごとに体格が違うため、見た目の組み合わせをキーにして混線を防ぐ。
const stageViews = new Map<string, StageViewState>();

function stageViewKey(personaId: string, look: Look): string {
  return [
    personaId,
    look.variantId,
    look.outfit?.personaId,
    look.outfit?.variantId,
    look.hair?.personaId,
    look.hair?.variantId,
  ]
    .filter(Boolean)
    .join("|");
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * 背景＋キャラの表示エリア。
 * フォールバックは VRM → poster画像 → 簡易エラー表示 の一直線。
 * poster画像は読み込み中には出さない（VRMのメタ情報についている顔クローズアップの
 * サムネイルを流用しているだけなので、全身が映るVRMに切り替わった瞬間サイズが
 * 変わって見えてしまうため。VRMが失敗したときの最終手段としてのみ使う）
 *
 * カメラは1本指ドラッグ=回り込み、2本指ピンチ=ズーム、2本指ドラッグ=位置ずらしで
 * 自由に動かせる（OrbitControls）。見失ったときのために右下に戻すボタンを出す
 */
export function CharacterStage({
  look,
  personaId,
  expression = "normal",
  talking = false,
  lipSync = 0,
  performance,
  lift = 0,
}: {
  look: Look;
  personaId: string;
  expression?: Expression;
  talking?: boolean;
  lipSync?: number;
  performance?: Partial<ModelPerformanceIntent>;
  lift?: number;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const [vrmStatus, setVrmStatus] = useState<"loading" | "ready" | "error">("loading");
  const [posterFailed, setPosterFailed] = useState(false);
  const orbitControlsRef = useRef<OrbitControlsImpl | null>(null);
  const viewKey = stageViewKey(personaId, look);
  const initialView = stageViews.get(viewKey) ?? null;
  const rememberView = useCallback(
    (view: StageViewState) => stageViews.set(viewKey, view),
    [viewKey],
  );

  // バリアントが変わったら読み込み状態をリセットする
  useEffect(() => {
    setVrmStatus("loading");
    setPosterFailed(false);
  }, [
    personaId,
    look.variantId,
    look.outfit?.personaId,
    look.outfit?.variantId,
    look.hair?.personaId,
    look.hair?.variantId,
  ]);

  const showPoster = vrmStatus === "error" && !posterFailed;
  const showErrorText = vrmStatus === "error" && posterFailed;
  // 借り物の服を着ても体は常に本人のものなので、肌の色は肌色ピッカーの指定だけで決まる。
  // 元の肌色から選んだ肌色へテクスチャを変換する（同じなら変換自体を行わない）。
  const ownSkinColor = BODY_SKIN_COLORS[personaId] ?? DEFAULT_SKIN_COLOR;
  const skinToneColor = look.skinTone ? (BODY_SKIN_COLORS[look.skinTone.personaId] ?? null) : null;

  return (
    <div className="absolute inset-0 bg-[#12121a]" style={{ bottom: lift }}>
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center transition-[background-image] duration-300"
        style={{ backgroundImage: `url(${backgroundUrl(look.scene)})` }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/10 via-black/5 to-black/30"
      />
      <VrmCanvas
        url={vrmUrl(personaId, look.variantId)}
        outfitUrl={
          look.outfit ? vrmUrl(look.outfit.personaId, look.outfit.variantId) : null
        }
        hairUrl={look.hair ? vrmUrl(look.hair.personaId, look.hair.variantId) : null}
        irisTextureUrl={look.iris ? `/face-parts/${look.iris.personaId}/iris.png` : null}
        browsTextureUrl={
          look.brows ? `/face-parts/${look.brows.personaId}/brows.png` : null
        }
        mouthTextureUrl={
          look.mouth ? `/face-parts/${look.mouth.personaId}/mouth.png` : null
        }
        bodySkinColor={skinToneColor}
        bodySkinSourceColor={skinToneColor ? ownSkinColor : null}
        // 借り物の服は覆う範囲が本人の衣装と違うため、VRoidがアルファで消した
        // 「服の下の体」がそのままだと穴として露出する。借りているあいだだけ
        // 穴の無い体テクスチャ（scripts/build-complete-skins.py で生成）に差し替える
        completeSkinUrl={look.outfit ? `/skin/${personaId}.webp` : null}
        skinGlossLevel={look.skinGloss ?? null}
        initialView={initialView}
        onViewChange={rememberView}
        motionUrl={vrmaUrl(look.motionId)}
        expression={expression}
        talking={talking}
        lipSync={lipSync}
        performance={performance}
        reducedMotion={reducedMotion}
        orbitControlsRef={orbitControlsRef}
        onReady={() => setVrmStatus("ready")}
        onError={() => setVrmStatus("error")}
      />
      {showPoster && (
        // eslint-disable-next-line @next/next/no-img-element -- publicの動的パスなのでnext/imageの最適化対象外
        <img
          src={posterUrl(personaId, look.variantId)}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setPosterFailed(true)}
        />
      )}
      {showErrorText && (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-[13px] text-white/50">
          読み込めませんでした
        </div>
      )}
      {vrmStatus === "ready" && (
        <button
          onClick={() => orbitControlsRef.current?.reset()}
          className="absolute right-2 bottom-2 grid h-9 w-9 place-items-center rounded-full
                     bg-black/45 text-[15px] text-white/85 backdrop-blur-[2px] active:scale-90"
          aria-label="表示位置を戻す"
        >
          ↺
        </button>
      )}
    </div>
  );
}
