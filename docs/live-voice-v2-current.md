# Live Voice V2 current production target

This document records the intended CURRENT Live Voice V2 voice-casting state used for release synchronization.

## Shizuku

- Gemini Live model: `gemini-2.5-flash-native-audio-preview-12-2025`
- Gemini Live prebuilt voice: `Achernar` (`Soft`)
- target: adult (20s) cute romantic partner / anime-romance heroine
- soft, sweet, rounded delivery instead of bright or crisp delivery
- slightly slower pace with gentle phrase endings
- close-distance delivery with occasional natural breathiness and small pauses
- subtle sensuality as a baseline nuance, without childlike voice or exaggerated moaning/whispering
- keeps a light yurufuwa-gyaru flavor while prioritizing intimate girlfriend warmth
- explicit prohibition on announcer, service-staff, sporty, or overly articulate delivery

Why the model differs from the other personas: recent Gemini 3.1 Flash Live + ephemeral-token reports show `prebuiltVoiceConfig.voiceName` can be ignored, while native-audio Live models are the documented voice-selectable path. Shizuku is temporarily pinned to the 2.5 native-audio preview so the selected voice color can actually be auditioned.

## Other personas

- Aimi: `gemini-3.1-flash-live-preview` / `Zephyr`
- Nagi: `gemini-3.1-flash-live-preview` / `Kore`
- Hinata: `gemini-3.1-flash-live-preview` / `Leda`
- Rena: `gemini-3.1-flash-live-preview` / `Gacrux`

## Production release retry

- 2026-09-01 JST: retry Production release after the prior Vercel Hobby build-rate-limit window.
- Canonical source remains `main`; no runtime behavior change is introduced by this release note update.

Canonical implementation remains `src/lib/live-voice-config.ts`; this document is a release-facing snapshot and must not override code.
