import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { NodeIO } from "@gltf-transform/core";
import {
  ALL_EXTENSIONS,
  KHRTextureBasisu,
  EXTMeshoptCompression,
} from "@gltf-transform/extensions";
import { reorder } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import {
  modelIdentities,
  reconcileSourceIdentities,
  assertIdentityPreserved,
} from "../packages/scene-schema/src/model-identity.ts";
const task = JSON.parse(await readFile(process.argv[2], "utf8")),
  root = path.dirname(process.argv[2]),
  input = path.join(root, "input", task.entry),
  output = path.join(root, "output");
await mkdir(output, { recursive: true });
const stage = (stage, progress) =>
  process.stdout.write(JSON.stringify({ stage, progress }) + "\n");
const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let error = "",
      output = "";
    child.stdout.on("data", (bytes) => {
      output = (output + bytes.toString()).slice(-8000);
      process.stdout.write(bytes);
    });
    child.stderr.on("data", (bytes) => {
      error = (error + bytes.toString()).slice(-8000);
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve(output + error)
        : reject(Error(command + " failed (" + code + "): " + error)),
    );
  });
const json = async (file) => {
  const bytes = await readFile(file);
  if (file.toLowerCase().endsWith(".glb"))
    return JSON.parse(
      bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
    );
  return JSON.parse(bytes.toString());
};
const identities = (data) => [
  ...modelIdentities(
    data.nodes ?? [],
    data.scenes?.[data.scene ?? 0]?.nodes ?? [],
  ).values(),
];
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "meshopt.encoder": MeshoptEncoder,
    "meshopt.decoder": MeshoptDecoder,
  });
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
let report = {
    sourceAssetId: task.sourceAssetId,
    sourceSha256: task.sourceSha256,
    settingsHash: task.settingsHash,
    workerVersion: "2.2.0",
    dependencies: { gltfTransform: "4.2.1", meshoptimizer: "0.23.0" },
    warnings: [],
    identityReport: null,
  },
  outputs = [];
