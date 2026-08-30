# friend-app-v2 情緒表現・自然音声アーキテクチャ設計

Status: **IMPLEMENTED (Aivis provider configuration remains intentionally blocked)**
Target repository: `syoudai0514/friend-app-v2`  
Reviewed against current `main`: 2026-08-30  
Scope: Phase 0〜6の安全境界・UI・runtime構造。Phase 7（文単位speculative TTS / phoneme / viseme）は対象外。

---

## 1. 目的

friend-app-v2 の会話を、単調な「セリフだけのチャット」から、**感情の変化・視線・間・場の空気・実際の発言・自然音声・VRM演技が分離されつつ同期する会話体験**へ発展させる。

重要原則は以下。

- LLMは「演技の意味」だけを決める
- RuntimeがVRM・Audio・lip syncの具体制御を決める
- streaming preview と persistent state を分離する
- `turn_complete` を唯一のcanonical transaction boundaryとする
- narrationは表示するがTTSしない
- `ChatMessage.text = speech` を維持する

---

## 2. CURRENT実装との接続点

CURRENTでは以下を確認済み。

- `src/lib/prompt.ts`: `[expression] speech [memory: ...]` の文字列protocol
- `src/app/chat/page.tsx`: Geminiのtext streamを受信し、expression/memoryタグを剥がして `replaceLastModel(text)`
- `src/lib/types.ts`: `ChatMessage = { role, text, at }`
- `src/lib/store.tsx`: state変更ごとにAppState全体をlocalStorageへ永続化
- `src/lib/speech.ts`: ユーザー側 SpeechRecognition のみ
- `VrmModel.tsx`: `talking=true` 中に `aa` を周期的に動かす簡易口パク
- `VrmModel.tsx`: shy表現でhead/eyesのbone offsetを直接適用
- VRMAモーションは既に複数導入済み

CURRENTの `addMessage({ role: "model", text: "" })` → `replaceLastModel()` はstream途中のpartial stateまでlocalStorageへ書き得る。新protocolではこの方式をモデル返答streamingに使わない。

---

# Part A. Canonical Dialogue Contract

## 3. 3層分離

### 3.1 narration

ユーザーに見せる地の文。外から観察できる感情変化・視線・仕草・間・雰囲気を短く表す。

例:

> しずくは一瞬言葉を止め、頬を少し赤くして視線をそらした。

### 3.2 speech

キャラクターが実際に口にする言葉。**TTS対象はこのspeechのみ。**

例:

> ……急にそういうこと言うんですね。ふふ、でも嬉しいです。

### 3.3 hidden performance intent

UIへ直接表示しない意味レベルの演技情報。

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

export type MotionCue =
  | "none"
  | "look_away"
  | "small_nod"
  | "head_tilt"
  | "lean_in";

export type PauseCue = "none" | "short" | "medium";

export interface ModelPerformanceIntent {
  version: 1;
  expression: EmotionId;
  emotionIntensity?: number;
  motionCue?: MotionCue;
  voiceStyle?: VoiceStyleId;
  pause?: PauseCue;
}

export interface ModelTurn {
  protocolVersion: 1;
  narration?: string;
  speech: string;
  memory?: string | null;
  performance: ModelPerformanceIntent;
}
```

### 3.4 保存形式

既存互換のため `ChatMessage.text` は維持する。

```ts
export interface ChatMessage {
  role: "user" | "model";
  text: string;
  at: number;
  narration?: string;
  performance?: ModelPerformanceIntent;
}
```

モデル返答では必ず `ChatMessage.text = ModelTurn.speech` とする。

---

## 4. narration設計

- **default = none**
- 通常: 0〜50文字 / 最大1文
- 重要ターンのみ: 最大80文字 / 最大2文
- show, don't explain
- 心情の直接説明を避ける
- ユーザーの行動を勝手に確定しない
- 同じ描写を連打しない
- narrationをspeechで言い直さない

Gemini通常historyにはnarrationを混ぜない。反復防止のため、直近2ターンのみ別入力で渡す。

```ts
recentPerformance: Array<{
  narration?: string;
  expression?: EmotionId;
  motionCue?: MotionCue;
}>
```

---

# Part B. DialogueProtocol / Transaction Boundary

## 5. Gemini出力protocol

### 5.1 禁止

**Gemini自身にNDJSON/SSEを書かせない。**

### 5.2 正式構成

```text
Gemini
  ↓ schema-enforced structured JSON stream
Server DialogueProtocol
  ↓ incremental parser / validation
Server-owned app events (NDJSON or SSE)
  ↓
