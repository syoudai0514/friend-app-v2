import {
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  ThinkingLevel,
  type Content,
  type GenerateContentConfig,
  type GenerateContentResponse,
} from "@google/genai";
import { buildSystemInstruction } from "@/lib/prompt";
import type { ChatMessage, Look, Persona } from "@/lib/types";

export const runtime = "nodejs";
/** 会話は毎回生成するのでキャッシュさせない */
export const dynamic = "force-dynamic";
// フォールバックでモデルを探し直したり、応答が長めになったりすると
// 既定の実行時間では途中で打ち切られることがあるため延ばしておく
// （Vercel Hobbyプランでの上限）
export const maxDuration = 60;

/** 無料枠を使い切らないよう、送る履歴は直近だけに絞る */
const MAX_HISTORY = 24;

/**
 * 返事の長さの上限。
 * 見えない思考トークンもここから引かれるモデルがあるので、
 * 短い返事しか要らなくても余裕をもたせておく
 */
const MAX_OUTPUT_TOKENS = 2048;

/**
 * 一度うまく動いたモデル名。同じ関数インスタンスが再利用されるあいだは覚えておき、
 * 毎回モデル一覧を引き直さないようにする（余計な通信でレート制限に当たるのを防ぐ）。
 * 設定を変えたときに古い結果を使い続けないよう、元の指定とセットで持つ
 */
let modelCache: { requested: string; resolved: string } | null = null;

interface ChatRequest {
  messages: ChatMessage[];
  persona: Persona;
  userName: string;
  affection: number;
  look: Look;
  memories?: string[];
}

