# 背景画像の置き場所

背景選択で使う画像を置く場所です。アプリは各背景IDの `.webp` を読み込みます。

## 置き方

```
public/backgrounds/<背景ID>.webp
```

例:

```
public/backgrounds/poolside.webp
public/backgrounds/night.webp
```

## 背景ID

| ID | 名前 |
|---|---|
| `room` | 自分の部屋 |
| `bed` | ベッドの上 |
| `poolside` | プールサイド |
| `arcade` | ゲームセンター |
| `office` | オフィス |
| `izakaya` | 居酒屋 |
| `classroom` | 夕暮れの教室 |
| `sakura` | 桜並木 |
| `night` | 夜景の部屋 |
| `cafe` | カフェ |
| `washitsu` | 和室 |

## コツ

- **縦長**（例 1200×2000 くらい）だとスマホの画面に合います。横長でも中央を切り出して表示します
- キャラが中央に立つので、中央は少し余白を残すと見やすくなります
- 明るすぎるとセリフの吹き出しが読みづらくなるので、少し落ち着いた明るさが扱いやすいです
