# friend-app-v2 情緒表現・自然音声アーキテクチャ設計

Status: **REVIEWED / APPROVE WITH CHANGES 反映済み**  
Target repository: `syoudai0514/friend-app-v2`  
Reviewed against current `main`: 2026-08-30  
Scope: **設計のみ。実装は本設計のPoC条件を満たしてから開始する。**

---

## 1. 目的

friend-app-v2 の会話を、単調な「セリフだけのチャット」から、**感情の変化・視線・間・場の空気・実際の発言・自然音声・VRM演技が分離されつつ同期する会話体験**へ発展させる。

今回の設計で最も重要なのは、LLMが決める「演技の意味」と、実機ランタイムが決める「具体的な再生方法」を分離することである。

---

## 2. CURRENT実装との接続点

CURRENTでは以下を確認済み。

- `src/lib/prompt.ts`: `[expression] speech [memory: ...]` の文字列protocol
- `src/app/chat/page.tsx`: Geminiのtext streamを受信し、expression/memoryタグを剥がして `replaceLastModel(text)`
- `src/lib/types.ts`: `ChatMessage = { role, text, at }`
- `src/lib/speech.ts`: ユーザー側 SpeechRecognition のみ
- `VrmModel.tsx`: `talking=true` 中に `aa` を周期的に動かす簡易口パク
- `VrmModel.tsx`: shy表現でhead/eyesのbone offsetを直接適用
- VRMAモーションは既に複数導入済み

したがって、既存互換を壊さず、会話・演技・音声を段階的に分離する。

---

# Part A. Canonical Dialogue Contract

## 3. 3層分離

1回のモデル返答を以下に分ける。

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
  emotionIntensity?: number; // 0..1
  motionCue?: MotionCue;
  voiceStyle?: VoiceStyleId;
  pause?: PauseCue;
}

