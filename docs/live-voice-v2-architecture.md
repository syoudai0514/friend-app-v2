# friend-app-v2 LIVE VOICE V2 Architecture

Status: **DRAFT FOR REVIEW 1**  
Target repository: `syoudai0514/friend-app-v2`  
Baseline main: `96098df9eaaac4214ee8a06b5d0be96ba650fd2e`  
Scope: low-latency Gemini Live conversation/audio, transaction safety, iPhone/PWA playback, voice casting, fallback, observability  
Implementation: **NOT STARTED**

---

## 0. Why this document exists

friend-app-v2 の会話体験を、

`送信 → 返答完成 → 音声完成 → 再生`

から、

`送信 → 1〜3秒級で話し始める → 残りを生成しながら自然に話す`

へ進化させる。

同時に、5キャラクターを「声名だけ違う読み上げ」ではなく、

`Persona speech style + Voice + Voice Director Instruction`

の3層で明確に差別化する。

この設計は `docs/emotion-voice-architecture.md` の speech / narration / performance / memory 分離と persistent transaction safety を維持しつつ、Live streaming audio のために playback lifecycle を拡張する。

---

## 1. CURRENT baseline

Baseline main: `96098df9eaaac4214ee8a06b5d0be96ba650fd2e`

PR #21〜#23で以下が導入済み。

- Gemini Live conversation PoC
- Gemini Live native audio
- personaごとのprebuilt voice
- output transcription取得
- Live audioのcompleted WAV化
- iPhone用 `AudioSessionController`
- `turn_complete → commitModelTurn → commitAck → autoplay`
- Live音声再利用による二重生成回避修正

ただしCURRENT Live pathは `turnComplete` までPCMを全量保持してからbrowserへ返すため、本来のLive streamingにはなっていない。

Productionで観測した旧経路では、会話後の追加 `/api/tts` が約8〜13秒を消費していた。PR #23の改善効果は本番deployment完了後に別途測定する。

---

## 2. Goals / SLO

### 2.1 Primary UX goal

ユーザーが送信をtapした後、キャラクターが「考えながら自然に話し始める」体験を作る。

### 2.2 Initial SLO

- TTFA p50: `<= 2.5s`
- TTFA p95: `<= 5.0s`
- warm Live session p95: `<= 3.5s`
- cold session: `<= 5.0s` を目標
- audible double-speech: `0`
- provisional audio後の別provider自動読み直し: `0`
- partial model message persistence: `0`
- hidden narration / performance / memoryの音声漏洩: `0`

TTFA = user send tap から最初の非silent audio frameがdevice outputへscheduleされるまで。

---

## 3. Non-goals for V2 first release

- full duplex microphone conversationへの全面移行
- always-listening wake word
- phoneme-perfect lip sync
- server-side durable conversation storage
- voice cloning
- custom trained voice
- current localStorage save modelの全面変更

まず text input → low-latency native audio reply を安定させる。

---

# Part A — Core Architecture

## 4. Recommended split: control plane vs media plane

### 4.1 Control plane — Vercel / Next.js

Vercel側の責務を以下へ限定する。

1. authenticated ephemeral token issuance
2. Live session constraints生成
3. final transcript受領・validation
4. narration / performance / memory enrichment
5. canonical `ModelTurn` finalize
6. persistent transactionのためのapplication protocol
7. metrics / error classification

Permanent `GEMINI_API_KEY` はserver only。

### 4.2 Media plane — Browser ↔ Gemini Live

リアルタイムaudio pathはbrowserからGemini Liveへ直接接続する。

```text
Vercel /api/live-token
   │ short-lived constrained token
   ▼
iPhone PWA
   │ WebSocket
   ▼
Gemini Live
   │ PCM chunks + output transcription
   ▼
iPhone PCM Streaming Player
```

理由:

- backend hopを避ける
- first audio chunkをserverでbufferしない
- Live APIのstateful WebSocketを本来の形で利用する
- Vercel Function lifecycleをreal-time media critical pathから外す

Googleの現行Live APIドキュメントも、audio/video streamingではclient-to-server接続の方がbackend hopを省けるため一般にperformanceが良く、productionではstandard API keyではなくephemeral tokenを推奨している。

Reference:
- https://ai.google.dev/gemini-api/docs/live-api
- https://ai.google.dev/api/live

