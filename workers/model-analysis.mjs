import { createHash } from "node:crypto";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const array = (accessor) =>
  accessor
    ? digest(
        Buffer.from(
          accessor.getArray().buffer,
          accessor.getArray().byteOffset,
          accessor.getArray().byteLength,
        ),
      )
    : null;
/** Identity, full transforms, indexed topology, physical material parameters, texture slot colour-space contracts, skins and animation curves. */
export function modelSnapshot(document) {
  const root = document.getRoot(),
    nodes = root.listNodes(),
    materials = root.listMaterials(),
    textures = root.listTextures(),
    nodeIndex = (node) => nodes.indexOf(node);
  const texture = (material, slot, colourSpace) => {
    const ref = material["get" + slot + "Texture"]();
    if (!ref) return null;
    const info = material["get" + slot + "TextureInfo"](),
      transform = info?.getExtension("KHR_texture_transform");
    return {
      texture: textures.indexOf(ref),
      colourSpace,
      texCoord: info?.getTexCoord(),
      mag: info?.getMagFilter(),
      min: info?.getMinFilter(),
      wrapS: info?.getWrapS(),
      wrapT: info?.getWrapT(),
      transform: transform
        ? {
            offset: transform.getOffset(),
            scale: transform.getScale(),
            rotation: transform.getRotation(),
          }
        : null,
    };
  };
  return {
    nodes: nodes.map((node) => ({
      name: node.getName(),
      extras: node.getExtras(),
      children: node.listChildren().map(nodeIndex),
      matrix: node.getMatrix(),
      worldMatrix: node.getWorldMatrix(),
      weights: node.getWeights(),
      skin: root.listSkins().indexOf(node.getSkin()),
    })),
    topology: root.listMeshes().map((mesh) =>
      mesh.listPrimitives().map((primitive) => ({
        mode: primitive.getMode(),
        indices: array(primitive.getIndices()),
        attributes: Object.fromEntries(
          primitive
            .listSemantics()
            .sort()
            .map((semantic) => [
              semantic,
              array(primitive.getAttribute(semantic)),
            ]),
        ),
        morphTargets: primitive.listTargets().map((target) =>
          Object.fromEntries(
            target
              .listSemantics()
              .sort()
              .map((semantic) => [
                semantic,
                array(target.getAttribute(semantic)),
              ]),
          ),
        ),
      })),
    ),
    materials: materials.map((material) => ({
      name: material.getName(),
      extras: material.getExtras(),
      baseColor: material.getBaseColorFactor(),
      metallic: material.getMetallicFactor(),
      roughness: material.getRoughnessFactor(),
      emissive: material.getEmissiveFactor(),
      alphaMode: material.getAlphaMode(),
      alphaCutoff: material.getAlphaCutoff(),
      doubleSided: material.getDoubleSided(),
      normalScale: material.getNormalScale(),
      occlusionStrength: material.getOcclusionStrength(),
      slots: [
        texture(material, "BaseColor", "srgb"),
        texture(material, "Emissive", "srgb"),
        texture(material, "Normal", "linear"),
        texture(material, "Occlusion", "linear"),
        texture(material, "MetallicRoughness", "linear"),
      ],
    })),
    primitiveMaterials: nodes.map(
      (node) =>
        node
          .getMesh()
          ?.listPrimitives()
          .map((p) => materials.indexOf(p.getMaterial())) ?? [],
    ),
    variants: nodes.map(
      (node) =>
        node
          .getMesh()
          ?.listPrimitives()
          .map(
            (p) =>
              p
                .getExtension("KHR_materials_variants")
                ?.listMappings()
                .map((m) => ({
                  names: m
                    .listVariants()
                    .map((v) => v.getName())
                    .sort(),
                  material: materials.indexOf(m.getMaterial()),
                })) ?? [],
          ) ?? [],
    ),
    skins: root.listSkins().map((skin) => ({
      joints: skin.listJoints().map(nodeIndex),
      skeleton: nodeIndex(skin.getSkeleton()),
      inverseBindMatrices: array(skin.getInverseBindMatrices()),
    })),
    animations: root.listAnimations().map((animation) => ({
      name: animation.getName(),
      channels: animation.listChannels().map((channel) => ({
        node: nodeIndex(channel.getTargetNode()),
        path: channel.getTargetPath(),
        interpolation: channel.getSampler().getInterpolation(),
        input: array(channel.getSampler().getInput()),
        output: array(channel.getSampler().getOutput()),
      })),
    })),
  };
}
export function compareModelSnapshots(
  before,
  after,
  { allowTopologyReorder = false } = {},
) {
  const checks = Object.fromEntries(
    Object.keys(before).map((key) => [
      key,
      {
        equal: JSON.stringify(before[key]) === JSON.stringify(after[key]),
        policy:
          key === "topology" && allowTopologyReorder
            ? "lossless-reorder-permitted"
            : "exact",
      },
    ]),
  );
  const errors = Object.entries(checks)
    .filter(
      ([key, check]) =>
        !check.equal && !(key === "topology" && allowTopologyReorder),
    )
    .map(([key]) => "Model contract changed: " + key);
  return {
    checks,
    errors,
    anchorPolicy: allowTopologyReorder
      ? "Surface triangle anchors must be excluded before reorder; stable entity anchors retain node/world identity"
      : "Indexed topology and all anchor source identities retained",
  };
}
export function modelMetrics(document) {
  const root = document.getRoot(),
    primitives = root
      .listNodes()
      .flatMap((node) => node.getMesh()?.listPrimitives() ?? []);
  let triangles = 0,
    vertices = 0;
  for (const p of primitives) {
    const count =
      p.getIndices()?.getCount() ?? p.getAttribute("POSITION")?.getCount() ?? 0;
    vertices += p.getAttribute("POSITION")?.getCount() ?? 0;
    triangles +=
      p.getMode() === 4
        ? count / 3
        : [5, 6].includes(p.getMode())
          ? Math.max(0, count - 2)
          : 0;
  }
  const textures = root.listTextures().map((t) => ({
    name: t.getName(),
    mime: t.getMimeType(),
    size: t.getSize(),
    bytes: t.getImage()?.byteLength ?? 0,
  }));
  const unknownTextures = textures.filter((t) => !t.size).length;
  return {
    nodes: root.listNodes().length,
    meshes: root.listMeshes().length,
    materials: root.listMaterials().length,
    triangles,
    vertices,
    estimatedDrawCalls: primitives.length,
    textures,
    textureBytes: textures.reduce((sum, t) => sum + t.bytes, 0),
    estimatedGpuTextureBytes: unknownTextures
      ? null
      : Math.ceil(
          textures.reduce(
            (sum, t) => sum + (t.size[0] * t.size[1] * 4 * 4) / 3,
            0,
          ),
        ),
    unknownTextures,
    note: "Draw calls count node-instanced primitives across all authored scenes; multipass can increase actual draws. GPU estimate is conservative RGBA8 plus full mip chain; compressed residency is not measured.",
    extensions: root.listExtensionsUsed().map((e) => e.extensionName),
  };
}
export function evaluateBudget(metrics, budget = {}) {
  const checks = Object.entries({
    maxTriangles: "triangles",
    maxGpuTextureBytes: "estimatedGpuTextureBytes",
    maxEncodedBytes: "bytes",
  })
    .filter(([key]) => budget[key] != null)
    .map(([key, metric]) => {
      const value = metrics[metric];
      return {
        key,
        limit: budget[key],
        value: value ?? null,
        met: Number.isFinite(value) && value <= budget[key],
        kind:
          metric === "estimatedGpuTextureBytes"
            ? "conservative-estimate"
            : "asset-metric",
      };
    });
  return {
    status: !checks.length
      ? "notConfigured"
      : checks.every((check) => check.met)
        ? "met"
        : "unmet",
    requested: budget,
    checks,
    measuredGpuMemory: false,
    policy:
      "Lossless-only: no automatic decimation, unit/transform compensation or identity loss. Impossible limits remain unmet.",
  };
}
