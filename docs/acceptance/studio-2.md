# Studio 2 acceptance — 2026-10-16

Baseline: `0c3ae97da282e843efb490589215c2a8fca51d07`, fetched again before PR creation. The user authorized a coordinated destructive refactor and requested consolidated verification after implementation. Existing public document bytes are retained; version-1 migration occurs only at authoring boundaries.

## Delivered architecture and product flows

One SceneDocument, EditorSession transaction path, Runtime and generated trusted extension catalog serve Editor, preview, publication and independent Player. The old monolithic graph/material/media responsibilities and built-in action switch have been replaced by owned systems/services and registered executors. Hotspot and industry annotations have one renderer. No separate industry runtime or compatibility forwarding layer is shipped.

- Shell: persistent standard/compact/focus layouts, resizable docks, command search, centralized shortcuts, remapping/conflicts, context operations, native fullscreen with focus fallback, input/IME/navigation priorities and layered cancellation.
- Extension platform: four independent trusted packages (SamplePulse, Annotation, Assembly, Piping); static schema, action, system, tool and typed panel composition; generated TS and embedded Native AOT contracts; missing-extension JSON preservation and publication rejection; immutable version/catalog provenance.
- Annotation: world/local/surface/path-station anchors, stable source/revision/primitive/triangle/barycentric provenance, repair and viewport reselection, real leaders and drag/undo/cancel, style/bulk/alignment tools, reverse-indexed property binding, deterministic clustering and selection, occlusion, Canvas batching above 500 labels and searchable accessible controls.
- Assembly: BOM/groups, shared steps and timeline ordering, straight/multi-point curved paths, local rotation/scale/easing/visibility/trails, deterministic seek/play/pause/restore, part/group highlight/isolate/focus and schema-generated Player step selection. Overlaps compose in chronological order; sequential intervals express ordering/dependencies. This is an explicit animation recipe, without a CAD constraint solver.
- Model revision: stable IDs, explicit mapping/animation reconciliation, added hierarchy, preserved edited world poses with shear rejection, retained unmatched business placeholders that block publication, and one undoable update. Surface anchors require reselection after provenance changes.
- Piping: distinct system, logical line and physical segment identities; fittings/valves use the segment kind; batch assignment, query/focus/highlight/isolate, property-bound shared annotations and configurable CSV columns/types/units with preview errors and atomic apply. GLTF import/mount/revision use the trusted Importer interface; no IFC parser is claimed.

Architecture/ownership and finite semantic metadata are documented in [design](../studio-2-design.md) and [extension development](../extensions.md). Synthetic portable examples are in [examples](../../examples/README.md).

## Executed verification

| Check | Result |
| --- | --- |
| Frozen npm install and deterministic catalog generation | Passed; Node 24, catalog `e97c74bf1ef31dd04f81007a98d39dff90aab643217c8ae668d0b2d52b200765` |
| TypeScript / ESLint / Editor and Player production builds | Passed; bundle-size advisories remain |
| .NET 10 Native AOT build and actual API startup | Passed; third-party SqlSugar/SqlClient trimming/AOT warnings remain |
| `verify:extensions` | 19 checks, including migration, registry gates, unknown JSON/history, commands, stable identity, exact restore, curves/rotation/scale/visibility, generic point paths, revision reconciliation, surface anchors, typed CSV, deterministic clustering, BVH, shared material release and SamplePulse lifecycle |
| `verify:experience` | Passed; content/history/tour/rule cancellation and loop detection |
| `verify:contracts` | 39 TS/C# fixtures, including nested stage rules, step options, barycentric sums and unresolved publication states |
| `verify:integration` | 12 actual MySQL/MinIO checks: auth, bytes/hash, CAS, rollback, immutable versions, publication, references, export/import, unpublish and release |
| `verify:browser` | Keyboard/IME/navigation priorities, input Esc and Ctrl+S, label drag/undo/cancel, native fullscreen, step selection, preview and independent Player; no browser/console errors |
| `verify:model-revision` | Actual GLTF revision mapping dialog, accepted new hierarchy, preserved IDs, unmatched placeholder and viewport surface repair; no browser/console errors |
| Layout retention | 100 focus-layout toggles; same primary 3D Canvas |
| 1920px Canvas width | Standard 66.77%; compact 97.5%; focus 100% |
| Responsive shell | No header overflow at 1366, 1024, 767 and 390px |
| O2VR showroom delivery | 80 source nodes, 70 meshes, 57 artwork bindings; 144 assets, 0 missing; four documented source-setting conflicts remain explicit |
| Public industry delivery | Published 50-part, two-step curved/rotational vehicle and 100-line/1000-segment/500-label pipe samples opened and operated in independent Player |
| Resource lifecycle | 10 preview and 10 actual close/reopen cycles: 345 registered resources before/after, 0 after close, no pending tasks, one retained WebGL context |