Browser
```

GeminiにはJSON Schemaで `ModelTurn` を強制する。

### 5.3 server-owned events

全eventに `turnId` を必須で付与する。

```json
{"type":"performance","turnId":"...","expression":"shy","emotionIntensity":0.7,"motionCue":"look_away","voiceStyle":"soft"}
{"type":"narration","turnId":"...","text":"しずくは一瞬言葉を止め、視線を横へ逃がした。"}
{"type":"speech_delta","turnId":"...","text":"……急に"}
{"type":"speech_delta","turnId":"...","text":"そういうこと言うんですね。"}
{"type":"turn_complete","turnId":"...","turn":{...canonical ModelTurn...}}
```

### 5.4 TurnDraft — volatile only

**streaming previewはAppStateへ入れない。絶対にlocalStorageへ永続化しない。**

```ts
export interface TurnDraft {
  turnId: string;
  narration?: string;
  speech: string;
  performance?: Partial<ModelPerformanceIntent>;
}
```

Clientは概念的に次を持つ。

```ts
const [turnDraft, setTurnDraft] = useState<TurnDraft | null>(null);
```

途中eventは `patchTurnDraft()` でUI previewのみ更新する。

禁止:

```text
speech_delta → AppState.messages更新
narration preview → AppState更新
performance preview → AppState更新
```

### 5.5 Canonical transaction boundary

**`turn_complete` のvalidation PASSだけが副作用を起こせる。**

```text
turn_complete
  ↓ validate canonical ModelTurn
ConversationTransaction
  ├ commitModelMessage
  ├ commitMemory
  ├ gainAffection
  └ mark TTS eligible
  ↓
persistent AppState / localStorage
```

実装APIは概念的に以下へ分離する。

```ts
patchTurnDraft(draftPatch)     // volatile / preview only
commitModelTurn(modelTurn)     // persistent / turn_complete only
```

`patchLastModel()` を新stream protocolの主要APIとして使わない。CURRENTの永続message更新へ引っ張られるため、legacy compatibility用途に限定する。

### 5.6 save invariant

以下を必須不変条件とする。

```text
turn_completeなし
→ model message永続化 0
→ memory commit 0
→ affection加算 0
→ TTS eligibility 0
```

Safari kill / reload / background kill / stream切断時もpartial model messageを残さない。

### 5.7 retry / fallback

禁止:

- raw JSON断片をspeechとして表示
- raw JSON断片をTTS

fallback:

1. structured outputを1回retry
2. legacy plain-text adapterへretry
3. 通常のエラーメッセージ

retryが発生してもConversationTransactionは1回だけcommit可能にする。

既存 `splitExpression()` / `splitMemory()` はlegacy adapter専用。

### 5.8 memory

新protocolでは `[memory: ...]` を廃止し、canonical responseへ持つ。

```ts
memory?: string | null
```

---

## 6. turn identity / stale response protection

Clientは各生成に一意な `turnId` と `AbortController` を持つ。

```text
activeTurnId
activeAbortController
```

受信eventについて:

```text
event.turnId !== activeTurnId
→ discard
```

persona切替 / route変更 / 新しいgeneration開始時は1セットで行う。

```text
abort generation
abort TTS
clear TurnDraft
invalidate activeTurnId
```

旧personaの遅延 `turn_complete` が新persona stateへcommitされることを禁止する。

---

## 7. affection更新

CURRENTのような「stream終了後に単純加算」はやめる。

`gainAffection(1)` は **ConversationTransactionの中で、canonical `turn_complete` validation PASS時だけ**実行する。

structured retry / legacy retry / abortで二重加算しない。

1 turnにつき `affection +1以下` を不変条件とする。

---

# Part C. PerformanceController

## 8. 演技責務の分離

LLMが返してよいもの:

```text
expression = shy
motionCue = look_away
voiceStyle = soft
emotionIntensity = 0.7
```

LLMに返させないもの:

- VRMA ID
- bone角度
- blendshape値
- lipSync値
- AudioContext状態
- 再生時刻

```text
ModelTurn.performance
        ↓
PerformanceController
 ├ ExpressionController
 ├ Gaze/PoseController
 ├ MotionController
 └ VoiceController
        ↓
VrmModel / AudioSessionController
```

推奨priority:

```text
1. VRMA base motion
2. semantic pose overlay
3. gaze/eyes overlay
4. expression morph
5. lip sync morph
```

同一boneへ複数overlayを無秩序に直接書き込まない。

Phase 1〜3では `motionCue` を保存しても実行しない。

---

# Part D. Voice Architecture

## 9. Provider方針

第一候補: **Aivis Cloud**  
キャラ別候補: **COEIROINK / つくよみちゃん**  
品質比較候補: **ElevenLabs**

Browser SpeechSynthesisはproduction自動fallbackにしない。

```ts
export interface TtsRequest {
  personaId: string;
  text: string;
  style?: VoiceStyleId;
  emotionIntensity?: number;
}
```

```text
/api/tts
  ↓
