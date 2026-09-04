# friend-v3 Photoreal Avatar PoC — Gate A Execution

Status: **ACTIVE POC / NO v3 PRODUCT IMPLEMENTATION**  
Recorded: 2026-09-04 JST  
Parent handoff: PR #35 / `docs/v3-avatar-poc-handoff`  
Parent exact head: `12d667fc437d66862502d001e84d1e5f1d50253c`  
CURRENT v2 `main` observed at restart: `de2a2b090efd8e33bdc2ea50b70845e612b8d542`

## 0. Purpose

Gate Aの目的は、アプリを作ることではない。

**Shizuku 1人について、canonical Visual Target級のPhotoreal qualityを「同一の実3Dキャラクター」で成立させられるかを、最短・低コストで判定する。**

Gate Aで品質上限が不足するならfriend-v3は停止する。Gate A中にTalk Engine、Next.js renderer、Three.js/R3F統合、iPhone最適化へ先回りしない。

これは、すでに投じた時間を理由に品質基準を下げるsunk-cost escalationを避け、最初に最も大きな不確実性を潰すためのstage-gateである。

---

## 1. Fresh restart state

### Repository

- repository: `syoudai0514/friend-app-v2`
- CURRENT main at restart: `de2a2b090efd8e33bdc2ea50b70845e612b8d542`
- PR #35 head: `12d667fc437d66862502d001e84d1e5f1d50253c`
- Gate A branch: `poc/v3-gate-a`

PR #35はdocs/assets onlyで、v2 production runtimeへ影響を与えないためmainへ未mergeのまま保持されている。この境界をGate Aでも維持する。

### Canonical visual targets

All three are confirmed on PR #35 exact head:

| Target | Path | Blob SHA |
|---|---|---|
| LIVE | `docs/v3-avatar-poc/assets/v3-target-live.jpg` | `12c17db65d034e70fc822051a3ea08a9ab3bd024` |
| LOUNGE | `docs/v3-avatar-poc/assets/v3-target-lounge.jpg` | `c9d611d64e9c326903fa44bfd0838c85064b6519` |
| STYLE | `docs/v3-avatar-poc/assets/v3-target-style.jpg` | `72d30626ccdc8da38478da326b66bf6b47aa21da` |

Visual intent is fixed by the handoff:

- **LIVE**: adult photoreal woman, warm eye contact, natural slight lean-in, close face/waist-up conversation, weak CG impression.
- **LOUNGE**: natural sofa sitting, crossed-leg / posture / body-weight coherence, relaxed full-body presence.
- **STYLE**: tasteful low-angle full-body composition, attractive leg/body silhouette, cinematic rather than voyeuristic camera, no body/clothing intersection or anatomical breakage.

Do not replace these targets during Gate A just because another result is easier to reproduce.

---

## 2. CURRENT authoring route review — 2026-09-04

Gate A optimizes for **information gain per yen/hour**, not for final runtime portability. A route that is perfect for WebGL but cannot prove the 90-point visual ceiling is less useful at this stage than a route that can quickly prove or disprove the ceiling.

### Route A — MetaHuman 5.8 / Unreal Engine 5.8 / UE Cine

**Decision: PRIMARY Gate A route**

Why:

- Epic currently documents MetaHuman 5.8 and direct MetaHuman authoring in Unreal Engine.
- `UE Cine` is explicitly the highest-fidelity assembly pipeline.
- `UE Optimized` exists for later performance work, but Gate A should not reduce quality early to satisfy Gate C constraints.
- Current assembly docs state Cine characters are typically 1–2 GB, while Optimized characters average under 100 MB. That makes the distinction useful: Cine establishes the quality ceiling; optimization is a later gate.
- DCC export remains available in 5.8 through the Export tool, including geometry/DNA/material/texture controls.
- Epic states that since MetaHuman 5.6, the Unreal Engine EULA allows MetaHuman characters and animation to be used in other engines and DCC tools such as Unity, Godot and Blender. Production use still requires a final license check against the then-current EULA.

