import * as THREE from 'three';
import { ShowroomEngine } from '@o2vr/engine';
import { assertDocument, componentDefinitions, getComponent, type BehaviorAction, type ChangeSet, type Entity, type JsonValue, type SceneComponent, type SceneDocument } from '@studio/scene-schema';
import { AssetStore, type AssetSource, type GpuResource } from './AssetStore';
import { Navigation } from './Navigation';
import { capturePanorama } from './PanoramaCapture';

type Instance = {
  id:string; modelPromise?:Promise<void>; nativeObjects?:Set<THREE.Object3D>;
  root: THREE.Object3D; visual: THREE.Group; owned: Set<GpuResource>; signature: string; task: number; materialTask: number;
  model?: THREE.Group; nativeNodes?: Map<number,THREE.Object3D>; cruiseCurve?: { key:string; curve:THREE.CatmullRomCurve3 }; clips: THREE.AnimationClip[]; mixer?: THREE.AnimationMixer; button?: HTMLButtonElement;
  audio?: HTMLAudioElement; panner?: PannerNode; media?: MediaElementAudioSourceNode; audioSignature?: string; businessTask?:number; artworkTask?:number;
};
type Point = { position: number[]; target: number[]; pause: number };
type Stop = { progress: number; duration: number; target: number[] };
type CruiseState = { id: string; progress: number; pause: number; visited: Set<number>; activeStop?: Stop };
type Flight = { time: number; duration: number; from: THREE.Vector3; to: THREE.Vector3; start: THREE.Quaternion; end: THREE.Quaternion };
export interface RuntimeInfo { title: string; content: string; imageUrl?: string }
export interface RuntimeCallbacks { onIssue?: (id: string, error: string) => void; onInfo?: (info: RuntimeInfo) => void; onSelect?: (id: string) => void; onReady?: () => void }
const vector = (value: JsonValue | number[] | undefined): THREE.Vector3 => new THREE.Vector3().fromArray(value as number[] ?? [0,0,0]);
const string = (value: JsonValue | undefined): string => String(value ?? '');
const number = (value: JsonValue | undefined): number => Number(value ?? 0);

export class SceneRuntime {
  document: SceneDocument | null = null;
  mode: 'edit' | 'play' = 'edit';
  readonly objects = new Map<string, Instance>();
  readonly navigation: Navigation;
  readonly issues = new Map<string, string>();
  displayMode: 'solid' | 'xray' = 'solid';
  private store: AssetStore | null = null;
  private root = new THREE.Group();
  private ambient = new THREE.AmbientLight();
  private sun = new THREE.DirectionalLight();
  private generation = 0;
  private environmentTask=0;
  private cleanup: (() => void)[] = [];
  private input = new AbortController();
  private fired = new Set<string>();
  private entered = new Set<string>();
  private cruise: CruiseState | null = null;
  private flight: Flight | null = null;
  private audioContext?: AudioContext;
  private pending = new Set<Promise<unknown>>();
  private pointerStart: [number, number] = [0,0];

