"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { Expression } from "@/lib/expressions";
import type { Look } from "@/lib/types";
import { posterUrl, vrmUrl } from "@/lib/vrm-assets";
import { CHARACTER_VIEWS } from "./view";

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
  const [viewIndex, setViewIndex] = useState(0);
  const view = CHARACTER_VIEWS[viewIndex];

  // バリアントが変わったら読み込み状態と視点をリセットする
  useEffect(() => {
    setVrmStatus("loading");
    setPosterFailed(false);
    setViewIndex(0);
  }, [personaId, look.variantId]);

  const showPoster = vrmStatus === "error" && !posterFailed;
  const showErrorText = vrmStatus === "error" && posterFailed;

  return (
    <div
      className="absolute inset-0 bg-[#12121a]"
      style={{ bottom: lift }}
      onClick={() => setViewIndex((i) => (i + 1) % CHARACTER_VIEWS.length)}
    >
      <VrmCanvas
        url={vrmUrl(personaId, look.variantId)}
        expression={expression}
        talking={talking}
        reducedMotion={reducedMotion}
        view={view}
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
    </div>
  );
}