Official references checked at restart:

- https://dev.epicgames.com/documentation/en-us/metahuman/assembly
- https://dev.epicgames.com/documentation/metahuman/metahuman-5-8-release-notes-in-unreal-engine
- https://www.unrealengine.com/news/all-the-big-news-and-announcements-from-the-state-of-unreal-2025
- https://www.unrealengine.com/eula/unreal

Main downside:

- The best-looking Cine result is not an iPhone/WebGL-ready asset. That is acceptable for Gate A. Export/optimization feasibility becomes a Gate C concern only after the visual ceiling is proven.

### Route B — Character Creator 5 + Headshot 3

**Decision: FALLBACK / portability challenger**

Why:

- CC5 is designed for realistic rigged characters and advertises pipelines to Blender, Unreal, Unity and other 3D tools.
- Current CC5 has an HD 70K base and a 10K Game Base option, so the path toward a lighter runtime is clearer than MetaHuman Cine.
- Headshot 3 is current and is intended for high-fidelity, animation-ready 3D head generation.
- Better candidate than MetaHuman if the eventual bottleneck becomes exportability / web-game optimization rather than raw visual quality.

Current price snapshot:

- CC5 Standard: `$299` perpetual.
- Headshot 3: separate paid plugin; price/promotions can change.

Official references checked at restart:

- https://www.reallusion.com/character-creator/
- https://www.reallusion.com/plan-and-pricing/individual/perpetual

Rule: **Do not purchase CC5/Headshot merely because Gate A started.** Use it only if MetaHuman is visually borderline or its character-control limitation is the actual blocker.

### Route C — Human Generator for Blender

**Decision: LOW-COST BACKUP**

Why:

- Blender-native workflow with photoreal humans, hair, outfits, poses and expressions.
- Current commercial license is `$128` lifetime and explicitly allows commercial software/video-game use when assets are not exposed for extraction/reuse.
- Very low financial friction.

Main risk:

- Gate A is not asking for “a decent realistic human”; it asks for a near-Visual-Target hero character with strong face/hair/skin consistency. The likely ceiling and facial-performance pipeline are less proven for this target than MetaHuman/CC5.

Official references checked at restart:

- https://humgen3d.com/pricing
- https://help.humgen3d.com/license

### Not primary for Gate A

- one-shot image-to-3D generators: fast, but identity, topology, facial rig and multi-angle hero quality are too uncertain for the canonical gate.
- Daz-first pipeline: possible, but asset-by-asset interactive licensing and runtime pipeline complexity add decision noise before the core visual ceiling is known.
- building a custom Blender human from zero: gives maximum control but poor information gain per hour for the first gate.

---

## 3. Gate A route decision

### First attempt

**MetaHuman 5.8 → UE Cine → six controlled stills**

This is deliberately a quality-ceiling test.

Do not start with UE Optimized. Do not start with glTF conversion. Do not start with WebGL. If Cine cannot make Shizuku attractive enough, optimization work has no value.

### One fallback attempt

If MetaHuman lands in the **BORDERLINE** band because of character-shape/style limitations rather than bad art direction, perform at most one CC5 + Headshot 3 candidate pass.

Do not run three or four pipelines indefinitely.

---

## 4. Shizuku identity lock

Shizuku is one **clearly adult woman in her 20s**.

Identity anchors:

- light blonde / light brown short bob
- subtle pink tips
- soft, warm adult face
- realistic eyes and skin
- white blouse direction
- pale pink skirt direction
- simple necklace
- pink earrings direction
- approachable / gentle rather than fashion-model severity

Priority order:

1. face identity and attractiveness
2. eyes / skin / hair realism
3. consistent head/body proportion
4. body anatomy / posture
5. clothing silhouette
6. accessory and exact color matching

