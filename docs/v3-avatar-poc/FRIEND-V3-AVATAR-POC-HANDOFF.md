# friend-v3 Photoreal Avatar PoC — Visual Target / Gate Plan / Handoff

Status: **PLANNING ONLY — v3本実装は未承認**  
Canonical home for now: `syoudai0514/friend-app-v2`  
Recorded: 2026-09-04 JST  
Current v2 main at recording time: `01c7b1ecf15357145b2416e1d5ecdc02c43ab546`

## 0. Why this document exists

この資料は、ChatGPT内の会話・添付画像に依存せず、別チャットから `friend-v3` の検討を再開できるようにするための引き継ぎ資料。

重要な意思決定:

- `friend-v3` を今すぐ本格開発しない。
- まず **Shizuku 1人のPhotoreal 3D Avatar PoC** を行う。
- 下記Visual Targetに十分近づけない場合は、v3を作らない。
- 静止画だけでなく、自然な動作とiPhoneリアルタイム描画まで通過して初めてv3を正式検討する。
- `friend-v2` の会話・音声改善は並行継続する。
- v2で検討中の **Talk Engine分離** はv3でも前提とし、会話/音声/記憶/演技意図はVisual Rendererから分離する。

---

# 1. Visual Target

以下3枚を **v3の目標画質・空気感・カメラ体験の基準** とする。

## 1.1 LIVE / Close Conversation

![V3 target live](assets/v3-target-live.jpg)

狙い:

- 成人女性の超リアル3D
- 顔の近距離でもCG感が弱い
- 温かい目線、自然な前傾、微笑み
- 顔〜腰上の会話が最重要
- UIより「そこにいる感」を優先

## 1.2 LOUNGE VIEW

![V3 target lounge](assets/v3-target-lounge.jpg)

狙い:

- ソファ等に自然に座れる
- 脚組み、姿勢変更、体重移動が自然
- 会話しながら全身のボディランゲージが見える
- 「ポーズ選択」ではなく、くつろいで一緒に過ごしている感覚

## 1.3 STYLE VIEW / Tasteful Low Angle

![V3 target style](assets/v3-target-style.jpg)

狙い:

- 膝付近〜やや低い位置からの、上品なローアングル全身ビュー
- 脚・全身シルエットを魅力的に見せる
- 極端な自由カメラではなく、破綻を防ぐ **Semi-Free Cinematic Camera**
- 成人キャラクターのみ
- 服・身体の貫通、内部侵入、極端な歪みを防止
- 露骨な表現ではなく、ファッション/親密感/距離感で魅力を作る

---

# 2. Original inspiration note

今回の方向性は、ユーザーが会話内で共有した第三者アプリ広告スクリーンショットをきっかけに検討した。

ただし、その第三者画像はこのリポジトリには保存しない。コピー・再配布・製品素材への転用も行わない。
今後の設計・PoCでは、**この文書に保存した3枚の生成済みfriend-v3 mockupを唯一のVisual Target**として扱う。

---

# 3. Core product decision

v3をやる価値があるのは、単に「v2より綺麗」になった場合ではない。

目標は:

> **AI動画のような可愛さ・リアルさを、同一人物のリアルタイム3Dとして維持しながら、自由度のある会話・表情・全身・カメラ体験を成立させる。**

したがって評価は甘くしない。

今回のVisual Targetを100点とした暫定Go基準:

- 静止状態: **90点近辺**
- 動作状態: **80〜85点以上**
- 70点程度ならv3本実装は見送る

「まあ可愛い」「VRMより綺麗」は合格理由にしない。

---

# 4. Avatar Gate — 本実装前に必ず通す3段階

## Gate A — 3D Still Quality

Shizuku 1人だけでモデルを作成し、同一3Dモデルから最低4構図をレンダリングする。

1. 正面の顔アップ
2. 腰上・少し前傾
3. ソファ座り・脚組み
4. STYLE VIEW相当のローアングル全身

