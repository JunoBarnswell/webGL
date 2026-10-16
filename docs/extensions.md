# Trusted extension development

Studio has one authoring document, one runtime and one action dispatcher. `SceneDocument.documentVersion` is 2. A known version-1 document is copied and upgraded at open/import boundaries; Runtime never migrates frames. New writes use version 2. `requiredExtensions` records exact semantic versions. The current protocol accepts exact extension dependency versions and a minimum runtime version; it does not interpret arbitrary semver ranges.

An extension is a workspace under `packages/extensions/<name>` with these files:

- `extension.json`: namespaced manifest, component field schemas and action field/target schemas. Only checked-in trusted source is composed.
- `runtime.ts`: a default system constructor implementing `RuntimeSystem`. It receives attach/change/mode/detach events, optional render/update hooks and registered action handlers. Update uses the existing engine scheduler. No additional RAF or polling of React state.
- `editor.ts`: `tools` contributions. Tools create EditorCommand transactions; they cannot directly change runtime meshes to persist edits.
- `package.json`: the private workspace exports.

Run `npm run schema:generate`. The composer checks identities, dependencies, cycles, permissions and runtime versions, and generates the canonical schema, TS known-type unions, catalog hash, runtime imports and editor tool imports. Do not edit generated files. Adding a trusted package requires no new SceneRuntime dispatcher or Inspector branch. The same runtime catalog is imported by Editor and Player; Player does not import editor tools or React editor panels.

Inspector fields, defaults, asset/entity/content references, clone remapping and publication checks come from the same schema. Supported semantic metadata includes `x-target-component`, `x-unique`, `x-less-than`, `x-required-publish` and `x-required-when`; both TS and embedded AOT validation implement these rules. Add cross-language fixtures to `verify-contracts.mts` whenever this finite keyword set changes.

Unknown namespaced component/action data remains intact while opening and editing. Missing or incompatible required extensions block publication. Runtime construction can disable selected extensions for diagnosis; attempting preview with an unavailable required system gives an explicit error. Unknown unnamespaced types are malformed, rather than extension identities.

Runtime instances own disposable effects. Restore temporary transforms/materials before document synchronization; release effects on mode change and detach. `EntityIndex` tracks component membership and material users. Per-entity change synchronization is serialized and generation-guarded, so old asynchronous work cannot overwrite a later scene. SpatialSystem maintains collision membership and a lazily rebuilt broad-phase BVH; Three remains the geometry narrow phase. Annotation projection and clustering are shared by showroom hotspots and extension labels.

Assembly progress is always evaluated from captured baseline positions, never accumulated from the previous progress. Piping owns its logical line-to-physical segment index, material clones and visibility overrides. Generic Player controls are generated from registered action schemas. A system must not write SceneDocument during playback.

Published manifests retain `runtimeBuild` and `extensionCatalogHash`. The hash identifies the publication catalog, rather than rejecting a compatible Player merely because another extension changed. Runtime major versions and the document's required extension versions/shape determine compatibility. Existing published object bytes are not rewritten.

Model `sourceElementId` uses glTF extras identifiers (`sourceElementId`, `ElementId`, `GlobalId`, `guid`) first, otherwise an unambiguous named hierarchy. Nameless or ambiguous paths remain importable but are marked `unresolved:` and cannot be silently matched during revision replacement. A revision report lists matched, unmatched and added elements. Unmatched/added elements require an explicit reconciliation; the original asset and references stay intact. Surface anchors also require the recorded mesh revision, and become unresolved on a mismatch.
