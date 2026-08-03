import type { AffectionLevel, Look, PartOption } from "./types";

/* -------------------------------------------------------------------------- */
/*  背景                                                                       */
/* -------------------------------------------------------------------------- */

export const SCENE: PartOption[] = [
  { id: "room", name: "自分の部屋", rarity: "NR" },
  { id: "bed", name: "ベッドの上", rarity: "SR" },
  { id: "bed-man", name: "ベッド（男性）", rarity: "SR" },
  { id: "poolside", name: "プールサイド", rarity: "SSR" },
  { id: "arcade", name: "ゲームセンター", rarity: "SR" },
  { id: "office", name: "オフィス", rarity: "NR" },
  { id: "izakaya", name: "居酒屋", rarity: "SR" },
  { id: "classroom", name: "夕暮れの教室", rarity: "SR" },
  { id: "sakura", name: "桜並木", rarity: "SSR" },
  { id: "night", name: "夜景の部屋", rarity: "SSR" },
  { id: "cafe", name: "カフェ", rarity: "NR" },
  { id: "washitsu", name: "和室", rarity: "NR" },
];

/* -------------------------------------------------------------------------- */
/*  モーション                                                                 */
/*  実体（VRMAファイル）は public/vrma/<motionId>.vrma に置く。               */
/*  ここには選択肢としての一覧だけを持つ                                       */
/* -------------------------------------------------------------------------- */

export const MOTION: PartOption[] = [
  { id: "idle", name: "たちポーズ", rarity: "NR" },
  { id: "genki", name: "ごきげん立ち", rarity: "SR" },
  { id: "kiss", name: "投げキッス", rarity: "SR" },
  { id: "kick", name: "ハイキック", rarity: "SR" },
  { id: "situp", name: "腹筋", rarity: "SR" },
  { id: "squat", name: "スクワット", rarity: "SR" },
];

export const DEFAULT_LOOK: Look = {
  variantId: "swimsuit",
  scene: "poolside",
  motionId: "idle",
};

/* -------------------------------------------------------------------------- */
/*  好感度                                                                     */
/* -------------------------------------------------------------------------- */

export const AFFECTION_LEVELS: AffectionLevel[] = [
  {
    level: 1,
    label: "はじめまして",
    threshold: 0,
    attitude:
      "まだ知り合ったばかり。少し敬語まじりで、遠慮がちだけど好意的に接する。相手のことを知りたがる。",
  },
  {
    level: 2,
    label: "気になる人",
    threshold: 10,
    attitude:
      "打ち解けてきた。タメ口が増え、冗談を言い合える。相手の生活や好みを覚えていて話題に出す。",
  },
  {
    level: 3,
    label: "仲良し",
    threshold: 30,
    attitude:
      "気を許している。甘えたり、からかったりする。相手の疲れに気づいて自分から労わる。",
  },
  {
    level: 4,
    label: "大切な人",
    threshold: 60,
    attitude:
      "はっきり好意を示す。会えない時間を寂しがり、次に話す約束をしたがる。ときどき照れる。",
  },
  {
    level: 5,
    label: "恋人",
    threshold: 100,
    attitude:
      "恋人として接する。素直に愛情を伝え、甘い言葉やスキンシップの描写も自然に混ぜる。相手を全面的に肯定して支える。",
  },
];

export function affectionLevel(affection: number): AffectionLevel {
  let current = AFFECTION_LEVELS[0];
  for (const lv of AFFECTION_LEVELS) {
    if (affection >= lv.threshold) current = lv;
  }
  return current;
}

/** 現在レベル内での進捗（0〜1）。ゲージ表示に使う */
export function affectionProgress(affection: number): number {
  const lv = affectionLevel(affection);
  const next = AFFECTION_LEVELS.find((l) => l.level === lv.level + 1);
  if (!next) return 1;
  return (affection - lv.threshold) / (next.threshold - lv.threshold);
}