  constructor(readonly engine: ShowroomEngine, private source: AssetSource, private callbacks: RuntimeCallbacks = {}) {
    engine.scene.add(this.root, this.ambient, this.sun);
    this.navigation = new Navigation(engine.camera, engine.renderer.domElement, () => engine.requestRender());
    this.navigation.onInterrupt = () => { this.cruise = null; this.flight = null; };
    this.cleanup.push(engine.onUpdate((dt: number) => this.update(dt)), engine.onRender(() => this.projectHotspots()));
    const canvas = engine.renderer.domElement;
    canvas.addEventListener('pointerdown', event => { this.pointerStart = [event.clientX,event.clientY]; }, { signal: this.input.signal });
    canvas.addEventListener('pointerup', event => {
      if(event.shiftKey)return;
      if (Math.hypot(event.clientX-this.pointerStart[0], event.clientY-this.pointerStart[1]) > 4) return;
      const rect = canvas.getBoundingClientRect();
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1, -(event.clientY-rect.top)/rect.height*2+1), engine.camera);
      const hit = ray.intersectObject(this.root, true).find(item => this.visible(item.object));
      if (!hit) return;
      let object: THREE.Object3D | null = hit.object;
      while (object && !object.userData.entityId) object = object.parent;
      if (object) this.click(String(object.userData.entityId));
    }, { signal: this.input.signal });
    // Every declared component is executed here; this is not a legacy API adapter.
    const implemented = new Set(['Mesh','Model','ModelNode','Hotspot','Artwork','Collider','Ground','Trigger','DisplayLayer','Light','Audio','Avatar','Cruise','Zone','Panorama','Animation']);
    for (const definition of componentDefinitions) if (!implemented.has(definition.type)) throw new Error('未实现组件: ' + definition.type);
  }
  private visible(object: THREE.Object3D): boolean {
    let cursor: THREE.Object3D | null = object;
    while (cursor) { if (!cursor.visible) return false; cursor = cursor.parent; }
    return !object.userData.collider;
  }
  private issue(id: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.issues.set(id, message); this.callbacks.onIssue?.(id, message);
  }
  private track(task: Promise<unknown>): void {
    this.pending.add(task); void task.finally(() => this.pending.delete(task)).catch(() => {});
  }
  private entity(id: string): Entity | undefined { return this.document?.entities.find(entity => entity.id === id); }
  getObject(id: string): THREE.Object3D | undefined { return this.objects.get(id)?.root; }
  getAssetSource(): AssetSource { return this.source; }
  private sourceUnits(entity:Entity):number {
    const node=getComponent(entity,'ModelNode');if(!node)return 1;
    const model=this.entity(string(node.data.modelEntityId));return Number(model&&getComponent(model,'Model')?.data.unitScale)||1;
  }
  getEntityFrame(id:string):THREE.Matrix4 {
    const entity=this.entity(id),object=this.getObject(id);if(!entity||!object)return new THREE.Matrix4();
    object.updateWorldMatrix(true,false);const unit=this.sourceUnits(entity);
    return object.matrixWorld.clone().multiply(new THREE.Matrix4().makeScale(1/unit,1/unit,1/unit));
  }


  async loadDocument(document: SceneDocument): Promise<void> {
    assertDocument(document); this.unloadScene();
    const generation = this.generation;
    this.document = document; this.store = new AssetStore(document, this.source, this.engine.resourceRegistry);
    for (const entity of document.entities) this.allocate(entity);
    this.hierarchy(); this.settings(true);
    await Promise.all(document.entities.filter(entity => !getComponent(entity,'ModelNode')).map(entity => this.build(entity)));
    if (generation !== this.generation) return;
    this.bindModelNodes(); this.hierarchy(); this.refreshCollision();
    while(this.pending.size)await Promise.allSettled([...this.pending]);
    if(generation!==this.generation)return;
    this.engine.requestRender();
    if (this.mode === 'play') await this.setMode('play');
    this.callbacks.onReady?.();
  }
  private allocate(entity: Entity): Instance {
    const root = new THREE.Group(); const visual = new THREE.Group(); root.add(visual);
    root.userData.entityId = entity.id;
    const instance: Instance = { id:entity.id, root, visual, owned: new Set(), signature: '', task: 0, materialTask: 0, clips: [] };
    this.objects.set(entity.id, instance); this.root.add(root); return instance;
  }
  private scope(instance: Instance): void {
    const next = this.engine.resourceRegistry.collect(instance.visual,(node:THREE.Object3D)=>!instance.nativeObjects||node.userData.ownerEntityId===instance.id) as Set<GpuResource>;
    if(instance.nativeObjects)for(const node of instance.nativeObjects)for(const resource of this.engine.resourceRegistry.collectObject(node))next.add(resource as GpuResource);
    for (const resource of next) if (!instance.owned.has(resource)) this.engine.resourceRegistry.retain(resource);
    for (const resource of instance.owned) if (!next.has(resource)) this.engine.resourceRegistry.release(resource);
    instance.owned = next;
  }
  private release(instance: Instance): void {
    this.scope(instance);
    instance.task++; instance.materialTask++;
    instance.mixer?.stopAllAction(); if (instance.model) instance.mixer?.uncacheRoot(instance.model);
    instance.button?.remove(); this.stopMedia(instance);
    for (const resource of instance.owned) this.engine.resourceRegistry.release(resource);
    instance.owned.clear();
  }
  private stopMedia(instance: Instance): void {
    if (instance.audio) { instance.audio.pause(); instance.audio.removeAttribute('src'); instance.audio.load(); }
    instance.media?.disconnect(); instance.panner?.disconnect();
    instance.audio = undefined; instance.media = undefined; instance.panner = undefined; instance.audioSignature = undefined;
  }
  private signature(entity: Entity): string {
    return JSON.stringify(entity.components.filter(c => c.enabled && ['Mesh','Model','Avatar','Light'].includes(c.type)).map(c => c.type === 'Light' ? c : { type: c.type, assetId: c.data.assetId, unitScale: c.data.unitScale, height: c.data.height }));
  }
  private alive(id: string, instance: Instance, generation: number, task: number): boolean { return this.generation === generation && this.objects.get(id) === instance && instance.task === task; }
  private async build(entity: Entity): Promise<void> {
    const instance = this.objects.get(entity.id)!; const store = this.store!;
    const generation = this.generation; this.release(instance);
    instance.visual.clear(); instance.modelPromise=undefined; instance.model = undefined; instance.nativeNodes = undefined; instance.nativeObjects=undefined; instance.mixer = undefined; instance.clips = [];
    instance.signature = this.signature(entity);
    const task = instance.task;
    try {
      const mesh = getComponent(entity,'Mesh'); const model = getComponent(entity,'Model'); const avatar = getComponent(entity,'Avatar');
      if (mesh && string(mesh.data.assetId)) {
        const geometry = await store.geometry(string(mesh.data.assetId));
        if (!this.alive(entity.id,instance,generation,task)) return;
        const object=new THREE.Mesh(geometry,new THREE.MeshPhongMaterial({color:'#cccccc'}));object.userData.ownerEntityId=entity.id;instance.visual.add(object);
      }
      const modelComponent=model??avatar;
      if(modelComponent?.data.assetId&&(!avatar||this.navigation.viewMode==='third'))await this.attachModel(entity,instance,modelComponent,generation,task);
      const light = getComponent(entity,'Light');
      if (light) {
        const intensity = number(light.data.intensity); const color = string(light.data.color); const distance = number(light.data.distance);
        const object = light.data.kind === 'ambient' ? new THREE.AmbientLight(color,intensity) : light.data.kind === 'point' ? new THREE.PointLight(color,intensity,distance) : light.data.kind === 'spot' ? new THREE.SpotLight(color,intensity,distance,THREE.MathUtils.degToRad(number(light.data.angle))) : new THREE.DirectionalLight(color,intensity);
        if (object instanceof THREE.DirectionalLight || object instanceof THREE.SpotLight) { object.target.position.set(0,0,-1); instance.visual.add(object.target); }
        instance.visual.add(object);
      }
      this.scope(instance);
      const current = this.entity(entity.id);
      if (current) { await this.material(current); await this.business(current); }
      if (this.alive(entity.id,instance,generation,task)) {
        this.bindModelNodes(); this.hierarchy(); this.refreshCollision(); this.engine.requestRender();
      }
    } catch (error) { if (this.alive(entity.id,instance,generation,task)) this.issue(entity.id,error); }
  }
  private async attachModel(entity:Entity,instance:Instance,component:SceneComponent,generation:number,task:number):Promise<void> {
    const loaded=await this.store!.instance(string(component.data.assetId));
    if(!this.alive(entity.id,instance,generation,task)){
      loaded.root.traverse(node=>{if(node instanceof THREE.Mesh)for(const material of Array.isArray(node.material)?node.material:[node.material])material.dispose();});return;
    }
    instance.model=loaded.root;instance.clips=loaded.clips;instance.nativeObjects=new Set();
    loaded.root.traverse(node=>instance.nativeObjects!.add(node));
    if(component.type==='Model'){instance.nativeNodes=new Map();loaded.root.traverse(node=>{if(typeof node.userData.gltfNodeIndex==='number')instance.nativeNodes!.set(node.userData.gltfNodeIndex,node);});}
    loaded.root.scale.multiplyScalar(number(component.data.unitScale));
    if(component.type==='Avatar'){
      const height=new THREE.Box3().setFromObject(loaded.root).getSize(new THREE.Vector3()).y;
      if(height>0)loaded.root.scale.multiplyScalar(number(component.data.height)/height);
      loaded.root.visible=this.navigation.viewMode==='third';
    }
    instance.visual.add(loaded.root);instance.mixer=new THREE.AnimationMixer(loaded.root);
    instance.mixer.addEventListener('finished',()=>{
      if(this.mode!=='play'||!this.document)return;
      const sources=this.document.entities.filter(e=>getComponent(e,'Animation')?.data.modelEntityId===entity.id).map(e=>e.id);
      for(const id of new Set([entity.id,...sources]))void this.emit('animationEnd',id);
    });
    this.scope(instance);this.engine.requestRender();
  }
  private ensureAvatar(entity:Entity,instance:Instance):Promise<void> {
    const component=getComponent(entity,'Avatar');if(instance.model||!component)return Promise.resolve();
    if(instance.modelPromise)return instance.modelPromise;
    const generation=this.generation,task=instance.task;
    const promise=this.attachModel(entity,instance,component,generation,task).catch(error=>{if(this.alive(entity.id,instance,generation,task))this.issue(entity.id,error);});
    instance.modelPromise=promise;void promise.finally(()=>{if(instance.modelPromise===promise)instance.modelPromise=undefined;});return promise;
  }
  private modelOwner(entity: Entity): Instance | undefined {
    const node = getComponent(entity,'ModelNode');
    return node ? this.objects.get(string(node.data.modelEntityId)) : undefined;
  }
  private bindModelNodes(): void {
    if (!this.document) return;
    for(const [ownerId,owner]of this.objects)if(owner.nativeNodes) {
      const present=new Set(this.document.entities.flatMap(e=>{const b=getComponent(e,'ModelNode');return b&&string(b.data.modelEntityId)===ownerId?[number(b.data.nodeIndex)]:[];}));
      for(const [index,node]of owner.nativeNodes)if(!present.has(index))node.removeFromParent();
    }
    for (const entity of this.document.entities) {
      const binding = getComponent(entity,'ModelNode'); if (!binding) continue;
      const owner = this.objects.get(string(binding.data.modelEntityId)); const instance = this.objects.get(entity.id)!;
      const native = owner?.nativeNodes?.get(number(binding.data.nodeIndex));
      if (native && instance.root !== native) {
        instance.root.removeFromParent();
        instance.root = native; native.userData.entityId = entity.id;
        instance.visual = new THREE.Group(); instance.visual.scale.setScalar(1/this.sourceUnits(entity)); native.add(instance.visual);
        this.track(this.material(entity)); this.track(this.business(entity).catch(error=>this.issue(entity.id,error)));
      }
    }
  }
  private hierarchy(): void {
    if (!this.document) return;
    for (const entity of this.document.entities) {
      const instance = this.objects.get(entity.id); if (!instance) continue;
      const node = getComponent(entity,'ModelNode');
      const parent = entity.parentId ? this.objects.get(entity.parentId) : undefined;
      let target = parent?.root ?? this.root;
      let divisor = 1; let scaleDivisor = 1;
      if (node) {
        const ownerEntity = this.entity(string(node.data.modelEntityId));
        const unit = ownerEntity && getComponent(ownerEntity,'Model');
        divisor = unit ? number(unit.data.unitScale) : 1;
        if (entity.parentId === ownerEntity?.id) target = this.objects.get(ownerEntity.id)?.model ?? target;
      } else if (entity.parentId) {
        const parentEntity = this.entity(entity.parentId); const parentBinding = parentEntity && getComponent(parentEntity,'ModelNode');
        const model = parentBinding && this.entity(string(parentBinding.data.modelEntityId));
        const units = model && getComponent(model,'Model');
        if (units) divisor = scaleDivisor = number(units.data.unitScale);
      }
      if (instance.root !== target && instance.root.parent !== target) target.add(instance.root);
      instance.root.name = entity.name;
      instance.root.position.fromArray(entity.transform.position).divideScalar(divisor);
      instance.root.quaternion.fromArray(entity.transform.rotation);
      instance.root.scale.fromArray(entity.transform.scale).divideScalar(scaleDivisor);
      instance.root.visible = entity.visible;
    }
    this.root.updateMatrixWorld(true);
  }
  private async material(entity: Entity): Promise<void> {
    const instance = this.objects.get(entity.id); if (!instance || !this.store || !this.document) return;
    const component = getComponent(entity,'Mesh') ?? getComponent(entity,'Model') ?? getComponent(entity,'ModelNode');
    const materialId = string(component?.data.materialId);
    const definition = this.document.materials.find(m => m.id === materialId);
    const nonce = ++instance.materialTask; const generation = this.generation; const store = this.store;
    if (!definition) return;
    try {
      const material = await store.material(definition);
      if (generation !== this.generation || this.objects.get(entity.id) !== instance || nonce !== instance.materialTask) { store.disposeUnowned(material); return; }
      const target = getComponent(entity,'ModelNode') ? instance.root : instance.visual;
      const meshes: THREE.Mesh[] = [];
      target.traverse(node => {
        if(!(node instanceof THREE.Mesh))return;
        let cursor:THREE.Object3D|null=node;
        while(cursor&&cursor!==instance.root){
          const nested=this.entity(String(cursor.userData.entityId??''));
          const component=nested&&(getComponent(nested,'ModelNode')??getComponent(nested,'Model'));
          if(nested&&nested.id!==entity.id&&component?.data.materialId)return;
          cursor=cursor.parent;
        }
        meshes.push(node);
      });
      for (const mesh of meshes) mesh.material = material;
      if (meshes.length === 0) store.disposeUnowned(material);
      this.scope(this.modelOwner(entity) ?? instance);
      const artwork = getComponent(entity,'Artwork'); if (artwork) await this.artwork(entity,artwork);
      this.applyDisplay(); this.engine.requestRender();
    } catch (error) { if (generation === this.generation) this.issue(entity.id,error); }
  }
  private async artwork(entity: Entity, component: SceneComponent): Promise<void> {
    const instance = this.objects.get(entity.id); if (!instance || !this.store) return;
    const generation = this.generation; const store = this.store; const task=instance.artworkTask=(instance.artworkTask??0)+1;
    if (!component.data.assetId) return;
    const texture = await store.texture(string(component.data.assetId));
    if (generation !== this.generation || this.objects.get(entity.id) !== instance || instance.artworkTask!==task || getComponent(this.entity(entity.id)!, 'Artwork')?.data.assetId!==component.data.assetId) return;
    const target = getComponent(entity,'ModelNode') ? instance.root : instance.visual;
    target.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) if ('map' in material) {
        const ownTexture = texture.clone(); ownTexture.colorSpace = THREE.SRGBColorSpace; ownTexture.flipY = true; ownTexture.needsUpdate = true;
        Object.assign(material,{ map: ownTexture }); material.needsUpdate = true;
      }
    });
    this.scope(this.modelOwner(entity) ?? instance); this.engine.requestRender();
  }
  private async business(entity: Entity): Promise<void> {
    const instance = this.objects.get(entity.id); if (!instance) return;
    const businessTask=instance.businessTask=(instance.businessTask??0)+1;
    const hotspot = getComponent(entity,'Hotspot');
    if (hotspot) {
      if (!instance.button) {
        const button = document.createElement('button'); button.className = 'runtime-hotspot'; button.type = 'button';
        button.addEventListener('click', event => { event.stopPropagation(); this.click(entity.id); });
        this.engine.container.appendChild(button); instance.button = button;
      }
      instance.button.textContent = string(hotspot.data.icon) + ' ' + string(hotspot.data.label);
      instance.button.style.setProperty('--hotspot-color',string(hotspot.data.color));
    } else { instance.button?.remove(); instance.button = undefined; }
    const artwork = getComponent(entity,'Artwork');
    if (artwork) try { await this.artwork(entity,artwork); } catch (error) { this.issue(entity.id,error); }
    const audio = getComponent(entity,'Audio');
    if (!audio || instance.audioSignature !== JSON.stringify(audio.data)) {
      this.stopMedia(instance);
      if (audio && audio.data.assetId && this.store) {
        const generation = this.generation; const url = await this.store.blobUrl(string(audio.data.assetId));
        if (generation !== this.generation || this.objects.get(entity.id) !== instance || instance.businessTask!==businessTask) return;
        const element = new Audio(url); element.preload = 'metadata'; element.volume = number(audio.data.volume); element.loop = Boolean(audio.data.loop);
        instance.audio = element; instance.audioSignature = JSON.stringify(audio.data);
      }
    }
    if (audio?.data.autoplay && this.mode === 'play') void this.playAudio(entity.id).catch(error => this.issue(entity.id,error));
  }
  async applyChangeSet(change: ChangeSet): Promise<void> {
    if (!this.document) return;
    this.document = change.after; this.store?.update(change.after);
    for (const id of change.entityIds) {
      const entity = this.entity(id); const instance = this.objects.get(id);
      const beforeEntity = change.before.entities.find(e=>e.id===id);
      if (!entity && instance) {
        // Child roots are independent owners; detach them before removing their former parent.
        for (const child of this.document.entities.filter(e => e.parentId === id)) this.getObject(child.id)?.removeFromParent();
        this.release(instance); instance.root.removeFromParent(); this.objects.delete(id);
      } else if (entity) {
        const target = instance ?? this.allocate(entity);
        if (!getComponent(entity,'ModelNode') && target.signature !== this.signature(entity)) this.track(this.build(entity));
        else if(!beforeEntity||JSON.stringify(beforeEntity.components)!==JSON.stringify(entity.components)) { this.track(this.material(entity)); this.track(this.business(entity)); }
      }
    }
    for (const entity of this.document.entities) {
      const material = getComponent(entity,'Mesh') ?? getComponent(entity,'Model') ?? getComponent(entity,'ModelNode');
      if (!change.entityIds.includes(entity.id) && change.materialIds.includes(string(material?.data.materialId))) this.track(this.material(entity));
    }
    this.bindModelNodes(); this.hierarchy(); this.refreshCollision(); if (change.settingsChanged) this.settings(false);
    this.engine.requestRender();
  }
  private settings(reset: boolean): void {
    if (!this.document) return;
    const settings = this.document.settings; const environmentTask=++this.environmentTask;
    this.engine.scene.background = new THREE.Color(settings.background); this.engine.renderer.toneMappingExposure = settings.exposure;
    Object.assign(this.engine.camera,{ fov: settings.fov, near: settings.near, far: settings.far }); this.engine.camera.updateProjectionMatrix();
    this.ambient.color.set(settings.ambientColor); this.ambient.intensity = settings.ambientIntensity;
    this.sun.color.set(settings.sunColor); this.sun.intensity = settings.sunIntensity; this.sun.position.fromArray(settings.sunPosition);
    this.engine.frameScheduler.onDemand = settings.onDemand; this.engine.adaptiveQuality.enabled = settings.adaptiveQuality;
    this.navigation.settings = settings;
    this.engine.perfMonitor.visible=settings.showStats; if(this.engine.perfMonitor.domElement)this.engine.perfMonitor.domElement.style.display=settings.showStats?'block':'none';
    if (reset) this.navigation.reset(settings);
    if (settings.environmentAssetIds.length === 6 && this.store) {
      const generation = this.generation; const store = this.store;
      this.track(Promise.all(settings.environmentAssetIds.map(id => store.texture(id))).then(textures => {
        if (this.generation !== generation || environmentTask!==this.environmentTask) return;
        this.engine.scene.environment?.dispose();
        const cube = new THREE.CubeTexture(textures.map(t => t.image)); cube.colorSpace = THREE.SRGBColorSpace; cube.needsUpdate = true;
        this.engine.scene.environment = cube; this.engine.requestRender();
      }).catch(error => this.issue('environment',error)));
    } else { this.engine.scene.environment?.dispose(); this.engine.scene.environment = null; }
  }
  private refreshCollision(): void {
    if (!this.document) return;
    const colliders: THREE.Object3D[] = []; const grounds: THREE.Object3D[] = [];
    for (const entity of this.document.entities) {
      const instance = this.objects.get(entity.id); if (!instance) continue;
      const collider = getComponent(entity,'Collider');
      let box = instance.visual.children.find(node => node.userData.collider);
      if (collider?.data.shape === 'box') {
        if (!box) {
          box = new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({ visible: false }));
          box.userData.collider = true; box.userData.ownerEntityId=entity.id; instance.visual.add(box); this.scope(instance);
        }
        box.position.copy(vector(collider.data.offset)); box.scale.copy(vector(collider.data.size)); colliders.push(box);
      } else {
        if (box) { box.removeFromParent(); this.scope(instance); }
        if (collider) colliders.push(instance.root);
      }
      if (getComponent(entity,'Ground')) grounds.push(instance.root);
    }
    this.root.updateMatrixWorld(true); this.navigation.colliders = colliders; this.navigation.grounds = grounds;
  }
  async setMode(mode: 'edit' | 'play'): Promise<void> {
    if(mode==='play')while(this.pending.size)await Promise.allSettled([...this.pending]);
    this.navigation.pause(); this.cruise = null; this.flight = null; this.mode = mode;
    this.fired.clear(); this.entered.clear(); this.displayMode = 'solid';
    for (const instance of this.objects.values()) { instance.mixer?.stopAllAction(); instance.audio?.pause(); if (instance.audio) instance.audio.currentTime = 0; }
    this.hierarchy(); this.settings(true);
    if(this.document)for(const entity of this.document.entities)if(getComponent(entity,'Avatar')){
      const instance=this.objects.get(entity.id);if(instance?.model){instance.model.position.set(0,0,0);instance.model.rotation.set(0,0,0);instance.model.visible=mode==='play'&&this.navigation.viewMode==='third'&&entity.visible;delete instance.root.userData.activeAvatarClip;}
    }
    this.applyDisplay();
    if (mode === 'play' && this.document) {
      this.navigation.enabled = true;
      for (const entity of this.document.entities) {
        const animation = getComponent(entity,'Animation'); if (animation?.data.autoplay) this.playAnimation(entity.id);
        const audio = getComponent(entity,'Audio'); if (audio?.data.autoplay) void this.playAudio(entity.id).catch(error => this.issue(entity.id,error));
        const cruise = getComponent(entity,'Cruise'); if (cruise?.data.autoplay) this.startCruise(entity.id);
      }
      await this.emit('ready','');
      this.engine.renderer.domElement.focus();
    }
    this.engine.requestRender();
  }
  click(id: string): void { if (this.mode === 'edit') this.callbacks.onSelect?.(id); else void this.emit('click',id); }
  async emit(event: string, sourceId: string): Promise<void> {
    if (this.mode !== 'play' || !this.document) return;
    const generation = this.generation;
    for (const behavior of this.document.behaviors) {
      if (behavior.event !== event || behavior.sourceId !== sourceId || behavior.condition.once && this.fired.has(behavior.id)) continue;
      if (behavior.condition.viewMode !== 'any' && behavior.condition.viewMode !== this.navigation.viewMode || behavior.condition.displayMode !== 'any' && behavior.condition.displayMode !== this.displayMode) continue;
      this.fired.add(behavior.id);
      try { for (const action of behavior.actions) { if (generation !== this.generation || this.mode !== 'play') return; await this.executeAction(action); } }
      catch (error) { this.issue(behavior.id,error); }
    }
  }
  async executeAction(action: BehaviorAction): Promise<void> {
    const instance = this.objects.get(action.targetId);
    switch (action.type) {
      case 'Show': if (instance) instance.root.visible = true; break;
      case 'Hide': if (instance) instance.root.visible = false; break;
      case 'Toggle': if (instance) instance.root.visible = !instance.root.visible; break;
      case 'DisplayMode': this.displayMode = action.data.mode === 'xray' ? 'xray' : 'solid'; this.applyDisplay(); break;
      case 'PlayAnimation': {const entity=this.entity(action.targetId);const model=this.objects.get(action.targetId);if(entity&&model&&getComponent(entity,'Avatar'))await this.ensureAvatar(entity,model);this.playAnimation(action.targetId,string(action.data.clip),Boolean(action.data.loop));break;}
      case 'PauseAnimation': {const entity=this.entity(action.targetId);const modelId=entity&&getComponent(entity,'Animation')?.data.modelEntityId;const model=this.objects.get(String(modelId??action.targetId));if(model?.mixer)model.mixer.timeScale=0;break;}
      case 'PlayAudio': await this.playAudio(action.targetId); break;
      case 'StopAudio': if (instance?.audio) { instance.audio.pause(); instance.audio.currentTime = 0; } break;
      case 'FlyTo': this.flyTo(action.targetId,string(action.data.viewId)); break;
      case 'OpenInfo': {
        const imageUrl = action.data.assetId && this.store ? await this.store.blobUrl(string(action.data.assetId)) : undefined;
        this.callbacks.onInfo?.({ title: string(action.data.title), content: string(action.data.content), imageUrl }); break;
      }
      case 'StartCruise': this.startCruise(action.targetId); break;
      case 'PauseCruise': this.cruise = null; break;
      case 'ViewMode': this.navigation.viewMode = action.data.mode === 'third' ? 'third' : 'first'; break;
      case 'Panorama': {
        const entity = this.entity(action.targetId); const panorama = entity && getComponent(entity,'Panorama');
        if (instance && panorama) { this.navigation.eye.copy(vector(panorama.data.position).applyMatrix4(this.getEntityFrame(entity!.id))); this.engine.camera.fov = number(panorama.data.fov); this.engine.camera.updateProjectionMatrix(); }
        break;
      }
    }
    this.engine.requestRender();
  }
  private playAnimation(id: string, clipName?: string, loop?: boolean): void {
    const entity = this.entity(id); const animation = entity && getComponent(entity,'Animation');
    const modelId = string(animation?.data.modelEntityId) || id;
    const instance = this.objects.get(modelId); if (!instance?.mixer) throw new Error('动画模型尚未就绪');
    const name = clipName || string(animation?.data.clip); const clip = instance.clips.find(clip => clip.name === name);
    if (!clip) throw new Error('动画片段不存在: ' + name);
    instance.mixer.timeScale = number(animation?.data.speed) || 1;
    const action = instance.mixer.clipAction(clip); action.reset(); action.setLoop(loop ?? Boolean(animation?.data.loop) ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); action.clampWhenFinished = true; action.play();
  }
  async playAudio(id: string): Promise<void> {
    const instance = this.objects.get(id); const entity = this.entity(id); const component = entity && getComponent(entity,'Audio');
    if (!instance?.audio || !component) throw new Error('音频尚未就绪');
    if (component.data.spatial && !instance.media) {
      this.audioContext ??= new AudioContext();
      instance.media = this.audioContext.createMediaElementSource(instance.audio); instance.panner = this.audioContext.createPanner();
      instance.panner.refDistance = number(component.data.distance)/1000;
      instance.media.connect(instance.panner); instance.panner.connect(this.audioContext.destination);
    }
    await this.audioContext?.resume();
    try { await instance.audio.play(); } catch { throw new Error('浏览器需要用户操作后播放声音，请再次点击对应音频的播放按钮'); }
  }
  async enableAudio(): Promise<void> {
    if (!this.document) return;
    for (const entity of this.document.entities) if (getComponent(entity,'Audio')) await this.playAudio(entity.id);
  }
  flyTo(id: string, viewId: string): void {
    const entity = this.entity(id); const zone = entity && getComponent(entity,'Zone');
    const views = zone?.data.views as { id: string; position: number[]; target: number[] }[] | undefined;
    const view = views?.find(v => v.id === viewId) ?? views?.[0]; if (!view) throw new Error('展区视点不存在');
    const instance = this.objects.get(id)!; instance.root.updateWorldMatrix(true,false);
    const position = vector(view.position).applyMatrix4(this.getEntityFrame(id)); const target = vector(view.target).applyMatrix4(this.getEntityFrame(id));
    const camera = this.engine.camera.clone(); camera.position.copy(position); camera.lookAt(target);
    this.cruise = null; this.flight = { time: 0, duration: number(zone?.data.duration) || 1.5, from: this.navigation.eye.clone(), to: position, start: this.engine.camera.quaternion.clone(), end: camera.quaternion.clone() };
    this.engine.requestRender();
  }
  startCruise(id: string): void {
    const entity = this.entity(id); if (!entity || !getComponent(entity,'Cruise')) throw new Error('巡航配置不存在');
    this.flight = null; this.cruise = { id, progress: 0, pause: 0, visited: new Set() }; this.engine.requestRender();
  }
  private updateCruise(dt: number): boolean {
    const state = this.cruise; if (!state) return false;
    const entity = this.entity(state.id); const component = entity && getComponent(entity,'Cruise'); const instance = this.objects.get(state.id);
    if (!component || !instance) { this.cruise = null; return false; }
    const points = component.data.points as Point[]; if (points.length < 2) return false;
    const curveKey=JSON.stringify([component.data.points,component.data.closed]);
    if(instance.cruiseCurve?.key!==curveKey){const curve=new THREE.CatmullRomCurve3(points.map(p=>vector(p.position)),Boolean(component.data.closed),'centripetal');curve.arcLengthDivisions=1000;instance.cruiseCurve={key:curveKey,curve};}
    const curve=instance.cruiseCurve.curve;
    const stops = [...(component.data.stops as Stop[] ?? []), ...points.map((p,i) => ({ progress: i/(points.length-1), duration: p.pause, target: p.target })).filter(p => p.duration > 0)];
    if (state.pause > 0) state.pause = Math.max(0,state.pause-dt);
    else {
      const next = state.progress + dt * number(component.data.speed) / number(component.data.duration);
      const stopIndex = stops.findIndex((stop,index) => !state.visited.has(index) && stop.progress >= state.progress && stop.progress <= next);
      if (stopIndex >= 0) { const stop = stops[stopIndex]; state.progress = stop.progress; state.pause = stop.duration; state.activeStop = stop; state.visited.add(stopIndex); }
      else { state.progress = next; state.activeStop = undefined; }
      if (state.progress >= 1) {
        if (component.data.closed) { state.progress %= 1; state.visited.clear(); }
        else { state.progress = 1; this.cruise = null; }
      }
    }
    const position = curve.getPointAt(Math.min(state.progress,1)).applyMatrix4(this.getEntityFrame(state.id));
    const target = state.activeStop ? vector(state.activeStop.target).applyMatrix4(this.getEntityFrame(state.id)) : curve.getPointAt((state.progress + .008) % 1).applyMatrix4(this.getEntityFrame(state.id));
    this.navigation.eye.copy(position); this.navigation.lookAt(target); this.navigation.pose(); return true;
  }
  private applyDisplay(): void {
    if (!this.document) return;
    for (const entity of this.document.entities) {
      const component = getComponent(entity,'DisplayLayer'); const instance = this.objects.get(entity.id); if (!component || !instance) continue;
      const xray = this.displayMode === 'xray' && component.data.layer === 'shell';
      const target=getComponent(entity,'ModelNode')?instance.root:instance.visual;
      target.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          if (!material.userData.baseDisplay) material.userData.baseDisplay = { opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite };
          const base = material.userData.baseDisplay as { opacity: number; transparent: boolean; depthWrite: boolean };
          material.opacity = xray ? number(component.data.xrayOpacity) : base.opacity; material.transparent = xray || base.transparent; material.depthWrite = xray ? false : base.depthWrite; material.needsUpdate = true;
        }
      });
    }
  }
  private update(dt: number): boolean {
    if (this.mode !== 'play' || !this.document) return false;
    let active = false;
    if (this.flight) {
      const flight = this.flight; flight.time = Math.min(flight.duration,flight.time+dt);
      const t = flight.time/flight.duration; const smooth = t*t*(3-2*t);
      this.navigation.eye.lerpVectors(flight.from,flight.to,smooth);
      const quaternion = flight.start.clone().slerp(flight.end,smooth); const euler = new THREE.Euler().setFromQuaternion(quaternion,'YXZ');
      this.navigation.yaw = euler.y; this.navigation.pitch = euler.x; this.navigation.pose();
      if (t === 1) this.flight = null; active = true;
    } else if (this.cruise) active = this.updateCruise(dt);
    else active = this.navigation.update(dt);
    for (const entity of this.document.entities) {
      const instance = this.objects.get(entity.id); if (!instance) continue;
      const avatar = getComponent(entity,'Avatar');
      if(instance.mixer&&(!avatar||this.navigation.viewMode==='third')){
        instance.mixer.update(dt);
        if(instance.mixer.timeScale!==0&&this.visible(instance.root)&&instance.clips.some(clip=>instance.mixer!.existingAction(clip)?.isRunning()))active=true;
      }
      if (avatar) {
        if(this.navigation.viewMode==='third'&&!instance.model&&!instance.modelPromise)this.track(this.ensureAvatar(entity,instance));
        if (instance.model) instance.model.visible = this.navigation.viewMode === 'third' && entity.visible;
        const position = this.navigation.eye.clone(); position.y -= this.document.settings.eyeHeight;
        instance.root.worldToLocal(position);
        if (instance.model) { instance.model.position.copy(position); instance.model.rotation.set(0,this.navigation.yaw,0); }
        const clipName = string(this.navigation.speed ? this.navigation.sprint ? avatar.data.runClip : avatar.data.walkClip : avatar.data.idleClip);
        if (instance.mixer && instance.root.userData.activeAvatarClip !== clipName) {
          instance.mixer.stopAllAction(); const clip = instance.clips.find(c => c.name.toLowerCase() === clipName.toLowerCase());
          if (clip) instance.mixer.clipAction(clip).play();
          instance.root.userData.activeAvatarClip = clipName;
        }
      }
      const trigger = getComponent(entity,'Trigger');
      if (trigger) {
        const local = this.navigation.eye.clone().add(new THREE.Vector3(0,-this.document.settings.eyeHeight*.5,0)); local.applyMatrix4(this.getEntityFrame(entity.id).invert()); local.sub(vector(trigger.data.offset));
        const half = vector(trigger.data.size).multiplyScalar(.5); const inside = Math.abs(local.x)<=half.x && Math.abs(local.y)<=half.y && Math.abs(local.z)<=half.z;
        if (inside !== this.entered.has(entity.id)) { if (inside) this.entered.add(entity.id); else this.entered.delete(entity.id); void this.emit(inside ? 'enter' : 'leave',entity.id); }
      }
      if (instance.panner) {
        const position = instance.root.getWorldPosition(new THREE.Vector3()).divideScalar(1000);
        instance.panner.positionX.value = position.x; instance.panner.positionY.value = position.y; instance.panner.positionZ.value = position.z;
      }
    }
    if (this.audioContext) {
      const listener = this.audioContext.listener; const position = this.engine.camera.position.clone().divideScalar(1000); const direction = this.engine.camera.getWorldDirection(new THREE.Vector3());
      listener.positionX.value = position.x; listener.positionY.value = position.y; listener.positionZ.value = position.z;
      listener.forwardX.value = direction.x; listener.forwardY.value = direction.y; listener.forwardZ.value = direction.z;
    }
    return active;
  }
  private projectHotspots(): void {
    for (const instance of this.objects.values()) if (instance.button) {
      const world = instance.root.getWorldPosition(new THREE.Vector3()); const projected = world.project(this.engine.camera);
      instance.button.hidden = !this.visible(instance.root) || projected.z < -1 || projected.z > 1 || Math.abs(projected.x)>1 || Math.abs(projected.y)>1;
      instance.button.style.left = (projected.x*.5+.5)*this.engine.container.clientWidth + 'px';
      instance.button.style.top = (-projected.y*.5+.5)*this.engine.container.clientHeight + 'px';
    }
  }
  async snapshot(id: string): Promise<Blob> {
    const entity = this.entity(id); const panorama = entity && getComponent(entity,'Panorama'); const instance = this.objects.get(id);
    if (!panorama || !instance) throw new Error('请选择全景观察点');
    const extras=this.engine.scene.children.filter(child=>!new Set<THREE.Object3D>([this.root,this.ambient,this.sun]).has(child));
    const visibility=extras.map(child=>child.visible);extras.forEach(child=>{child.visible=false;});
    try{return await capturePanorama(this.engine.renderer,this.engine.scene,vector(panorama.data.position).applyMatrix4(this.getEntityFrame(entity!.id)),number(panorama.data.width),number(panorama.data.height));}
    finally{extras.forEach((child,index)=>{child.visible=visibility[index];});this.engine.requestRender();}
  }
  stats(): { objects: number; resources: number; textures: number; geometries: number; pending: number; contexts: number; listeners: number } {
    const resources = this.engine.resourceRegistry.getStats();
    return { objects: this.objects.size, resources: resources.totalTracked, textures: this.engine.renderer.info.memory.textures, geometries: this.engine.renderer.info.memory.geometries, pending: this.pending.size, contexts: this.engine.renderer.domElement.isConnected ? 1 : 0, listeners: this.cleanup.length + (this.input.signal.aborted ? 0 : 2) };
  }
  unloadScene(): void {
    this.generation++; this.navigation.pause(); this.cruise = null; this.flight = null;
    for (const instance of this.objects.values()) { this.release(instance); instance.root.removeFromParent(); }
    this.objects.clear(); this.store?.close(); this.store = null; this.document = null; this.root.clear(); this.issues.clear(); this.fired.clear(); this.entered.clear();
    this.engine.scene.environment?.dispose(); this.engine.scene.environment = null;
    this.engine.renderer.renderLists.dispose(); this.engine.requestRender();
  }
  dispose(): void {
    this.unloadScene(); this.input.abort(); this.navigation.dispose();
    for (const cleanup of this.cleanup) cleanup(); this.cleanup = [];
    this.root.removeFromParent(); this.ambient.removeFromParent(); this.sun.removeFromParent(); void this.audioContext?.close();
  }
}