Do not burn early iterations matching earrings while the face is still wrong.

---

## 5. Required Gate A evidence

All images must come from **the same underlying 3D Shizuku character**. No per-view AI repainting, face replacement or 2D generation is allowed in the evidence set.

Required renders:

1. `A1_FACE_FRONT` — face close-up, frontal
2. `A2_FACE_45` — same face at ~45°
3. `A3_FACE_PROFILE` — same face in profile
4. `A4_LIVE_WAIST_LEAN` — waist-up, slight natural lean-in
5. `A5_LOUNGE` — sofa seated, natural crossed-leg pose
6. `A6_STYLE_LOW_ANGLE` — tasteful low-angle full body

Recommended repository paths once produced:

```text
docs/v3-avatar-poc/gate-a/
  candidate-01-metahuman/
    A1-face-front.png
    A2-face-45.png
    A3-face-profile.png
    A4-live-waist-lean.png
    A5-lounge.png
    A6-style-low-angle.png
    candidate-notes.md
```

Also preserve one neutral turntable or editor screenshot proving these are the same 3D character if practical.

---

## 6. Camera / lighting controls

The comparison must not accidentally reward camera tricks.

### Face identity set

- neutral-to-soft expression
- same hairstyle, skin, makeup, lighting family
- front / 45 / profile should not change facial sculpt
- avoid extreme portrait lens distortion

### LIVE

- close conversational framing
- warm soft light
- slight forward posture
- focus on eye/skin/hair realism

### LOUNGE

- seated anatomy must carry believable pelvis / torso / knee / ankle relationships
- crossed legs must not rely on clipping
- shoulders and hands should not look frozen if visible

### STYLE

Use the handoff camera envelope as the initial range:

- vertical angle: approximately `+5–15°` in the project convention
- horizontal orbit: within approximately `±25°`
- FOV: approximately `35–45°`
- look target: chest → face

The objective is an attractive cinematic low view, not an unrestricted inspection camera.

---

## 7. Gate A scoring — freeze before viewing candidate

The score is intentionally fixed before the first candidate so the criterion cannot drift toward the result.

| Dimension | Weight |
|---|---:|
| Same-person identity across front / 45 / profile | 25 |
| Face realism: eyes, nose, mouth, ears, jaw | 15 |
| Skin / eye material realism | 15 |
| Hair realism | 15 |
| Full-body proportion / anatomy coherence | 10 |
| Pose integrity: LIVE / LOUNGE / STYLE | 10 |
| Lighting / camera / overall target atmosphere | 5 |
| Outfit / accessory target fidelity | 5 |
| **Total** | **100** |

### Hard-fail overrides

Any of these prevents PASS even if the arithmetic score is high:

- profile looks like a different person
- obvious facial geometry failure at 45°/profile
- helmet-like or visibly synthetic hair at target distance
- plastic/waxy skin that remains after one material/lighting correction
- realistic face attached to doll-like body
- broken pelvis/leg/torso anatomy in low-angle view
- material or body/cloth clipping severe enough to break the illusion
- evidence uses 2D repainting to hide a 3D defect

### Decision bands

- **PASS:** `90–100`, no hard fail → Gate B may start.
- **BORDERLINE:** `85–89`, no hard fail → maximum **2 focused iterations** total, then re-score.
- **FAIL:** `<85`, or hard fail that remains after focused correction → stop friend-v3.

The `90` threshold matches the canonical handoff. Do not lower it because the candidate was expensive or time-consuming.

---

## 8. MetaHuman candidate-01 build recipe

Use Unreal Engine / MetaHuman **5.8** current toolchain.

### Phase A1 — face first

Create one adult female character and tune only enough to answer:

- Is the face attractive enough at front?
- Does the identity survive 45°?
- Does the profile stay convincing?
- Are eyes / skin already inside striking distance of the LIVE target?