Machine-readable evidence and safe synthetic screenshots are in [studio-2/](studio-2/). Actual gallery screenshots remain under ignored `.local/acceptance/studio-2/` to avoid committing artwork/project content. The additional 2D annotation canvas does not represent another WebGL context.

| Before | Standard | Compact | Focus | Preview |
| --- | --- | --- | --- | --- |
| [baseline](studio-2/baseline.png) | [standard](studio-2/standard.png) | [compact](studio-2/compact.png) | [focus](studio-2/focus.png) | [preview](studio-2/preview.png) |

## Performance method and limits

[benchmark.json](studio-2/benchmark.json) records exact Chromium/OS/CPU, 1920×1080 DPR 1, SwiftShader software GPU, request/load/heap data, draw/triangle/resource counts, bounded CPU update/render distributions, system CPU totals, React commit samples and RAF cadence. Runs use fresh page/context, warm HTTP/server/module caches, no network simulation, and shared 12-triangle synthetic cube geometry. Browser tests run separately from the final benchmark. The legacy comparison is the same empty-core workflow; the legacy product has no industry counterpart.

CPU render duration includes submission and shared annotation rendering; update duration covers the existing scheduler's simulation callbacks. Sampling includes initial render costs and on-demand heartbeat draws, so sample counts must be read with the distributions. GPU timer queries are unavailable on this software GPU and are recorded as null. RAF spacing measures scheduling, never rendered FPS. React profiling is opt-in on the development editor with `?profile=1`; production does not ship an active profiler.

| Fixture | Page to ready (ms) | RAF P95 (ms) | CPU render P95 (ms) | Draw calls | Label DOM | React commits through sampling |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| current · empty core | 941.3 | 16.7 | 16.8 | 0 | 0 | 16 |
| baseline · empty core | 924.8 | 16.8 | unavailable | unavailable | 0 | unavailable |
| current · 500 labels / 500 parts / 1000 segments | 3459.0 | 16.8 | 43.6 | 1000 | 500 | 43 |
| current · 50 labels / 50 parts | 1668.1 | 16.8 | 13.6 | 50 | 50 | 20 |
| current · 2000 labels / 2000 parts | 6625.6 | 16.8 | 73.6 | 2000 | 0 | 79 |

The 60 FPS / ≤16.7ms desktop reference target is not established for the industry fixtures in this cloud software renderer. This evidence does not substitute for hardware GPU and real engineering-model stress tests. Loading progress publishes at most once per 80ms within a phase, with immediate phase/completion notifications; no additional RAF was introduced.

## Reproduction and remaining external UAT

Use the configured Linux services and native API, then run `npm run verify:extensions`, `verify:experience`, `verify:contracts`, `verify:integration` and `verify:browser`. Start the Vite editor for `verify:model-revision`; Chromium defaults to `/usr/bin/chromium`, overridable through `STUDIO_CHROMIUM`. The CI workflow exercises both production Player and the model repair workflow.

`npm run examples:industry` creates and publishes synthetic examples; `NODE_USE_ENV_PROXY=1 npm run import:showroom` reconstructs the supplied gallery; `npm run verify:delivery` uses those ignored fixture records. `npm run benchmark:studio` creates/removes its own synthetic fixtures. `STUDIO_BASELINE` may point to an immutable baseline source archive served independently; no baseline implementation is included in the delivered application.

Remaining external validation: real hardware GPU/real car and plant geometry, screen-reader and international-keyboard coverage, multi-monitor/browser fullscreen policy differences, and long-duration production operation. Native Plant 3D/IFC round-trip editing and CAD constraints are outside the stated first-release product boundary. No unexecuted scenario is counted as passed.
