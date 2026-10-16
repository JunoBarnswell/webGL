# Studio 2 acceptance — 2026-10-16

Baseline: `0c3ae97da282e843efb490589215c2a8fca51d07`, fetched again before PR creation. Source was implemented as one coordinated change, then compiled and exercised. This report records measured outcomes, not assumed specification completion.

## Verified

| Check | Result |
| --- | --- |
| Frozen npm install / generated catalog | Passed; current lockfile, Node 24 |
| TypeScript / ESLint / both Vite builds | Passed; existing bundle-size warnings remain |
| Native .NET 10 AOT build / actual API startup | Passed; third-party SqlSugar/SqlClient trimming and AOT warnings remain |
| `verify:extensions` | 12 checks: migration, registry conflicts/dependencies/cycles, unknown JSON, clone/history, commands, source identities, seek/reset, CSV, anchors, dirty sets, BVH and sample action lifecycle |
| `verify:experience` | Passed; existing content/history/tour/rule cancellation and loop detection |
| `verify:contracts` | 34 TS/C# fixtures, including extension ranges, unknown contributions, line identity and target capabilities |
| `verify:integration` | 12 real MySQL/MinIO checks: authentication, bytes/hash, CAS, validation rollback, immutable versions, publication, dependency protection, export/import (including SamplePulse), unpublish and reference release |
| `verify:browser` | Actual keyboard/IME/flying priority, command search, preview, generic industry actions and public Player; no page errors |
| Layout retention | 100 focus-layout toggles, one retained Canvas |
| 1920px viewport width | Standard 66.77%; compact 97.5%; focus 100% |
| Responsive header | No horizontal overflow at 1366, 1024, 767 and 390px |
| O2VR showroom | 80 source nodes, 70 meshes, 57 bindings; 144 assets, **0 missing**; original 4 documented source-setting conflicts remain explicit |
| Public sample delivery | Showroom, 50-part synthetic vehicle and 100-line/1000-segment/500-label pipe scene opened and operated in independent Player |
| Resource lifecycle | 10 preview cycles and 10 actual editor close/reopen cycles: 345 registered resources before/after, 0 after close, no pending tasks, one retained context |

JSON evidence and synthetic screenshots are in [studio-2/](studio-2/). Actual showroom screenshots remain local under `.local/acceptance/studio-2/` rather than committing artwork/project data.

## Reproduce

Use the standard Linux setup, then run `npm run verify:extensions`, `verify:experience`, `verify:contracts`, `verify:integration` and `verify:browser`. Chromium defaults to `/usr/bin/chromium`; set `STUDIO_CHROMIUM` for another installed executable. `npm run examples:industry` generates and publishes the two synthetic projects. `NODE_USE_ENV_PROXY=1 npm run import:showroom` reconstructs the supplied showroom; `npm run verify:delivery` requires those local fixture records.

`npm run benchmark:studio` creates and removes its own synthetic fixtures. `STUDIO_BASELINE` optionally points to a separately served immutable source archive. The baseline archive uses the original schema at its import boundary; no second runtime or compatibility package is shipped.

## Performance interpretation

The checked-in benchmark records Chromium version, OS/CPU, DPR, dimensions, software GPU identity, requests, load time, draw/triangle/resource counts and per-system CPU totals. Fixtures share real 12-triangle cube geometry; they are not representative engineering car or plant models. HTTP/server/module caches are warm, while each page/context starts fresh. No network simulation is applied.

RAF spacing measures scheduling cadence, **not CPU or GPU frame execution**. Static scenes use on-demand draws. Thus a 16.7ms RAF interval is not a claim of continuous rendered 60 FPS. The legacy comparison is an empty-core workflow; industry scenarios have no legacy counterpart. GPU timer queries, real hardware, React commit profiling and real CAD model performance have not been validated.

## Scope that remains beyond this implementation

The unified foundation and first-release industry flows above are implemented. The attachment's complete advanced scope is **not** claimed as finished: multi-curve/rotational assembly trajectories and a full BOM/step timeline editor; interactive surface-anchor reconciliation for changed/added model elements; draggable 3D leader endpoints and GPU-batched annotation LOD; exhaustive fullscreen/assistive-technology/international-keyboard UAT; and real industrial model stress/UAT remain outstanding. Model revision updates deliberately stop on unmatched/added elements and preserve the original model. Surface anchors with a revision mismatch remain unresolved rather than being silently moved.

The examples demonstrate publishable linear explode, deterministic seek/restore, logical pipeline relationships, CSV transactions, shared labels and registered Player actions. They do not claim CAD constraint solving, native Plant 3D or IFC round-trip editing.