VoiceRegistry
  ↓
ProviderAdapter
 ├ Aivis Cloud
 ├ COEIROINK gateway
 └ ElevenLabs (optional)
```

### 9.1 TTS開始境界

**Phase 1〜6では、TTS input sourceは `turn_complete.ModelTurn.speech` のみ。**

禁止:

```text
speech_delta → TTS
TurnDraft.speech → TTS
preview narration → TTS
```

transaction境界を揃える。

```text
turn_complete
 ├ save
 ├ memory commit
 ├ affection update
 └ TTS eligible
```

Phase 7で文単位先読みを導入する場合のみ、別途speculative audio protocolを設計する。

---

## 10. Voice Registry

```ts
export interface VoiceProfile {
  voiceProfileId: string;
  provider: "aivis" | "coeiroink" | "elevenlabs";
  voiceId: string;
  modelId?: string;
  modelVersion?: string;
  baseSpeed: number;
  basePitch: number;
  styleMap: Partial<Record<VoiceStyleId, string>>;
  fallbackVoiceProfileId?: string;
  license: {
    url: string;
    commercialScope: string;
    otherCharacterUse: string;
    attributionRequired: boolean;
    attributionText?: string;
    contentRestrictions?: string;
    redistributionRestrictions?: string;
    reviewedAt: string;
  };
  productionApproved: boolean;
}
```

fallback順:

```text
primary voice
→ transient retry 1回
→ approved secondary voice
→ text-only
```

---

## 11. Privacy境界

**TTS Providerへ送信可能なのは `ModelTurn.speech` のみ。**

送信禁止:

- user message
- narration
- memory
- system prompt
- persona prompt全文
- recentPerformance

通常logへTTS本文を残さない。

```text
requestId
provider
personaId
characterCount
latencyMs
status
```

表示speechとTTS入力の間に `ttsTextNormalizer` を置く。

---

# Part E. AudioSessionController

## 12. state

```ts
type AudioState =
  | "locked"
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "interrupted"
  | "error";

type GenerationState =
  | "idle"
  | "requesting"
  | "streaming"
  | "complete"
  | "error";
```

`generationState` と `audioState` は直交させる。

初回「音声ON」または再生ボタンの明示的user gestureでunlockする。`audio.play()` Promise rejectionを必ず処理する。

監視対象:

- `visibilitychange`
- `pageshow`
- `pagehide`
- `playing`
- `pause`
- `ended`
- `error`
- persona切替
- route変更
- 新しい発話開始

backgroundでは無理に再生継続しない。foreground復帰時も勝手に途中再開しない。

`fetch().body` をそのまま `<audio>` へ渡す前提にせず、PoCでtransportを選定する。

---

# Part F. Lip Sync

## 13. 原則

```text
thinking/requesting/streaming中 → 口を動かさない
actual audio playing中 → lip sync
```

段階導入:

1. audio stateだけで簡易open/close
2. `AnalyserNode` RMSで音量連動

Web Audio不具合がある実機ではlip syncをOFFにし、音声再生を優先する。

`lipSync` をLLM metadataへ含めない。

---

# Part G. UI / Cache

## 14. 表示

```text
[小さな半透明 narration]
しずくは一瞬言葉を止め、視線を横へ逃がした。

しずく
[通常speech bubble]
……急にそういうこと言うんですね。ふふ、でも嬉しいです。
                         🔊
