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

## 3. Root cause found in the pre-v5 asset

Fresh inspection of the prior current binary (`sha256 bfb42e47...`) found two geometries:

- `RenaBody`: up to Y `0.855865...`
- `RenaHead`: down to Y `0.785501...`

That meant the replacement head/neck and body overlapped across roughly 7 cm of model-space height. The replacement head included lower-neck/chest skin over geometry that was still present in the body. In the app this read as the rectangular/patch-like neck splice rather than a single neck.

The lower replacement-neck texture also differed strongly from the approved body-neck skin sample. Before correction, representative median RGB values were approximately:

- approved body neck: `[239, 198, 183]`
- replacement head neck: `[208, 134, 133]`

The profile also still read slightly forward, while the v4 lower-face correction had not fully removed the pointed/protruding chin impression.

## 4. v5 integration strategy

The chosen strategy is a single final GLB with two internal geometry groups, not runtime face/body layering.

The approved body is the invariant base. The repair changes only the upper skin transition and replacement head geometry required to make that transition continuous.

Applied v5 corrections:

1. Move the replacement head about 3 mm posterior, then blend the lower neck back onto the measured current body neck axis so the offset correction does not create a new seam.
2. Apply a conservative additional lower-face refinement: up to about 3 mm posterior and 0.8 mm upward only in the central lower-face skin region, plus a small lower-jaw width taper. Eyes, nose bridge, hair and earrings are excluded by the spatial/texture mask.
3. Remove the old overlapping skin surfaces while preserving clothing and non-skin detail. The validated candidate removed 2,089 body skin faces above the collar transition and 71,365 replacement-head skin faces below the transition.
4. Fit the replacement lower-neck cross-section toward the body neck center/width over a short vertical blend region rather than relying on a butt joint.
5. Match lower-neck PBR response to the body material and correct only the replacement neck texture region multiplicatively toward the approved body-neck skin sample. Baked texture detail is retained instead of painting the neck a flat color.
6. Keep hair/earring geometry outside the central skin crop so pink hair ends and flower earrings are not clipped by the seam repair.

The validated final binary is:

- SHA-256: `31d5a06ef664d268c3e35235ea233350f1988e2e9a38c191eb27513f8149d93d`
- Size: `102,186,072` bytes
- Geometry: `RenaBody` + `RenaHead`

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
