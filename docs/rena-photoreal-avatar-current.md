# Rena Photoreal Avatar — CURRENT

Updated: 2026-09-07
Status: CURRENT

This document is the current product/implementation contract for the photoreal `rena` avatar PoC. If this document conflicts with an older handoff, PR body, screenshot, or historical commit, the current repository source and this contract take precedence unless a newer accepted canonical document explicitly supersedes it.

## 1. User-visible requirements

- RENA-AVATAR-001 — Preserve the approved body proportions. In particular, do not redesign the long/slim legs, current hip/buttock scale, or overall school-uniform silhouette while fixing the face.
- RENA-AVATAR-002 — The face should stay close to the accepted reference direction: small/slender face, large soft eyes, narrow nose, non-protruding chin, bob hair with pink gradient ends, and pink flower earrings.
- RENA-AVATAR-003 — A neck/head seam must not be visibly readable from front, either side, or back. This includes geometry overlap, z-fighting, hard material/normal boundaries, UV/base-color discontinuity, and skin-tone steps.
- RENA-AVATAR-004 — In profile, the head must sit on the body's neck axis rather than reading as shifted forward.
- RENA-AVATAR-005 — The mouth-to-chin line must not read as underbite/prognathic or excessively pointed.
- RENA-AVATAR-006 — Hair and earrings must survive the seam fix without being cropped as if they were neck/chest skin.
- RENA-AVATAR-007 — The asset used by the app is `/public/models/rena/loose.glb`; `CharacterStage` may override it only through `NEXT_PUBLIC_RENA_GLB_URL` for controlled testing.

## 2. Current runtime architecture

`src/components/character/CharacterStage.tsx` special-cases `personaId === "rena"` and loads the photoreal GLB through `GlbCanvas`. Other characters continue through the VRM path.

`GlbCanvas` uses `GLTFLoader`, centers the asset from its actual bounds, disables mesh frustum culling for this dense Tripo-derived asset, and exposes OrbitControls for visual inspection.

The current Rena GLB is **not rigged** and is intentionally treated as static geometry. Therefore the visual repair in this contract must not be reported as having solved facial expressions, lip sync, gaze, or natural body motion. Those require a rigged/morph-capable follow-up asset or a different deformation pipeline.

The exact approved-current binary identity is recorded in `public/models/rena/manifest.json` and is enforced by automated tests.

## 3. v5 actual-app failure and confirmed root cause

The v5 binary (`sha256 31d5a06e...`) passed the binary/unit/lint/build contract and loaded successfully through the actual app WebGL path, but that was **not** sufficient for visual acceptance. Actual app front/side/back QA exposed a pale lower-neck band and, in both profiles, a broad horizontal/sloped skin shelf protruding from the throat. That violated RENA-AVATAR-003, RENA-AVATAR-004, and RENA-AVATAR-006, so v5 must not be treated as an accepted visual result.

Fresh geometry comparison against the canonical `main` baseline (`sha256 bfb42e47...`) showed why:

- canonical `RenaBody`: 867,486 vertices / 1,690,095 faces, max Y `0.855865...`
- v5 `RenaBody`: 866,285 vertices / 1,688,006 faces, max Y `0.848693...`
- v5 had cropped part of the otherwise-approved natural body neck while retaining a large replacement-head skin surface through roughly Y `0.837`–`0.856`.
- the remaining replacement-head lower skin sat substantially forward of the natural body neck in profile, which produced the shelf/spike visible in the actual app.

The canonical-body comparison also confirmed that every retained v5 body vertex was a vertex from the canonical body; the failure was therefore an upper-neck integration error, not a reason to redesign the approved lower body.

## 4. v6 integration strategy — CURRENT branch candidate

The corrective strategy is still one final GLB with internal `RenaBody` and `RenaHead`, never runtime face/body layering.

1. Restore `RenaBody` from the canonical `main` baseline exactly, including its natural neck. This makes RENA-AVATAR-001 an invariant rather than re-editing the approved body during each face iteration.
2. Keep the v5 `RenaHead` as the face/hair/earring identity source so the accepted face direction is not redesigned.
3. Remove only replacement-head **skin** faces in the lower throat/neck overlap region (`|x| < 0.060`, `y < 0.856`, `z > -0.047`). The forward jaw/chin is retained; non-skin faces are never selected, preserving hair ends and earrings.
4. Do not recolor, reshape, crop, or regenerate the canonical body to hide the seam. The natural body neck supplies the visible neck surface after the redundant replacement-head shelf is removed.
5. Lock the exact candidate binary and geometry in `public/models/rena/manifest.json`. Binary/unit/lint/build checks are necessary but the merge gate remains actual-app WebGL inspection from front, both sides, and back.

CURRENT branch candidate identity:

- SHA-256: `31e0214990813b5faf410a909ae27efb3bbe528e0d44835a204c54ff73615fa8`
- Size: `98,586,840` bytes
- `RenaBody`: 867,486 vertices / 1,690,095 faces (canonical baseline topology)
- `RenaHead`: 549,599 vertices / 1,037,505 faces
- replacement-head skin faces removed: 162,410

**Acceptance status: pending actual-app visual QA.** This candidate must not be merged merely because automated checks are green.

## 5. Acceptance and verification

Before merging any future Rena visual change, check all of the following against the then-current app asset, not an old screenshot:

1. Binary contract/GLB header and manifest hash pass.
2. `npm test`, `npm run lint`, and `npm run build` pass.
3. App renderer loads `rena` through the photoreal GLB path without fallback/error.
4. Front, left, right and back views show no visible neck splice or body/head double surface.
5. Profile does not read as forward-shifted and the chin does not read as protruding.
6. The accepted body style is unchanged below the neck repair region.
7. Hair ends and earrings remain intact.
8. Production verification is performed after the main-branch deployment; branch/PR checks are not proof of production state.

## 6. Motion/expression follow-up

Natural idle, gaze, expressions and lip sync are a separate follow-up. The current `GlbCanvas` path has no skeletal/morph contract, so adding fake UI-level "talking" state without a deformable model would not satisfy the requirement.

Recommended next step after the visual asset is accepted: create or retarget a rigged photoreal Rena asset with stable head/neck topology, facial blendshapes (or ARKit-compatible equivalents), eye bones/look-at targets, jaw/mouth controls, and a humanoid body skeleton; then add a photoreal performance controller parallel to the existing VRM performance path.
