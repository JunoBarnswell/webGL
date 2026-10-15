export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type ComponentType = 'Mesh' | 'Model' | 'ModelNode' | 'Hotspot' | 'Artwork' | 'Collider' | 'Ground' | 'Trigger' | 'DisplayLayer' | 'Light' | 'Audio' | 'Avatar' | 'Cruise' | 'Zone' | 'Panorama' | 'Animation';
export type ActionType = 'Show' | 'Hide' | 'Toggle' | 'DisplayMode' | 'PlayAnimation' | 'PlayAudio' | 'StopAudio' | 'FlyTo' | 'OpenInfo' | 'StartCruise' | 'PauseCruise' | 'ViewMode' | 'Panorama';
export interface SceneComponent { type: ComponentType; enabled: boolean; data: Record<string, JsonValue> }
export interface SceneAsset { id: string; name: string; kind: 'mesh' | 'model' | 'image' | 'audio' | 'texture'; entry: string; files: string[]; sha256: string }
export interface Transform { position: Vec3; rotation: Quat; scale: Vec3 }
export interface Entity { id: string; name: string; parentId: string | null; visible: boolean; locked: boolean; transform: Transform; components: SceneComponent[]; legacyUuid: string }
export interface TextureBinding { assetId: string; offset: [number, number]; repeat: [number, number]; rotation: number; channel: number; flipY: boolean; colorSpace: 'srgb' | 'linear' }
export interface SceneMaterial { id: string; name: string; kind: 'phong' | 'standard' | 'physical'; color: string; specular: string; emissive: string; opacity: number; transparent: boolean; side: number; depthWrite: boolean; shininess: number; reflectivity: number; metalness: number; roughness: number; clearcoat: number; clearcoatRoughness: number; lightMapIntensity: number; maps: Record<string, TextureBinding>; envAssetIds: string[] }
export interface SceneSettings { background: string; exposure: number; fov: number; near: number; far: number; position: Vec3; target: Vec3; moveSpeed: number; eyeHeight: number; playerRadius: number; collision: boolean; viewMode: 'first' | 'third'; ambientColor: string; ambientIntensity: number; sunColor: string; sunIntensity: number; sunPosition: Vec3; onDemand: boolean; adaptiveQuality: boolean; showStats: boolean }
export interface BehaviorAction { type: ActionType; targetId: string; data: Record<string, JsonValue> }
export interface Behavior { id: string; name: string; event: 'click' | 'enter' | 'leave' | 'ready' | 'animationEnd'; sourceId: string; condition: { once: boolean; viewMode: 'any' | 'first' | 'third'; displayMode: 'any' | 'solid' | 'xray' }; actions: BehaviorAction[] }
export interface SceneDocument { schemaVersion: 1; sceneId: string; name: string; units: 'mm'; assets: SceneAsset[]; materials: SceneMaterial[]; entities: Entity[]; settings: SceneSettings; behaviors: Behavior[] }
export interface ChangeSet { before: SceneDocument; after: SceneDocument; entityIds: string[]; materialIds: string[]; settingsChanged: boolean; behaviorsChanged: boolean; assetsChanged: boolean }
export interface Draft { sceneId: string; revision: number; document: SceneDocument }
export interface PublishedManifest { formatVersion: 1; versionId: string; publishedAt: string; document: SceneDocument }
export interface FieldSchema { type?: string | string[]; title?: string; default?: JsonValue; enum?: string[]; const?: string | number; minimum?: number; maximum?: number; properties?: Record<string, FieldSchema>; items?: FieldSchema; required?: string[]; 'x-editor'?: string; 'x-reference'?: 'asset' | 'entity' | 'material' }
export interface ComponentDefinition { type: ComponentType; title: string; fields: Record<string, FieldSchema> }
