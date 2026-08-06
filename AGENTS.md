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
9. **別キャラの衣装は「服（`_CLOTH`）だけ」を借りる。体は絶対に借りない。**
   `VrmCanvas.tsx`でベースVRMと衣装提供元VRMを重ね、両方に同じVRMAの時刻を
   評価する。提供元は`materialMode="onlyClothes"`で服マテリアルのみ表示し、
   身長比で自動拡縮したうえで足元（minY）を合わせる。**ベースのBodyは一切
   加工せず完全なまま表示する。**
   VRoid書き出しのBody_00_SKINは下着まで焼き込まれた完全な素体で、服の下の
   面は削られていない（aimi/shizuku/nagi/renaの4体すべてで確認済み）。
   そのため露出の多い服を借りても穴は開かない。
   **かつては「VRoidが服の下の面を削るから提供元のBodyも重ねて補う」という
   誤った前提で体ごと借りており、それが首の黒い塊・首の伸び・顔と体の
   二色化という一連の不具合すべての根本原因だった**（詳細は15〜18番）。
   体を2体重ねる限り、別メッシュ同士なので首の継ぎ目に必ず隙間ができ、
   肌の色も一致させ続けなければならない。服だけ借りれば構造的に起きない。
   残る制約は体型差による肌の突き抜け・裾のずれだけで、これは
   「体型差がある服は少しずれることがあります」とUIで断っている範囲。
   **キャラのVRMが増えたら、まず服だけ隠して素体が完全か確認すること**
   （一時的なデバッグページを作り、`hideClothes`だけ立てて描画すれば分かる）。
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
13. **同じキャラの衣装違いVRM複数体に、あとから肌の光沢だけ反映したいことがある。**
    （例: しずくの体に光沢のあるmatcapを追加、既存4衣装すべてに反映）
    衣装ごとに完全に別のVRMファイルなので、実行時にランダムアクセスで
    差し替えるより、VRMファイル自体を1回だけ書き換える方が本筋
    （余計なpropsの配線やfetchが増えない）。`scripts/patch-skin-material.py`を使う。
    **`Body_00_SKIN`/`Face_00_SKIN`マテリアルを丸ごと差し替えるのは事故る**
    （実際に1回やって2つ問題が出た: ①衣装ごとに微妙に違う
    baseColorTexture＝肌の柄まで参照VRMのものに置き換わり、FFVティファの脚に
    別衣装の柄が透けて見えた。②さらにFFVティファでは、脚のニーハイ
    （見た目上は肌の柄ではなく別メッシュのはず）まで見えなくなった。
    `alphaMode`/`doubleSided`など他プロパティの変更がレンダリング順序に
    影響したとみられるが、正確な機序は特定できていない）。
    そのため光沢に直接関係するプロパティ（`matcapFactor`・`matcapTexture`・
    `rimLightingMixFactor`・`parametricRimColorFactor`・
    `parametricRimFresnelPowerFactor`・`parametricRimLiftFactor`）だけを
    個別に上書きし、`baseColorTexture`ほか肌の柄・他の描画設定には
    一切触れない方式にした。出力は必ず一旦別ファイルに書き、
    `baseColorTexture`のバイト列が変化していないこと（＝柄が消えていない
    こと）・`materials`件数・`buffers[0].byteLength`と実際のバッファ長の
    一致・ブラウザでの見た目（他衣装のメッシュも含め）を確認してから
    対象ファイルへ上書きすること。同じ参照元に対して複数回パッチを
    重ねがけすると未参照テクスチャが世代分蓄積してファイルサイズが
    膨らむため、必ずgit履歴からパッチ前のオリジナルを取り出して
    起点にすること（`git show <パッチ前のコミット>:<path> > original.vrm`）。