---

## 5. Ephemeral token security contract

### 5.1 Token issuance

新規same-origin endpointを想定する。

```text
POST /api/live-token
```

必須条件:

- existing app authorizationを通過したbrowserのみ
- permanent Gemini API keyをbrowserへ返さない
- tokenをlogしない
- responseを `Cache-Control: no-store`
- tokenをlocalStorage / IndexedDBへ保存しない
- page/session memoryのみ

### 5.2 Token constraints

初期値:

- `uses = 1`
- `newSessionExpireTime`: issuance後おおむね60秒以内
- `expireTime`: session上限をカバーするが必要以上に長くしない
- modelを `gemini-3.1-flash-live-preview` に固定
- response modalityを `AUDIO` に固定
- personaごとのvoiceをserver側でconstraint
- toolsはV2 initial releaseでは原則なし

Google API reference上、ephemeral tokenはdefaultで1 use、new session開始期限はdefault約60秒、token expiryはdefault約30分。実装時はcurrent SDK/API schemaをfresh確認する。

### 5.3 Session setup ownership

security-critical fieldsはserver-issued tokenのconstrained setup側をauthoritativeとする。

Browserから自由変更させないもの:

- model
- response modality
- prebuilt voice
- system identity envelope
- enabled tools

Browser側でturnごとに変わる会話inputのみ送る。

---

## 6. Live session lifecycle

### 6.1 Warm session strategy

TTFA短縮のため「送信tap後に毎回socket connect」は避ける。

推奨:

```text
/chat entered
  ↓
voice enabled + app visible
  ↓
obtain ephemeral token
  ↓
open Live WebSocket
  ↓
wait setupComplete
  ↓
READY_WARM
```

送信tapでは既存READY_WARM sessionを使う。

### 6.2 When not to preconnect

以下では接続しない / closeする。

- voice disabled
- document hidden
- pagehide / route leave
- persona switching中
- auth invalid

### 6.3 Session renewal

Google docs上、audio-only sessionは15分上限。V2ではhard cutoff直前まで使い切らず、12〜14分帯でrenew/resumeを検討する。

初期releaseでは安全性優先で:

- idle時にnew sessionへ切替
- active generation中の強制renew禁止
- `goAway` を受けたらremaining timeを見て再接続準備
- session resumptionはPhase 3以降で検証し、初期実装の必須条件にしない

---

# Part B — Transaction Model

## 7. The key change

CURRENTの重要な原則:

```text
turn_complete
→ canonical ModelTurn
→ commitModelTurn
→ persistent state update
→ commitAck
→ autoplay eligibility
```

V2では **persistent-state eligibility = commitAck** を維持する。

ただし **audio playback eligibility = commitAck** だけは外す。

理由: first audioを1〜3秒で聞かせる時点ではfinal transcriptとcanonical ModelTurnがまだ確定していないため。

---

## 8. New state machine

```text
REQUESTED
  ↓
PROVISIONAL_GENERATING
  ↓ first PCM accepted
PROVISIONAL_PLAYING
  ↓ model generation complete
FINAL_GENERATED
  ↓ final transcript / validation / enrichment
FINALIZING
  ↓
COMMIT_PENDING
  ↓ persistent transaction
COMMITTED
```

Abort paths:

```text
REQUESTED / PROVISIONAL_GENERATING
  → ABORTED_NO_AUDIO

PROVISIONAL_PLAYING
  → ABORTED_AFTER_AUDIO

FINALIZING / COMMIT_PENDING
  → FINALIZE_FAILED
```

---

## 9. Meaning of PROVISIONAL SPEECH

PROVISIONAL audioは「聞こえてよいが、まだpersistent realityではない」。

PROVISIONAL中に禁止:

- `AppState.messages`へmodel message保存
- localStorageへmodel text保存
- memory commit
- affection increment
- 次turnのcanonical historyへ追加

表示するpartial output transcriptionも `TurnDraft` 相当のvolatile UIだけに置く。

### 9.1 Audio already heard but finalization fails

このケースは `ephemeral utterance` として扱う。

- playback queueを停止/flush
- draftを破棄
- persistent historyへ残さない
- memoryなし
- affectionなし
- 別providerで別返答を自動生成して読み直さない