```

TurnDraftはpreview表示に使ってよいが、リロード後に残らない。

canonical `turn_complete` 後にのみ履歴messageとして確定表示する設計でもよい。PoCでUXを比較する。

session内では同じmodel messageの再生Blobをmemory cacheし、再再生で再課金しない。

個人会話speechをCDNへ永続cacheしない。固定idle lineのみ事前生成/cache可。

---

# Part H. Phase 0 Technical PoC Gate

## 15. PoC 1 — Gemini structured stream / transaction integrity

実証対象:

```text
Gemini structured stream
→ server-owned events
→ TurnDraft
→ turn_complete
→ ConversationTransaction
```

強制試験:

- stream途中でreload
- stream途中で通信切断
- AbortControllerでabort
- persona切替
- route変更
- structured parse failure
- structured retry
- legacy fallback

PASS条件:

- localStorageにpartial model message 0
- `turn_complete` なしのmemory commit 0
- `turn_complete` なしのaffection加算 0
- stale turn commit 0
- raw JSON露出 0
- retryによる二重commit 0

## 16. PoC 2 — iPhone standalone PWA × Aivis

対象: しずく1人

確認:

- 手動再生
- 連続20〜50回
- autoplay after unlock
- 消音状態
- Bluetooth
- background → foreground
- 画面ロック
- persona切替中の停止
- route変更
- 通信遅延
- TTS生成失敗
- play() rejection

計測:

```text
tap → audible first audio
p50
p95
```

PoC後にproduction目標値を固定する。初期目安:

```text
p50 < 1.2s
p95 < 2.5s
```

ただし採否は実測結果とUXを見て最終決定する。

## 17. PoC 3 — transaction side-effect invariant

1 turnにつき必ず:

```text
model message: 0 or 1
memory: 0 or 1
affection: +0 or +1
TTS: 0 or 1
```

retry / abort / persona切替 / route変更で二重副作用が発生しないこと。

## 18. PoC 4 — Voice casting / latency / cost

同じ20セリフで比較。

候補:

- Aivis 2〜3声
- つくよみちゃん
- 必要ならElevenLabs 1声

評価:

- キャラ本人に聞こえるか
- 毎日聞いて疲れないか
- happy/shy/sadでも同一人物に聞こえるか
- first audioまでのms
- 100文字あたりの実コスト

---

# Part I. Implementation Phases

## Phase 1 — Canonical Dialogue Contract / Transaction

- `protocolVersion: 1`
- `ModelTurn`
- `ModelPerformanceIntent`
- `TurnDraft`（volatile only）
- `patchTurnDraft()`
- `commitModelTurn()`
- `ConversationTransaction`
- `turnId`
- `AbortController`
- stale event discard
- memory field化
- legacy adapter
- save互換

音声なし。

## Phase 2 — Emotion UI

- narration + speech分離表示
- canonical narration保存
- recentPerformance直近2ターン
- CURRENT expression動作維持
- motionCueは保存のみ、実行しない

## Phase 3 — One Character Voice

- しずく1人
- Aivis
- 手動再生
- `turn_complete.speech` のみTTS eligible
- AudioSessionController
- Voice Registry
- privacy logging

## Phase 4 — Auto Voice + 5 Character Casting

- audio unlock
- interruption処理
- 自動再生
- 5人voice registry確定
- credits
- approved fallback

## Phase 5 — Audio-driven Lip Sync

- busy口パク削除
- playing連動
- RMS lip sync
- failure時lip sync OFF fallback

## Phase 6 — PerformanceController

- bone ownership
- look_away
- small_nod
- head_tilt
- expression intensity
- VRMA統合

## Phase 7 — Advanced Sync（必要時のみ）

- 文単位TTS先読み
- speculative audio protocol
- viseme/phoneme
- speech-motion同期

---

# Part J. Acceptance Criteria

## 19. Conversation / Persistence

- narrationとspeechが明確に分離
- narrationなしターンを自然に生成
- narration通常50文字以内
- speechのみ通常conversation historyへ入る
- raw structured outputがUIへ露出しない
- memoryがユーザーへ表示されない
- TurnDraftは永続化されない
- `turn_complete` なしのpartial save 0
- stale turn commit 0
- retryで二重commit 0
- 1 canonical turnにつきaffection加算は最大1回

## 20. TTS

- TTS対象はcanonical `turn_complete.ModelTurn.speech` のみ
- narrationを絶対に読み上げない
- user message/memory/system promptをproviderへ送らない
- speech_deltaからTTS開始しない
- approved fallbackのみ使用
- provider障害時にtext-onlyへ安全に落ちる

## 21. iPhone PWA

- user gesture後に安定再生
- background/foregroundで二重再生・勝手な再開なし
- persona/route変更で旧generationと旧音声停止
- play() reject時にUIが壊れない
- first-audio latency p50/p95を記録

## 22. VRM

- thinking中に口パクしない
- audio playing中のみlip sync
- lip sync failureでも音声継続
- VRMA / shy / gaze / motionCueが同一boneへ無秩序に競合しない

---

# Part K. Non-goals

初期実装では行わない。

- 完全な音素viseme
- 感情ごとの専用VRMA大量生成
- 5キャラ×複数provider同時production運用
- narration音声化
- user voice cloning
- 長期音声ファイル永続保存
- Phase 7以前のspeculative TTS

---

## 23. 最終設計判断

第2回SOLレビューのNEW P0である「partial turn保存」を以下で解消する。

```text
Server events
   ↓
TurnDraft (volatile / NEVER persisted)
   ↓ UI preview
turn_complete
   ↓ validation
ConversationTransaction
 ├ commitModelMessage
 ├ commitMemory
 ├ gainAffection
 └ mark TTS eligible
   ↓
persistent AppState
```

加えて以下を正式採用する。

- `turnId` / `AbortController` / stale response discard
- TTS開始境界を `turn_complete.speech` に固定
- affection更新をcanonical transactionへ統合
- `protocolVersion: 1`
- first-audio latency p50/p95計測

これにより、設計上の既知P0は解消済みとみなす。

**次の作業は Phase 0 Technical PoC。PoC PASS前に本実装へ進まない。**
