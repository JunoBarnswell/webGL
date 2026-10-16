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

## S3 industrial semantics and IFC

Added one shared dimensioned unit catalog for browser, Native AOT and IFC metadata. It covers area, volume, pressure, flow, temperature offsets and common SI/IFC names. Numeric parsing rejects blanks, hexadecimal, booleans and non-finite values. Mapping preserves observed values/units, declared units, source paths, upstream provenance and revisions; default values use the target unit. Inherited classification fields retain required constraints, reusable property templates and completeness diagnostics. Typed systems/ports carry membership and directed connectivity, with a selectable topology view. Derived mappings retain semantic metadata and use keyset traversal; index creation serializes on the immutable asset when multiple callers race.

The production IFC converter now uses the multicore local-geometry iterator, shared geometry identities, normals, per-node placements, a deterministic origin, and disk spooling. The complete product hierarchy and non-geometric records remain addressable. Type/instance property provenance, nullable values, units, systems and ports are retained. The original world-coordinate converter is read from Git into `.local` solely as a test oracle; it is not a production fallback.

Typecheck, lint and pure contracts passed. `npm run verify:ifc` compared the same three source files using the old/new complete converter processes:

| Schema | Geometry instances / unique meshes | Semantic records | Maximum world-bound difference | Old / new wall seconds | Old / new peak RSS KiB |
| --- | --- | --- | --- | --- | --- |
| IFC2x3 public building | 14 / 14 | 19 | 0.00124 mm | 0.412 / 0.403 | 141000 / 145724 |
| IFC4 public basic | 3 / 3 | 8 | 0 mm | 0.293 / 0.334 | 138988 / 142288 |
| IFC4x3 generated large coordinates | 24 / 1 | 30 | 0.01525 mm | 0.374 / 0.336 | 140160 / 143632 |

The generated IFC4x3 input also passed type-property units, nullable non-geometric metadata, system/port connection preservation, and byte-identical output with one versus four iterator threads. Input hashes, reference source hash, timings, memory and issues are in `.local/acceptance/studio-2.3/ifc/results.json`. These are small CPU fixtures, not a production-model throughput or GPU claim. Native mapping parity and final browser/large-model acceptance remain in S6.

## S4 configuration implementation

Rule compilation and deterministic solving share one IR, explicit manual deselection, integer step indexes, priority ranges and final-pass diagnostics. Coverage uses the shared cancellable analysis worker and exports the exact catalog snapshot, a seeded 1000 random sample, pairwise/ternary/boundary requests, unresolved tuple counts and truncated details. The dedicated rule editor consumes that IR. Primitive material choices and atomic part preparation resolve explicit mapping priorities before a single visual scope commit; cancellation retains the last committed BOM and appearance. Numeric bindings declare axis, quantity unit and optional reference size; fields on independent axes compose. BOM exports distinguish immutable library pins from embedded revision labels.

Initial S4 checks: pure rule regression and seeded coverage passed (1013 requests, 36/36 pairwise levels on the small fixture); Studio 2.3 pure contract suite and ESLint passed. Native admission checks and browser operation are consolidated with S5/S6; they are not marked accepted at this commit.

## S5 processing implementation

Budget fields now travel through UI, canonical settings/worker-recipe hash, real worker metrics, immutable report and release admission. A scene pins `settings.processingReports` by asset/job; the API validates the committed output ledger and input/settings hashes. This avoids another project's latest diagnostic changing a scene's budget. Source and derived budgets are evaluated separately, external glTF package bytes are included, triangle metrics include node instances, and unknown GPU estimates cannot satisfy a configured limit. Unmet limits produce `UnmetBudget` and no apply action.

MySQL migration 007 adds owner, database-time expiry, monotonic epoch and attempt count. Heartbeat is two seconds; lease is fifteen seconds. Progress and final output/dependency transactions are fenced. Attempts use isolated `job/epoch` directories. Model differences cover node/world matrices, topology, material factors/texture colour spaces, variants, skinning and animation curves; image comparison includes a heatmap. G2/G3 remain explicit admission research in `asset-pipeline-admission.md`.

Actual checks: Linux Native AOT publish passed; typecheck/lint/build and pure processing helpers passed. Real MySQL/MinIO optimization verified unmet budget rejection, met-budget admission and canonical cache identity. Two native instances passed live-owner protection, kill -9 recovery, expired-owner/SIGCONT fencing and database uniqueness (one model/semantic output pair per job). Current native program also passed 39 cross-language fixtures, all nine existing Studio 2.2 integration groups and the Studio 2.3 native readiness/reference suite. Legacy fixture literals were updated to the declared `reject` policy and real 32×16 floor image dimensions; compatibility aliases were not added. Browser/scale/delivery acceptance continues in S6.
