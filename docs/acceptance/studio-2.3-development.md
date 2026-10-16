# Studio 2.3 implementation checkpoints

Baseline `457eda90cba9b377216d17d6146835e00e8d6365`; Linux acceptance; Windows waived. These are development checkpoints, not the final S6 acceptance report. Logs are isolated under `.local/acceptance/studio-2.3/`.

## S1 shared contracts

Implemented one path-aware schema reference walker per language, prefab source-tree plans with explicit external-reference retain/redirect, stale snapshot rejection, channel-role visual composition, camera leases, rule IR, cross-scene impact discovery and structured scene/project readiness. Publication uses the same readiness service as the standalone check. Checking unsaved documents does not save or overwrite the cloud draft.

Typecheck, lint, frontend build, 19 extension checks and S1 pure contracts passed. The Linux native compiler completed; copying over the old running executable initially failed with `Text file busy`. The stale API process was stopped and the generated native output was installed and run. The real MySQL/MinIO API passed the S1 readiness/reference integration cases, 39 cross-language contract fixtures and all 9 existing Studio 2.2 integration groups. Third-party AOT/trim warnings remain in the compiler log. Later source edits require the consolidated native rebuild and rerun in S6.

The reference parity gate exposed a nested `oneOf` traversal omission in UI action references and a traversal-order difference. The shared walker now resolves nested alternatives with their actual value and sorts graph edges by path; parity compares semantic edges. No second reference validator was added.

## S2 authoring

Implemented persisted diagram positions/groups/view, pointer and keyboard editing, a minimap, direct spherical hotspot/vertex positioning, actual image-plane coordinates, two-point floor calibration, world/image transforms and live radar. Project links carry entrance camera and preload policy. Shared URLs pin a published revision, node, camera, locale and hotspot; history restoration uses the existing abortable navigation state machine. Public project manifest lookup accepts an explicit immutable revision. Video is a canonical asset kind with a real upload path.

Prefab plans run in an editor-owned cancellable worker and are adopted only against the captured scene snapshot. Full source-tree/resource/nested-pin changes and referring paths are visible. Apply resolves an explicitly chosen source ancestor; saving a child source leaves the parent's pin intact.

Storyboards compile track/clip ordering, curves and quaternions once, then sample absolute time. Keyframes, Bezier timing, ripple edits, waveform generation and VTT export use the existing document command path. Reverse playback explicitly silences original audio. Timeline clips outside the horizontal viewport are omitted from rendering.

S2 typecheck, lint, frontend build and pure contracts passed. The 100-node/300-edge fixture, 1,000 coordinate round trips, malformed deep links, nested Apply, keyframe split invariance, ripple and subtitles passed. A synthetic Node CPU fixture with 100 tracks × 100 clips and 500 random seeks measured P95 **0.336 ms** on this environment. This is not browser/GPU/physical-device evidence. New native routes, UI interactions, worker cancellation at 1,000 instances and browser back/forward remain for consolidated S6 acceptance.

Extension 2.3 changes are additive. The single current contract accepts installed-or-older minor revisions within the same major version; future or different-major requirements are rejected. Compiled nested documents declare the highest compatible required minor version. Historical immutable documents are not rewritten.