export interface ModelTurn {
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

モデル返答では必ず:

```text
ChatMessage.text = ModelTurn.speech
```

とする。

これにより旧saveはそのまま読み、新saveも旧コードでspeechだけは表示できる。

---

## 4. narration設計

### 4.1 原則

- **default = none**
- 通常: 0〜50文字 / 最大1文
- 重要ターンのみ: 最大80文字 / 最大2文
- show, don't explain
- 心情の直接説明を避ける
- ユーザーの行動を勝手に確定しない
- 同じ「頬を赤らめる」「視線をそらす」を連打しない
- narrationをspeechで言い直さない

### 4.2 recentPerformance

`ChatMessage.text = speech` を維持するため、Gemini通常historyにはnarrationを混ぜない。

ただし反復防止のため、直近2ターンだけ別入力として渡す。

```ts
recentPerformance: Array<{
  narration?: string;
  expression?: EmotionId;
  motionCue?: MotionCue;
}>
```

---

## 5. Gemini出力protocol — P0修正

### 5.1 禁止

**Gemini自身にNDJSON/SSEイベントを書かせない。**

Geminiのstream chunkは独立JSONイベントではなく、最終JSONを構成するpartial JSON stringであるため、モデル出力をそのまま1行JSONイベントとして扱う設計は採用しない。

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

ブラウザへはサーバーが独自eventへ変換して送る。

例:

```json
{"type":"performance","expression":"shy","emotionIntensity":0.7,"motionCue":"look_away","voiceStyle":"soft"}
{"type":"narration","text":"しずくは一瞬言葉を止め、視線を横へ逃がした。"}
{"type":"speech_delta","text":"……急に"}
{"type":"speech_delta","text":"そういうこと言うんですね。"}
{"type":"turn_complete","turn":{...canonical ModelTurn...}}
```

### 5.4 保存境界

**保存対象は `turn_complete` のcanonical responseのみ。**

途中eventはUIのpreviewには使えるがsaveへ確定しない。

### 5.5 parse failure

禁止:

- raw JSON断片をspeechとして表示
- raw JSON断片をTTS

fallback:

1. structured outputを1回retry
2. legacy plain-text adapterへretry
3. 通常のエラーメッセージ

既存 `splitExpression()` / `splitMemory()` はlegacy adapter専用として残す。

### 5.6 memory

新protocolでは `[memory: ...]` を廃止し、canonical responseのfieldへ移す。

```ts
memory?: string | null
```

---

## 6. Store更新

CURRENTの `replaceLastModel(text)` だけでは複数fieldのstream更新に弱い。

実装時は1メッセージ単位のatomic patchへ変更する。

```ts
patchLastModel({
  text,
  narration,
  performance,
})
```

旧APIはcompatibility wrapperとして残してもよい。

---

# Part B. PerformanceController

## 7. 演技責務の分離 — P0修正

LLMは「何を感じ、どう演じるか」の意味だけを返す。

LLMが返してよい例:

```text
expression = shy
motionCue = look_away
voiceStyle = soft
emotionIntensity = 0.7
```

LLMに返させてはいけないもの:

- VRMA ID
- bone角度
- blendshape値
- lipSync値
- AudioContext状態
- 再生時刻

### 7.1 Architecture

```text
ModelTurn.performance
        ↓
PerformanceController
 ├─ ExpressionController
 ├─ Gaze/PoseController
 ├─ MotionController
 └─ VoiceController
        ↓
VrmModel / AudioSessionController
```

### 7.2 bone ownership / priority

CURRENTのVRMA、shy pose、将来のlook_away/head_tiltが同じboneへ同時書き込みしないよう、PerformanceControllerがownershipを管理する。

推奨priority:

```text
1. VRMA base motion
2. semantic pose overlay (shy/look_away/head_tilt)
3. gaze/eyes overlay
4. expression morph
5. lip sync morph
```

同一boneへ複数overlayを同時適用する場合は、PerformanceController内で合成し、VrmModel外から直接boneを書き換えない。

Phase 1〜3では `motionCue` を保存しても実行せず、PerformanceController完成後に有効化する。

---

# Part C. Voice Architecture

## 8. Provider方針

第一候補: **Aivis Cloud**

キャラ別候補: **COEIROINK / つくよみちゃん**

品質比較候補: **ElevenLabs**

Browser SpeechSynthesisはproduction fallbackに自動使用しない。

### 8.1 Provider abstraction

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

---

## 9. Voice Registry

booleanだけのlicense表現は禁止。最低限以下を持つ。

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

provider障害時も、**事前承認済みfallback voiceのみ**使用する。

推奨fallback順:

```text
primary voice
→ transient retry 1回
→ approved secondary voice
→ text-only
```

Browser SpeechSynthesisはユーザーが明示的にONにした「簡易音声モード」に限定する。

---

## 10. Privacy境界

**TTS Providerへ送信可能なのは `ModelTurn.speech` のみ。**

送信禁止:

- user message
- narration
- memory
- system prompt
- persona prompt全文
- recentPerformance

自アプリ側の通常logへTTS本文を残さない。

logは原則:

```text
requestId
provider
personaId
characterCount
latencyMs
status
```

のみ。

---

## 11. TTS text normalization

表示speechとTTS入力の間に `ttsTextNormalizer` を置く。

用途:

- emoji除去/読み替え
- URL読み上げ抑制
- 記号の過剰読み防止
- 人名等の読み補正
- 不自然な連続記号の正規化

表示文字列そのものは改変しない。

---

# Part D. AudioSessionController

## 12. iPhone PWA音声 — P0修正

Audio再生をChatPageへ直接書かず、独立Controllerで管理する。

### 12.1 audio state

```ts
type AudioState =
  | "locked"
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "interrupted"
  | "error";
```

### 12.2 generation stateは別管理

```ts
type GenerationState =
  | "idle"
  | "requesting"
  | "streaming"
  | "complete"
  | "error";
```

`generationState` と `audioState` は直交させる。

将来、次文を生成中に前文を読み上げる場合でも表現できる。

### 12.3 unlock

初回「音声ON」または再生ボタンの明示的user gestureでaudioをunlockする。

`audio.play()` のPromise rejectionを必ず処理する。

### 12.4 lifecycle

AudioSessionControllerは以下を監視する。

- `visibilitychange`
- `pageshow`
- `pagehide`
- audio `playing`
- audio `pause`
- audio `ended`
- audio `error`
- persona切替
- route変更
- 新しい発話開始

backgroundでは無理に喋り続けない。

foreground復帰時も勝手に途中再生せず、原則停止状態へ戻し、必要ならユーザー操作で再生。

### 12.5 streaming transport

`fetch().body` を直接 `<audio>` へ渡す前提にしない。

PoCでAivis公式streaming方式をiPhone standalone PWAで実証し、次のいずれかを選定する。

- MediaSource対応方式
- progressive playable response URL
- Blob完成後再生
- Web Audio decode/playback

本番方式はPoC結果で確定する。

---

# Part E. Lip Sync

## 13. 原則

CURRENTの

```text
busy = talking
```

による周期的 `aa` 口パクは廃止する。

新原則:

```text
thinking/requesting/streaming中 → 口を動かさない
actual audio playing中 → lip sync
```

### 13.1 Phase 1

まずはaudio stateだけで簡易open/close。

### 13.2 Phase 2

`AnalyserNode` のRMSで音量連動。

```text
voice audio
→ Web Audio AnalyserNode
→ RMS amplitude
→ smoothed mouth open
→ VRM aa
```

Web Audio不具合がある実機ではlip syncをOFFにし、**音声再生を優先**する。

### 13.3 禁止

`lipSync` をLLM metadataへ含めない。

lip syncは音声波形という実測値から決める。

---

# Part F. UI

## 14. 表示

```text
[小さな半透明 narration]
しずくは一瞬言葉を止め、視線を横へ逃がした。

しずく
[通常speech bubble]
……急にそういうこと言うんですね。ふふ、でも嬉しいです。
                         🔊
```

narration:

- speechより小さい文字
- 半透明
- キャラ名ラベルなし
- 最大2文
- TTS対象外

speech:

- CURRENT bubbleを継続
- 各model messageに再生ボタン

設定:

- 音声ON/OFF
- 自動再生ON/OFF
- 簡易音声モード（optional）

---

# Part G. Cache / Cost

## 15. Cache方針

個人会話speechをCDNへ永続cacheしない。

session内では同じmodel messageの再生用Blobをmemory cacheし、再生ボタンを押すたびに再課金しない。

永続cache可:

- 定型idle line
- 固定system voice sample

永続cache不可:

- 個人会話speech
- memoryに依存するセリフ

---

# Part H. Voice Casting

## 16. 基本方針

最初から5人×複数providerを本番運用しない。

```text
5キャラ
  ↓ 原則
Aivis Cloud
  ↓ 特定キャラだけA/B評価で明確に優れる場合
COEIROINK等
  ↓ 障害時
approved fallback or text-only
```

### 16.1 つくよみちゃん

採用候補として残す。

採用時はライセンスレビュー結果をVoice Registryへ記録し、creditsから

```text
しずく — Voice: COEIROINK:つくよみちゃん
```

のように確認可能にする。

音声素材そのものの再配布はしない。

---

# Part I. PoC Gate

## 17. Phase 0 — 実装前Technical PoC

以下3つがPASSするまで本実装へ進まない。

### PoC 1: iPhone standalone PWA × Aivis

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

PASS条件:

- 勝手な再開なし
- 二重再生なし
- persona切替後の旧音声残留なし
- 復帰不能なし

### PoC 2: Gemini structured streaming

100ターン程度生成。

schema:

```text
narration
speech
expression
emotionIntensity
motionCue
voiceStyle
pause
memory
```

Acceptance:

- raw JSON露出 0
- narration誤読み上げ 0
- memory表示 0
- invalid expression 0
- interrupted streamで履歴破壊 0
- turn_completeなしのpartial save 0

### PoC 3: Voice casting / latency / cost

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

# Part J. Implementation Phases

## Phase 1 — Canonical Dialogue Contract

- `ModelTurn`
- `ModelPerformanceIntent`
- memory field化
- legacy adapter
- save互換
- `patchLastModel()`

音声なし。

## Phase 2 — Emotion UI

- narration + speech分離表示
- narration保存
- recentPerformance直近2ターン
- CURRENT expression動作維持
- motionCueは保存のみ、実行しない

## Phase 3 — One Character Voice

- しずく1人
- Aivis
- 手動再生
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
- unsupported/failure時lip sync OFF fallback

## Phase 6 — PerformanceController

- bone ownership
- look_away
- small_nod
- head_tilt
- expression intensity
- VRMA統合

## Phase 7 — Advanced Sync（必要時のみ）

- 文単位TTS先読み
- viseme/phoneme
- speech-motion同期

---

# Part K. Acceptance Criteria

## 18. 会話

- narrationとspeechが明確に分離
- narrationなしターンを自然に生成できる
- narrationが通常50文字以内
- speechのみ既存conversation historyへ入る
- raw structured outputがUIへ露出しない
- memoryがユーザーへ表示されない

## 19. 音声

- narrationを絶対に読み上げない
- user message/memory/system promptをTTS providerへ送らない
- キャラごとの声が固定
- fallback voiceは事前承認済みのみ
- provider障害時にtext-onlyへ安全に落ちる

## 20. iPhone PWA

- user gesture後に安定再生
- background/foregroundで二重再生・勝手な再開なし
- persona/route変更で旧音声停止
- play() reject時にUIが壊れない

## 21. VRM

- thinking中に口パクしない
- audio playing中のみlip sync
- lip sync failureでも音声は継続
- VRMA / shy / gaze / motionCueが同一boneへ無秩序に競合しない

---

# Part L. Non-goals

初期実装では行わない。

- 完全な音素viseme
- 感情ごとの専用VRMA大量生成
- 5キャラ×複数provider同時production運用
- narration音声化
- user voice cloning
- 長期音声ファイル永続保存

---

## 22. 最終設計判断

レビュー判定は **APPROVE WITH CHANGES**。

以下は維持する。

- narration / speech / hidden performance intent の3層分離
- `ChatMessage.text = speech`
- narration非TTS
- provider abstraction
- thinking ≠ speaking

以下はレビューを受けて変更した。

- Gemini → NDJSON ではなく **Gemini structured JSON → server-owned events**
- `turn_complete` canonical responseのみ保存
- memoryをstructured fieldへ移行
- `PerformanceController`追加
- `AudioSessionController`追加
- generation/audio stateを分離
- lipSyncをLLM metadataから削除
- narration通常上限を50文字へ短縮
- recentPerformance直近2ターン追加
- Voice Registryライセンス情報を詳細化
- Browser SpeechSynthesisの自動fallbackを禁止
- TTS privacy境界を `speech only` と明文化

**次の作業は Phase 0 Technical PoC。PoC PASS前に本実装へ進まない。**
