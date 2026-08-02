/**
 * 表情。VRMExpressionManager にそのまま渡すプリセット名と適用量(0〜1)の組。
 *
 * 会話の返事にタグが付いてくるので、それをこの表に当てて表情を変える。
 */

export type Expression =
  | "normal"
  | "happy"
  | "shy"
  | "sad"
  | "angry"
  | "surprised"
  | "sleepy";

export interface ExpressionPreset {
  /** VRM 1.0 標準表情プリセット名（happy/angry/sad/relaxed/surprised など） */
  preset: string;
  weight: number;
}

export const EXPRESSIONS: Record<Expression, ExpressionPreset[]> = {
  /** ふだんの顔。表情プリセットを何も足さない */
  normal: [],
  /** うれしい・笑っている */
  happy: [{ preset: "happy", weight: 1 }],
  /** 照れ。やわらかい目元に小さな笑顔を重ねる */
  shy: [
    { preset: "relaxed", weight: 0.7 },
    { preset: "happy", weight: 0.32 },
  ],
  /** しょんぼり */
  sad: [{ preset: "sad", weight: 1 }],
  /** むくれている */
  angry: [{ preset: "angry", weight: 1 }],
  /** びっくり */
  surprised: [{ preset: "surprised", weight: 1 }],
  /** ねむそう */
  sleepy: [{ preset: "relaxed", weight: 0.5 }],
};

export const EXPRESSION_IDS = Object.keys(EXPRESSIONS) as Expression[];

export function isExpression(value: string): value is Expression {
  return (EXPRESSION_IDS as string[]).includes(value);
}

/**
 * 返事の先頭に付いてくる `[happy]` のようなタグを取り出して、本文と分ける。
 * タグが無い・知らない名前のときは normal 扱いにして、本文はそのまま返す。
 */
export function splitExpression(text: string): { expression: Expression; body: string } {
  const m = /^\s*[[［]\s*([a-zA-Z]+)\s*[\]］]\s*/.exec(text);
  if (!m) return { expression: "normal", body: text };

  const name = m[1].toLowerCase();
  const body = text.slice(m[0].length);
  return { expression: isExpression(name) ? name : "normal", body };
}

/**
 * 返事が届く途中でもタグだけ先に読めるようにする。
 * まだタグが出そろっていない（`[ha` のような）ときは表示を止めておく。
 */
export function isTagIncomplete(text: string): boolean {
  return /^\s*[[［][a-zA-Z]*$/.test(text);
}

const SHY_CUES =
  /(好き|大好き|愛して|かわい|可愛|照れ|恥ずか|ドキドキ|会いたかった|会えて|声を聞くと|そばに|ぎゅ|えへ)/;
const HAPPY_CUES =
  /(おかえり|うれし|嬉し|楽しい|ありがとう|来てくれ|待って|よかった|ふふ|おつかれ|えらい|元気|笑|お茶|落ち着)/;

/**
 * AIのタグが normal でも、本文が明らかに好意的なら表情を補う。
 * ホームの固定セリフにも同じ判定を使い、会話との笑顔頻度を揃える。
 */
export function enhanceExpression(expression: Expression, body: string): Expression {
  if (expression !== "normal") return expression;
  if (SHY_CUES.test(body)) return "shy";
  if (HAPPY_CUES.test(body)) return "happy";
  return "normal";
}
