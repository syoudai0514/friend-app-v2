# friend-app-v2 情緒表現・自然音声アーキテクチャ設計

Status: **DESIGN / REVIEW REQUESTED**  
Target repository: `syoudai0514/friend-app-v2`  
Reviewed against current `main`: 2026-08-30  
Scope: **設計のみ。実装・本番反映はこの文書のレビュー後。**

---

## 1. 背景と目的

現在の会話は、LLMの返答をほぼそのまま1つの吹き出しへ表示し、先頭の表情タグだけでVRM表情を変えている。
この方式は軽量だが、会話が「セリフだけ」に寄りやすく、以下が表現しにくい。

- 一瞬の戸惑い、嬉しさ、照れ、ためらいなどの**感情の変化**
- 視線、姿勢、間、沈黙などの**非言語表現**
- 場の空気、距離感、雰囲気の変化
- 実際に口から出した言葉と、地の文・情景描写の明確な分離
- キャラクターごとの自然な音声
- 発話内容とVRMの口・表情・モーションの同期

今回の目的は、会話を「テキストチャット」から、**キャラクターがその場で考え、反応し、話しているように感じる会話体験**へ発展させることである。

---

## 2. CURRENT実装で確認した事実

### 2.1 会話出力

`src/lib/prompt.ts` は現在、LLMに以下を要求している。

- 先頭に `[happy]` / `[shy]` 等の表情タグを1つ
- その後に会話本文
- 必要な場合のみ末尾に `[memory: ...]`

`src/app/chat/page.tsx` はストリームを受信し、表情タグとmemoryタグを除去して、残った本文をモデル吹き出しへ表示している。

したがって、現在のモデル返答は実質以下の1レイヤーである。

```text
expression + speech text
```

### 2.2 保存形式

`ChatMessage` は現在、

```ts
{
  role: "user" | "model";
  text: string;
  at: number;
}
```

のみ。

既存データ互換を壊さないため、今回の設計では `text` を残し、追加情報は optional field とする。

### 2.3 音声

`src/lib/speech.ts` は **音声入力（SpeechRecognition）専用**であり、キャラクターの読み上げ機能はない。

### 2.4 口パク

`VrmModel.tsx` の現在の口パクは、LLMが返答生成中 (`talking=true`) に `aa` blendshape を周期的に動かしている。

つまり現在は、

```text
「返答を考えている時間」 = 口を動かす時間
```

であり、将来TTSを導入した場合には、

```text
「音声再生中」 = 口を動かす時間
```

へ変更する必要がある。

---

# Part A. 情緒・雰囲気・実発言の分離

## 3. 表現モデル

1回のキャラクター返答を、以下の3レイヤーへ分離する。

### Layer 1: Scene / Narration

ユーザーに見せる「地の文」。

例:

> しずくは一瞬目を丸くした。頬が少し赤くなり、視線を横へ逃がす。

役割:

- 表情の変化
- 視線
- 仕草
- 沈黙・間
- 距離感
- 場の雰囲気

### Layer 2: Spoken Dialogue

キャラクターが**実際に発声した言葉**。

例:

> 「……急にそういうこと言うんですね。ふふ、でも嬉しいです」

TTSで読むのは原則この部分だけ。

### Layer 3: Hidden Performance Metadata

UIには直接表示しない制御情報。

例:

```json
{
  "expression": "shy",
  "emotionIntensity": 0.72,
  "motionCue": "look_away",
  "voiceStyle": "soft_shy"
}
```

これをVRM表情・将来のモーション・声質へ連動させる。

---

## 4. 「説明しすぎない」ことを重要ルールとする

リアルさを出すため、ナレーションはキャラの心を全部説明しない。

悪い例:

> しずくはあなたが大好きなので、嬉しさと恥ずかしさを感じた。

良い例:

> しずくは一瞬言葉を止め、頬を少し赤くして視線をそらした。

理由:

- 感情を明示しすぎると小説の解説文になる
- 人間同士の会話は、視線・間・声色から感情を推測する
- ユーザーに「読み取る余地」を残した方がキャラクターを生きているように感じやすい

設計原則は **show, don't explain** とする。

---

## 5. 毎ターン必ずナレーションを出さない

ナレーションを毎回出すと、逆に単調になる。

推奨:

- 普通の短い返答: narrationなしでもよい
- 感情変化がある: 1文
- 大きな感情変化・重要な会話: 最大2文

目安:

```text
narration: 0〜80文字
speech: 1〜4文、概ね20〜180文字
```

「何も起きない」という選択肢を持たせる。

---

## 6. 新しい会話レスポンス契約

### 推奨データ型

```ts
export type EmotionId =
  | "normal"
  | "happy"
  | "shy"
  | "sad"
  | "angry"
  | "surprised"
  | "sleepy";

export type VoiceStyleId =
  | "neutral"
  | "bright"
  | "soft"
  | "shy"
  | "sad"
  | "serious"
  | "excited";

export interface ModelPerformance {
  narration?: string;
  speech: string;
  expression: EmotionId;
  emotionIntensity?: number; // 0.0 - 1.0
  motionCue?: string;
  voiceStyle?: VoiceStyleId;
}

export interface ChatMessage {
  role: "user" | "model";
  text: string;
  at: number;
  performance?: ModelPerformance;
}
```

### backward compatibility

`text` は引き続き残す。

モデル返答の場合:

```text
text = performance.speech
```

とする。

これにより:

- 既存save dataはそのまま読める
- 新fieldを知らない旧コードでもspeechは表示できる
- v1互換を極力崩さない

---

## 7. LLM出力プロトコル

### 結論

**ユーザー表示用のタグ文字列を直接ストリームする現方式から、構造化イベント方式へ移行する。**

推奨方式は NDJSON または SSE。

LLM内部出力例:

```jsonl
{"type":"state","expression":"shy","intensity":0.72,"motionCue":"look_away","voiceStyle":"shy"}
{"type":"narration","text":"しずくは一瞬目を丸くし、頬を少し赤くして視線をそらした。"}
{"type":"speech","text":"……急にそういうこと言うんですね。ふふ、でも嬉しいです。"}
{"type":"memory","text":"ユーザーはしずくと手をつなぎたい"}
```

サーバーは1行単位で検証してクライアントへイベント化する。

### なぜ単純JSON 1個ではなくイベント方式か

単一JSONは堅牢だが、全生成完了まで表示開始できない。

イベント方式なら:

1. 表情を先に変更
2. narration表示
3. speech表示
4. 完成したspeechでTTS開始

という自然な順序にできる。

### フォールバック

構造化出力に失敗した場合:

```text
speech = 従来の本文
expression = normal
narration = undefined
```

として会話自体は止めない。

---

## 8. Prompt方針

従来の

```text
[expression] 本文 [memory]
```

指定を廃止し、以下を明示する。

### narration生成ルール

- キャラ本人の外から観察できる動作を優先
- 心情の直接説明は最小限
- 同じ「頬を赤らめる」「視線をそらす」を連続使用しない
- ユーザーの行動を勝手に確定しない
- 現実にキャラクターが実行できない動作を過度に描写しない
- narrationなしも許可

### speech生成ルール

- Personaの口調を最優先
- narrationの内容をもう一度セリフで説明しない
- 人間らしい言い直し、短い間、ためらいは許可
- 毎回質問で終わらせない
- 同じ定型句を連打しない

---

## 9. UI設計

モデル返答は以下の順に表示する。

```text
[小さな地の文カード]
しずくは一瞬目を丸くし、頬を少し赤くして視線をそらした。

しずく
[通常の会話吹き出し]
……急にそういうこと言うんですね。ふふ、でも嬉しいです。
```

### narration UI

