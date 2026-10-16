# Studio 2.2 processing dependencies

Model processing runs in a bounded child process of the single API worker queue. It does not run inside Native AOT or the real-time renderer. The original input bytes and SHA remain in MinIO. Failed/cancelled processing never replaces a scene's current asset.

- Node.js >=22.18 with native TypeScript stripping (tested environment version must be recorded at acceptance).
- `@gltf-transform/core`, `extensions`, `functions` 4.2.1: MIT. Locked by package-lock.json; https://github.com/donmccurdy/glTF-Transform.
- `meshoptimizer` 0.23.0: MIT. https://github.com/zeux/meshoptimizer. Shared identity reconciliation is imported from the canonical scene-schema source by the worker.
- Three.js 0.160.1: MIT. The bundled Basis transcoder JavaScript/WASM is copied from the installed Three.js package during Vite build. https://github.com/mrdoob/three.js.
- KTX-Software 4.4.2 (`toktx`): Apache-2.0 and bundled third-party notices. Official release archive https://github.com/KhronosGroup/KTX-Software/releases/tag/v4.4.2. Install separately; retain the release license/notice files. KTX2 conversion is unavailable until `STUDIO_TOKTX` resolves to this tool; a missing converter fails the job explicitly.
- IfcOpenShell 0.8.3.post2: LGPL-3.0-or-later. https://github.com/IfcOpenShell/IfcOpenShell. Install in a separate Python environment, retain its license and replacement capability; the application invokes it through `workers/ifc-convert.py`. No IFC parser is linked into the API or renderer. Only read-only tessellated IFC import is provided. `STUDIO_IFC_PYTHON` and optional `STUDIO_IFC_MODULES` select the installed environment.

Set `STUDIO_WORKER_ROOT` to the packaged `workers` directory, `STUDIO_NODE` to Node, and install the worker's locked dependencies before enabling processing. `STUDIO_JOB_ROOT` selects a writable, isolated staging directory. Jobs are serialized, limited to 1 GiB of source files and 15 minutes, have bounded Node heap/logs, persist their status in MySQL, and recover queued/running work after restart. Keep configuration, tools and data out of Git. External converters are operator-installed dependencies, not silently downloaded by a model or an uploaded project.
