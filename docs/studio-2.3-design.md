# WebGL Studio 2.3 — architecture and delivery decisions

Baseline: `457eda90cba9b377216d17d6146835e00e8d6365` (latest remote main checked 2026-10-16). The user requested every S0–S6 stage. The attachment supplies product requirements and static-review hypotheses; claims of production faults require reproduction. Existing project data, immutable versions and source assets remain intact. Linux is the acceptance platform; Windows remains waived.

## One source and one execution path

SceneDocument v2 and typed library documents remain authoritative. EditorCommand/DocumentSession owns every committed edit; plans, compiled indices, rule graphs and previews are disposable derivatives. SceneRuntime, VisualStateSystem, CameraOwnership, the engine and Canvas remain shared by Editor and Player. Additive optional fields preserve authored documents without a second runtime format. Runtime/catalog version changes are explicit; no loader follows a mutable library head.

Reference traversal will have one schema-driven implementation with paths and identity context. Template compilation/remapping, deletion impact, library usage, release readiness and model operations consume that traversal. Local prefab snapshots are scoped metadata; global references are checked in the expanded document. Plans identify both the referring field and the referenced stable identity.

## S1 correctness contracts

A PrefabUpdatePlan compares complete old/new source trees and resources, records every selected instance/pin, conflicts and external referring fields, and simulates the final document. Removed unmodified nodes participate in impact reporting. The caller explicitly redirects references or retains deleted nodes as local additions. Execution verifies the same immutable scene snapshot and source pins before one command commits. Failed or stale plans write nothing. Nested Apply names the selected source ancestor; saving a child library revision never rewrites a parent's pinned source. Cross-scene analysis reports draft and historical uses separately.

Visual owners declare a role and channel policy. Channel composition and ordering are explicit, including intersected clipping planes, material selection before colour/opacity/highlight, and attachment ownership. Equal-priority replacement conflicts are inspectable; arrival order is not a priority mechanism. Camera leases have explicit priorities, rejection/preemption and stale-completion protection. Manual control preempts automation; cancelled automation resumes only through an explicit action.

ReleaseReadinessReport reports schema, references, revision pins, resources, visual bindings, workspace compatibility, budgets and evidence separately. Errors block release; hardware evidence is advisory unless an authored release policy requires it. Both scene and project publication use the same checks and retain the prior pointer on failure.

## S2 creative tools

Prefab tree Diff exposes structure, component, resource and reference changes. Ownership breadcrumbs choose the source to Apply to. Project graph positions/groups are authored metadata; pointer previews commit once, with keyboard navigation, edge creation, minimap and fit. Node/floor deletion presents dependent routes/hotspots. Spherical hotspot placement and precise properties share the graph's document session. Floor calibration and radar use the actual camera direction.

NavigationURL pins a published project revision, validates node/locale/hotspot membership and finite camera values, and restores share/back/forward state. Project navigation remains abortable with rollback and one Canvas.

Storyboard compilation caches immutable track ordering, interval lookup, keyframes and curves. Sampling is absolute, repeatable and independent of FPS. Curve splitting retains the original parameter window. Ripple/keyframe edits commit as transactions. Reverse playback silences original audio explicitly; pause/scrub/loop and subtitles have defined ownership.

## S3 industrial semantics

One dimensioned unit catalog is consumed by TypeScript and Native AOT mapping. It includes affine temperature conversion, pressure/area/volume/flow and strict numeric parsing. Derived values retain original value/unit/path and revision provenance. Class inheritance has deterministic field override and cycle checks. System topology retains relationship kind, direction and ports, with completeness diagnostics. Rendering clipping is labelled as such, never CAD area/volume analysis.

IFC geometry uses IfcOpenShell's multi-core iterator, shared local geometry and node placements, deterministic source origin, normals and isolated failures. Original GUIDs, nullable properties, type/instance origin, units and port relationships remain semantic records even without geometry. Reference conversion is compared on the same licensed/public and synthetic IFC inputs, with transformed world bounds and source identities.

## S4 product configuration

Catalog rules compile into one IR/dependency graph. Contradiction and unreachable-option checks carry shortest explanation paths; priorities, manual requests, numeric discretization and negative cycles have explicit outcomes. Pairwise/ternary/boundary coverage reports legal and invalid combinations. A selected configuration resolves one final material per primitive: source glTF variants are lookup definitions, not simultaneous global variant states. Async preparation must pass generation/nonce checks before visual application. BOM rows retain the pinned catalog and option provenance.

## S5 processing and budgets

Job settings carry canonical budgets into cache identity, worker execution, reports, UI and release checks. Lossless encoding cannot claim to meet an impossible triangle budget. GPU memory estimates retain their assumptions and require hardware telemetry for measured claims. Model comparison checks nodes/world transforms, geometry/topology, materials/colour spaces, variants, skin/animation and protected anchors.

MySQL leases use database time, owner, expiry, fencing epoch and heartbeat. Only the current lease can update progress or atomically commit results/dependencies. Each attempt has an isolated work directory; stale cleanup cannot remove a successor's output. Immutable content-addressed objects make retry safe. Starting another API never requeues another live owner's work.

## S6 evidence and review

Existing gates remain. New contract/integration cases target demonstrated failures, negative inputs, cross-owner state, fixed-version publication and multi-instance recovery. Browser acceptance is executed against the actual app without adding a frontend test framework. Synthetic CPU/geometry measurements, actual IFC/database/browser evidence, and physical hardware measurements are distinct.

Stage commits and reviewable PRs retain rollback boundaries; schema/data migrations are additive. Release evidence names tested source/tree, input licenses/digests, device/browser, thresholds and reproduction commands. Missing physical GPU/mobile/VR or licensed production models are Blocked, with required inputs and rerun commands. G2/G3 LOD/instancing/streaming remain explicitly researched admission paths unless independently implemented and measured.

## Official references

[PlayCanvas template Diff](https://developer.playcanvas.com/user-manual/editor/templates/diff/), [nested templates](https://developer.playcanvas.com/user-manual/editor/templates/nested/); [3DVista deep links](https://www.3dvista.com/en/blog/the-url-of-a-virtual-tour/); [Inventor presentation](https://help.autodesk.com/cloudhelp/2026/ENU/Inventor-Help/files/GUID-D4F96206-7AFD-42FB-A471-E59B17566EE2.htm); [Tandem classifications](https://help.autodesk.com/cloudhelp/ENU/Tandem-Specify/files/tandem-classifications.html); [glTF material variants](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_variants/README.md); [IfcOpenShell iterator](https://docs.ifcopenshell.org/ifcopenshell/geometry_iterator.html); [Three.js KTX2Loader](https://threejs.org/docs/pages/KTX2Loader.html). These references define behaviour and format semantics; repository tests establish this implementation's actual support.