- 文字サイズ: speechより小さめ
- 半透明
- italic相当または弱い色
- キャラ名ラベルは付けない
- 長くても2文

### speech UI

現在のmodel bubbleを継続利用。

### 音声ボタン

model bubbleごとに小さな再生ボタンを設ける。

```text
🔊 再生 / ⏸ 停止
```

設定で「返答を自動再生」をON/OFFできるようにする。

---

# Part B. キャラクター自然音声

## 10. 要件

- 5キャラそれぞれ違う声
- 機械音感をなるべく避ける
- 日本語の自然さを最重視
- Personaの性格に合わせた声質
- 感情によって話速・強さを多少変更
- narrationは読まず、speechのみ発声
- iPhone PWAで動作
- APIキーはクライアントへ露出しない
- 将来providerを変更できる
- ライセンス条件をコード上で管理する

---

## 11. Provider抽象化を最初から行う

直接AivisやCOEIROINK専用コードをChatPageへ書かない。

```ts
export interface TtsRequest {
  personaId: string;
  text: string;
  style?: VoiceStyleId;
  emotionIntensity?: number;
}

export interface TtsProvider {
  synthesize(request: TtsRequest): Promise<TtsResult>;
}
```

サーバー側:

```text
/api/tts
  -> voice registry
  -> provider adapter
      -> Aivis Cloud
      -> COEIROINK gateway
      -> ElevenLabs
      -> fallback
```

これにより、声の比較・差し替えをアプリ本体から分離する。

---

## 12. Provider候補評価（2026-08-30時点）

### A. Aivis Cloud API — 第一候補

推奨: **Production primary candidate**

理由:

- 日本語特化
- 自然さ・感情表現を強く意識したTTS
- Cloud APIあり
- 低遅延ストリーミングを公式に提供
- AivisSpeech/AivisHubの複数モデルを利用可能
- 将来自作モデルへ移行可能
- VercelサーバーrouteからAPIを呼びやすい

注意:

- 各音声モデルのライセンスは別途確認必須
- 料金・rate limitを本番トラフィックに合わせて確認

公式情報ではCloud APIはリアルタイム用途を想定し、最速0.3秒で音声生成開始としている。

### B. COEIROINK + つくよみちゃん — 有力な個別キャラ候補

つくよみちゃんは候補として残す。

2026-08-30確認時点で、COEIROINK上のつくよみちゃん音声は:

- 非商用: 可
- 個人商用: 可
- 法人商用: 可
- 別キャラクターへの声当て: 可
- クレジット: 必須

したがってfriend-app-v2の別キャラへ声を当てること自体は規約上可能。

ただしCOEIROINKはローカルエンジン中心なので、Vercelだけでproduction TTSを完結させる構成には向かない。
採用する場合は別途常駐TTS gateway/serverが必要。

推奨用途:

- 特定キャラの声が非常に合う場合
- local/self-host検証
- Aivisとの音質比較

### C. ElevenLabs — 品質比較用 / second provider

- 日本語TTS APIあり
- 多言語向け高品質音声
- API実装が容易

ただし:

- コスト
- 外部サービス依存
- voice利用権確認
- 日本語キャラ演技の好み

を考慮し、第一実装ではなく**品質ベンチマーク**として使う。

### D. VOICEVOX

- 無料
- API利用しやすい
- 多数のキャラクター

一方、本要望の「機械音ではなく自然な声」を最優先すると第一候補にはしない。
fallback / 比較対象とする。

### E. Browser SpeechSynthesis

production voiceには使用しない。

理由:

- iPhone/OSごとに声が変わる
- キャラごとの声を保証できない
- 品質・速度の再現性が低い

障害時のfallbackだけを想定。

---

## 13. 推奨Voice Casting

特定の音声モデル名を設計段階で固定しない。

5キャラごとに2〜3音声を試聴し、実機でA/B評価する。

### アイミー

- 明るい
- 若い
- テンポ速め
- 感情振幅大