低TTFAと「聞こえた音声は必ず永続化」を同時に100%保証することはできない。V2は明示的にoptimistic playbackを採用し、persistent transactionだけは厳密に保護する。

---

## 10. FINAL speech boundary

Gemini Liveの `outputTranscription` はaudio/serverContentとは独立に送信され、arrival orderingは保証されない。

したがって:

- partial output transcriptionはcanonical禁止
- PCM arrival順とtranscript arrival順を同一視しない
- `generationComplete` 以前にpersistent finalizeしない
- exact finalization triggerはPhase 2 PoCでcurrent Live event behaviorを実測しfreezeする

安全な初期候補:

1. `generationComplete` を「model generation終了」の境界とする
2. output transcriptionを引き続き収集
3. `turnComplete` または検証済みterminal conditionでtranscriptをfinalize
4. final transcriptが空/異常ならNO COMMIT

commit latencyはTTFA critical pathではないため、ここは速度より正しさを優先する。

---

## 11. Interruption rules

### 11.1 New user message

新規送信時:

- generation epoch increment
- old provisional generationをinterrupt
- old PCM queueをflush
- old partial transcriptを破棄

ただし旧turnが既にFINAL_GENERATED以降へ入り、canonical finalize可能な状態なら、playback lifecycleとcommit lifecycleを分離してcommit処理を完了させてもよい。詳細はReview Gateで再確認する。

### 11.2 Gemini `interrupted`

- 即PCM queue flush
- provisional draft破棄
- generationComplete未達ならNO COMMIT

Google API referenceもrealtime playback中の`interrupted`をplayback queue停止/emptyのsignalとして扱えるとしている。

### 11.3 Persona switch

- generation epoch increment
- active Live session close
- PCM queue flush
- old persona provisional state全破棄
- new persona用token/session作成

### 11.4 pagehide / background

- playback stop/flush
- socket closeまたはsuspend policy
- partial draftをpersistent化しない

---

# Part C — Privacy Boundary

## 12. Live provider input minimization

CURRENT Live PoCではsystem instruction生成の都合でhidden stateが広めにLiveへ渡っている。

V2ではLive media planeへ渡すものを最小化する。

Allowed:

- persona identity
- persona speech style
- voice director instruction
- userの呼び名
- coarse relationship level
- canonical speech history（必要な直近分）
- current user message
- conversationに本当に必要なselected memoryのみ、少数

Do not send by default:

- narration history
- raw performance history
- VRM motion implementation details
- raw full memory corpus
- hidden system/debug metadata
- localStorage全体

Live出力audioへ以下が混入してはいけない:

- narration
- memory metadata
- performance metadata
- JSON/tag/system explanation

### 12.1 Enrichment provider

final speech後のnarration/performance/memory enrichmentはaudio critical pathから外す。

Enrichment inputは:

- canonical final speech
- latest user message
-必要最小限のpersona/context

に限定する。

---

# Part D — iPhone/PWA Streaming Audio

## 13. Player architecture

CURRENT `AudioSessionController` のwhole-WAV再生はfallbackとして維持する。

Streaming用に別component/engineを作る。

第一候補: **AudioWorklet**

理由:

- PCM連続再生向き
- main threadからaudio renderingを分離
- ring buffer / jitter bufferを実装しやすい
- underrun metricsを取れる

ただしiPhone PWAでの実機PoCをPhase 1 release gateとする。AudioWorkletが対象iOS/PWA combinationで不安定なら、scheduled `AudioBufferSourceNode`を第二候補とする。

### 13.1 Unlock rule

送信buttonのuser gesture call stack内で:

```text
AudioContext.resume()
```

まで行う。

network response後に初回resumeしない。

### 13.2 PCM path

```text
Gemini Live PCM 24kHz Int16 mono
  ↓ WebSocket
Int16 decode
  ↓
resample if AudioContext sampleRate differs
  ↓
AudioWorklet ring buffer
  ↓
destination
```

WAV化はstreaming primary pathではしない。

---

## 14. Jitter buffer initial policy

Initial design values。Phase 1実測で調整する。

- start threshold: `240ms`
- adaptive range: `160〜500ms`
- low-water: `120ms`
- underrun発生turn後: `+80ms`
- 10 turn連続underrunなし: `-30ms`
- >80ms級gap: rebuffer検討

500ms超のbufferを常態化させない。