合格条件:

- 正面だけでなく45°・横顔でも別人にならない
- 目、鼻、口、顎、耳が角度変更で破綻しない
- 髪がヘルメット/板ポリ感にならない
- 肌がプラスチックに見えない
- 全身にした時に「リアルな顔を人形の身体へ載せた」印象にならない
- ローアングルで脚・骨盤・胴体・顔が破綻しない
- Visual Target静止画比で90点近辺を狙える

ここで明確に届かない場合、v3は停止する。

## Gate B — Motion Quality

Gate Aを通過した同一モデルで10〜15秒程度の短いデモを作る。

最低動作:

- breathing
- blink
- eye micro movement
- user gaze tracking
- soft smile
- head tilt
- subtle weight shift
- lean in
- lip sync / short fixed line
- light hair movement
- light cloth movement

固定セリフ例:

> おかえり。今日はどうだった？

評価重点:

- 瞬きが周期ループに見えない
- 眼球だけが動く不自然さがない
- 話した瞬間に口元が人形化しない
- smileで顔が別人にならない
- 首傾げ・前傾で顔が崩れない
- 会話していない待機中にも生命感がある
- Visual Target比で動作時80〜85点以上

1〜2回の改善でも明確にCG人形感が残るなら、v3本実装は見送る。

## Gate C — iPhone Realtime

Gate A/Bを通過したモデルをiPhone上でリアルタイム描画する。

最低View:

- FACE
- NORMAL / waist-up
- FULL
- LOUNGE
- STYLE

暫定性能目標:

- iPhone 16級: 60fps target
- 30fpsを大きく割らない
- 顔の品質を大幅に落として30fpsを維持するだけならNO-GO候補
- cached launchは数秒程度を目標
- 長時間利用で過度の発熱・Safari/PWA不安定化を避ける

Gate A/B/Cすべてを通過して初めて `friend-v3` を正式プロジェクト化する。

---

# 5. Why movement matters as much as polygons

Photoreal系は静止画品質だけを上げると、不気味の谷リスクが上がる。

特に人間は以下の規則性・不整合を検知しやすい:

- 一定周期の瞬き
- 顔と眼球の視線不一致
- 口だけ動くリップシンク
- 呼吸と肩/胸郭の無関係
- 表情変化と頭/姿勢が独立している
- 体重移動がなく全身が常に完全静止

したがってMotionは3層で構成する。

### Base Motion

- stand
- sit
- walk / approach
- sofa sit
- leg cross
- posture change

### Additive Performance

- head tilt
- look away
- nod
- lean in
- smile / shy reaction
- gaze hold

### Micro Motion

- breathing
- blink
- eye saccade / micro gaze
- shoulder micro shift
- weight transfer
- hair spring
- cloth secondary motion

Micro Motionは固定周期ではなく、**制約付きの自然な確率分布**で発生させる。

---

# 6. v2 / Talk Engine / v3 responsibility split

v3のVisual PoCと、v2の会話・音声改善を混ぜない。

将来の理想責務:

```text
                  ┌─────────────────────────┐
                  │       Talk Engine       │
                  │                         │
User voice/text → │ dialogue / persona      │
                  │ memory                  │
                  │ voice                   │
                  │ performance intent      │
                  └──────────┬──────────────┘
                             │
                  Dialogue Event Protocol
                             │
        ┌────────────────────┴────────────────────┐
        │                                         │
┌───────▼─────────┐                      ┌────────▼─────────┐
│ friend-app-v2   │                      │ friend-app-v3   │
│ VRM Renderer    │                      │ Photoreal 3D    │
│ current/stable  │                      │ Renderer        │
└─────────────────┘                      └──────────────────┘
```

原則:

- v3 RendererからGemini/providerを直接呼ばせない方向を優先
- Talk Engineはrenderer非依存にする
- memory / affection / personaはrendererに持たせない
- Visual Rendererは演技の具体化に責任を持つ
- v2を壊してv3へ移行するのではなく、共通Talk Engineの別Rendererとして成立させる

---

# 7. Dialogue / performance event direction

将来のTalk EngineからVisual側へ、文章だけでなく意味レベルのイベントを渡す。

概念例:

```text
speech_delta
performance_delta
audio_delta
turn_final
commitAck
```

例:

```json
{
  "type": "performance_delta",
  "expression": "concerned",
  "gaze": "user",
  "motion": "lean_in_soft",
  "intensity": 0.55
}
```

```json
{
  "type": "speech_delta",
  "text": "そっか……"
}
```

v3側:

```text
performance_delta
  → 眉を少し下げる
  → gazeをuserへ
  → 頭をわずかに傾ける
  → ゆっくりlean-in

speech/audio
  → viseme / mouth / cheek / jaw
```

重要:

- LLMにbone角度やblendshape値を直接決めさせない
- semantic intent → runtime controllerの分離を維持
- existing v2 `turn_complete` / canonical transaction / commitAckの安全境界を壊さない

---

# 8. v3 Visual Runtime concept

PoC候補:

- Next.js / React
- React Three Fiber
- Three.js
- GLB / glTF humanoid
- custom high-density face rig / blendshapes
- PBR skin
- realistic eyes
- hair cards + lightweight spring physics
- lightweight cloth secondary motion
- KTX2 texture compression
- Meshopt / geometry optimization

Authoring候補:

- Blender
- MetaHuman等を高品質な原型作成に利用する案
- ただし最終runtimeはiPhone向けに軽量化する

現時点で特定authoring toolへロックしない。

### Adapter direction

```text
AvatarAdapter
 ├ VRMAvatarAdapter          // v2
 └ PhotorealAvatarAdapter    // v3
```

既存の意味レベル performance contractを再利用しやすくする。

---

# 9. Photoreal character controller concept

```text
PhotorealCharacter
      │
      ├ FaceController
      │   ├ gaze
      │   ├ blink
      │   ├ brows
      │   ├ cheeks
      │   ├ jaw
      │   └ viseme / lips
      │
      ├ BodyController
      │   ├ breathing
      │   ├ posture
      │   ├ weight shift
      │   └ gesture
      │
      ├ PerformanceController
      │
      ├ CameraDirector
      │
      └ SceneDirector
```

Animation priorityの暫定方向:

1. base body motion
2. semantic/additive pose
3. gaze/eyes/head overlay
4. facial expression
5. audio-driven lip/viseme
6. secondary hair/cloth

同じbone/morphへ複数系統が無秩序に上書きしないようcomposition layerを作る。

---

# 10. View / Camera plan

v3の主要体験として以下を想定。

| View | Main framing | Role |
|---|---|---|
| FACE | 顔〜胸上 | 最も親密な会話 |
| NORMAL | 腰上 | 日常会話 |
| FULL | 全身 | キャラクター/服/全身動作 |
| LOUNGE | 座り・ソファ | 長時間のくつろぎ会話 |
| STYLE | ややローアングル全身 | ファッション・脚・シルエット |
| CLOSE | 近距離 | 親密度の高い会話演出 |

完全自由カメラより **Semi-Free Cinematic Camera** を優先する。

理由:

- body/cloth/hair内部への侵入を防ぐ
- 極端なFOVで顔・脚が変形するのを防ぐ
- 画角ごとの品質を保証しやすい
- ユーザー操作を残しつつ「ゲームのdebug camera」感を避ける

---

# 11. STYLE VIEW provisional camera envelope

PoC用の仮値。実モデルに応じてチューニングする。

```text
camera height:      35–60 cm
distance:           1.5–2.5 m
vertical angle:     +5–15°
horizontal orbit:   ±25°
FOV:                35–45°
look target:        chest → face
```

操作案:

