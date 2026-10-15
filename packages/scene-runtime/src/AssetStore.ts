import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AssetScheduler, ResourceRegistry } from '@o2vr/engine';
import type { SceneAsset, SceneDocument, SceneMaterial } from '@studio/scene-schema';

export interface AssetSource { url(assetId: string, file: string): string; headers?: () => HeadersInit }
export type GpuResource = THREE.BufferGeometry | THREE.Material | THREE.Texture;
export class AssetStore {
  private scheduler = new AssetScheduler({ concurrency: 8 });
  private bytes = new Map<string, Promise<ArrayBuffer>>();
  private textures = new Map<string, Promise<THREE.Texture>>();
  private models = new Map<string, Promise<GLTF>>();
  private cubes = new Map<string,Promise<THREE.CubeTexture>>();
  private geometries = new Map<string, Promise<THREE.BufferGeometry>>();
  private owned = new Set<GpuResource>();
  private urls = new Set<string>();
  private blobUrls = new Map<string,Promise<string>>();
  private closed = false;
  constructor(private document: SceneDocument, readonly source: AssetSource, private registry: ResourceRegistry) {}
  update(document: SceneDocument): void { this.document = document; }
  asset(id: string): SceneAsset {
    const asset = this.document.assets.find(a => a.id === id);
    if (!asset) throw new Error('资源引用不存在: ' + id);
    return asset;
  }
  private own(resource: GpuResource): void {
    this.registry.retain(resource);
    if (this.closed) this.registry.release(resource);
    else this.owned.add(resource);
  }
  file(asset: SceneAsset, path = asset.entry): Promise<ArrayBuffer> {
    const key = asset.id + '/' + path;
    let promise = this.bytes.get(key);
    if (!promise) {
      promise = this.scheduler.schedule(key, async (signal: AbortSignal) => {
        const response = await fetch(this.source.url(asset.id, path), { headers: this.source.headers?.(), signal });
        if (!response.ok) throw new Error(asset.name + ': HTTP ' + response.status);
        return response.arrayBuffer();
      });
      this.bytes.set(key, promise);
    }
    return promise;
  }
  blobUrl(id: string): Promise<string> {
    let promise=this.blobUrls.get(id);
    if(!promise){promise=(async()=>{
      const asset=this.asset(id);const bytes=await this.file(asset);
      if(this.closed)throw new DOMException('场景已关闭','AbortError');
      const url=URL.createObjectURL(new Blob([bytes]));this.urls.add(url);return url;
    })();this.blobUrls.set(id,promise);}
    return promise;
  }
  texture(id: string): Promise<THREE.Texture> {
    let promise = this.textures.get(id);
    if (!promise) {
      promise = (async () => {
        const url = URL.createObjectURL(new Blob([await this.file(this.asset(id))]));
        try {
          const image = new Image(); image.src = url; await image.decode();
          const texture = new THREE.Texture(image); texture.needsUpdate = true; this.own(texture); return texture;
        } finally { URL.revokeObjectURL(url); }
      })();
      this.textures.set(id, promise);
    }
    return promise;
  }
  geometry(id: string): Promise<THREE.BufferGeometry> {
    let promise = this.geometries.get(id);
    if (!promise) {
      promise = this.file(this.asset(id)).then(bytes => {
        const geometry = new THREE.BufferGeometryLoader().parse(JSON.parse(new TextDecoder().decode(bytes)));
        this.own(geometry); return geometry;
      });
      this.geometries.set(id, promise);
    }
    return promise;
  }
  model(id: string): Promise<GLTF> {
    let promise = this.models.get(id);
    if (!promise) {
      promise = (async () => {
        const asset = this.asset(id); const urls = new Map<string, string>();
        await Promise.all(asset.files.filter(path => path !== asset.entry).map(async path => {
          const url = URL.createObjectURL(new Blob([await this.file(asset, path)]));
          urls.set(path, url);
        }));
        const manager = new THREE.LoadingManager();
        manager.setURLModifier(url => {
          if (url.startsWith('data:') || url.startsWith('blob:')) return url;
          const path = decodeURIComponent(new URL(url, 'https://studio.invalid/').pathname.slice(1));
          const replacement = urls.get(path);
          if (!replacement) throw new Error('模型缺少相对依赖: ' + path);
          return replacement;
        });
        try {
          const loader = new GLTFLoader(manager);
          const base = 'https://studio.invalid/' + asset.entry.slice(0, asset.entry.lastIndexOf('/') + 1);
          const gltf = await loader.parseAsync(await this.file(asset), base);
          gltf.scene.traverse(node => {
            const association = gltf.parser.associations.get(node);
            if (association?.nodes !== undefined) node.userData.gltfNodeIndex = association.nodes;
          });
          for (const resource of this.registry.collect(gltf.scene)) this.own(resource as GpuResource);
          return gltf;
        } finally { for (const url of urls.values()) URL.revokeObjectURL(url); }
      })();
      this.models.set(id, promise);
    }
    return promise;
  }
  async instance(id: string): Promise<{ root: THREE.Group; clips: THREE.AnimationClip[] }> {
    const template = await this.model(id);
    const root = clone(template.scene) as THREE.Group;
    root.traverse(node => {
      if (node instanceof THREE.Mesh) node.material = Array.isArray(node.material) ? node.material.map(m => m.clone()) : node.material.clone();
    });
    const sources:THREE.Object3D[]=[];const targets:THREE.Object3D[]=[];
    template.scene.traverse(node=>sources.push(node));root.traverse(node=>targets.push(node));
    const identifiers=new Map(sources.map((node,index)=>[node.uuid,targets[index].uuid]));
    const clips=template.animations.map(source=>{
      const clip=source.clone();
      for(const track of clip.tracks){
        const parsed=THREE.PropertyBinding.parseTrackName(track.name);
        const target=template.scene.getObjectByProperty('uuid',parsed.nodeName)||template.scene.getObjectByName(parsed.nodeName);
        if(target&&identifiers.has(target.uuid))track.name=identifiers.get(target.uuid)+track.name.slice(track.name.lastIndexOf('.'));
      }
      return clip;
    });
    return {root,clips};
  }
  cube(ids: string[]): Promise<THREE.CubeTexture> {
    const key=ids.join('|');let promise=this.cubes.get(key);
    if(!promise){promise=Promise.all(ids.map(id=>this.texture(id))).then(faces=>{
      const cube=new THREE.CubeTexture(faces.map(texture=>texture.image));cube.colorSpace=THREE.SRGBColorSpace;cube.needsUpdate=true;this.own(cube);return cube;
    });this.cubes.set(key,promise);}
    return promise;
  }
  async material(def: SceneMaterial): Promise<THREE.Material> {
    const parameters = { color: def.color, opacity: def.opacity, transparent: def.transparent, side: def.side as THREE.Side, depthWrite: def.depthWrite };
    const material = def.kind === 'physical'
      ? new THREE.MeshPhysicalMaterial({ ...parameters, metalness: def.metalness, roughness: def.roughness, clearcoat: def.clearcoat, clearcoatRoughness: def.clearcoatRoughness })
      : def.kind === 'standard' ? new THREE.MeshStandardMaterial({ ...parameters, metalness: def.metalness, roughness: def.roughness })
      : new THREE.MeshPhongMaterial({ ...parameters, shininess: def.shininess, specular: def.specular, reflectivity: def.reflectivity });
    material.emissive.set(def.emissive);
    material.lightMapIntensity = def.lightMapIntensity;
    try {
      for (const [key, binding] of Object.entries(def.maps)) {
        const texture = (await this.texture(binding.assetId)).clone();
        texture.offset.fromArray(binding.offset); texture.repeat.fromArray(binding.repeat); texture.rotation = binding.rotation;
        texture.channel = binding.channel; texture.flipY = binding.flipY;
        texture.colorSpace = binding.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.wrapS = texture.wrapT = key === 'lightMap' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
        texture.needsUpdate = true;
        Object.assign(material, key === 'ormMap' ? { aoMap: texture, roughnessMap: texture, metalnessMap: texture } : { [key]: texture });
      }
      if (def.envAssetIds.length === 6) {
        material.envMap = await this.cube(def.envAssetIds);
      }
      return material;
    } catch (error) { this.disposeUnowned(material); throw error; }
  }
  disposeUnowned(material: THREE.Material): void {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture && !(value instanceof THREE.CubeTexture) && !this.owned.has(value)) value.dispose();
    material.dispose();
  }
  close(): void {
    this.closed = true; this.scheduler.dispose();
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
    for (const resource of this.owned) this.registry.release(resource);
    this.owned.clear(); this.cubes.clear(); this.blobUrls.clear(); this.bytes.clear(); this.textures.clear(); this.models.clear(); this.geometries.clear();
  }
}
