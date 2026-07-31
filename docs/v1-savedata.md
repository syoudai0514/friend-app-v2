# v1 のセーブデータ形式

このアプリが端末に残すデータの一覧。
別の版（v2）へ引っ越すときの受け渡し仕様として使う。

対象コミット: `v1.0.0` タグ

---

## 保存場所

| キー | 場所 | 中身 | 引っ越し |
|---|---|---|---|
| `friend-app:v1` | localStorage | 本体（`AppState`） | **する** |
| `friend-app:lock` | localStorage | 端末ロック設定（Face ID・パスコード） | しない（移行先で再設定） |
| `friend-app:pending` | sessionStorage | ホームで打った言葉をトーク画面へ渡す一時置き場 | しない（一時的なもの） |
| `friend-app-pass` | Cookie | 合言葉認証のトークン（サーバーが発行） | しない |

localStorage はドメインごとに分かれているため、別ドメインのアプリからは直接読めない。
引っ越しは「せってい」画面の**エクスポート／インポート**を通して行う。

---

## 本体（`friend-app:v1`）の形

```ts
interface AppState {
  onboarded: boolean;          // 初回の名前入力が済んでいるか
  userName: string;            // キャラからの呼ばれ方
  persona: Persona;            // いま選んでいるキャラの人格
  look: Look;                  // いま選んでいる見た目
  affection: number;           // 好感度。会話するたびに増える
  messages: ChatMessage[];     // 会話履歴
  memories: string[];          // 会話から覚えた要点（好きなもの・約束など）
  personas: Record<string, PersonaSave>;  // 選んでいない他キャラの保存分
}

interface PersonaSave {        // キャラごとに分けて持つ。切り替えても消えない
  persona: Persona;
  look: Look;
  affection: number;
  messages: ChatMessage[];
  memories: string[];
}

interface Persona {
  id: string;                  // aimi / shizuku / nagi / hinata / rena
  name: string;                // キャラ名
  firstPerson: string;         // 一人称
  honorific: string;           // ユーザーにつける敬称。空文字なら呼び捨て
  speech: string;              // 口調の指示（プロンプトに入る）
  personality: string;         // 性格の指示（プロンプトに入る）
  idleLines: string[];         // ホーム画面の待機セリフ。{user} が名前に置換される
}

interface Look {               // すべてカタログ内のIDを指す文字列
  hair: string;       hairColor: string;
  eyes: string;       eyeColor: string;
  brows: string;      mouth: string;
  nose: string;       makeup: string;
  outfit: string;
  headAcc: string;    glasses: string;   earrings: string;
  skin: string;       figure: string;
  scene: string;      // 背景
}

interface ChatMessage {
  role: "user" | "model";
  text: string;
  at: number;                  // 送信時刻（エポックミリ秒）
}
```

型の実体は `src/lib/types.ts`、読み書きは `src/lib/store.tsx` にある。

---

## エクスポートされるJSON

「せってい」→「エクスポート」で `koibito-backup-YYYY-MM-DD.json` が落ちる。
中身は `AppState` の全項目に、先頭へ版の目印を1つ足したもの。

```jsonc
{
  "schemaVersion": 1,     // ← この形式であることの目印
  "onboarded": true,
  "userName": "あなた",
  "persona": { "id": "aimi", ... },
  "look": { "hair": "ponytail", ... },
  "affection": 12,
  "messages": [ { "role": "user", "text": "ただいま", "at": 1712... } ],
  "memories": ["ラーメンが好き"],
  "personas": { "shizuku": { "persona": {...}, "look": {...}, ... } }
}
```

> ⚠️ `schemaVersion` は `v1.0.0` から書き出すようになった。
> **それ以前に書き出したファイルにはこの項目が無い。**
> 読み込む側は「`schemaVersion` が無い ＝ 1」として扱うこと。

読み込みは `reconcile()`（`src/lib/store.tsx`）が担当する。
知らない項目は無視し、足りない項目は既定値で埋めるので、
多少形が違っても壊れずに読める。

---

## 別の版へ引き継ぐときの対応関係

そのまま引き継げるもの（識別子を変えないこと）:

| 項目 | 備考 |
|---|---|
| `persona.id` | `aimi` / `shizuku` / `nagi` / `hinata` / `rena` |
| `affection` | 数値そのまま |
| `messages` | 形も含めてそのまま |
| `memories` | 文字列の配列 |
| `userName` / `onboarded` | そのまま |
| 表情ID | `normal` / `happy` / `shy` / `sad` / `angry` / `surprised` / `sleepy`（`src/lib/expressions.ts`） |

引き継ぎに変換が要るもの:

| 項目 | 備考 |
|---|---|
| `look.outfit` | 衣装ID。表示方式が変われば対応表が必要 |
| `look.scene` | 背景ID。同名で揃えられるなら不要 |
| `look` のその他（`hair` `eyes` `mouth` `brows` `makeup` `nose` `skin` `figure` `headAcc` `glasses` `earrings` `hairColor` `eyeColor`） | SVGアバターを描くための項目。別方式では意味を持たない |

このアプリに**存在しない**もの（引き継ぎ対象外）:

- キャラの解放状態／衣装の解放状態（ガチャ未実装。全部最初から使える）
- 課金・通貨
- 複数セーブスロット

---

## 注意

- インポートは**全上書き**。取り込む前のデータは残らない
- 会話履歴が長いとJSONが数MB規模になることがある
- 端末ロック（Face ID・パスコード）の設定は別キーなので、エクスポートには含まれない