function errorStream(message: string): Response {
  return new Response(message, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Chat-Error": "1" },
  });
}

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return errorStream(
      "（APIキーがまだ設定されていないみたい。.env.local に GEMINI_API_KEY を入れて、サーバーを再起動してね）",
    );
  }

  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return errorStream("（メッセージをうまく読み取れませんでした）");
  }

  const { messages, persona, userName, affection, look, memories } = body;
  if (!Array.isArray(messages) || !persona || !look) {
    return errorStream("（メッセージをうまく読み取れませんでした）");
  }

  const history = messages.slice(-MAX_HISTORY);
  const contents: Content[] = history
    .filter((m) => m.text?.trim())
    .map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.text }],
    }));

  if (contents.length === 0) {
    return errorStream("（何か話しかけてみて）");
  }

  const ai = new GoogleGenAI({ apiKey });
  // Google AI Studio の「モデルごとのレート制限」で確認したところ、
  // lite系がいちばん無料枠（RPM）が広かったので、それを初期値にする。
  // これが無ければ下の自動フォールバックが本当に使えるモデルを探しにいく
  const requestedModel = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  const systemInstruction = buildSystemInstruction({
    persona,
    userName,
    affection,
    look,
    memories,
  });

  let stream: AsyncGenerator<GenerateContentResponse>;
  let usedConfig: GenerateContentConfig;
  // エラー文で「どのモデルが困っているか」を言えるように、実際に使ったモデル名を覚えておく。
  // 一度うまくいったモデルは覚えておき、次からは探し直さない（無駄な通信を減らす）
  let usedModel =
    modelCache?.requested === requestedModel ? modelCache.resolved : requestedModel;
  try {
    ({ stream, config: usedConfig } = await startStream(ai, usedModel, contents, systemInstruction));
  } catch (e) {
    // モデル名が見つからないときは、このAPIキーで実際に使えるモデルを探して
    // 一度だけ自動で肩代わりする。GEMINI_MODEL が古い/間違っている場合の保険
    if (!isModelNotFound(e)) {
      return errorStream(await friendlyError(e, ai, requestedModel, usedModel));
    }
    const fallbackModel = await findFallbackModel(ai, usedModel);
    if (!fallbackModel) {
      return errorStream(await friendlyError(e, ai, requestedModel, usedModel));
    }
    usedModel = fallbackModel;
    try {
      ({ stream, config: usedConfig } = await startStream(
        ai,
        fallbackModel,
        contents,
        systemInstruction,
      ));
    } catch (e2) {
      return errorStream(await friendlyError(e2, ai, requestedModel, usedModel));
    }
  }
  modelCache = { requested: requestedModel, resolved: usedModel };

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let result = await relay(stream, controller, encoder);
        if (result.sent === 0) {
          // 本文が1文字も来ないことがある。思考トークンだけで上限を使い切った、
          // 安全フィルタに触れた、などが考えられる。上限をさらに広げて一度だけ聞き直す
          try {
            const retry = await startStream(ai, usedModel, contents, systemInstruction, {
              ...usedConfig,
              maxOutputTokens: (usedConfig.maxOutputTokens ?? MAX_OUTPUT_TOKENS) * 2,
            });
            result = await relay(retry.stream, controller, encoder);
          } catch {
            // 聞き直しがエラーになっても、下の空チェックに任せる
          }
        }
        if (result.sent === 0) {
          controller.enqueue(encoder.encode(emptyReplyMessage(result)));
        } else if (result.finishReason && result.finishReason !== "STOP") {
          // 文の途中で打ち切られたとき、切れたまま置かずに余韻でつなぐ
          controller.enqueue(encoder.encode("……"));
        }
      } catch (e) {
        controller.enqueue(encoder.encode(await friendlyError(e, ai, requestedModel, usedModel)));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

interface RelayResult {
  sent: number;
  finishReason: string | undefined;
  /** 見えない思考に使われたトークン数。空返答の原因調べに使う */
  thoughtsTokens: number | undefined;
}

/** ストリームの本文をそのままクライアントへ送りつつ、送った量と終了理由を返す */
async function relay(
  stream: AsyncGenerator<GenerateContentResponse>,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
): Promise<RelayResult> {
  let sent = 0;
  let finishReason: string | undefined;
  let thoughtsTokens: number | undefined;
  for await (const chunk of stream) {
    const text = chunk.text;
    if (text) {
      sent += text.length;
      controller.enqueue(encoder.encode(text));
    }
    finishReason = chunk.candidates?.[0]?.finishReason ?? finishReason;
    thoughtsTokens = chunk.usageMetadata?.thoughtsTokenCount ?? thoughtsTokens;
  }
  return { sent, finishReason, thoughtsTokens };
}

/** 本文が空だったときのメッセージ。原因が分かるよう終了理由も小さく添える */
function emptyReplyMessage(result: RelayResult): string {
  const base = "……ごめん、今ちょっとうまく言葉が出てこなかった。もう一回言ってくれる？";
  const hints: string[] = [];
  if (result.finishReason) hints.push(result.finishReason);
  if (result.thoughtsTokens) hints.push(`thoughts:${result.thoughtsTokens}`);
  return hints.length > 0 ? `${base}\n[${hints.join(" / ")}]` : base;
}

function isModelNotFound(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  // 存在しないエイリアスは 404 ではなく 400 INVALID_ARGUMENT で返ってくることがあるので、
  // モデル名絡みっぽいエラーは広めに拾ってフォールバックへ回す
  return /404|NOT_FOUND|not found|400|INVALID_ARGUMENT/i.test(msg) && /model/i.test(msg);
}

function isInvalidArgument(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /400|INVALID_ARGUMENT/i.test(msg);
}

/**
 * 思考トークンの設定と安全フィルタの設定は、モデルによって受け付ける形が違い、
 * 合わないと 400 invalid argument で弾かれる。効かせたい順に候補を並べて、
 * 弾かれたら次の形へ落としていく。
 *
 * 思考を最小にしたいのは、見えない思考トークンが maxOutputTokens を食い潰して
 * 本文が空になったり途中で切れたりするのを防ぐため。
 * 安全フィルタを緩めたいのは、恋人同士のふつうの甘い会話が
 * 途中で打ち切られてしまうのを防ぐため。
 */
function configVariants(systemInstruction: string): GenerateContentConfig[] {
  const base: GenerateContentConfig = {
    systemInstruction,
    temperature: 1.05,
    topP: 0.95,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  };

  const categories = [
    HarmCategory.HARM_CATEGORY_HARASSMENT,
    HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
  ];
  const safetyOff = categories.map((category) => ({
    category,
    threshold: HarmBlockThreshold.OFF,
  }));
  const safetyNone = categories.map((category) => ({
    category,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  }));

  // 3.x 以降は thinkingLevel、それより前は thinkingBudget で思考量を指定する。
  // どちらが通るか分からないので両方を順に試す
  const minimalLevel = { thinkingLevel: ThinkingLevel.MINIMAL };
  const zeroBudget = { thinkingBudget: 0 };

  return [
    { ...base, safetySettings: safetyOff, thinkingConfig: minimalLevel },
    { ...base, safetySettings: safetyNone, thinkingConfig: minimalLevel },
    { ...base, safetySettings: safetyOff, thinkingConfig: zeroBudget },
    { ...base, safetySettings: safetyNone, thinkingConfig: zeroBudget },
    { ...base, safetySettings: safetyNone },
    { ...base },
  ];
}

/**
 * 使える設定の形を上から順に試してストリームを開く。
 * 実際に通った設定も返す（空返答で聞き直すときに同じ形を使いたいので）
 */
async function startStream(
  ai: GoogleGenAI,
  model: string,
  contents: Content[],
  systemInstruction: string,
  forceConfig?: GenerateContentConfig,
): Promise<{ stream: AsyncGenerator<GenerateContentResponse>; config: GenerateContentConfig }> {
  const variants = forceConfig ? [forceConfig] : configVariants(systemInstruction);
  let lastError: unknown;

  for (const config of variants) {
    try {
      const stream = await ai.models.generateContentStream({ model, contents, config });
      return { stream, config };
    } catch (e) {
      // モデル名そのものが違うときは、設定を変えても無駄なのですぐ諦める
      if (isModelNotFound(e)) throw e;
      // 設定が受け付けられないときだけ次の形へ落とす
      if (!isInvalidArgument(e)) throw e;
      lastError = e;
    }
  }
  throw lastError;
}

// 画像/音声/埋め込み専用など、雑談の返信には使えないモデル
const NOT_CHAT_MODEL = /embed|image|imagen|vision|audio|tts|veo|aqa|learnlm|native-audio|live/i;
// preview/exp/thinking系や、出たばかりの世代は無料枠がまだ十分に開放されて
// いないことがあるので、最後の手段にする
const RISKY_QUOTA = /exp|preview|thinking/i;

/** モデル名から "gemini-3.5" のような世代番号を取り出す（新しさの参考程度に使う） */
function modelGeneration(name: string): number {
  const m = /gemini-(\d+(?:\.\d+)?)/.exec(name);
  return m ? parseFloat(m[1]) : -1;
}

/**
 * このAPIキーで実際に generateContent が使えるモデルを探す。
 * リクエストしたものと同じ名前は除く（それは今まさに失敗したモデルなので）。
 *
 * Google AI Studio の「モデルごとのレート制限」で確認したところ、
 * 世代の新しさよりも lite が付くモデルの方が無料枠（RPM）が広かった
 * （出たばかりの世代はむしろ枠が狭いこともある）。そのため lite を最優先にし、
 * 次に通常の flash、最後に preview/exp系の順で選ぶ
 */
async function findFallbackModel(
  ai: GoogleGenAI,
  excludeModel: string,
): Promise<string | null> {
  try {
    const names = await listUsableModelNames(ai);
    const candidates = names.filter((n) => n !== excludeModel);
    const safe = candidates.filter((n) => !NOT_CHAT_MODEL.test(n));
    // 全部が画像/音声系だった場合の保険として、除外前の一覧にも戻れるようにする
    const pool = safe.length > 0 ? safe : candidates;

    const byNewest = (a: string, b: string) => modelGeneration(b) - modelGeneration(a);
    const flash = pool.filter((n) => /flash/i.test(n) && !RISKY_QUOTA.test(n));
    const flashLite = flash.filter((n) => /lite/i.test(n)).sort(byNewest);
    const flashOther = flash.filter((n) => !/lite/i.test(n)).sort(byNewest);
    const flashRisky = pool.filter((n) => /flash/i.test(n) && RISKY_QUOTA.test(n)).sort(byNewest);
    const pro = pool.filter((n) => /pro/i.test(n)).sort(byNewest);

    return (
      flashLite[0] ??
      flashOther[0] ??
      flashRisky[0] ??
      pro.find((n) => !RISKY_QUOTA.test(n)) ??
      pro[0] ??
      pool[0] ??
      null
    );
  } catch {
    return null;
  }
}

/** generateContent に対応したモデル名（"models/" は外した形）の一覧 */
async function listUsableModelNames(ai: GoogleGenAI): Promise<string[]> {
  const names: string[] = [];
  const pager = await ai.models.list();
  for await (const model of pager) {
    if (!model.name || !model.supportedActions?.includes("generateContent")) continue;
    names.push(model.name.replace(/^models\//, ""));
  }
  return names;
}

/** Gemini のエラーをキャラが困っている風の日本語に変換する */
async function friendlyError(
  e: unknown,
  ai: GoogleGenAI,
  requestedModel: string,
  usedModel: string,
): Promise<string> {
  const msg = e instanceof Error ? e.message : String(e);
  // フォールバック先を使っていたときは、どのモデルの話かが分かるようにする
  const modelNote = usedModel !== requestedModel ? `（${usedModel} で）` : "";

  if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
    return `（無料枠の上限に届いちゃったみたい${modelNote}。少し時間をおいてから、もう一度話しかけてね）`;
  }
  if (/401|403|API key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(msg)) {
    return "（APIキーが正しくないみたい。Google AI Studio で発行したキーを .env.local に入れ直してね）";
  }
  if (isModelNotFound(e)) {
    const names = await listUsableModelNames(ai).catch(() => []);
    const hint =
      names.length > 0
        ? `このAPIキーで使えそうなのは ${names.slice(0, 3).join(" / ")} など。`
        : "このAPIキーで使えるモデルが見つからなかった。";
    return `（「${requestedModel}」というモデルが見つからなかった。${hint} GEMINI_MODEL に設定してみてね）`;
  }
  if (/SAFETY|blocked/i.test(msg)) {
    return "……ごめん、その話はうまく返せなさそう。ほかのこと話そ？";
  }
  // ここに来るのは想定外のエラーなので、次に同じ状況になったときすぐ分かるよう
  // 元のエラーメッセージの先頭部分だけ添えておく
  const detail = msg.slice(0, 220).replace(/\s+/g, " ").trim();
  return `（うまく繋がらなかったみたい。少しだけ待ってから、もう一度送ってみて）\n[${detail}]`;
}