- horizontal swipe → limited orbit
- vertical swipe → limited camera height
- pinch → limited distance

CameraDirector guards:

- collision clamp
- minimum/maximum distance
- vertical-angle clamp
- horizontal orbit clamp
- body intersection guard
- cloth/outfit intersection guard
- pose-aware envelope
- lens distortion guard

STYLE VIEWは覗き込み機能ではなく、**魅力的な全身/脚/ファッション構図を維持するcinematic view**として扱う。

---

# 12. Character reacts to camera

カメラだけが動くと「3Dモデルを観察している」感が強くなる。

v3では、ビュー変更をキャラクター側の演技と同期させる。

STYLE切替例:

```text
0 ms    camera transition start
100 ms  gaze follows camera
250 ms  posture correction
500 ms  one leg subtly moves forward
700 ms  camera settles
900 ms  expression settles / optional speech
```

LOUNGE切替例:

```text
SceneDirector → lounge scene / lighting
BodyController → walk/sit transition
CameraDirector → full-body / knee-up framing
PerformanceController → calmer gesture amplitude
Voice intent → softer delivery option
```

「写真の構図切替」ではなく、**相手がこちらを認識して動いた**感覚を狙う。

---

# 13. Slightly sexy, but product-quality direction

v3の魅力は露出量ではなく以下を中心に作る。

- distance
- gaze duration
- eye contact recovery after look-away
- voice softness
- lean-in
- posture
- leg/whole-body silhouette
- lighting
- scene mood
- character reaction to camera/user

成人キャラクターのみ。

Relationship / affectionとの連動候補:

```text
normal
  ↓
more smiling
  ↓
longer gaze
  ↓
closer conversational distance
  ↓
LOUNGE unlock
  ↓
STYLE unlock
```

最初から全刺激を開放するより、関係性の変化として演出を解放する方向を検討する。

---

# 14. PoC character scope

最初は **Shizuku 1人のみ**。

固定要素:

- clearly adult woman
- targetは20代成人の見た目
- generated Visual Targetの髪/顔/雰囲気を基準
- light blonde / light brown short bob
- subtle pink tips
- white blouse
- pale pink skirt
- simple necklace / pink earrings direction

最初から5人を制作しない。

理由:

- Photorealの難所はrenderer codeよりcharacter asset quality
- 顔・髪・目・肌・リグ・blendshape・全身バランスの反復が必要
- 1人でquality barを突破できないなら5人に増やしても意味がない

---

# 15. PoC does NOT need the final Talk Engine

Avatar Gate A/Bは固定セリフ・固定performanceでよい。

Talk Engine完成待ちは禁止。

並行:

```text
friend-v2
 └ Talk Engine / voice / latency improvements

Avatar PoC
 └ character quality / motion / iPhone realtime
```

Gate C後にTalk Engine contractへ接続する。

この分離により、3Dモデルの品質検証が会話APIやTTSの都合に引っ張られない。

---

# 16. Cost direction

PoCの最初は無料〜低コストを優先。

- Three.js / R3F: open-source
- Blender: free
- glTF ecosystem: free/open
- candidate base-human authoring toolを必要に応じて評価

ただし本当のコストはsoftware licenseより **character制作品質と調整工数**。

最初から高価な完成モデルを購入するのではなく、Gate Aで品質可能性を検証してから投資判断する。

---

# 17. Explicit NO-GO conditions

以下のいずれかが解消困難ならv3本実装を見送る。

- 正面以外で顔が別人になる
- 横顔が明確に弱い
- 全身にすると人形感が出る
- STYLE low-angleで身体/脚/顔が崩れる
- blink/gaze/smileで不気味の谷が強くなる
- lip syncで口周りが人形化する
- iPhoneで画質を大幅に落とさないと30fps前後を維持できない
- 長時間で発熱/クラッシュが実用範囲外
- Visual Target比70点程度から改善できない

