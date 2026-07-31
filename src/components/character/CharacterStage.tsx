"use client";

import type { Expression } from "@/lib/expressions";
import type { Look } from "@/lib/types";

/**
 * 背景＋キャラの表示エリア。
 *
 * Phase 0時点ではVRM描画をまだ組み込んでいないため、背景色だけを敷いた
 * プレースホルダになっている。Phase 1でWebGLキャンバス（VRM→poster→簡易エラー
 * の一直線フォールバック）に置き換える
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
  void personaId;
  void expression;
  void talking;
  return (
    <div
      className="absolute inset-0 bg-[#12121a]"
      style={{ bottom: lift }}
      data-scene={look.scene}
      data-variant={look.variantId}
      data-motion={look.motionId}
    />
  );
}
