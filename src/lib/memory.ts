/**
 * 会話の中で「覚えておくべきこと」を、返事の末尾に付く隠しタグから取り出す。
 *
 * 例: "今日ラーメン食べたんだ〜！おいしかった！[memory: ラーメンが好き]"
 * のように、本文のあとに付けてもらう。ユーザーには見せず、
 * 次回以降の会話で参考にできるよう別に保存する。
 *
 * 表情タグ（先頭）と違って、こちらは末尾に付くうえ中身が自由な長さの文章になる。
 * ストリーミング中に閉じ括弧が来るまで、書きかけのタグをそのまま画面に
 * 出さないよう保留する
 */

// 全角コロン「：」で書かれることもあるので両方受け付ける
const KEYWORD = "memory:";
const MEMORY_TAG = /[[［]memory[:：]\s*([^\]］]*)[\]］]\s*$/i;

function lastOpenBracketIndex(text: string): number {
  return Math.max(text.lastIndexOf("["), text.lastIndexOf("［"));
}

function normalizeColon(tail: string): string {
  return tail.replace(/：/g, ":");
}

export interface MemorySplit {
  /** タグを取り除いた本文 */
  body: string;
  /** このターンで新しく覚えた内容。無い・まだ書きかけのときは null */
  learned: string | null;
}

export function splitMemory(text: string): MemorySplit {
  const complete = MEMORY_TAG.exec(text);
  if (complete) {
    return {
      body: text.slice(0, complete.index).trimEnd(),
      learned: complete[1].trim() || null,
    };
  }

  // 末尾の "[" 以降が "[memory:" になり得る途中の形なら、
  // 閉じ括弧が来るまで本文として出さずに保留する
  const openIdx = lastOpenBracketIndex(text);
  if (openIdx !== -1) {
    const tail = normalizeColon(text.slice(openIdx + 1).toLowerCase());
    const stillTypingKeyword = KEYWORD.startsWith(tail);
    const pastKeyword = tail.startsWith(KEYWORD);
    if (stillTypingKeyword || pastKeyword) {
      return { body: text.slice(0, openIdx).trimEnd(), learned: null };
    }
  }

  return { body: text, learned: null };
}

/**
 * ストリームが終わったあと、最後に一度だけ使う版。
 *
 * モデルが閉じ括弧を書き忘れたまま途中で打ち切られることがある。
 * そのとき splitMemory() だと書きかけのタグを隠すだけで中身を捨ててしまうので、
 * ここでは隠しつつ中身も拾う。タグとして中途半端でも、
 * 会話の本文を巻き込んで消さないことを最優先にしている
 */
export function finalizeMemory(text: string): MemorySplit {
  const complete = MEMORY_TAG.exec(text);
  if (complete) {
    return {
      body: text.slice(0, complete.index).trimEnd(),
      learned: complete[1].trim() || null,
    };
  }

  const openIdx = lastOpenBracketIndex(text);
  if (openIdx !== -1) {
    const raw = text.slice(openIdx + 1);
    const tail = normalizeColon(raw.toLowerCase());
    // 書きかけのタグなら、本文には出さずに隠す
    if (KEYWORD.startsWith(tail)) {
      return { body: text.slice(0, openIdx).trimEnd(), learned: null };
    }
    // キーワードまでは書けているなら、続きを覚えた内容として拾う
    if (tail.startsWith(KEYWORD)) {
      const learned = normalizeColon(raw).slice(KEYWORD.length).replace(/[\]］]\s*$/, "").trim();
      return { body: text.slice(0, openIdx).trimEnd(), learned: learned || null };
    }
  }

  return { body: text, learned: null };
}