### 14.1 Drift

短い会話turnではsample-count clockを基本とする。

queue occupancyが長時間偏る場合のみ、ごく小さいresampling correctionを検討。初期実装で過剰なdrift algorithmを入れない。

---

## 15. Completed-audio fallback

stream playerが開始できなかったが同一generationのPCMを全量取得できた場合:

```text
same-generation PCM
→ WAV wrapping
→ CURRENT HTMLAudioElement route
```

新しいモデルcallをしない。

これをfallback #2とする。

---

# Part E — Fallback

## 16. Provider order

```text
1. Gemini Live streaming
2. Same Live generation completed audio
3. Canonical text + Gemini TTS
4. Device speechSynthesis
```

### 16.1 Golden rule

**1frameでもprovisional audioをユーザーへ聞かせたturnでは、別speech/providerへのautomatic fallbackを禁止する。**

途中までAimiのLive音声を聞いた後、別voiceが最初から別の返答を読む体験を絶対に作らない。

### 16.2 TTS quota circuit breaker

Gemini TTSの `429 / RESOURCE_EXHAUSTED` は短時間retryしない。

Policy:

```text
quota 429
→ circuit OPEN
→ current quota windowでGemini TTS即skip
→ device speech fallbackへ
```

`408 / transient 5xx / network` は必要に応じてbounded retry可。ただし同じturnで二重音声を起こさない。

---

# Part F — Voice Identity

## 17. Three-layer voice model

キャラ音声は以下を分離する。

### Layer 1 — Persona speech style

「何をどういう言葉で言うか」。

`src/lib/personas.ts` の `speech` / `personality` がauthoritative。

### Layer 2 — Prebuilt Voice

声質そのもの。

### Layer 3 — Voice Director Instruction

同じVoiceをどう演じるか。

例:

- vocal smile
- energy
- softness
- pace feel
- intimacy
- emotional range
- 禁止演技

pitch/tempoの数値をAPIパラメータとして前提にしない。数値はaudition評価用の「感覚目標」に留め、providerへは自然言語directorを中心に渡す。

---

## 18. First audition cast

| Character | Candidate A | Candidate B | Candidate C | Initial favorite |
|---|---|---|---|---|
| Aimi | Zephyr | Sadachbia | Autonoe | Zephyr |
| Shizuku | Aoede | Sulafat | Achernar | Aoede |
| Nagi | Kore | Schedar | Despina | Kore |
| Hinata | Leda | Sadachbia | Puck | Leda |
| Rena | Gacrux | Sulafat | Algieba | Gacrux |

**これは本決定ではない。iPhone PWA audition後にfreezeする。**

---

## 19. Voice Director v1

### Aimi

20代前半の明るい女性。恋人とスマホ越しに近距離で話している自然な声。口元に軽い笑顔を感じさせ、少し高めで軽快。テンポはやや速め。「ねぇねぇ」「〜じゃん」では少し弾ませる。嬉しい時は自然に声が上がるが叫ばない。アニメ声、作った幼い声、CM、ナレーター、機械的読み上げは禁止。

### Shizuku

若い女性の柔らかく甘い声。力を抜いて、恋人へゆるく笑いながら話す距離感。テンポは普通で、少しだけお姉さんらしい余裕を持つ。軽いギャル感は語尾とリズムで出し、大げさなギャル演技にしない。優しいが眠そうにはしない。丁寧なナレーター、お嬢様、朗読調は禁止。

### Nagi

若い女性の少し低めでクールな声。短い台詞を自然に切り、感情を出しすぎない。心配や照れが語尾に少し漏れる。無愛想と冷酷を混同しない。照れた時だけ少し柔らかくする。棒読み、低すぎる声、威圧的な演技は禁止。

### Hinata

明るく反応の速い若い女性。元気な後輩として声の立ち上がりが速く、リズムが軽い。笑顔と好奇心を自然に出す。テンポは速めだが常に叫ばない。子供声、甲高すぎるアニメ声、常時100%テンションは禁止。

### Rena

落ち着いた大人の女性。恋人との距離が近く、柔らかく余裕がある。少し低めで温かく、テンポはややゆっくり。からかいは声量ではなく間と語尾で出す。母性的すぎず、色気を誇張しない。ニュース読み、ナレーション、過剰な囁きは禁止。

