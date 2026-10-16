# Studio 2.3 S0 — audit baseline

2026-10-16, Asia/Shanghai. Remote main and local main were clean at `457eda90cba9b377216d17d6146835e00e8d6365`. The user requested all stages. The attachment is a static review, not evidence of production data loss. Architecture and acceptance boundaries are in [the design record](../studio-2.3-design.md).

| Evidence | Actual result |
|---|---|
| Latest remote/ancestry and clean worktree | Pass, before the 2.3 branch was created |
| `npm run verify:studio22` against the existing native API and real MySQL/MinIO | Pass, nine contract/integration groups rerun |
| `npm run typecheck`, `npm run lint` | Pass, rerun on the baseline |
| Prefab unmodified source-child deletion referenced by an external annotation | Reproduced: preview reports zero conflicts; existing document validation rejects propagation and preserves the complete transaction. Missing impact UX is confirmed; silent committed reference corruption is not demonstrated |
| Camera ownership | Reproduced: a later configurator request cancels a storyboard lease regardless of semantic priority |
| Area conversion | Reproduced: `m2 → mm2` is unsupported |
| Project diagram and Player URL, Storyboard sampling, IFC geometry, budget UI/API and job recovery | Static implementation observations confirmed in the referenced source files; production failures are not inferred without negative/integration fixtures |
| Old 2.2 Native AOT and browser acceptance | Existing submitter evidence retained. This is not represented as an independent new 2.3 build or GPU result |

Raw current-run baseline logs and minimal reproductions are under `.local/acceptance/studio-2.3/s0-*` and will be copied into the final delivery evidence. This stage does not delete assets, scene history or publications.

S1 must turn the demonstrated gaps into field-level plans and deterministic ownership. F-02/F-06/F-07/F-10/F-12 remain risks requiring the stage-specific negative fixtures and real service/browser checks. Physical GPU, mobile/VR and representative licensed production models remain unavailable; S6 must record these separately as Blocked, rather than substitute synthetic evidence.
