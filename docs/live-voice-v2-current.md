# Live Voice V2 current production target

This document records the intended CURRENT Live Voice V2 voice-casting state used for release synchronization.

## Shizuku

- primary voice engine: browser-local `Piper Plus` + Tsukuyomi-chan ONNX
- pinned model: `ayousanz/piper-plus-tsukuyomi-chan` revision `36b59c825c36bd386b8960cf3f604382f52f2a87`
- model: `tsukuyomi-chan-6lang-fp16.onnx` (about 38 MB, 22050 Hz)
- dependencies: `piper-plus@0.6.0` + `onnxruntime-web@1.24.3`
- first use downloads the voice model automatically; later sessions reuse IndexedDB
- speech synthesis runs in the browser; Shizuku dialogue text is not sent to an external TTS service
- Gemini Live direct audio is bypassed for Shizuku; canonical dialogue still comes from the existing `/api/chat` transaction path
- if local inference fails, the existing `/api/tts` path remains a safe fallback
- target persona: adult woman in her 20s, sweet close-distance girlfriend style, soft tameguchi, subtle sensual warmth, never childlike

The local architecture follows the CURRENT ManaEvo implementation: dynamic Piper/ORT loading, iOS single-threaded WASM, local model caching, and short-chunk inference to control memory pressure.

### Attribution / license note

The voice model is trained from the Tsukuyomi-chan corpus (CV: Rei Yumesaki). Before any public distribution beyond this private PoC, keep the required corpus attribution and usage restrictions visible in the product/release materials and re-check the current upstream terms.

## Other personas

- Aimi: `gemini-3.1-flash-live-preview` / `Zephyr`
- Nagi: `gemini-3.1-flash-live-preview` / `Kore`
- Hinata: `gemini-3.1-flash-live-preview` / `Leda`
- Rena: `gemini-3.1-flash-live-preview` / `Gacrux`

## Production release retry

- 2026-09-01 JST: Vercel Hobby build-rate-limit window cleared and Production releases resumed.

Canonical runtime implementation is split between `src/lib/live-audio-fetch-bridge.ts` for Gemini Live personas and `src/lib/tsukuyomi-local-tts.js` / `src/lib/shizuku-tsukuyomi-bridge.js` for Shizuku.