### しずく

- 柔らかい
- 少し息を含む
- ゆっくり
- 安心感

つくよみちゃんはこの系統の候補として試聴価値あり。

### なぎ

- 少し低め
- クール
- 感情を抑えた声
- 照れ時だけ柔らかくなる

### ひなた

- 明るく高め
- テンポ速め
- 元気

### れな

- 落ち着いた大人
- 少し低め
- ゆっくり
- 余裕がある

---

## 14. Voice Registry

Personaへ直接provider固有IDを埋め込まず、独立registryにする。

```ts
export interface VoiceProfile {
  personaId: string;
  provider: "aivis" | "coeiroink" | "elevenlabs" | "browser";
  voiceId: string;
  modelId?: string;
  baseSpeed: number;
  basePitch?: number;
  credit?: string;
  commercialAllowed: boolean;
  otherCharacterAllowed: boolean;
  reviewedAt: string;
}
```

例:

```ts
const VOICES = {
  shizuku: {
    provider: "coeiroink",
    voiceId: "tsukuyomi-chan",
    credit: "COEIROINK:つくよみちゃん",
    commercialAllowed: true,
    otherCharacterAllowed: true,
    reviewedAt: "2026-08-30"
  }
}
```

実際の採用voiceは試聴後に決定する。

---

## 15. ライセンスを実装要件にする

音声を選ぶときは品質だけで決めない。

各voiceについて最低限以下を記録する。

```text
provider
voice/model name
license URL
commercial use
other-character use
credit required
adult-content restrictions
redistribution restrictions
reviewed date
```

設定画面またはアプリ内「クレジット」に必要な表記を集約する。

特につくよみちゃん/COEIROINK採用時は、ユーザーから確認可能な場所へクレジット表示を設ける。

---

## 16. TTS API設計

### Endpoint

```http
POST /api/tts
```

Request:

```json
{
  "personaId": "shizuku",
  "text": "ふふ、来てくれたんですね。",
  "style": "soft",
  "emotionIntensity": 0.5
}
```

Response:

```text
audio/mpeg or audio/wav stream
```

### セキュリティ

- TTS API keyはserver envのみ
- クライアントへprovider keyを返さない
- `personaId` からserver側でvoiceを決定
- clientから任意voiceIdを指定させない
- text length上限を設ける

---

## 17. 音声生成タイミング

### 推奨

1. Geminiがspeech完成
2. speechを画面表示
3. auto voice ONなら `/api/tts`
4. 音声をstream再生
5. 再生開始時に口パク開始
6. 再生終了時に口パク停止

narrationは読み上げない。

### 将来最適化

speechが複数文の場合は、文単位TTS先読みも検討可能。

Phase 1では分割せず、1返答=1TTS requestでよい。

---

## 18. Lip Sync設計

現在の

```text
busy => sin波でaa口パク
```

は廃止する。

### Phase 1

```text
audio playing => aaを自然周期で動かす
```

まず生成中ではなく**実際の再生時間**へ同期するだけでも大きく改善する。

### Phase 2

Web Audio API `AnalyserNode` でRMS音量を取得し、

```text
aa = clamp(rms * gain)
```

で口の開きを音量へ同期する。

これにより:

- 無音部分で口を閉じる
- 大きな発声で口が開く
- 文末で自然に閉じる

### Phase 3 optional

providerがphoneme/viseme timingを返せる場合だけ、

```text
aa / ih / ou / ee / oh
```

の母音lip syncへ拡張。

最初からここまで行わない。

---

## 19. emotion -> voice mapping

voiceStyleをLLMが完全自由入力するのではなく、有限集合にする。

例:

```ts
const DELIVERY = {
  neutral: { speed: 1.00 },
  bright:  { speed: 1.06 },
  excited: { speed: 1.10 },
  soft:    { speed: 0.94 },
  shy:     { speed: 0.92 },
  sad:     { speed: 0.90 },
  serious: { speed: 0.95 }
};
```

