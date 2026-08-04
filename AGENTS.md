<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# friend-app v2 — プロジェクト概要と引き継ぎメモ

このファイルはClaude Code・OpenAI Codex CLIなど、複数のAIコーディングツールが
共通で読み込む規約ファイルです（`CLAUDE.md` はこのファイルを読み込むだけの
薄いラッパーになっています）。**別のツール・別のセッションに引き継いでも
ここを読めば経緯が分かるように**、決定事項と失敗から学んだことをここに書きます。
新しい知見が増えたら、このファイルに追記してください。

## これは何のアプリか

「日々の疲れを癒すAIキャラと会話する、自分専用のスマホWebアプリ」。
[friend-app（v1）](https://github.com/syoudai0514/friend-app) の後継版で、
キャラ表示を v1 の「1枚絵PNG → SVGアバター」から **3Dアバター（VRM 1.0）** に
作り替えている。v1は別セッションで並行して開発が続いている（凍結していない）。

- 会話: Gemini（`@google/genai`）、システムプロンプトは `src/lib/prompt.ts`
- 保存: ブラウザのlocalStorageのみ（`src/lib/store.tsx`）。サーバーには残さない
- 入口: 合言葉（`APP_PASSCODE`環境変数）で保護。無ければ素通し
- 主用途: iPhoneのホーム画面追加（PWA standalone）
- v1との共通契約: `personaId`（aimi/shizuku/nagi/hinata/rena）・`expressionId`・
  `affection`・`messages`・`memories` はv1と完全一致。`variantId`はv2新設

## Phaseと現在地

| Phase | 内容 | 状態 |
|---|---|---|
| 0 | v2雛形（v1コピー→描画層削除→ビルド通過） | ✅完了 |
| 1 | WebGL実機検証（サンプルVRM表示） | ✅完了 |
| 2 | 1キャラ本番（表情7種・まばたき・poster fallback） | ほぼ完了。実機での最終確認は都度お願いする |
| 3 | モーション（Mixamo→Blender→VRMA） | 進行中。6種類導入済み（下記） |
| 4 | 衣装/髪型（衣装ごとに別VRM） | 進行中。アイミー3種・しずく4種・れな3種。別キャラの衣装・髪型試着版あり |
| 5 | 残りキャラ移行＋セーブ移行UI | 進行中（なぎ・れなにVRM配置済み。ひなたは未着手。セーブ移行UIは実装済みだが実機往復テスト未実施） |

## キャラクターとアセットの現状

| personaId | 名前 | VRM衣装（variantId: 表示名） | 背景scene | 状態 |
|---|---|---|---|---|
| aimi | アイミー | swimsuit: ドレス / shirt: 腰巻きギャル / knit: オフショルニット | poolside | VRM済み |
| shizuku | しずく | casual: 私服（ノースリーブ） / knit: 長袖ニット / leather: 黒レザードレス / fftifa: FFVティファ | washitsu | VRM済み |
| nagi | なぎ | default: スタンダード（VRM0.0エクスポート） | night | VRM済み。posterなし（thumbnailImage未設定のため） |
| hinata | ひなた | （未作成） | classroom | **VRM未着手** |
| rena | れな | default: スタンダード / work: 仕事着 / casual: 私服（いずれもVRM0.0エクスポート、元ファイル名/タイトルは全て「あい」） | office | VRM済み。posterなし（thumbnailImage未設定のため） |

モーション（`public/vrma/<motionId>.vrma`、全キャラ共通・人型ボーン名でリターゲット済み）:
`idle`(たちポーズ) / `genki`(ごきげん立ち) / `kiss`(投げキッス) / `kick`(ハイキック) /
`situp`(腹筋) / `squat`(スクワット)。追加は歓迎、Mixamoで探して手順どおり変換する。

## ディレクトリ構成（実装済み）

```
public/vrm/<personaId>/<variantId>.vrm         VRM本体（衣装込み1体）
public/vrm/<personaId>/<variantId>.poster.webp 読込中/失敗時の静止画（VRMのメタ情報の
                                                サムネイルを流用しているだけ。全身ではなく
                                                顔クローズアップなので不完全。将来的に
                                                ちゃんとした全身poster差し替えの余地あり）
public/vrma/<motionId>.vrma                    モーション（キャラ非依存）
public/backgrounds/<sceneId>.jpg               背景（未使用でもCSS/デフォルト背景で足りている）
scripts/generate-vrm-manifest.mjs              public/vrm/を走査してsrc/lib/vrm-manifest.tsを
                                                自動生成（npm run dev/buildの前に走る）。
                                                DISPLAY_NAMES定数でファイル名と表示名を分離
scripts/extract-face-parts.mjs                 代表VRMから瞳・眉・口の画像を
                                                public/face-parts/へ自動抽出
src/components/character/
  useVrm.ts        VRM読み込み（GLTFLoader+VRMLoaderPlugin）、dispose管理
  useVrma.ts       VRMA読み込み（VRMAnimationLoaderPlugin）
  VrmModel.tsx     ポーズ・カメラ初期位置・表情・まばたき・モーション再生
  VrmCanvas.tsx    R3F Canvas + OrbitControls + context lost対策
  CharacterStage.tsx  VRM→poster→簡易エラー表示のフォールバック制御
src/lib/vrm-assets.tsx   vrmUrl()/posterUrl()/vrmaUrl() のURL組み立て
src/lib/vrm-manifest.ts  自動生成ファイル（直接編集しない）
```

## 実装で分かった落とし穴（同じ失敗を繰り返さないために）

1. **VRMは何もしないとT-poseで出る。** 直立に見せるには
   `humanoid.getNormalizedBoneNode("leftUpperArm").rotation.z` に**絶対角度**を
   設定する（`VrmModel.tsx`で`Math.PI*0.42`前後）。normalizedボーンは
   「回転0 = T-pose」が基準になっており、既存の値に**差分を足す**やり方は
   ワールド軸基準の回転が想定外に増幅されて破綻する（実際にT-poseや変な方向の
   曲がりで2回失敗した）。姿勢の微調整はどのみち実機で見ないと正しい軸が
   分からないため、Blender側でVRMAとして作るのが本筋（Phase 3）。
2. **MToonの輪郭線（アウトライン）専用マテリアルは`isOutline===true`で
   `side: THREE.BackSide`が意図的。** 描画修正で全マテリアルを触るときは
   必ず`isOutline`を除外すること。除外し忘れて全身が輪郭線の色で覆われる
   事故を1回起こした。
3. **両面描画(`DoubleSide`)にしていいのは髪・顔だけ。** VRoid書き出しの
   マテリアル名は末尾が`_HAIR`/`_FACE`/`_EYE`/`_SKIN`/`_CLOTH`という命名規則
   （`useVrm.ts`で`/_(HAIR|FACE)$/`の正規表現チェック）。特定角度で顔や髪が
   消えるのは`_HAIR`/`_FACE`が片面描画なのが原因だが、`_CLOTH`はVRoidの
   書き出し時点で既に必要な面が両面設定済みなので**触ると事故る**
   （しゃがみ姿勢で服の折り返り部分の裏側が見えてしまった）。
4. **カメラは初回ロード時のバインドポーズのバウンディングボックスから
   一度だけ計算する**（`VrmModel.tsx`、全身が収まるようfovから距離を逆算）。
   スクワット等で体が大きく動くモーションだと画角から外れることがあるが、
   これは仕様として割り切り、**OrbitControls（1本指回転・2本指ピンチ/パン）**
   で利用者が調整する前提にしている。右下の「↺」で初期位置に戻せる
   （`orbitControlsRef.current.reset()`、初期化時に`saveState()`している）。
   `maxPolarAngle`は`Math.PI*0.68`程度に制限し、真下から見上げる
   （スカートの中が見える）角度には回り込めないようにしてある。
5. **VRMAのループ再生は最後→最初のコマで姿勢が不連続にジャンプする。**
   その勢いをスプリングボーン（髪等の物理演算）が拾って一瞬暴れることがある。
   `AnimationMixer`の`"loop"`イベントで`vrm.springBoneManager.reset()`を
   呼んで対処している。
6. **three@0.185は型を同梱しない。** `@types/three`を devDependencies に
   別途追加する必要がある（`npm i --save-dev @types/three`）。
7. **肌の艶はVRM本体を再編集せず、読み込み時のMToon設定で足せる。**
   マテリアル名末尾が`_SKIN`のものだけに暖色のparametric rimを設定し、顔は弱く、
   脚を含むBodyは少し強くする。アウトラインは必ず除外し、服や髪には適用しない。
   GLTFLoader後の名前には` (Instance)`が付くため、末尾判定ではこれも許容する。
8. **照れ表情は表情プリセットだけでは伝わりにくい。** `relaxed`と小さな`happy`を
   合成し、normalizedの頭・両目へ「うつむき＋視線そらし」の差分回転を重ねる。
   差分は毎フレーム、AnimationMixer評価前に前回分を外してから付け直すこと。
   外さず加算すると、静止ポーズで首や目の回転が累積して破綻する。
9. **別キャラの衣装は、VRoidの`_CLOTH`マテリアルを境界に服だけ表示できる。**
   `VrmCanvas.tsx`でベースVRMと衣装提供元VRMを重ね、両方に同じVRMAの時刻を
   評価する。身長比で提供元を自動拡縮し、足元の高さも合わせる。ドレス程度なら
   顔・髪・肌をベースのまま移せることを確認済み。ただし、現状はVRMを2体読むため
   GPU/メモリ負荷がほぼ2体分あり、体型差の大きい服では肌の突き抜けや裾のずれが
   残る。正式版ではBlender等で衣装メッシュを共通素体へ合わせて書き出し、服ごとの
   ボディマスクも持たせるのが本筋。`Look.outfit`はこの試着元を保存する。
10. **髪型も`_HAIR`マテリアルを境界に分離できる。** ベース側の髪を隠し、
    提供元VRMでは髪だけを表示する。全身の身長比で拡縮したうえで、両VRMの
    `head`ボーンのワールド座標差を使って頭位置を合わせる。VRMAの時刻を同期すれば
    頭の動きとスプリングボーンにも追従する。`Look.hair`に提供元を保存する。
    衣装と髪型を別々の提供元から同時試着すると最大3体のVRMを読むため、これは
    あくまで互換性確認用。正式版では衣装・髪メッシュを事前抽出して軽量化する。
11. **瞳・眉・口はVRM内で別々のPNGになっており、VRoid間で共通UVを使える。**
    `extract-face-parts.mjs`で代表VRMの`EyeIris_00_EYE`、`FaceBrow_00_FACE`、
    `FaceMouth_00_FACE`のbaseColor画像を抽出し、ベースVRMの同名マテリアルへ
    読み込み後に差し替える。顔形状・表情モーフはベース側のままなので、別顔メッシュを
    重ねるよりずれにくく、追加VRMも不要。差し替えテクスチャは`sRGB`、`flipY=false`に
    し、切替・破棄時に元のmapへ必ず戻して追加テクスチャをdisposeする。
12. **届いたVRMがVRM 1.0とは限らない。** なぎ・れなのファイルは
    `extensionsUsed`が`["KHR_materials_unlit","VRM"]`（`VRMC_vrm`ではない）
    ＝VRM0.0エクスポートだった（VRoid Studioのエクスポート設定で1.0/0.0を
    選べるため、指定し忘れると0.0で出る）。`@pixiv/three-vrm`
    (`VRMLoaderPlugin`)は`acceptV0Meta`がデフォルトtrueで読み込み自体は
    できるが、**正面の向きが180度逆のまま**になる。`loaded.meta?.metaVersion
    === "0"`のときだけ`VRMUtils.rotateVRM0(loaded)`を呼んで揃える
    （`useVrm.ts`）。VRM0.0はmetaに`thumbnailImage`ではなく`texture`
    フィールドを持つ別構造で、そもそも値が`-1`（未設定）なこともあり、
    その場合はposter.webpを生成できない（このケースでは実際に両方とも
    未設定だった。poster自体はVRM読込失敗時の最終フォールバックなので
    実害は小さいが、`受け取りルーティン`のVRMC_vrmチェックはVRM0.0では
    素通りしてしまう点に注意——`extensionsUsed`を先に見て版を確認する）。

## Mixamo → Blender → VRMA の手順（確立済み）

1. Mixamoで動きを検索・プレビュー（例: `Happy Idle`, `Sitting`, `Crawling`）
2. ダウンロード設定: **Format = FBX Binary(.fbx)**（"FBX for Unity"は不要。
   Unity向け座標変換が入るので素のBinaryでよい）、**Skin = Without Skin**
   （モーションだけでよく、Mixamoのマネキンメッシュは不要）
3. Blenderに **VRM Add-on for Blender** を導入
4. `File → Import → VRM` で対象キャラのVRMを読み込む（ターゲット）
5. `File → Import → FBX` でMixamoの動きを読み込む（ソース、`mixamorig:`接頭辞の骨格）
6. VRM Add-onのリターゲット機能でソース→ターゲットのボーン対応を取る
   （コンストレイントで追従させる方式が一般的）
7. **重要:** コンストレイントで追従させただけでは、書き出すと
   **1コマだけの静止ポーズになる**（実際に3回失敗した）。
   ターゲット側armatureをPoseモードで全ボーン選択→
   `Pose/Object → Animation → Bake Action`。Frame Start/Endを
   Mixamoの動きの長さに合わせ、**Visual Keyingを必ずON**にする
   （コンストレイントの動きを実キーフレームとして焼き付けるため）
8. `File → Export → VRM Animation (.vrma)` で書き出す
9. **送る前の自己チェック**: ファイルサイズが数十〜100KB以上あるか
   （静止ポーズだけだと10〜15KB程度で明らかに小さい）。受け取る側は
   glTFのJSONチャンクに`animations`配列があるか、`buffers[0].byteLength`が
   0でないかで機械的に判定できる（このセッションでは毎回pythonでバイナリを
   直接パースして確認していた）

## VRM受け取り時の確認ルーティン

新しいVRM/VRMAが届いたら、まずこれを機械的にチェックしてから組み込む
（このセッションで確立した手順）:

- **VRM**: まず`extensionsUsed`に`VRMC_vrm`があるか`VRM`（旧0.0）しかないかを
  見る。1.0なら`extensions.VRMC_vrm.meta`の`name`/`authors`、`humanBones`が
  54個前後あるか、`expressions.preset`に標準7種＋viseme系があるかを確認。
  0.0なら`extensions.VRM.meta`（`title`/`author`/`humanoid.humanBones`
  ／`blendShapeMaster.blendShapeGroups`）で同等の確認をし、上記12番の
  向き補正が要ることを忘れない
- **重複送信の検知**: 同じファイルが2回送られてくることが何度かあった
  （VRoid側で保存し忘れ、別のプロジェクトを開いたまま等）。`md5sum`で
  直前に配置したファイルと比較し、一致したら「変更が反映されていない
  可能性」を先に伝える
- **サムネイル流用**: `meta.thumbnailImage`が指す画像をBIN chunkから
  切り出し、そのまま`<variantId>.poster.webp`として使っている
  （顔クローズアップなので全身表示との整合は取れていないが、読込失敗時
  の最終フォールバックとしてのみ表示されるので実害は小さい）
- **表示名**: ファイル名（variantId）と別に「クローゼットでの見た目」を
  ユーザーに確認してから`generate-vrm-manifest.mjs`の`DISPLAY_NAMES`に
  追記する

## 制約・注意（v1から引き継ぎ、継続して有効）

- VRoid Studio・BlenderはどちらもGUI操作が主で、この環境からは操作できない。
  ユーザーとの往復が前提。Blenderはheadless実行も可能な設計だが、この
  セッションでは自動化していない（GUIでの手順を案内する形を取った）
- VRoid Hub / Boothの無料素材はR-18/性的表現での利用を禁止しているものが
  多い。素材選定のライセンス確認はユーザー側の必須作業
- 下着（一律で見た目を揃えたい等）はコードでは対応できない。VRoid Studio
  側の素体（ベースボディ）設定で対応するのが筋（衣装をまたいで共通反映される）
- 性的な体位・行為を模したモーション/ポーズの作成は支援しない
  （Mixamoにも存在しないし、そうした用途の手伝いはしない）

## Git運用

- 開発ブランチ: `claude/friend-app-v2-vrm-r0lkkr`（統合先: `main`）
- コミットメッセージは日本語、「何を・なぜ」を書く（このリポジトリの
  git logを参照）。改修系コミットは原因と対処を書いておくと後から追える
- 変更のたびに `npm run build` を通してからコミット・プッシュする
  （`prebuild`/`predev`で`generate-vrm-manifest.mjs`が自走するので
  VRMを置いただけでも一度buildを通すこと）
- v1リポジトリ（`friend-app`）には書き込まない（別セッションが担当）

## デプロイ

v1とは別のVercelプロジェクト（別URL）。環境変数は `GEMINI_API_KEY`（必須）、
`APP_PASSCODE`（公開時推奨）、`GEMINI_MODEL`（任意）。詳細は`README.md`。

## 次にやりそうなこと（優先度順の目安）

1. ひなたのVRM作成（同じ手順：.vroid→VRMエクスポート→送付→配置。
   1.0でのエクスポートを念押しする——なぎ・れなはVRM0.0で来て上記12番の
   対応が必要だった）
2. Phase 2の実機最終確認（表情7種・まばたき間隔・poster fallback・
   prefers-reduced-motion）
3. モーションの追加（Mixamoで探す→Blenderで変換の手順は確立済み）
4. Phase 5: v1エクスポートJSONのインポート動作確認（`store.tsx`の
   `reconcile()`は実装済みだが実機での往復テストは未実施）
5. なぎ・れなのposter.webp（VRM0.0のためthumbnailImage/textureが未設定で
   自動抽出できなかった。VRoid側で全身キャプチャをもらうか、
   VRM読込成功時にcanvasから撮る仕組みを別途作るか要検討）
