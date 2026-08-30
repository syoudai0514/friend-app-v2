# Emotion + Natural Voice implementation

## Baseline and delivery

- CURRENT main HEAD: `93d89d1076670998665aa3d49098e73e0ea3e807`
- Branch: `feature/emotion-natural-voice`
- PR: `#16`
- Original implementation HEAD reviewed: `34a6f82792c7d08e139281ca76ebcb3cb047db0a`
- Gemini Schema subset fix: `0cbae89aad69c1ca225f87560bd0984a4c4bd562`
- Transaction acknowledgment fix: `00371b4c0ad46694e8323c29aa7df596cf56d142`

## Implemented architecture

- `src/lib/dialogue.ts` owns `ModelTurn`, Gemini provider schema, runtime validation, server event parsing, and the isolated legacy adapter.
- `/api/chat` requests Gemini structured JSON server-side, parses/validates it before emitting server-owned NDJSON events, retries structured output once, then falls back to legacy plain text once. Gemini raw JSON fragments never reach the browser.
- The Gemini `responseJsonSchema` intentionally uses only the CURRENT supported provider subset. String length rules such as narration <= 80, speech <= 360, and memory <= 120 are enforced in `validateModelTurn()` rather than with provider-side `minLength` / `maxLength` keywords.
- `TurnDraft` exists only in `ChatPage` React state and is never put in `AppState`; interruption, abort, reload, persona switch, and route change cannot persist a partial model reply.
- `commitModelTurn()` is the canonical completion transaction: one speech message (`ChatMessage.text = ModelTurn.speech`), at most one memory, and affection +1 in one persistent state transition. `turnId` prevents duplicate/stale commits.
- The store also owns a **session-only `commitAck`** next to persistent `AppState`. That acknowledgment is created in the exact same React state transition that applies the canonical conversation transaction, but only `AppState` is serialized. `ChatPage` no longer treats a synchronous boolean return as proof of commit; autoplay/TTS eligibility waits for this acknowledgment.
- Speech history is the only normal model history sent back to Gemini. Up to two narration/expression/motion records are passed separately as `recentPerformance`.
- The UI renders narration above character name and speech. Streaming preview is volatile and is replaced by the canonical persisted message only after `turn_complete` and successful commit acknowledgment.
- New sends, persona changes, and route unmount abort generation, clear the volatile draft, invalidate stale turns, and stop audio.

## Voice and audio

- `src/lib/voice.ts` and `src/lib/voice-server.ts` provide the provider-neutral registry, safe unconfigured defaults for all five personas, production-approval/license gates, TTS request validation, and display-preserving normalization.
- `/api/tts` implements the Aivis Cloud adapter against the reviewed endpoint contract and accepts only `{ personaId, speech, style, emotionIntensity }`. It never accepts chat history, user text, narration, memory, or prompts, and logs only metadata.
- Real Aivis model UUIDs, style names, API secret, and license approvals are intentionally not guessed. Profiles remain unavailable until those values are configured and `productionApproved` is explicitly true; otherwise the app safely remains text-only.
- `AudioSessionController` owns locked / idle / loading / playing / paused / interrupted / error transitions, stale-audio stopping, lifecycle handling, play rejection, per-session audio cache, and best-effort RMS lip sync. Browser SpeechSynthesis is not an automatic fallback.
- Settings include voice enabled and autoplay; each model message has a playback control.

## Performance

- `src/lib/performance.ts` converts semantic intent into bounded runtime overlays; the LLM cannot choose VRMA IDs, bones, angles, or lip-sync values.
- `look_away`, `small_nod`, `head_tilt`, emotion intensity, and pause are implemented. `lean_in` is deliberately a no-op until torso/VRMA ownership can be visually validated.
- VRMA base motion is evaluated before the composed semantic head/eye overlay, then expression morphs, then audio-driven mouth movement. Generation-time sinusoidal mouth movement has been removed.

## Save compatibility

- Save schema remains additive/backward compatible. Existing `ChatMessage.text` is retained; narration/performance/turn/audio-related fields are optional/defaulted.
- Existing v1/v2 exports continue through reconciliation; no user data reset is performed.
- `commitAck` is runtime/session-only and is never persisted to localStorage or exported save data.

## Environment and Aivis setup

- `GEMINI_API_KEY` is required for live chat.
- `AIVIS_API_KEY` is required only when an approved Aivis voice profile is enabled.
- For each persona, configure the real model UUID, reviewed license metadata, optional verified style names, and explicit production approval. Unknown values must remain unconfigured.

## Validation status

- GitHub Actions `validate` run #10 on HEAD `2801aadb6c2ceb681634bfb57d7940c4d559f11a` was **SUCCESS**.
- GitHub Actions `validate` run #16 after the transaction-acknowledgment code fix was **SUCCESS** (`npm test`, `npm run lint`, `npm run build`).
- The previous provider-schema issue is resolved: `minLength` / `maxLength` are removed from Gemini `responseJsonSchema`, while application validation still enforces narration/speech/memory limits.
- The transaction acknowledgment race identified by the second independent review is resolved by gating autoplay/TTS eligibility on the session-only `commitAck` emitted atomically with the canonical `AppState` transaction.
- iPhone standalone PWA validation remains **NOT VERIFIED** in this environment.
- First-audio latency p50/p95 remains **not measured** until a real approved voice profile/API key is configured.

## Required iPhone manual checks

- manual play
- autoplay after user unlock
- 20-50 consecutive plays
- mute/silent behavior
- Bluetooth output
- background -> foreground
- lock -> unlock
- route/persona change while generating/playing
- generation abort
- network delay / TTS failure
- `audio.play()` rejection recovery

## Known limitations

- Aivis is functionally wired but production voice configuration is blocked on real UUID/style/license/API-secret data.
- `lean_in` remains intentionally disabled.
- iPhone manual verification and first-audio latency measurements are still external/manual gates.
- Phase 7 speculative sentence TTS / phoneme / viseme sync remains out of scope.

## Review handoff

Independent SOL review should focus on the current PR HEAD and confirm:

1. GitHub Actions validate is GREEN.
2. No unsupported Gemini provider-schema keywords remain.
3. TurnDraft never enters persistent state.
4. `turn_complete` plus session-only `commitAck` is the only boundary that makes autoplay/TTS eligible.
5. Queued persona changes can reject the persistent commit without any stale autoplay.
6. Aivis remains disabled unless voice + license + approval configuration is complete.
7. iPhone items above are reported as manual/not-verified rather than inferred.
