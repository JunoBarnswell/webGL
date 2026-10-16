import type { KnownComponentType, KnownActionType } from "./known-types";
export type { KnownComponentType, KnownActionType } from "./known-types";
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Scalar = string | number | boolean;
export type JsonValue =
  | Scalar
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type ComponentType = KnownComponentType | (string & {});
export type ActionType = KnownActionType | (string & {});
export type EventType =
  | "click"
  | "hover"
  | "enter"
  | "leave"
  | "ready"
  | "animationEnd"
  | "mediaEnd"
  | "viewpointArrive"
  | "tourEnd"
  | "variableChange"
  | "uiClick"
  | "uiChange"
  | "key";
export type ReferenceKind =
  | "entity"
  | "asset"
  | "material"
  | "content"
  | "viewpoint"
  | "tour"
  | "variable"
  | "ui"
  | "layout";
export type SourceKind =
  | "entity"
  | "scene"
  | "ui"
  | "viewpoint"
  | "tour"
  | "variable"
  | "key";
export interface SceneComponent {
  type: ComponentType;
  enabled: boolean;
  data: Record<string, JsonValue>;
}
export interface AssetPreview {
  file: string;
  width: number;
  height: number;
}
export interface SceneAsset {
  id: string;
  name: string;
  kind: "mesh" | "model" | "image" | "audio" | "texture";
  entry: string;
  files: string[];
  sha256: string;
  preview?: AssetPreview;
  importTaskId?: string;
}
export interface Transform {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}
export interface Entity {
  id: string;
  name: string;
  parentId: string | null;
  visible: boolean;
  locked: boolean;
  transform: Transform;
  components: SceneComponent[];
  legacyUuid: string;
}
export interface TextureBinding {
  assetId: string;
  offset: [number, number];
  repeat: [number, number];
  rotation: number;
  channel: number;
  flipY: boolean;
  colorSpace: "srgb" | "linear";
}
export interface SceneMaterial {
  id: string;
  name: string;
  kind: "phong" | "standard" | "physical";
  color: string;
  specular: string;
  emissive: string;
  opacity: number;
  transparent: boolean;
  side: number;
  depthWrite: boolean;
  shininess: number;
  reflectivity: number;
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  lightMapIntensity: number;
  maps: Record<string, TextureBinding>;
  envAssetIds: string[];
}
export interface SceneSettings {
  sprintMultiplier: number;
  lookSensitivity: number;
  pitchLimit: number;
  thirdPersonDistance: number;
  thirdPersonHeight: number;
  thirdPersonFocusHeight: number;
  thirdPersonMinDistance: number;
  thirdPersonSmoothing: number;
  environmentAssetIds: string[];
  background: string;
  exposure: number;
  fov: number;
  near: number;
  far: number;
  position: Vec3;
  target: Vec3;
  moveSpeed: number;
  eyeHeight: number;
  playerRadius: number;
  collision: boolean;
  viewMode: "first" | "third";
  ambientColor: string;
  ambientIntensity: number;
  sunColor: string;
  sunIntensity: number;
  sunPosition: Vec3;
  onDemand: boolean;
  adaptiveQuality: boolean;
  showStats: boolean;
}
export interface ContentItem {
  id: string;
  name: string;
  title: string;
  body: string;
  imageAssetId: string;
  audioEntityId: string;
  layoutId: string;
}
export interface Viewpoint {
  id: string;
  name: string;
  anchorId: string;
  position: Vec3;
  target: Vec3;
  fov: number;
  thumbnailAssetId: string;
}
export interface TourStop {
  id: string;
  viewpointId: string;
  hold: number;
  travel: number;
}
export interface Tour {
  id: string;
  name: string;
  stops: TourStop[];
  loop: boolean;
  speed: number;
}
export interface SceneVariable {
  id: string;
  name: string;
  type: "boolean" | "number" | "string";
  initial: Scalar;
}
export type Condition =
  | { type: "all" | "any"; conditions: Condition[] }
  | {
      type: "compare";
      source: "variable" | "runtime";
      key: string;
      operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains";
      value: Scalar;
    };