providerごとに対応可能なパラメータへ変換する。

LLMにpitch/speedの生数値を直接決めさせない。

理由:

- キャラ声がターンごとに不安定になる
- 極端値を出す可能性
- provider交換が難しくなる

---

## 20. emotion -> VRM mapping

既存expression 7種は残す。

```text
normal
happy
shy
sad
angry
surprised
sleepy
```

追加metadata:

```text
emotionIntensity: 0..1
motionCue
```

### motionCue Phase 1

新規VRMAを大量に作る必要はない。

まず既存モーションを壊さず、ボーン差分で小さく表現できるものだけ採用。

例:

```text
look_away
small_nod
head_tilt
lean_forward_small
```

大きな動作は後でVRMA化する。

---

## 21. Chat UI状態遷移

現在の `busy` 1個だけでは足りない。

推奨:

```ts
type ConversationPhase =
  | "idle"
  | "thinking"
  | "receiving"
  | "tts-loading"
  | "speaking";
```

### VRM挙動

```text
thinking     -> 口を動かさない
receiving    -> 表情だけ先に変化してよい
tts-loading  -> 小さな待機表情
speaking     -> lip sync ON
idle         -> 通常idle
```

これだけでも「考えているのに口がパクパクする」違和感が消える。

---

## 22. Audio UX

設定項目:

```text
音声を使う        ON/OFF
返答を自動再生    ON/OFF
音量              0-100
ナレーション表示  ON/OFF
```

モデル吹き出しごとに:

```text
🔊 再生
```

を設置する。

自動再生OFFでも、過去の返答をタップして再生可能にする。

---

## 23. Privacy / Cache

会話は親密な内容を含む可能性が高い。

Phase 1ではサーバー側に生成音声を永続保存しない。

```text
Gemini API -> existing
TTS provider -> speech text only
Audio -> browserで再生
```

推奨:

- server persistent cacheなし
- provider request logging条件を確認
- 設定画面に利用providerを表示

将来コスト削減が必要になった場合のみ、定型idle line等に限定してstatic cacheする。

ユーザー固有会話のCDN永続cacheは初期実装では行わない。

---

# Part C. 実装ロードマップ

## Phase E1 — Structured Emotion

目的: 地の文とセリフの分離だけ完成させる。

変更候補:

```text
src/lib/types.ts
src/lib/prompt.ts
src/app/api/chat/route.ts
src/app/chat/page.tsx
src/lib/dialogue-protocol.ts  NEW
```

Acceptance:

- narrationとspeechが別表示
- speechだけがChatMessage.textにも保存される
- 既存save dataが読める
- expressionが現在同様に動く
- narrationなしの返答も正常
- malformed model outputで会話が壊れない

---

## Phase E2 — Voice Provider PoC

目的: 1キャラだけ自然音声を出す。

第一候補: Aivis Cloud API

変更候補:

```text
src/app/api/tts/route.ts       NEW
src/lib/voice/types.ts         NEW
src/lib/voice/registry.ts      NEW
src/lib/voice/providers/*      NEW
src/lib/useCharacterVoice.ts   NEW
```

Acceptance:

- しずく1キャラでTTS再生
- API keyはbrowserへ露出しない
- narrationを読まない
- auto play ON/OFF
- 再生ボタンあり
- iPhone実機で音が出る

---

## Phase E3 — 5 Character Casting

目的: 各キャラに別voiceを割り当てる。

作業:

- 各キャラ2〜3 voiceを試聴
- 実機A/B
- ライセンス確認
- `voice-registry.ts`へ確定値登録
- credits UI

つくよみちゃん採用はこのPhaseで判断する。

---

## Phase E4 — Audio Lip Sync

目的: 音声と口を同期。

Acceptance:

- thinking中は口を動かさない
- speaking中のみ口を動かす
- 音声の無音に合わせて口が閉じる
- audio stop / route changeで必ず停止

