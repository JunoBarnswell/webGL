import Ajv from 'ajv';
import schema from '../scene-document.schema.json';
import type { ActionType, BehaviorAction, ComponentDefinition, ComponentType, Entity, FieldSchema, JsonValue, SceneComponent, SceneDocument, SceneMaterial, SceneSettings } from './types';
export type * from './types';
export { schema as documentSchema };

const ajv = new Ajv({ allErrors: true, strict: false });
const validateShape = ajv.compile(schema);
export const componentDefinitions: ComponentDefinition[] = schema.$defs.component.oneOf.map(item => ({
  type: item.properties.type.const as ComponentType,
  title: item.title,
  fields: item.properties.data.properties as unknown as Record<string, FieldSchema>
}));
export const actionDefinitions = schema.$defs.action.oneOf.map(item => ({ type: item.properties.type.const as ActionType, title: item.title, fields: item.properties.data.properties as unknown as Record<string, FieldSchema> }));
export const materialFields = schema.$defs.material.properties as unknown as Record<string, FieldSchema>;
export const settingFields = schema.$defs.settings.properties as unknown as Record<string, FieldSchema>;

export function fieldDefaults(fields: Record<string, FieldSchema>): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, structuredClone(field.default ?? (field.properties ? fieldDefaults(field.properties) : null))]));
}

export function createComponent(type: ComponentType): SceneComponent {
  const definition = componentDefinitions.find(item => item.type === type);
  if (!definition) throw new Error(`未知组件 ${type}`);
  return { type, enabled: true, data: fieldDefaults(definition.fields) };
}

export function createAction(type: ActionType): BehaviorAction {
  const definition = actionDefinitions.find(item => item.type === type);
  if (!definition) throw new Error(`未知动作 ${type}`);
  return { type, targetId: '', data: fieldDefaults(definition.fields) };
}

export function createMaterial(name = '材质'): SceneMaterial {
  return { ...fieldDefaults(materialFields), id: crypto.randomUUID(), name } as unknown as SceneMaterial;
}

export function createEntity(name = '节点', parentId: string | null = null): Entity {
  return { id: crypto.randomUUID(), name, parentId, visible: true, locked: false, transform: { position: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1] }, components: [], legacyUuid: '' };
}

export function createDocument(name = '未命名场景'): SceneDocument {
  return { schemaVersion: 1, sceneId: crypto.randomUUID(), name, units: 'mm', assets: [], entities: [], materials: [], behaviors: [], settings: fieldDefaults(settingFields) as unknown as SceneSettings };
}

export function getComponent(entity: Entity, type: ComponentType): SceneComponent | undefined {
  return entity.components.find(component => component.type === type && component.enabled);
}

function fieldReferences(value: JsonValue | undefined, field: FieldSchema, visit: (kind: string, id: string) => void): void {
  if (typeof value === 'string' && field['x-reference'] && value) visit(field['x-reference'], value);
  if (Array.isArray(value) && field.items) value.forEach(item => fieldReferences(item, field.items!, visit));
  if (value && !Array.isArray(value) && typeof value === 'object' && field.properties) {
    for (const [key, nested] of Object.entries(field.properties)) fieldReferences(value[key], nested, visit);
  }
}

export function documentReferences(document: SceneDocument): { kind: string; id: string }[] {
  const references: { kind: string; id: string }[] = [];
  const visit = (kind: string, id: string) => references.push({ kind, id });
  for (const entity of document.entities) for (const component of entity.components) {
    const definition = componentDefinitions.find(item => item.type === component.type);
    if (definition) for (const [key, field] of Object.entries(definition.fields)) fieldReferences(component.data[key], field, visit);
  }
  for (const material of document.materials) fieldReferences(material as unknown as JsonValue, schema.$defs.material as unknown as FieldSchema, visit);
  for (const behavior of document.behaviors) {
    if (behavior.sourceId) visit('entity', behavior.sourceId);
    for (const action of behavior.actions) {
      if (action.targetId) visit('entity', action.targetId);
      const definition = actionDefinitions.find(item => item.type === action.type);
      if (definition) for (const [key, field] of Object.entries(definition.fields)) fieldReferences(action.data[key], field, visit);
    }
  }
  return references;
}

