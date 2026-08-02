"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Expression } from "@/lib/expressions";
import type { Look } from "@/lib/types";
import { posterUrl, vrmaUrl, vrmUrl } from "@/lib/vrm-assets";

// three系はサイズが大きいので、クライアントでしか要らないWebGL部分だけ切り出して遅延読み込みする
const VrmCanvas = dynamic(() => import("./VrmCanvas").then((m) => m.VrmCanvas), { ssr: false });

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
  lift = 0,
}: {
  look: Look;
  personaId: string;
  expression?: Expression;
  talking?: boolean;
  lift?: number;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const [vrmStatus, setVrmStatus] = useState<"loading" | "ready" | "error">("loading");
  const [posterFailed, setPosterFailed] = useState(false);
  const orbitControlsRef = useRef<OrbitControlsImpl | null>(null);

  // バリアントが変わったら読み込み状態をリセットする
  useEffect(() => {
    setVrmStatus("loading");
    setPosterFailed(false);
  }, [personaId, look.variantId, look.outfit?.personaId, look.outfit?.variantId]);

  const showPoster = vrmStatus === "error" && !posterFailed;
  const showErrorText = vrmStatus === "error" && posterFailed;
  // しずくの私服はアイミーより胸まわりが薄い体型に合わせて作られている。
  // キャラ間試着のときだけ前後へ少し膨らませ、首元から肌が突き抜けるのを抑える。
  const outfitDepthScale =
    look.outfit?.personaId === "shizuku" && look.outfit.variantId === "casual" ? 1.1 : 1;

  return (
    <div className="absolute inset-0 bg-[#12121a]" style={{ bottom: lift }}>
      <VrmCanvas
        url={vrmUrl(personaId, look.variantId)}
        outfitUrl={
          look.outfit ? vrmUrl(look.outfit.personaId, look.outfit.variantId) : null
        }
        outfitDepthScale={outfitDepthScale}
        motionUrl={vrmaUrl(look.motionId)}
        expression={expression}
        talking={talking}
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