---

## 20. Proposed Shizuku persona v2

CURRENTの「おっとり丁寧・ゆっくり・〜ですね/〜でしょう？」は新ターゲットと衝突するため、voice directorだけでなくpersona本文を変更する。

### Proposed `speech`

柔らかいタメ口中心の、ゆるふわで少しギャルっぽい話し方。「え、〜じゃん」「おつかれ〜」「〜しよ？」「ふふ」「えへへ」などを自然に使う。丁寧語は真面目な話や特別な場面だけ。少し甘く距離が近いが、過剰なギャル語や「マジ」「ヤバ」の連発はしない。テンポは普通で、古風なお嬢様口調にはしない。

### Proposed `personality`

包容力のある癒し系。相手の話を最後まで受け止め、頑張りを具体的に褒める。無理に励まさず「おつかれ〜」と寄り添う一方、ときどき柔らかくからかったり甘えたりする。アイミーより落ち着いていて、少しお姉さんらしい余裕がある。

### Separation from Aimi

- Aimi: high energy / active teasing / 明るい王道ギャル
- Shizuku: medium energy / soft sweetness / ゆるふわギャル

2人のblind identification率を重点測定する。

---

# Part G — Voice Audition

## 21. DEV ONLY audition workflow

### Round 1 — Voice only

- director instruction固定
- same script
- Neutral
- candidate name非表示
- A/B/C順randomize

評価:

- 可愛さ
- 自然さ
- 恋人感
- 聞き疲れ
- character fit

### Round 2 — Director only

Round 1勝者voice固定。

Director v1/v2/v3を比較。

Emotion scripts:

- Neutral
- Happy
- Shy
- Comforting
- Excited

### Round 3 — Character identification

5 characters × 5 emotions = 25 clips。

shuffleしてvoice名を隠す。

目標:

- overall identification >= 80%
- target >= 90%
- Aimi/Shizuku confusionを個別測定

### Device gate

最終決定はdesktopではなく **実際のiPhone PWA** で行う。

Record:

- character
- voice
- director revision/hash
- Live model
- device/iOS
- PWA or Safari
- TTFA
- underrun count
- subjective scores

---

# Part H — Observability

## 22. Required metrics

speech textそのものはlogしない。

Record only metadata:

- `live_session_connect_ms`
- `live_setup_complete_ms`
- `live_first_pcm_ms`
- `audio_start_ms`
- `ttfa_ms`
- `jitter_buffer_start_ms`
- `underrun_count`
- `generation_complete_ms`
- `finalize_ms`
- `commit_ack_ms`
- `provisional_audio_started: boolean`
- `provisional_after_audio_abort: boolean`
- `commit_failed: boolean`
- `fallback_provider`
- `tts_quota_circuit_open: boolean`
- personaId
- model name
- error category

Never log:

- user message text
- model speech text
- narration
- memory contents
- ephemeral token
- API key

---

# Part I — Implementation Phases

## Phase 0 — Architecture freeze / audition design

Deliverables:

- this architecture APPROVE
- transaction state definitions frozen
- privacy boundary frozen
- fallback conditions frozen
- TTFA metrics frozen
- audition method frozen
- Shizuku target approved

**No production implementation before Phase 0 approval.**

## Phase 1 — Streaming audio engine only

Synthetic PCMで完成させる。

- AudioContext user gesture unlock
- AudioWorklet
- 24k Int16 decode
- resampling
- jitter buffer
- queue flush
- interruption
- iPhone PWA real-device test

No Gemini dependency required for core player tests.

Gate:

- stable audible playback
- no large gaps
- interruption works
- background/foreground safe

## Phase 2 — Direct Live + ephemeral token PoC

feature flag only。

- `/api/live-token`
- constrained token
- browser→Gemini Live WS
- warm session
- first PCM streaming
- output transcription collection
- current persona voice mapping
- metrics

Persistent transactionはまだ変更最小限。

Gate:

- TTFA measured
- no key exposure
- no hidden metadata leakage
- iPhone stability

## Phase 3 — PROVISIONAL / FINAL / COMMITTED transaction

- new client state machine
- final transcript canonicalization
- server enrichment
- commitModelTurn
- commitAck
- aborted-after-audio handling
- persona switch
- route/pagehide
- new message interruption

Gate:

- partial persistence 0
- memory/affection side effect before commit 0
- double speech 0

## Phase 4 — Fallback hardening

- same-generation completed WAV
- Live failure before first audio
- Gemini TTS quota circuit breaker
- no 429 retry
- device speechSynthesis
- provider/error matrix tests

## Phase 5 — Voice audition + persona tuning

Can run partly in parallel with Phase 1〜3。

- DEV ONLY audition UI
- A/B/C voice test
- director test
- Shizuku persona v2 test
- 5-character identification

Freeze final casting after iPhone results。

## Phase 6 — Production rollout

feature flag staged rollout。

Because this is a private/small app, percentage rollout may be replaced by explicit device/session allowlist if simpler. Do not add rollout infrastructure disproportionate to project size.

Release gate:

- TTFA targets acceptable
- no repeated underrun
- no transaction regressions
- no hidden-state speech
- fallback tested
- iPhone PWA verified

---

# Part J — Review Gates

## 23. Review 1 must decide

Reviewer must explicitly judge:

1. browser→Gemini direct + ephemeral token architecture
2. token constraint/security completeness
3. warm session lifecycle
4. PROVISIONAL / FINAL / COMMITTED semantics
5. canonical final transcript boundary
6. interruption rules
7. iPhone AudioWorklet feasibility and fallback
8. jitter buffer policy
9. fallback ordering and no-double-speech rule
10. TTS quota circuit breaker
11. privacy input minimization
12. 5-character casting/audition strategy
13. Shizuku persona v2 direction
14. implementation phase ordering

Output:

`APPROVE / APPROVE WITH CHANGES / REJECT`

Then findings as `P0 / P1 / P2`.

## 24. Re-review gate

After Review 1 findings are applied, reviewer must fresh read updated branch/PR and classify every previous finding:

- CLOSED
- PARTIALLY CLOSED
- OPEN
- REGRESSION

Re-review cannot approve while any P0 remains OPEN/PARTIALLY CLOSED。

Final output:

- `APPROVE FOR IMPLEMENTATION`
- or `NOT READY FOR IMPLEMENTATION`

No implementation begins until `APPROVE FOR IMPLEMENTATION`.

---

## 25. Design decisions ledger

| ID | Decision | Status |
|---|---|---|
| D-01 | Browser↔Gemini direct media plane | Proposed |
| D-02 | Server-issued constrained ephemeral token | Proposed |
| D-03 | Persistent commit still guarded by commitAck | Proposed |
| D-04 | Provisional audio may play before commit | Proposed |
| D-05 | Partial transcription never canonical | Proposed |
| D-06 | AudioWorklet primary streaming engine | Proposed / PoC gate |
| D-07 | Same-generation PCM/WAV before new-provider fallback | Proposed |
| D-08 | No automatic alternate speech after audible provisional audio | Proposed |
| D-09 | Gemini TTS quota 429 circuit breaker, no immediate retry | Proposed |
| D-10 | Aimi/Shizuku differentiated via persona + voice + director | Proposed |

Review revisions should update this table rather than silently changing architecture.

---

## 26. Open questions intentionally left for review/PoC

1. `generationComplete` と `turnComplete` のどちらをfinal transcript freezeのterminal signalにするか。TTFAには影響させず、Phase 2でevent orderingを実測して確定する。
2. AudioWorkletがtarget iPhone PWAで十分安定するか。Phase 1で実機gate。
3. Live session historyをどこまでwarm socketへ持たせるか。privacy/latency/context growthを測って決定。
4. session resumptionを初期releaseで採用するか。必須にしない。
5. Shizukuの最終VoiceはAoedeでよいか。auditionで決定。
6. Aimiの「もっと可愛い」をZephyr director強化で達成できるか、voice変更が必要か。auditionで決定。

---

## 27. Source-of-truth relationship

この設計がfinal APPROVEされた場合、Live Voice V2に関しては本書をsource of truthとする。

`docs/emotion-voice-architecture.md` は引き続き narration / speech / performance / memory 分離とpersistent transactionの基礎契約として有効。

ただし旧文書の

`commitAck = audio playback eligibility`

に相当する部分だけはV2で次へ拡張する。

```text
provisional playback eligibility ≠ commitAck
persistent reality eligibility = commitAck
```

この差分を明示せず旧設計を上書きしない。