if (task.operation === "ifc") {
  stage("IFC structure and geometry", 0.05);
  await run(process.env.STUDIO_IFC_PYTHON ?? "python3", [
    new URL("./ifc-convert.py", import.meta.url).pathname,
    input,
    output,
  ]);
  Object.assign(report, {
    ifc: JSON.parse(
      await readFile(path.join(output, "ifc-report.json"), "utf8"),
    ),
  });
  outputs = [
    { kind: "model", entry: "derived.glb", files: ["derived.glb"] },
    { kind: "semantic", entry: "semantics.json", files: ["semantics.json"] },
  ];
} else {
  const definition = await json(input),
    sourceIds = identities(definition),
    document = await io.read(input);
  const geometryHash = (doc) => {
    const hash = createHash("sha256");
    for (const mesh of doc.getRoot().listMeshes())
      for (const primitive of mesh.listPrimitives()) {
        for (const semantic of [...primitive.listSemantics()].sort()) {
          const a = primitive.getAttribute(semantic);
          hash.update(semantic);
          hash.update(
            Buffer.from(
              a.getArray().buffer,
              a.getArray().byteOffset,
              a.getArray().byteLength,
            ),
          );
        }
        const index = primitive.getIndices();
        if (index)
          hash.update(
            Buffer.from(
              index.getArray().buffer,
              index.getArray().byteOffset,
              index.getArray().byteLength,
            ),
          );
      }
    return hash.digest("hex");
  };
  // Variant bindings belong to a node/primitive, even when geometry is identical.
  // Compare references inside the unchanged material table after serialization.
  const variantBindings = (doc) => {
    const materials = doc.getRoot().listMaterials();
    return JSON.stringify(
      doc
        .getRoot()
        .listNodes()
        .map(
          (node) =>
            node
              .getMesh()
              ?.listPrimitives()
              .map(
                (primitive) =>
                  primitive
                    .getExtension("KHR_materials_variants")
                    ?.listMappings()
                    .map((mapping) => ({
                      variants: mapping
                        .listVariants()
                        .map((variant) => variant.getName())
                        .sort(),
                      material: materials.indexOf(mapping.getMaterial()),
                    })) ?? [],
              ) ?? [],
        ),
    );
  };
  const sourceVariantBindings = variantBindings(document);
  const sourceGeometryHash = geometryHash(document);
  const sourceMatrices = document
    .getRoot()
    .listNodes()
    .map((node) => node.getMatrix());
  const diagnostics = (doc) => {
    const r = doc.getRoot(),
      primitives = r.listMeshes().flatMap((m) => m.listPrimitives());
    let triangles = 0,
      vertices = 0;
    for (const p of primitives) {
      vertices += p.getAttribute("POSITION")?.getCount() ?? 0;
      triangles +=
        (p.getIndices()?.getCount() ??
          p.getAttribute("POSITION")?.getCount() ??
          0) / 3;
    }
    const textures = r.listTextures().map((t) => ({
      name: t.getName(),
      mime: t.getMimeType(),
      size: t.getSize(),
      bytes: t.getImage()?.byteLength ?? 0,
    }));
    return {
      nodes: r.listNodes().length,
      meshes: r.listMeshes().length,
      materials: r.listMaterials().length,
      triangles,
      vertices,
      estimatedDrawCalls: primitives.length,
      textures,
      textureBytes: textures.reduce((s, t) => s + t.bytes, 0),
      estimatedGpuTextureBytes: textures.reduce(
        (s, t) => s + (t.size ? (t.size[0] * t.size[1] * 4 * 4) / 3 : 0),
        0,
      ),
      note: "Draw calls and GPU bytes are estimates; actual telemetry is measured in the browser",
      extensions: r.listExtensionsUsed().map((e) => e.extensionName),
    };
  };
  report.before = {
    ...diagnostics(document),
    bytes: (await stat(input)).size,
    sourceIdentityCount: sourceIds.length,
    unresolvedSourceIds: sourceIds.filter((id) => id.startsWith("unresolved:")),
  };
  if (task.operation === "optimize") {
    stage("Meshopt geometry", 0.2);
    if (task.settings.useMeshopt !== false) {
      await document.transform(
        reorder({ encoder: MeshoptEncoder, target: "size" }),
      );
      document
        .createExtension(EXTMeshoptCompression)
        .setRequired(true)
        .setEncoderOptions({
          method: EXTMeshoptCompression.EncoderMethod.QUANTIZE,
        });
      report.geometryPolicy =
        "Lossless Meshopt encoding; no mesh/material merging, position quantization, simplification, or node-transform compensation";
    }
    if (task.settings.textureCodec === "ktx2") {
      stage("KTX2 texture compression", 0.45);
      const version = await run(process.env.STUDIO_TOKTX ?? "toktx", [
        "--version",
      ]);
      if (!version.includes("v4.4.2"))
        throw Error("KTX-Software 4.4.2 is required: " + version);
      report.dependencies.ktxSoftware = "4.4.2";
      let index = 0;
      for (const texture of document.getRoot().listTextures()) {
        if (!["image/png", "image/jpeg"].includes(texture.getMimeType())) {
          report.warnings.push(
            "Texture codec retained: " + texture.getMimeType(),
          );
          continue;
        }
        const extension = texture.getMimeType() === "image/png" ? "png" : "jpg",
          source = path.join(output, "texture-" + index + "." + extension),
          destination = path.join(output, "texture-" + index + ".ktx2");
        await writeFile(source, texture.getImage());
        const linear = document
          .getRoot()
          .listMaterials()
          .some(
            (m) =>
              m.getNormalTexture() === texture ||
              m.getOcclusionTexture() === texture ||
              m.getMetallicRoughnessTexture() === texture,
          );
        const srgb = document
          .getRoot()
          .listMaterials()
          .some(
            (m) =>
              m.getBaseColorTexture() === texture ||
              m.getEmissiveTexture() === texture,
          );
        if (linear && srgb)
          throw Error(
            "A texture is shared by linear and sRGB slots; split it before KTX2 conversion",
          );
        await run(process.env.STUDIO_TOKTX ?? "toktx", [
          "--t2",
          "--encode",
          "etc1s",
          "--genmipmap",
          "--assign_oetf",
          linear ? "linear" : "srgb",
          "--assign_primaries",
          "bt709",
          destination,
          source,
        ]);
        const ktx = await readFile(destination);
        if (ktx.readUInt32LE(12) !== 0)
          throw Error(
            "Expected transcodable ETC1S KTX2; output has a concrete vkFormat",
          );
        texture
          .setImage(new Uint8Array(ktx))
          .setMimeType("image/ktx2")
          .setURI("texture-" + index + ".ktx2");
        index++;
      }
      document.createExtension(KHRTextureBasisu).setRequired(true);
    }
    stage("Identity and quality gate", 0.75);
    const destination = path.join(output, "derived.glb");
    await io.write(destination, document);
    const after = await json(destination),
      nextIds = identities(after),
      protectedIds = task.settings.protectedSourceIds?.length
        ? task.settings.protectedSourceIds
        : sourceIds.filter((id) => !id.startsWith("unresolved:"));
    const identity = reconcileSourceIdentities(protectedIds, nextIds);
    assertIdentityPreserved(identity);
    report.identityReport = identity;
    const lost = (definition.extensionsUsed ?? []).filter(
      (e) =>
        !(after.extensionsUsed ?? []).includes(e) &&
        ![
          "KHR_mesh_quantization",
          "EXT_meshopt_compression",
          "KHR_meshopt_compression",
        ].includes(e),
    );
    if (lost.length)
      throw Error("Optimizer dropped source extensions: " + lost.join(", "));
    if (
      (definition.animations?.length ?? 0) !== (after.animations?.length ?? 0)
    )
      throw Error("Optimizer changed animation coverage");
    const roundtrip = await io.read(destination);
    const matrices = roundtrip
      .getRoot()
      .listNodes()
      .map((node) => node.getMatrix());
    report.nodeTransformsPreserved =
      matrices.length === sourceMatrices.length &&
      sourceMatrices.every((matrix, i) =>
        matrix.every(
          (value, j) =>
            Math.abs(value - matrices[i][j]) <
            1e-7 * Math.max(1, Math.abs(value)),
        ),
      );
    if (!report.nodeTransformsPreserved)
      throw Error("Optimizer changed source node transforms");
    report.materialVariantsPreserved =
      sourceVariantBindings === variantBindings(roundtrip);
    if (!report.materialVariantsPreserved)
      throw Error("Optimizer changed source material variant bindings");
    report.geometryUnchanged = sourceGeometryHash === geometryHash(roundtrip);
    report.after = {
      ...diagnostics(document),
      bytes: (await stat(destination)).size,
    };
    outputs = [{ kind: "model", entry: "derived.glb", files: ["derived.glb"] }];
  }
  const sourceRecords = (definition.nodes ?? []).flatMap((node, index) => {
    const extras = node.extras ?? {},
      guid =
        extras.sourceElementId ??
        extras.ElementId ??
        extras.GlobalId ??
        extras.guid;
    return guid
      ? [
          {
            id: String(guid),
            sourceElementId: "external:" + String(guid),
            name: node.name ?? String(guid),
            classId: String(extras.IfcClass ?? ""),
            properties: { ...extras },
            links: [],
            modelRevision: task.sourceSha256,
            nodeIndex: index,
          },
        ]
      : [];
  });
  if (sourceRecords.length) {
    await writeFile(
      path.join(output, "semantics.json"),
      JSON.stringify({ records: sourceRecords }),
    );
    outputs.push({
      kind: "semantic",
      entry: "semantics.json",
      files: ["semantics.json"],
    });
  }
}
stage("Ready for upload", 0.95);
await writeFile(
  path.join(output, "report.json"),
  JSON.stringify(report, null, 2),
);
await writeFile(
  path.join(root, "result.json"),
  JSON.stringify({ report, outputs }),
);
stage("Completed conversion", 1);