Produce temporary A1/A2/A3 before investing heavily in clothing or scene work.

**Early kill rule:** if the face is clearly below target and not plausibly fixable with sculpt/material/hair tuning, do not spend time building lounge/style scenes.

### Phase A2 — hair / skin / identity refinement

Tune:

- short bob silhouette
- light blonde/light-brown base
- pink-tip direction if achievable without compromising realism
- eye wetness / sclera / iris balance
- skin roughness / subsurface response
- subtle natural makeup only

Do not over-smooth skin.

### Phase A3 — body / outfit

Use an adult body proportion coherent with the face.

Target clothing:

- white blouse
- pale pink skirt

If exact wardrobe is unavailable, use the closest clean silhouette for the first anatomy proof. Exact wardrobe creation/purchase is justified only after face identity passes A1/A2/A3.

### Phase A4 — assemble UE Cine

Gate A evidence is rendered with **UE Cine** because this gate measures quality ceiling.

Keep a note of:

- engine / MetaHuman version
- assembly mode
- texture settings
- hair asset
- body preset
- wardrobe assets
- lighting setup
- camera FOV per render

### Phase A5 — pose / scene

Create only what is needed for:

- LIVE waist lean
- lounge sofa seated / leg-cross
- style low-angle full body

No interactive scene system is needed.

---

## 9. Comparison sheet

After all six images exist, create:

`docs/v3-avatar-poc/gate-a/GATE-A-SCORECARD.md`

For every dimension record:

- score
- visible evidence
- biggest gap vs canonical target
- whether the gap is character asset, material, hair, pose, lighting or camera
- exact next correction

Avoid statements such as “なんとなくCGっぽい”. Translate each impression into an observable defect.

Example:

```text
Hair realism: 9/15
Evidence: temple/side layers form a single rigid sheet at 45°.
Cause hypothesis: current groom silhouette / strand density.
Next correction: replace/tune bob groom before altering face sculpt.
```

This turns subjective preference into a repeatable correction loop.

---

## 10. Iteration budget

### Candidate 01 — MetaHuman

- Pass 1: face identity / skin / eyes / rough hair
- Pass 2: only the largest score-limiting defect(s)
- Pass 3: only if the total is 85–89 and the remaining gap has a specific plausible fix

### Candidate 02 — CC5 + Headshot 3

Allowed only if MetaHuman is borderline because of tool-specific shape/style limits and a CC5 route has a credible chance to close that exact gap.

Do not make Candidate 02 merely because Candidate 01 took effort.

---

## 11. Explicitly forbidden during Gate A

- friend-v3 production app implementation
- changes to v2 runtime
- Talk Engine integration
- Gemini/TTS integration
- Three.js/R3F renderer work
- iPhone performance optimization
- building all five characters
- outfit system
- relationship unlock logic
- free camera implementation
- changing the canonical Visual Target
- lowering the 90-point PASS criterion after seeing results

---

## 12. Gate A exit

### PASS

Only after a documented score of 90+ and no hard fail:

- preserve six renders and scorecard
- freeze Gate A candidate asset/version
- begin Gate B motion proof with the same character

### BORDERLINE

- perform only the documented high-leverage corrections
- max two focused iterations
- re-score using the same rubric

### FAIL

- document the reason
- stop v3 work
- keep friend-v2 / Talk Engine work independent and intact

---

## 13. Next concrete action

The next action is **not code**.

1. Install/open Unreal Engine 5.8 with current MetaHuman Creator.
2. Create `Shizuku Gate A Candidate 01` as a clearly adult woman.
3. Produce A1/A2/A3 first.
4. Compare the three face angles before doing wardrobe/scene polish.
5. If the face survives, produce A4/A5/A6 with UE Cine.
6. Commit the six raw renders + candidate notes to `poc/v3-gate-a`.
7. Score once using the frozen rubric.

Gate A is complete only when the evidence exists; this document alone is not a PASS.