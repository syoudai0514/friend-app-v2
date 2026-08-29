# SOL設計レビュー依頼 — 情緒表現 + 自然音声

対象設計書: `docs/emotion-voice-architecture.md`

このレビューでは実装を行わず、設計の妥当性だけを確認してください。

## レビュー観点

1. narration / speech / hidden metadata の3層分離は妥当か
2. `ChatMessage.text = speech` を維持する後方互換方針に問題がないか
3. Geminiの構造化出力をNDJSON/SSEへ変換する設計は堅牢か
4. narrationが冗長にならないprompt制約は十分か
5. current memory / expression / VRMA処理との競合がないか
6. Aivis Cloudをproduction第一候補とする判断は妥当か
7. COEIROINK:つくよみちゃんを個別キャラ候補として残す方針は妥当か
8. 5キャラのvoice registry / license registry設計に不足がないか
9. iPhone PWAでの音声自動再生・停止・background復帰の考慮漏れがないか
10. `thinking` と `speaking` を分離し、口パクをaudio playbackへ同期する設計に問題がないか
11. Web Audio API `AnalyserNode` によるRMS lip syncの性能・実装難度は妥当か
12. TTS送信時のprivacy / logging / cache方針に不足がないか
13. Phase E1〜E5の分割は適切か
14. 実装前に追加すべきテスト・PoCがあるか

## 回答フォーマット

```text
判定: APPROVE / APPROVE WITH CHANGES / REDESIGN

P0:
- ...

P1:
- ...

P2:
- ...

推奨変更:
- ...

実装開始可否:
- YES / NO
```

特に問題がなければ、実装開始前の最小PoCとして何を先に作るべきかも提案してください。
