# フレンド v2

友達と話せる、スマホ向けのWebアプリ。[friend-app（v1）](https://github.com/syoudai0514/friend-app)から、
キャラ表示を1枚絵PNG／SVGアバターから**3Dアバター（VRM 1.0）**へ作り替えている版です。

会話は **Google Gemini の無料枠** で動きます。会話・記憶・好感度まわりのしくみはv1から
そのまま引き継いでいます。詳しい経緯・技術方針・Phase計画は [`AGENTS.md`](AGENTS.md) を参照してください。

---

## 現在の状態（Phase 0）

v1（[ead793f](https://github.com/syoudai0514/friend-app/commit/ead793f2e0dbf38be9276b1cfa544f1c16f26430)）
の内容をコピーし、SVGアバター描画層（`src/components/avatar/**`・`CharacterArt.tsx`・写真素材）を
取り除いた雛形です。**キャラはまだ画面に表示されません**（`CharacterStage` は背景色のみのプレースホルダ）。
VRMの実描画はPhase 1以降で組み込みます。

## できること

| 画面 | 内容 |
|---|---|
| ホーム | 背景シーン＋待機セリフ。↻ でセリフが変わる |
| トーク | Geminiと会話。返事は1文字ずつ流れてくる |
| クローゼット | 衣装（VRMバリアント）／モーション／背景 の切り替え |
| キャラ | 性格の違う5人から選ぶ |
| せってい | 呼ばれたい名前、キャラの口調・性格・セリフの編集、データのエクスポート／インポート |

- **好感度**：話しかけるたびに上がり、5段階で口調と距離感が変わります
- **保存先**：会話・見た目・好感度はすべてブラウザのlocalStorageのみ。サーバーには残りません
- **表情**：返事の内容に合わせて7種類（ふつう／うれしい／照れ／しょんぼり／むくれ／驚き／眠そう）の
  タグをキャラ自身が選びます。VRM表情プリセットへの反映はPhase 2で作り込みます

---

## はじめかた

### 1. APIキーを取る

[Google AI Studio](https://aistudio.google.com/apikey) を開いて「Create API key」。
Googleアカウントがあれば無料で、クレジットカードの登録もいりません。

### 2. キーを設定する

```bash
cp .env.local.example .env.local
```

`.env.local` を開いて `GEMINI_API_KEY=` の右にキーを貼ります。

### 3. 起動する

```bash
npm install
npm run dev
```

http://localhost:3000 を開いてください。

---

## mainへpushする（Windows）

リポジトリ直下の `push-main.bat` をダブルクリックすると、現在の `main` ブランチをGitHubへpushできます。別ブランチで実行した場合は安全のため中止します。

---

## 見た目のしくみ（VRM）

```
public/vrm/<personaId>/<variantId>.vrm          … 衣装込みのVRM本体
public/vrm/<personaId>/<variantId>.poster.webp  … 読み込み前後に出す静止画
public/vrma/<motionId>.vrma                     … 骨格アニメーション（Mixamo→Blenderでオフライン変換）
public/backgrounds/<sceneId>.jpg                … 背景
```

- VRM本体はVRoid Studio（無料）でユーザーが作成
- `npm run dev` / `npm run build` の前に `scripts/generate-vrm-manifest.mjs` が
  `public/vrm/` を走査して `src/lib/vrm-manifest.ts` を書き出します（画像置き場の一覧と同じ考え方）
- フォールバックは **VRM → poster画像 → 簡易エラー表示** の一直線（v1の三段フォールバックには戻さない）

まだVRMを1体も置いていないため、クローゼットの衣装タブには
「スタンダード」という仮のバリアントだけが出ます。

---

## 会話の中身を変える

キャラへの指示は `src/lib/prompt.ts` の `buildSystemInstruction()` で組み立てています。
一人ひとりの性格・口調・呼び方は、コードを触らなくてもアプリの「せってい」画面から書き換えられます。

---

## v1からのセーブ移行

「せってい」画面の**エクスポート／インポート**を使います。別オリジンなのでlocalStorageは
直接読めないため、v1側でエクスポートしたJSONファイルをv2側でインポートしてください。
`schemaVersion` を見て、v1形式（無ければ1とみなす）から自動で変換します。
v1の見た目（髪型・目・服など）のうちVRMで意味を持たない項目は引き継がれません。
端末ロック設定は移行対象外です（v2側で再設定してください）。

---

## 技術構成

- Next.js 16（App Router）/ React 19 / TypeScript
- Tailwind CSS v4
- `three` / `@react-three/fiber` / `@pixiv/three-vrm` / `@pixiv/three-vrm-animation`
- `@google/genai`（Gemini SDK）
- APIキーはサーバー側（`src/app/api/chat/route.ts`）だけで使い、ブラウザには渡していません
- 合言葉の判定は `src/proxy.ts`
- クッキーはHMAC-SHA256で署名しているので、中身を書き換えても通りません