export interface BehaviorAction {
  id: string;
  type: ActionType;
  targetId: string;
  wait: boolean;
  data: Record<string, JsonValue>;
  condition?: Condition;
  then?: BehaviorAction[];
  else?: BehaviorAction[];
}
export interface Behavior {
  id: string;
  name: string;
  enabled: boolean;
  event: EventType;
  sourceKind: SourceKind;
  sourceId: string;
  once: boolean;
  concurrency: "ignore" | "restart" | "queue";
  condition: Condition;
  actions: BehaviorAction[];
}
export type UiKind =
  | "text"
  | "image"
  | "icon"
  | "shape"
  | "container"
  | "button"
  | "list"
  | "slider"
  | "toggle"
  | "tourControls"
  | "viewpointList"
  | "audioControls"
  | "animationControls"
  | "viewMode"
  | "displayMode"
  | "panoramaControls"
  | "movement"
  | "loading"
  | "entry";
export type UiBreakpoint = "desktop" | "tablet" | "mobile";
export type UiBinding =
  | ""
  | "scene.name"
  | "content.title"
  | "content.body"
  | "content.image"
  | "content.audio"
  | "runtime.viewMode"
  | "runtime.displayMode"
  | "runtime.tourName"
  | "runtime.progress";
export interface UiStyle {
  x: number;
  y: number;
  width: number | string;
  height: number | string;
  rotation: number;
  zIndex: number;
  color: string;
  background: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  textAlign: "left" | "center" | "right";
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  shadow: string;
  opacity: number;
  padding: number;
  gap: number;
  position: "flow" | "absolute";
  layout: "free" | "row" | "column";
  align: "start" | "center" | "end" | "stretch";
  justify: "start" | "center" | "end" | "space-between";
  objectFit: "cover" | "contain";
  overflow: "visible" | "hidden" | "auto";
  anchor:
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right"
    | "center"
    | "stretch";
  animation: "none" | "fade" | "slide" | "pulse";
  hidden: boolean;
}
export interface UiNode {
  id: string;
  name: string;
  kind: UiKind;
  layoutId: string;
  parentId: string | null;
  text: string;
  assetId: string;
  targetId: string;
  binding: UiBinding;
  style: UiStyle;
  tablet: Partial<UiStyle>;
  mobile: Partial<UiStyle>;
  action: BehaviorAction | null;
}
export interface UiLayout {
  id: string;
  name: string;
  scope: "hud" | "content" | "entry" | "loading";
  width: number;
  height: number;
  presentation: "modal" | "sidebar" | "card";
}
export interface UiDocument {
  layouts: UiLayout[];
  nodes: UiNode[];
  theme: {
    accent: string;
    background: string;
    text: string;
    fontFamily: string;
  };
}
export interface SceneDocument {
  documentVersion: 2;
  requiredExtensions: { id: string; version: string }[];
  sceneId: string;
  name: string;
  units: "mm";
  assets: SceneAsset[];
  materials: SceneMaterial[];
  entities: Entity[];
  settings: SceneSettings;
  contents: ContentItem[];
  viewpoints: Viewpoint[];
  tours: Tour[];
  variables: SceneVariable[];
  ui: UiDocument;
  behaviors: Behavior[];
}
export interface DocumentPatch {
  op: "add" | "remove" | "replace";
  path: (string | number)[];
  value?: unknown;
}
export interface ChangeSet {
  sceneReplaced: boolean;
  before: SceneDocument;
  after: SceneDocument;
  entityIds: string[];
  materialIds: string[];
  settingsChanged: boolean;
  behaviorsChanged: boolean;
  assetsChanged: boolean;
  contentChanged: boolean;
  uiChanged: boolean;
  navigationChanged: boolean;
  patches?: DocumentPatch[];
}
export interface Draft {
  sceneId: string;
  revision: number;
  document: SceneDocument;
}
export interface PublishedManifest {
  runtimeBuild: string;
  extensionCatalogHash: string;
  versionId: string;
  publishedAt: string;
  document: SceneDocument;
}
export interface FieldSchema {
  type?: string | string[];
  title?: string;
  default?: JsonValue;
  enum?: string[];
  const?: string | number;
  minimum?: number;
  maximum?: number;
  properties?: Record<string, FieldSchema>;
  items?: FieldSchema;
  required?: string[];
  "x-editor"?: string;
  "x-reference"?: ReferenceKind;
  "x-asset-kind"?: string;
  "x-target-component"?: string;
  "x-unique"?: boolean;
  "x-less-than"?: string;
  "x-required-publish"?: boolean;
  "x-required-when"?: { field: string; value: string };
}
export interface ComponentDefinition {
  type: ComponentType;
  title: string;
  fields: Record<string, FieldSchema>;
}
export interface ActionDefinition {
  type: ActionType;
  title: string;
  fields: Record<string, FieldSchema>;
  target: ReferenceKind | "";
  components: string[];
}