14. **肌の色・光沢は「キャラ全員が選べる」形にするなら、VRMファイルを個別に
    書き換えるのではなく実行時に適用する方が本筋。**（2026-08-05、しずくの
    肌色黒め／アイミーの白めをお互いに選べるようにし、光沢も脚を含め
    全キャラに適用できるようにした際の判断）
    - **肌色**: `recolorBodyTexture`（Canvas上で肌マテリアルのテクスチャを
      ソース色→ターゲット色へ比率変換）を本人の体に適用する。
      各キャラの肌色hexは目視ではなくBody_00_SKINベース
      テクスチャの肌色ピクセル（`r>=65,g>=45,b>=35,r-g>=4,g-b>=2`の
      条件を満たすもの）の中央値から算出している
      （既存のaimi/shizukuの手打ち値と算出結果が実際にほぼ一致したため、
      この方法で間違いないと確認できた）。`Look.skinTone`に
      `{personaId, variantId}`で保存するが、色の決定に使うのは
      `personaId`だけ（`variantId`は他の試着系フィールドとの型統一のため
      残しているだけで参照していない）。
    - **光沢**: しずくの肌はVRMファイル自体にmatcap＋parametric
      rimを焼き込んでいた（13番参照）が、これだと他キャラに広げるのに
      毎回VRMを個別パッチする必要がある。そこで「しずくのVRMから
      matcap画像を1枚だけ抽出して`public/textures/skin-gloss-matcap.png`
      という共有アセットにする」→「`VrmModel.tsx`の新しいuseEffectで、
      表示中のVRMのBody_00_SKINマテリアルに対し
      `matcapFactor`/`matcapTexture`/`rimLightingMixFactor`/
      `parametricRimColorFactor`等を実行時に代入する」方式に変えた。
      これによりVRMファイルは一切書き換えず、`Look.skinGloss`
      （`null`=変更なし／`"normal"`=しずくの実際の値／`"strong"`=強め）
      だけでどのキャラ・どの衣装にも同じ光沢を再現できる。抽出画像は
      1254×1254と大きすぎたため256×256にダウンサイズしてから配置した
      （matcapは球面マッピングの滑らかな絵柄なので高解像度は不要）。
      効果はBody_00_SKINのみに絞り、Face_00_SKINには触れていない
      （ユーザーの要望が「脚の光沢」だったため）。
15. **【解決済み・経緯として保存】借り物衣装で本人のBodyを非表示にすると
    首元に隙間ができ、暗い切り株のように見える事故があった。**（2026-08-05）
    当時は衣装元のBodyを重ねる設計だったため、本人のBodyを消す必要があり、
    その結果すぐ下の頭（Face_00_SKINは両面描画）の裏側が透けていた。
    頭ボーンへの追従度で三角形をふるい分けて首だけ残す、という対症療法を
    入れたが、閾値調整が必要なうえ17番の二次事故も招いた。
    **最終的には9番のとおり「服だけ借りる」設計に変えて構造的に解消し、
    このふるい分け処理（filterBodyGeometryByHead）は削除した。**
16. **VRoid/Blenderからの元エクスポート時点で、服（`_CLOTH`）マテリアルに
    艶のあるmatcapFactor=[1,1,1]が焼き込まれていることがある。**
    （2026-08-05、アイミー・しずくの一部衣装で判明。14番の肌の光沢
    ピッカーとは無関係に、アーティスト側の書き出し設定で入っていた）
    「光沢は肌だけにしたい」という方針のもと、`scripts/strip-cloth-gloss.py`
    で服マテリアルのmatcapFactorだけを`[0,0,0]`へ一括で上書きした。
    13番のBody/Face_00_SKIN差し替えと違い、テクスチャの追加・参照変更は
    一切しない純粋な数値上書きなので、BINチャンクは完全に無傷（何度
    実行しても副作用が無い）。他の描画設定（`baseColorTexture`・
    `alphaMode`等）にも触れていない。
17. **姿勢で動く値を、姿勢に依存しないはずの固定オフセットの根拠に使っては
    いけない。**（2026-08-05、しずく×なぎの服で首が異常に伸びて発覚）
    15番の隙間対策として衣装元の位置合わせを足元基準からheadボーンの
    ワールド座標基準に変えたところ、首が伸びる事故になった。headボーンの
    座標は`getWorldPosition()`で取った「計測した一瞬の姿勢」の値であり、
    アイドルモーションの向き・揺れで常に動いている。これを`vrm.scene.position`
    のような固定オフセットの計算に使うと、計測タイミングと実際の姿勢が
    ズレたときに破綻する。位置合わせは足元（minY）基準に戻した。
    **髪の位置合わせ（`hairOffsetX/Y/Z`）は今も同じheadボーン方式**で、
    髪は全身位置合わせと違いズレが目立ちにくいため問題は出ていないが、
    同種のリスクを抱えている点に注意。
