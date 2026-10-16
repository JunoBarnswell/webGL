import { MeshoptDecoder } from "meshoptimizer";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import * as THREE from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { AssetScheduler, ResourceRegistry } from "@o2vr/engine";
import { runAssetTask } from "@studio/asset-pipeline";
import { assetBytes } from "./AssetCache";
import type {
  SceneAsset,
  SceneDocument,
  SceneMaterial,
} from "@studio/scene-schema";
import {modelIdentities} from "@studio/scene-schema";

export interface AssetSource {
  recordsUrl?: (assetId: string, parameters: URLSearchParams) => string;
  url(assetId: string, file: string): string;
  headers?: () => HeadersInit;
}
export type GpuResource = THREE.BufferGeometry | THREE.Material | THREE.Texture;
export interface VariantMaterial {material:THREE.Material;materialIndex:number;meshIndex:number;primitiveIndex:number}
export class AssetStore {
  private scheduler = new AssetScheduler({ concurrency: 8 });
  private bytes = new Map<string, Promise<ArrayBuffer>>();
  private textures = new Map<string, Promise<THREE.Texture>>();
  private models = new Map<string, Promise<GLTF>>();
  private cubes = new Map<string, Promise<THREE.CubeTexture>>();
  private geometries = new Map<string, Promise<THREE.BufferGeometry>>();
  private owned = new Set<GpuResource>();
  private urls = new Set<string>();
  private blobUrls = new Map<string, Promise<string>>();
  private ktx: KTX2Loader | null = null;
  private closed = false;
  private cancellation = new AbortController();
  constructor(
    private document: SceneDocument,
    readonly source: AssetSource,
    private registry: ResourceRegistry,
    private renderer?: THREE.WebGLRenderer,
  ) {}
  update(document: SceneDocument): void {
    this.document = document;
  }
  asset(id: string): SceneAsset {
    const asset = this.document.assets.find((a) => a.id === id);
    if (!asset) throw new Error("资源引用不存在: " + id);
    return asset;
  }
  private own(resource: GpuResource): void {
    this.registry.retain(resource);
    if (this.closed) this.registry.release(resource);
    else this.owned.add(resource);
  }
  file(asset: SceneAsset, path = asset.entry): Promise<ArrayBuffer> {
    const key = asset.id + "/" + path;
    let promise = this.bytes.get(key);
    if (!promise) {
      promise = this.scheduler.schedule(key, async (signal: AbortSignal) => {
        return assetBytes(this.source, asset, path, signal);
      });
      this.bytes.set(key, promise);
    }
    return promise;
  }
  blobUrl(id: string): Promise<string> {
    let promise = this.blobUrls.get(id);
    if (!promise) {
      promise = (async () => {
        const asset = this.asset(id);
        const bytes = await this.file(asset);
        if (this.closed) throw new DOMException("场景已关闭", "AbortError");
        const url = URL.createObjectURL(new Blob([bytes]));
        this.urls.add(url);
        return url;
      })();
      this.blobUrls.set(id, promise);
    }
    return promise;
  }
  texture(id: string): Promise<THREE.Texture> {
    let promise = this.textures.get(id);
    if (!promise) {
      promise = (async () => {
        const url = URL.createObjectURL(
          new Blob([await this.file(this.asset(id))]),
        );
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          const texture = new THREE.Texture(image);
          texture.needsUpdate = true;
          this.own(texture);
          return texture;
        } finally {
          URL.revokeObjectURL(url);
        }
      })();
      this.textures.set(id, promise);
    }
    return promise;
  }
  geometry(id: string): Promise<THREE.BufferGeometry> {
    let promise = this.geometries.get(id);
    if (!promise) {
      promise = this.file(this.asset(id)).then(async (bytes) => {
        type Attribute = {
          array: THREE.TypedArray;
          itemSize: number;
          normalized: boolean;
        };
        const data = await runAssetTask<{
          attributes: Record<string, Attribute>;
          index: Attribute | null;
          groups: { start: number; count: number; materialIndex?: number }[];
        }>("geometry", bytes, { signal: this.cancellation.signal });
        if (this.closed) throw new DOMException("场景已关闭", "AbortError");
        const geometry = new THREE.BufferGeometry();
        for (const [name, a] of Object.entries(data.attributes))
          geometry.setAttribute(
            name,
            new THREE.BufferAttribute(a.array, a.itemSize, a.normalized),
          );
        if (data.index)
          geometry.setIndex(
            new THREE.BufferAttribute(
              data.index.array,
              data.index.itemSize,
              data.index.normalized,
            ),
          );
        for (const group of data.groups)
          geometry.addGroup(group.start, group.count, group.materialIndex);
        this.own(geometry);
        return geometry;
      });
      this.geometries.set(id, promise);
    }
    return promise;
  }
  model(id: string): Promise<GLTF> {
    let promise = this.models.get(id);
    if (!promise) {
      promise = (async () => {
        const asset = this.asset(id);
        const urls = new Map<string, string>();
        await Promise.all(
          asset.files
            .filter((path) => path !== asset.entry)
            .map(async (path) => {
              const url = URL.createObjectURL(
                new Blob([await this.file(asset, path)]),
              );
              urls.set(path, url);
            }),
        );
        const manager = new THREE.LoadingManager();
        manager.setURLModifier((url) => {
          if (url.startsWith("data:") || url.startsWith("blob:")) return url;
          const path = decodeURIComponent(
            new URL(url, "https://studio.invalid/").pathname.slice(1),
          );
          const replacement = urls.get(path);
          if (!replacement) throw new Error("模型缺少相对依赖: " + path);
          return replacement;
        });
        try {
          const loader = new GLTFLoader(manager).setMeshoptDecoder(
            MeshoptDecoder,
          );
          if (this.renderer) {
            this.ktx ??= new KTX2Loader()
              .setTranscoderPath(new URL("decoders/", document.baseURI).href)
              .detectSupport(this.renderer);
            loader.setKTX2Loader(this.ktx);
          }

          const base =
            "https://studio.invalid/" +
            asset.entry.slice(0, asset.entry.lastIndexOf("/") + 1);
          const gltf = await loader.parseAsync(await this.file(asset), base);
          const sourceIds=modelIdentities(gltf.parser.json.nodes??[],gltf.parser.json.scenes?.[gltf.parser.json.scene??0]?.nodes??[]);
          gltf.scene.traverse((node) => {
            const association = gltf.parser.associations.get(node);
            if (association?.nodes !== undefined) {
              node.userData.gltfNodeIndex = association.nodes;
              node.userData.gltfSourceElementId=sourceIds.get(association.nodes)??"";
            }
          });
          gltf.scene.traverse((node) => {
            if (node instanceof THREE.Mesh) {
              const association = gltf.parser.associations.get(node) as
                | { meshes?: number; primitives?: number }
                | undefined;
              if (association?.meshes !== undefined)
                node.userData.gltfMeshIndex = association.meshes;
              if (association?.primitives !== undefined)
                node.userData.gltfPrimitiveIndex = association.primitives;
            }
          });
          for (const resource of this.registry.collect(gltf.scene))
            this.own(resource as GpuResource);
          const definitions = gltf.parser.json.materials ?? [];
          gltf.scene.traverse((node) => {
            if (!(node instanceof THREE.Mesh)) return;
            for (const material of Array.isArray(node.material)
              ? node.material
              : [node.material]) {
              const address = gltf.parser.associations.get(material) as
                  | { materials?: number }
                  | undefined,
                definition =
                  address?.materials === undefined
                    ? undefined
                    : definitions[address.materials];
              if (!definition) continue;
              for (const [source, slot] of [
                [definition.pbrMetallicRoughness?.baseColorTexture, "map"],
                [definition.normalTexture, "normalMap"],
                [definition.emissiveTexture, "emissiveMap"],
                [definition.occlusionTexture, "aoMap"],
                [
                  definition.pbrMetallicRoughness?.metallicRoughnessTexture,
                  "roughnessMap",
                ],
              ] as const)
                if (
                  source &&
                  !(material as unknown as Record<string, unknown>)[slot]
                )
                  throw Error("模型纹理解码失败：" + asset.name + " / " + slot);
            }
          });

          return gltf;
        } finally {
          for (const url of urls.values()) URL.revokeObjectURL(url);
        }
      })();
      this.models.set(id, promise);
    }
    return promise;
  }
  async instance(
    id: string,
  ): Promise<{ root: THREE.Group; clips: THREE.AnimationClip[] }> {
    const template = await this.model(id);
    const root = clone(template.scene) as THREE.Group;
    root.traverse((node) => {
      if (node instanceof THREE.Mesh)
        node.material = Array.isArray(node.material)
          ? node.material.map((m) => m.clone())
          : node.material.clone();
    });
    const sources: THREE.Object3D[] = [];
    const targets: THREE.Object3D[] = [];
    template.scene.traverse((node) => sources.push(node));
    root.traverse((node) => targets.push(node));
    const identifiers = new Map(
      sources.map((node, index) => [node.uuid, targets[index].uuid]),
    );
    const clips = template.animations.map((source) => {
      const clip = source.clone();
      for (const track of clip.tracks) {
        const parsed = THREE.PropertyBinding.parseTrackName(track.name);
        const target =
          template.scene.getObjectByProperty("uuid", parsed.nodeName) ||
          template.scene.getObjectByName(parsed.nodeName);
        if (target && identifiers.has(target.uuid))
          track.name =
            identifiers.get(target.uuid) +
            track.name.slice(track.name.lastIndexOf("."));
      }
      return clip;
    });
    return { root, clips };
  }
  async variant(
    id: string,
    targets: Iterable<THREE.Object3D>,
    name: string,
  ): Promise<Map<THREE.Mesh, VariantMaterial>> {
    const gltf = await this.model(id);
    const definition = gltf.parser.json as {
      extensions?: {
        KHR_materials_variants?: { variants: { name: string }[] };
      };
      meshes?: {
        primitives: {
          extensions?: {
            KHR_materials_variants?: {
              mappings: { material: number; variants: number[] }[];
            };
          };
        }[];
      }[];
    };
    const variantIndex =
      definition.extensions?.KHR_materials_variants?.variants.findIndex(
        (v) => v.name === name,
      ) ?? -1;
    if (variantIndex < 0) throw Error("材质变体不存在：" + name);
    const result = new Map<THREE.Mesh, VariantMaterial>();
    await Promise.all(
      [...targets].map(async (target) => {
        if (!(target instanceof THREE.Mesh)) return;
        const mesh = target.userData.gltfMeshIndex,
          primitive = target.userData.gltfPrimitiveIndex;
        if (typeof mesh !== "number" || typeof primitive !== "number") return;
        const mapping = definition.meshes?.[mesh]?.primitives[
          primitive
        ]?.extensions?.KHR_materials_variants?.mappings.find((m) =>
          m.variants.includes(variantIndex),
        );
        if (mapping) {
          const material = (await gltf.parser.getDependency(
            "material",
            mapping.material,
          )) as THREE.Material;
          if (this.closed) {
            this.disposeUnowned(material);
            return;
          }
          for (const resource of this.registry.collectObject(
            new THREE.Mesh(target.geometry, material),
          ))
            if (!this.owned.has(resource as GpuResource))
              this.own(resource as GpuResource);
          result.set(target, {material,materialIndex:mapping.material,meshIndex:mesh,primitiveIndex:primitive});
        }
      }),
    );
    return result;
  }
  cube(ids: string[]): Promise<THREE.CubeTexture> {
    const key = ids.join("|");
    let promise = this.cubes.get(key);
    if (!promise) {
      promise = Promise.all(ids.map((id) => this.texture(id))).then((faces) => {
        const cube = new THREE.CubeTexture(
          faces.map((texture) => texture.image),
        );
        cube.colorSpace = THREE.SRGBColorSpace;
        cube.needsUpdate = true;
        this.own(cube);
        return cube;
      });
      this.cubes.set(key, promise);
    }
    return promise;
  }
  async material(def: SceneMaterial): Promise<THREE.Material> {
    const parameters = {
      color: def.color,
      opacity: def.opacity,
      transparent: def.transparent,
      side: def.side as THREE.Side,
      depthWrite: def.depthWrite,
    };
    const material =
      def.kind === "physical"
        ? new THREE.MeshPhysicalMaterial({
            ...parameters,
            metalness: def.metalness,
            roughness: def.roughness,
            clearcoat: def.clearcoat,
            clearcoatRoughness: def.clearcoatRoughness,
          })
        : def.kind === "standard"
          ? new THREE.MeshStandardMaterial({
              ...parameters,
              metalness: def.metalness,
              roughness: def.roughness,
            })
          : new THREE.MeshPhongMaterial({
              ...parameters,
              shininess: def.shininess,
              specular: def.specular,
              reflectivity: def.reflectivity,
            });
    material.emissive.set(def.emissive);
    material.lightMapIntensity = def.lightMapIntensity;
    try {
      for (const [key, binding] of Object.entries(def.maps)) {
        const texture = (await this.texture(binding.assetId)).clone();
        texture.offset.fromArray(binding.offset);
        texture.repeat.fromArray(binding.repeat);
        texture.rotation = binding.rotation;
        texture.channel = binding.channel;
        texture.flipY = binding.flipY;
        texture.colorSpace =
          binding.colorSpace === "srgb"
            ? THREE.SRGBColorSpace
            : THREE.NoColorSpace;
        texture.wrapS = texture.wrapT =
          key === "lightMap" ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
        texture.needsUpdate = true;
        Object.assign(
          material,
          key === "ormMap"
            ? { aoMap: texture, roughnessMap: texture, metalnessMap: texture }
            : { [key]: texture },
        );
      }
      if (def.envAssetIds.length === 6) {
        material.envMap = await this.cube(def.envAssetIds);
      }
      return material;
    } catch (error) {
      this.disposeUnowned(material);
      throw error;
    }
  }
  disposeUnowned(material: THREE.Material): void {
    for (const value of Object.values(material))
      if (
        value instanceof THREE.Texture &&
        !(value instanceof THREE.CubeTexture) &&
        !this.owned.has(value)
      )
        value.dispose();
    material.dispose();
  }
  close(): void {
    this.ktx?.dispose();
    this.ktx = null;
    this.closed = true;
    this.cancellation.abort();
    this.scheduler.dispose();
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
    for (const resource of this.owned) this.registry.release(resource);
    this.owned.clear();
    this.cubes.clear();
    this.blobUrls.clear();
    this.bytes.clear();
    this.textures.clear();
    this.models.clear();
    this.geometries.clear();
  }
}
