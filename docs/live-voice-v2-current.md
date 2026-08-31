# Live Voice V2 current production target

This document records the intended CURRENT Live Voice V2 voice-casting state used for release synchronization.

## Shizuku

- Gemini Live prebuilt voice: `Autonoe`
- target: adult (20s) anime-romance heroine
- brighter / slightly higher / sweeter timbre
- close-distance delivery with light breathiness
- subtle sensuality as a baseline nuance, without childlike voice or exaggerated moaning/whispering
- keeps the yurufuwa-gyaru speech style and slightly older-sister warmth

## Other personas

- Aimi: `Zephyr`
- Nagi: `Kore`
- Hinata: `Leda`
- Rena: `Gacrux`

## Production release retry

- 2026-09-01 JST: retry Production release after the prior Vercel Hobby build-rate-limit window.
- Canonical source remains `main`; no runtime behavior change is introduced by this release note update.

Canonical implementation remains `src/lib/live-voice-config.ts`; this document is a release-facing snapshot and must not override code.