これは「せっかく作ったから続行する」サンクコスト判断を防ぐため、先に固定する。

---

# 18. GO condition / start of real v3

以下が満たされた場合にだけ、本格的な `friend-v3` 設計/実装へ進む。

- Gate A PASS
- Gate B PASS
- Gate C PASS
- same character identity across all target angles
- realtime motion still feels attractive
- iPhone quality/performance is acceptable
- Talk Engine interface can be consumed without renderer-provider coupling

その時点で検討するもの:

- dedicated `friend-app-v3` repo
- production PhotorealAvatarAdapter
- CameraDirector
- SceneDirector
- 5-person rollout
- outfit system
- relationship unlock system
- final UI
- Talk Engine service/package separation

---

# 19. Recommended first execution sequence in a new chat

新しいChatGPTチャットで以下の順に進める。

### Step 0 — CURRENT read

GitHub `syoudai0514/friend-app-v2` をfresh readする。

この文書と3枚のVisual Targetを読む。

### Step 1 — Gate A production-method review

実装前に候補ルートを比較する。

候補例:

- MetaHuman-origin → optimize → glTF
- Blender-native photoreal humanoid
- other currently available photoreal human generation / authoring pipeline

評価項目:

- target face similarity potential
- 360° consistency
- facial rig
- commercial/license suitability
- exportability
- iPhone optimization path
- price
- iteration speed

CURRENTのツール/ライセンス/モデル事情はwebでfresh確認すること。

### Step 2 — Generate/build only one Shizuku candidate

最初からapp architectureへ入らない。

### Step 3 — Produce Gate A comparison sheet

同一モデルから:

1. face front
2. 45°
3. profile
4. waist-up lean
5. lounge
6. low-angle style

Visual Targetと横並び評価する。

### Step 4 — Decide

- PASS → Gate B
- borderline → 1–2 iterations
- clear fail → stop v3

---

# 20. Copy-ready next-chat handoff prompt

以下を新規チャットの最初に送れば、この会話履歴なしで再開できる。

```text
@GitHub

friend-v3 Photoreal Avatar PoC を新規チャットから再開します。

repository:
syoudai0514/friend-app-v2

最初にCURRENT GitHubをfresh readしてください。

canonical handoff:
docs/v3-avatar-poc/FRIEND-V3-AVATAR-POC-HANDOFF.md

visual targets:
docs/v3-avatar-poc/assets/v3-target-live.jpg
docs/v3-avatar-poc/assets/v3-target-lounge.jpg
docs/v3-avatar-poc/assets/v3-target-style.jpg

重要:
- v3本実装はまだ開始しない
- まずShizuku 1人のPhotoreal Avatar Gate A
- Visual Targetに届かなければv3はNO-GO
- friend-v2 / Talk Engine改善とは分離して進める
- CURRENT tool / license / photoreal human pipelineはfresh researchする

まずHandoff全文と3枚のVisual Targetを確認し、
Gate Aを最短・低コストで検証する制作方式を比較してください。
その後、最有力方式で実際のShizuku Photoreal Avatar PoCを作るための具体的な実行計画を出してください。
```

---

# 21. Storage / privacy boundary for continuation

この資料とVisual TargetをGitHub側に保存した後は、今後のPoC判断をこのChatGPTチャットの添付画像や会話履歴へ依存させない。

このチャットを削除した後の別チャットでは:

- このGitHub文書をfresh read
- Visual Target 3枚を基準にする
- ChatGPT内に以前の画像が残っている前提で進めない

第三者広告スクリーンショットはリポジトリに保存せず、生成したfriend-v3 target mockupだけをcanonical visual referenceにする。

---

# 22. One-line decision

> **friend-v3はまだ作らない。まずShizuku 1人で「このVisual Target級の可愛さ・リアルさを、自然に動くiPhoneリアルタイム3Dとして実現できるか」を証明し、証明できた場合のみ本格着手する。**