export function validateDocument(value: unknown, forPublish = false): string[] {
  if (!validateShape(value)) return (validateShape.errors ?? []).slice(0, 20).map(error => `${error.instancePath || '/'} ${error.message}`);
  const document = value as SceneDocument;
  const errors: string[] = [];
  const groups = { entity: document.entities, asset: document.assets, material: document.materials, behavior: document.behaviors };
  const sets = Object.fromEntries(Object.entries(groups).map(([kind, items]) => [kind, new Set(items.map(item => item.id))]));
  for (const [kind, items] of Object.entries(groups)) {
    if (sets[kind].size !== items.length) errors.push(`${kind} ID 重复`);
    if (items.some(item => !/^[a-zA-Z0-9_-]{1,100}$/.test(item.id))) errors.push(`${kind} ID 非法`);
  }
  const entities = new Map(document.entities.map(entity => [entity.id, entity]));
  for (const entity of document.entities) {
    if (entity.parentId && !entities.has(entity.parentId)) errors.push(`${entity.name} 的父节点不存在`);
    const visited = new Set<string>();
    let cursor: Entity | undefined = entity;
    while (cursor) {
      if (visited.has(cursor.id)) { errors.push(`${entity.name} 存在层级环`); break; }
      visited.add(cursor.id); cursor = cursor.parentId ? entities.get(cursor.parentId) : undefined;
    }
    if (new Set(entity.components.map(item => item.type)).size !== entity.components.length) errors.push(`${entity.name} 存在重复组件`);
    const q = entity.transform.rotation;
    if (Math.abs(q.reduce((sum, n) => sum + n*n, 0) - 1) > 0.001) errors.push(`${entity.name} 四元数未归一化`);
    if (entity.transform.scale.some(n => Math.abs(n) < 0.000001)) errors.push(`${entity.name} 缩放不可为零`);
    for (const component of entity.components) {
      if (forPublish && component.enabled && ['Mesh','Model','Avatar','Audio','Artwork'].includes(component.type) && !component.data.assetId) errors.push(`${entity.name}/${component.type} 尚未指定资源`);
      if (component.type === 'ModelNode' && !entities.get(String(component.data.modelEntityId))?.components.some(item => item.type === 'Model')) errors.push(`${entity.name} 的模型实例引用无效`);
      if (component.type === 'Animation' && forPublish && component.enabled && (!component.data.clip || !entities.get(String(component.data.modelEntityId))?.components.some(item => item.type === 'Model'))) errors.push(`${entity.name} 的动画配置不完整`);
    }
  }
  for (const reference of documentReferences(document)) if (!sets[reference.kind]?.has(reference.id)) errors.push(`无效的 ${reference.kind} 引用 ${reference.id}`);
  for (const asset of document.assets) {
    if (!asset.files.includes(asset.entry)) errors.push(`${asset.name} 入口不在资源包中`);
    if (asset.files.some(path => path.startsWith('/') || path.includes('\\') || path.split('/').some(part => part === '..' || part === '.' || !part))) errors.push(`${asset.name} 包含非法文件路径`);
  }
  if (document.settings.near >= document.settings.far) errors.push('相机远裁剪面必须大于近裁剪面');
  if (forPublish) for (const behavior of document.behaviors) {
    if (behavior.event !== 'ready' && !behavior.sourceId) errors.push(`${behavior.name} 尚未指定事件源`);
    for (const action of behavior.actions) if (!['DisplayMode','ViewMode','OpenInfo'].includes(action.type) && !action.targetId) errors.push(`${behavior.name}/${action.type} 尚未指定目标`);
  }
  return [...new Set(errors)];
}

export function assertDocument(value: unknown, forPublish = false): asserts value is SceneDocument {
  const errors = validateDocument(value, forPublish);
  if (errors.length) throw new Error(errors.join('\n'));
}
