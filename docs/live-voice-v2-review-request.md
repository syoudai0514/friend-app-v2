# LIVE VOICE V2 — Review / Re-review Request

Target: `docs/live-voice-v2-architecture.md`  
Branch: `docs/live-voice-v2-architecture`  
Baseline main: `96098df9eaaac4214ee8a06b5d0be96ba650fd2e`

この文書は、独立レビュアへそのまま渡せるレビュー依頼テンプレート。

---

# REVIEW 1 PROMPT

```text
@GitHub

==================================================
friend-app-v2
LIVE VOICE V2
ARCHITECTURE REVIEW 1
NO IMPLEMENTATION
==================================================

repository:
syoudai0514/friend-app-v2

review branch:
docs/live-voice-v2-architecture

architecture spec:
docs/live-voice-v2-architecture.md

IMPORTANT:
最初にCURRENT GitHubをfresh readしてください。
mainとreview branchの両方を確認してください。

CURRENT main HEADも必ず再確認し、spec記載のbaselineからmainが進んでいる場合は影響を評価してください。

PR #21〜#23周辺のCURRENT実装も確認してください。
特に:

- src/lib/gemini-live.ts
- src/app/api/chat/route.ts
- src/app/api/tts/route.ts
- src/app/chat/chat-page-base.tsx
- src/lib/audio-session.ts
- src/lib/live-audio-fetch-bridge.ts
- src/lib/conversation-transaction.ts
- src/lib/dialogue.ts
- src/lib/prompt.ts
- src/lib/personas.ts
- docs/emotion-voice-architecture.md

今回は設計レビューのみ。

コード変更禁止。
commit禁止。
PR作成禁止。

==================================================
PURPOSE
==================================================

LIVE VOICE V2を実装可能な状態まで設計freezeする。

目標:

- 送信から1〜3秒級で話し始める
- iPhone PWAで安定する
- Gemini Live native audioをstreaming再生する
- permanent API keyをbrowserへ出さない
- commitAckのpersistent transaction safetyを維持する
- provisional audioとcanonical stateを分離する
- hidden narration/memory/performanceを音声へ漏らさない
- 5キャラの声を可愛く、かつ明確に差別化する

==================================================
MUST REVIEW
==================================================

1. Browser → Gemini Live direct + constrained ephemeral tokenは妥当か

2. token issuance / uses / expiry / setup constraint / log禁止等は十分か

3. warm sessionでTTFA p50<=2.5s / p95<=5sを狙う設計は妥当か

4. PROVISIONAL_GENERATING
   → PROVISIONAL_PLAYING
   → FINAL_GENERATED
   → FINALIZING
   → COMMIT_PENDING
   → COMMITTED
   のstate modelは安全か

5. provisional audioをcommit前に聞かせつつ、
   messages/memory/affection/localStorageをcommitAckまで変更しない設計は妥当か

6. outputTranscriptionはarrival orderingが保証されない前提で、
   partial transcriptをcanonical化しない設計は十分か

7. generationComplete / turnCompleteのどちらをfinal transcript boundaryにすべきか

8. audioを聞かせた後にfinalize失敗した場合の
   ephemeral utterance / NO COMMIT方針は妥当か

9. new user message / provider interrupted / persona switch / pagehide / route changeでの
   playback flushとtransaction処理にraceがないか

10. AudioWorklet + PCM ring bufferを第一候補とするのはiPhone Safari/PWAで妥当か

11. 24kHz Int16 PCM → AudioContext sample rate変換の設計は妥当か

12. jitter buffer初期240ms / adaptive 160〜500msは妥当か

13. fallback順:

    Gemini Live streaming
    → same-generation completed audio
    → Gemini TTS
    → device speechSynthesis

    は妥当か

14. 1frameでもprovisional audioを聞かせた後は別speech/providerへ自動fallbackしない方針は妥当か

15. Gemini TTS 429 / RESOURCE_EXHAUSTEDを即retryせずcircuit breakerを開く設計は妥当か

16. Live provider input minimizationはprivacy boundaryとして十分か

17. narration / speech / performance / memory分離と互換性があるか

18. Aimi / Shizuku / Nagi / Hinata / Renaのaudition候補とDirector v1は妥当か

19. Shizukuを
    「おっとり丁寧」→「柔らかい・甘い・ゆるふわギャル」
    にpersona自体から変更する案は、Aimiとの差別化を維持できるか

20. Phase 0〜6の分割・release gateは十分か

==================================================
REVIEW STANDARD
==================================================

単なる賛成ではなく、CURRENTコードに照らして成立するか確認してください。

特にP0を厳しく見てください。

以下は禁止:

- permanent Gemini API key client exposure
- partial transcript persistence
- provisional memory/affection update
- narration/memory/performanceの音声化
- audible double speech
- quota 429 immediate retry
- iPhone user gesture制約を無視したAudioContext起動

==================================================
OUTPUT
==================================================

判定:

APPROVE
APPROVE WITH CHANGES
REJECT

findings:

P0
P1
P2

各findingには:

- ID
- 問題
- なぜ問題か
- 具体的修正案
- architecture specのどの節を直すか

を含めてください。

最後に必ず:

A. implementation blocker一覧
B. security/privacy判定
C. transaction safety判定
D. iPhone streaming判定
E. TTFA実現可能性
F. voice casting判定
G. Shizuku persona判定
H. APPROVE FOR IMPLEMENTATIONに必要な条件

を提示してください。

今回はread-only reviewのみ。
```