18. **肌の色を塗り替えるときはBody_00_SKINとFace_00_SKINの両方を対象に
    すること。**（2026-08-05、なぎの肌色を変えたら顔と体が別の色に分かれて
    発覚）`recolorBodyTexture`の対象判定がBody_00_SKINだけだったため、
    首の境目で二色になっていた。Face_00_SKINも含めて修正。
    なお9番で体を借りなくなったため、肌色の塗り替えは本人の体だけが
    対象になり、`Look.skinTone`の指定がないときは変換自体を行わない。
19. **しずく・アイミーのVRMは、元のVRoid/Blenderエクスポート時点で
    Face_00_SKINのmatcapFactorが`[1,1,1]`（最大）のまま入っていた。**
    （2026-08-05、しずくの私服でユーザーが発見。「元々色黒なのに着替えたら
    体は色黒・顔は白くなる」という報告で判明）脚を含むBody_00_SKINは
    しずくのVRMで0.09〜0.18程度に抑えているのに対し、顔だけ最大強度の
    matcap（明るい画像）が乗るため、体は色黒のまま顔だけ白く浮いて見えて
    いた。肌色ピッカー・肌の色そのものとは無関係で、16番の服の光沢と同種の
    「元エクスポート時点の焼き込み」問題。Face_00_SKINのmatcapFactorだけを
    `[0,0,0]`へ数値上書きして解消（しずくの4衣装＋アイミーの3衣装、
    計7ファイル。BINチャンク無傷を確認済み）。**服だけでなく顔にも
    同種の焼き込みが無いか、光沢がらみの不具合調査では両方疑うこと。**
20. **計測effect（`onMeasured`）の依存配列に、再レンダーのたびに参照が
    変わる値を入れてはいけない。**（2026-08-06、実機スクショ32枚で
    「借りた髪が浮いて頭頂部が禿げて見える」「借りた服が上下にずれる」と
    判明）身長・足元minY・headボーンのワールド座標を測るeffectがカメラ
    初期化と一体になっており、依存配列に`initialView`が入っていた。
    `initialView`は`CharacterStage.tsx`のmodule-level Mapから毎レンダー
    読み直す値で、OrbitControlsを動かすたびに`rememberView`が新しい
    オブジェクトを書き込むため、クローゼットで選択を変える等の再レンダーの
    たびに参照が変わり計測effectが再実行されていた。一方、借り物側（服・髪）
    は`AppearanceLayers`の`key`で作り直されるため読み込み直後の静止姿勢で
    1回だけ測る。つまり**別々の姿勢で測った座標同士を突き合わせて**
    オフセットを出しており、17番と同じ罠が別経路で再発していた。
    計測effectとカメラ初期化effectを分離し、計測の依存は`[vrm, onMeasured]`
    だけにしたうえで、どちらも`useRef`でVRMごとに1回だけ走るようガードした。
    保険として、計測前に`vrm.humanoid.resetNormalizedPose()`で静止姿勢へ
    固定してから測り、測り終えたら`armDown`姿勢を掛け直す。
    **再現には静止スクリーンショットでは足りない**——バグは「再レンダーが
    起きたあと」にしか出ないため、Playwrightでの確認もカメラドラッグや
    タブ切替で意図的に再レンダーを起こしてから撮影する必要があった。
21. **借りた服は提供元の体型に合わせた硬いメッシュなので、着る側の方が
    大きい部位は必ず服の外へ出る（しずくの胸・肩・背中が服を突き抜ける）。**
    （2026-08-06、実機スクショで判明）9番で「服だけ借りる」設計にしたことで
    首の継ぎ目は解消したが、体型差そのものへの対処はしていなかった。
    `fit-clothes.ts`の`fitClothingToBody()`で、服のメッシュを体からの
    はみ出しが無くなる位置まで法線方向へ押し出す方式にした。体は一切
    変形しないので着る人の体型がそのまま服に出る。両VRMをrestポーズに
    固定してバインド姿勢で計算する（20番の計測と同じ理由——姿勢に依存する
    値を使うと壊れる）ので、変位はスキニング後の全モーションに追従する。
    襟ぐり・袖口・裾など服の開いた縁は体すれすれを通りがちで、押し出しの
    余裕が一律だとギザギザの継ぎ目になったため、縁だけ大きめの余裕を
    別に持たせている。**襟ぐりが浅い服は体を覆う面積そのものが足りない
    ことがあり、これは押し出しでは直らない**（体を覆っていない場所に
    服は存在しないので、動かす頂点が無い）。

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