---

## Phase E5 — Emotion Performance

目的: narration metadataを3D演技へつなぐ。

- emotionIntensity
- look away
- small nod
- head tilt
- voice style

を追加。

大きなジェスチャーは既存VRMA追加工程へ回す。

---

# Part D. テスト

## 24. Structured response tests

最低ケース:

1. narration + speech
2. speech only
3. memoryあり
4. narrationに改行
5. malformed JSON line
6. stream途中切断
7. expression unknown
8. empty speech
9. 旧ChatMessage load

---

## 25. Voice tests

- Japanese punctuation
- `……`
- `〜`
- 英数字混在
- 人名
- 長文
- emoji除去
- 連続再生
- persona切替中の再生停止
- iOS mute / autoplay制約
- Bluetoothイヤホン
- app background -> foreground

---

## 26. UX評価テスト

同じ会話を以下でA/Bする。

A:

```text
speech only
```

B:

```text
narration + speech + expression + voice
```

評価項目:

```text
キャラが生きている感じ
感情が伝わる
会話が単調でない
セリフが自然
ナレーションが邪魔でない
声がキャラに合う
待ち時間が気にならない
```

5段階で比較する。

---

# Part E. 設計判断

## 27. 今回の推奨結論

### Decision 1

**情緒表現は「ナレーション」と「実発言」を別データとして持つ。**

セリフ本文に `(照れながら)` のような動作を混ぜ続けない。

### Decision 2

**モデル出力を構造化する。**

現行 `[happy] text [memory]` の文字列protocolを将来的に卒業する。

### Decision 3

**TTSはprovider abstractionを入れてから実装する。**

1provider直書きはしない。

### Decision 4

**production first candidateはAivis Cloud。**

日本語自然さ、低遅延、クラウド統合のバランスが良い。

### Decision 5

**つくよみちゃんは捨てない。**

別キャラへの声当てが許諾されており、有力voice候補として5キャラcasting時に比較する。

### Decision 6

**TTSが読むのはspeechのみ。**

ナレーションまで読み上げると「小説の朗読」になり、キャラクター本人が話している感覚が弱くなる。

### Decision 7

**口パクはLLM生成中ではなくaudio playbackへ同期する。**

これはTTS導入と同時に直すべき既存違和感。

---

# Part F. SOLレビュー依頼事項

レビューでは特に以下を確認してほしい。

1. NDJSON/SSE方式とGemini streamingの相性により良い選択肢がないか
2. `ChatMessage.text = speech` を維持するbackward compatibility方針が妥当か
3. narrationが会話を冗長にしないprompt制約が十分か
4. Aivis Cloud primary / COEIROINK optionalという選定が妥当か
5. iPhone PWAのaudio autoplay制約への設計漏れがないか
6. Web Audio analyserによるlip syncが性能面で妥当か
7. TTS privacy / logging / cache方針に不足がないか
8. 既存memory・expression・VRMAロジックへのデグレリスク
9. Phase分割が細かすぎない/大きすぎないか
10. 実装前に追加すべきテスト

---

## 28. 実装開始条件

以下を満たしてから実装へ進む。

```text
[ ] SOL設計レビュー完了
[ ] 構造化response protocol確定
[ ] Aivis Cloudで1キャラ試聴
[ ] つくよみちゃんを同じセリフで比較試聴
[ ] voice license一覧作成
[ ] iPhone PWA audio再生PoC
```

---

## 29. 外部仕様確認先

2026-08-30時点で確認した公式情報:

- Aivis Cloud API / AivisSpeech / AivisHub
- COEIROINK 利用規約
- COEIROINK つくよみちゃん音声利用条件
- VOICEVOX 利用規約
- ElevenLabs Text-to-Speech API

各voice/modelの利用条件は実装着手時にも再確認すること。音声モデルのライセンスはソフトウェア本体のライセンスと別の場合がある。
