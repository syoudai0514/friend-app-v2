# Emotion + Natural Voice implementation

## Baseline and delivery

- CURRENT main HEAD: `93d89d1076670998665aa3d49098e73e0ea3e807`
- Branch: `feature/emotion-natural-voice`
- Implementation commit: `cf3e98b8b08bbc7dc92f9d3afce574df3770b31c`
- Documentation commit: `109df606e31636ef07ca33700cd700b6a941ed9f`
- PR: created after the final documentation update; this branch is never merged by this work.

## Implemented architecture

- `src/lib/dialogue.ts` owns `ModelTurn`, JSON Schema, runtime validation, server event parsing, and the isolated legacy adapter.
- `/api/chat` asks Gemini for structured JSON server-side, validates it before emitting server-owned NDJSON events, retries structured output once, then uses legacy plain-text once. Gemini JSON fragments never reach the browser.
- `TurnDraft` exists only in `ChatPage` React state. It is never placed in `AppState`, so stream interruption, abort, reload, and route change leave no partial model reply in localStorage.
- `commitModelTurn()` is the sole model completion transaction: it commits exactly one speech message (`ChatMessage.text = ModelTurn.speech`), up to one memory, and `affection +1` in a single state transition. `turnId` prevents duplicate model commits.
- Speech history is the only model history sent back to Gemini. Up to two `narration / expression / motionCue` records are sent separately as `recentPerformance`.
- The chat UI renders narration above character name and speech. Preview switches to the canonical saved message only on `turn_complete`.
- The abort controller / active turn ID discard stale events. New sends, persona change, and route unmount abort generation, clear the draft, and stop audio.

## Voice and audio

- `src/lib/voice.ts` contains the provider-neutral registry, safe default unconfigured profiles for the five current personas, a TTS input validator, and display-preserving text normalization.
- `/api/tts` accepts only `{ personaId, speech, style, emotionIntensity }`. It neither accepts nor forwards chat history, user text, narration, memory, or prompts. Logs contain only request ID, provider, persona, character count, latency, and status.
- No Aivis voice/model ID or license is guessed. All five profiles are `productionApproved: false`, therefore text-only is the safe behavior until a reviewed profile and the verified official API adapter are supplied.
- `AudioSessionController` owns lock / idle / loading / playing / paused / interrupted / error behavior, stale stop, iPhone lifecycle stop, audio error handling, per-session blob cache, and optional RMS lip-sync. Browser SpeechSynthesis is not used as a fallback.
- The settings page adds voice on/off and autoplay switches. Each model message has a playback button; disabled voice remains visibly unavailable instead of silently falling back.

## Performance

- `src/lib/performance.ts` maps semantic intent to bounded runtime overlays. LLM output cannot select VRMA files, bones, angles, or lip-sync values.
- The controller supports `look_away`, `small_nod`, and `head_tilt`; `lean_in` is deliberately a no-op until it can be checked against every current VRM.
- VRMA base motion is evaluated before one composed semantic head/eye overlay, then expression morphs and finally audio-driven `aa` mouth movement. The old generation-time sinusoidal lip movement is removed.

## Save migration

- Schema remains version 2 and is additive. Existing messages retain `text`; new `narration`, `performance`, `turnId`, and `voice` fields are optional/defaulted. Existing v1/v2 exports continue through `reconcile()`.

## Environment and Aivis setup

- `GEMINI_API_KEY` remains required for chat.
- `AIVIS_API_KEY` is documented but not used until the official API contract is re-verified and a reviewed provider adapter is added.
- Before enabling an Aivis profile: verify its real voice/model ID, official license URL, commercial and character-use scope, attribution, restrictions, review date, and the live official OpenAPI request/response contract. Then set that one profile to `productionApproved: true` and implement the verified adapter without logging speech text.

## Validation

- Validation run in this work: ModelTurn validation, raw-event rejection, legacy adapter, TTS normalizer and unconfigured-provider safety; `npm run lint`; and `npm run build`.
- iPhone manual validation: **NOT VERIFIED** in this environment. Verify manual play, post-unlock autoplay, 20–50 repeated plays, mute switch, Bluetooth, background/foreground, lock/unlock, route and persona changes, generation abort, TTS failure, network delay, and `audio.play()` rejection.
- First audio latency: **not measured**. Measurement must start only after an approved provider is configured; store aggregate p50/p95 without speech text.

## Review points / limitations

- Aivis production playback is blocked rather than guessed because official endpoint/parameter verification and a licensed voice selection are not available here.
- `lean_in` intentionally remains no-op pending VRM-by-VRM visual QA.
- The server produces safe speech events after the complete structured response is validated; it does not expose partial structured JSON. This prioritizes transaction correctness over speculative TTS (Phase 7 is out of scope).