---

# RE-REVIEW PROMPT

Review 1 findings反映後は以下をそのまま渡す。

```text
@GitHub

==================================================
friend-app-v2
LIVE VOICE V2
ARCHITECTURE RE-REVIEW
FINAL IMPLEMENTATION GATE
NO IMPLEMENTATION
==================================================

repository:
syoudai0514/friend-app-v2

review branch:
docs/live-voice-v2-architecture

architecture spec:
docs/live-voice-v2-architecture.md

IMPORTANT:
CURRENT GitHubをfresh readしてください。
前回Review 1の内容を鵜呑みにせず、更新後specを独立して再評価してください。

main HEAD
review branch HEAD
architecture spec
PR diff
前回review findings
その後の修正

をCURRENTで確認してください。

コード変更禁止。
commit禁止。
PR作成禁止。

==================================================
PURPOSE
==================================================

前回Review 1のP0/P1/P2が正しく解消されたか確認し、
LIVE VOICE V2を実装へ進めてよいか最終判定する。

==================================================
REQUIRED FINDING TRACKING
==================================================

前回findingを1件ずつ:

CLOSED
PARTIALLY CLOSED
OPEN
REGRESSION

のいずれかへ分類してください。

P0が1件でもOPENまたはPARTIALLY CLOSEDなら
APPROVE FOR IMPLEMENTATIONは禁止。

また、修正による新規regressionをfresh reviewしてください。

==================================================
MANDATORY FINAL CHECK
==================================================

- browser direct Live authentication
- ephemeral token constraints
- API key non-exposure
- warm session lifecycle
- PROVISIONAL / FINAL / COMMITTED transaction
- partial transcript non-persistence
- audio-before-commit semantics
- final transcript boundary
- interrupted/error race
- persona/route/page lifecycle
- iPhone PWA AudioWorklet strategy
- fallback engine
- no-double-speech invariant
- TTS quota circuit breaker
- privacy minimization
- observability without speech logging
- 5 voice differentiation
- Shizuku persona compatibility
- Phase implementation gates

==================================================
FINAL OUTPUT
==================================================

判定は必ずどちらか:

APPROVE FOR IMPLEMENTATION
NOT READY FOR IMPLEMENTATION

その後:

1. Previous finding closure matrix
2. New P0/P1/P2 findings
3. Remaining implementation risks
4. Exact implementation phase order
5. Final voice audition set
6. Final Shizuku direction
7. Final release gates

今回はread-only re-reviewのみ。
```

---

## Review workflow

```text
Architecture draft
  ↓
Review 1
  ↓
P0/P1/P2をspecへ反映
  ↓
Review findings closure table更新
  ↓
Re-review
  ↓
APPROVE FOR IMPLEMENTATION
  ↓
Phase 1 implementation開始
```

実装PRとarchitecture review PRを混ぜない。
