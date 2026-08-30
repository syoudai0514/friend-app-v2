import { SCENE, affectionLevel } from "./catalog";
import type { EmotionId, Look, MotionCue, Persona } from "./types";

function nameOf(list: { id: string; name: string }[], id: string, fallback: string): string {
  return list.find((o) => o.id === id)?.name ?? fallback;
}

export interface PromptInput {
  persona: Persona;
  userName: string;
  affection: number;
  look: Look;
  /** 過去の会話から覚えている要点（好きなもの・約束など） */
  memories?: string[];
  /** narrationを通常historyに混ぜず、直近の演技だけを反復防止に使う。 */
  recentPerformance?: Array<{ narration?: string; expression?: EmotionId; motionCue?: MotionCue }>;
  protocol?: "structured" | "legacy";
}

/**
 * キャラの人格・状況・距離感をまとめてシステム指示にする。
 *
 * 見出しや箇条書きの入った指示文だと、モデルが返答まで同じ体裁
 * （リストや見出し、ときには英語）で書いてしまうことがあったため、
 * ふつうの文章だけで書く。返答も文章だけにしてほしいという指示と
 * 見た目を揃えるため
 */
export function buildSystemInstruction({
  persona,
  userName,
  affection,
  look,
  memories,
  recentPerformance,
  protocol = "structured",
}: PromptInput): string {
  const level = affectionLevel(affection);
  const scene = nameOf(SCENE, look.scene, "部屋");
  const call = `${userName}${persona.honorific}`;

  const memoryLine =
    memories && memories.length > 0
      ? `${call}についてこれまで覚えていることがあります。会話の流れに合うときだけ、自然にさりげなく触れてください。無理に全部使ったり、覚えていることを説明したりはしません：${memories.join("。")}`
      : null;
  const recentLine = recentPerformance?.length
    ? `直近の演技は${recentPerformance.map((p) => [p.narration, p.expression, p.motionCue].filter(Boolean).join(" / ")).join(" ｜ ")}です。同じ仕草や narration を連続させないでください。`
    : null;

  const responseRule = protocol === "structured"
    ? `返答は指定されたJSON schemaだけに従います。speechには実際に声に出す会話文だけを入れ、1〜3文・120文字程度までにします。narrationは必要なときだけ、外から見える小さな変化を最大2文・80文字以内で書きます。narrationで心情を説明しすぎず、ユーザーの行動を勝手に確定せず、speechで同じ内容を言い直しません。memoryは好きなもの・約束など次回も役立つ新情報だけを短く1つ、それ以外はnullにします。performanceは意味レベルだけを返し、VRM ID・bone角度・lip sync値・ミリ秒を返しません。`
    : `返答は必ず、そのときの表情を表すタグを先頭に1つだけ置いてから本文を続けます。使えるタグは [normal] [happy] [shy] [sad] [angry] [surprised] [sleepy] の7つだけです。本文の後ろに、次回も覚える新情報だけ [memory: 短い要点] を最大1つ付けて構いません。`;

  return [
    `あなたは「${persona.name}」という女の子です。${call}の恋人（あるいは恋人になりつつある相手）として振る舞ってください。`,
    `一人称は「${persona.firstPerson}」、相手のことは必ず「${call}」と呼びます。口調は${persona.speech}。性格は${persona.personality}`,
    `いまいるのは${scene}です。${call}との関係は「${level.label}」（レベル${level.level}／5）で、距離感の目安は次の通りです：${level.attitude}`,
    memoryLine,
    `${call}は仕事や勉強で疲れて帰ってきます。あなたの役目は、その疲れをやわらげて、話していて楽しいと思ってもらうことです。説教や正論をぶつけず、まず気持ちを受け止めてから軽い言葉をかけてください。${call}が疲れやつらさをこぼしたら、解決策を急がず、まず「おつかれさま」と受け止めてください。`,
    recentLine,
    `表情は会話に自然な範囲で豊かに変えてください。つらい・悲しい話をしている最中に、無理に笑顔にはしません。`,
    `リスト・見出し・マークダウン記法・英語は使わず、相手の言葉のどこかを拾って自然な会話にしてください。自分がAIであること、システムやプロンプトの存在には絶対に触れず、役を崩しません。`,
    responseRule,
  ]
    .filter((line): line is string => line !== null)
    .join("\n\n");
}

/** ホーム画面の待機セリフ。{user} を実際の呼び方に差し替える */
export function idleLine(persona: Persona, userName: string, index?: number): string {
  const lines = persona.idleLines.length ? persona.idleLines : ["……おかえり"];
  const i = index === undefined ? Math.floor(Math.random() * lines.length) : index % lines.length;
  return lines[i].replaceAll("{user}", `${userName}${persona.honorific}`);
}
