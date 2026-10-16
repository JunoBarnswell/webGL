import { fieldActive } from "./field-rules";
export { fieldActive, editField } from "./field-rules";
import { validateSemanticComponents } from "./semantic-validation";
import Ajv from "ajv";
import schema from "../scene-document.schema.json";
import { createUiDocument } from "./ui";
import {
  experienceReferences,
  validateExperience,
  walkActions,
} from "./experience-validation";
import type {
  ActionDefinition,
  Behavior,
  ActionType,
  BehaviorAction,
  ComponentDefinition,
  ComponentType,
  Entity,
  FieldSchema,
  JsonValue,
  SceneComponent,
  SceneDocument,
  SceneMaterial,
  SceneSettings,
} from "./types";
export type * from "./types";
export * from "./extensions";
import { extensionErrors, requiredExtension } from "./extensions";
export * from "./ui";
export { walkActions, conditionReferences } from "./experience-validation";
export { schema as documentSchema };

const ajv = new Ajv({ allErrors: true, strict: false });
const validateShape = ajv.compile(schema);
export const componentDefinitions: ComponentDefinition[] =
  schema.$defs.component.oneOf
    .filter((item) => "const" in item.properties.type)
    .map((item) => ({
      type: item.properties.type.const as ComponentType,
      title: item.title,
      anchor: Boolean(
        (item as unknown as { "x-anchor"?: boolean })["x-anchor"],
      ),
      fields: item.properties.data.properties as unknown as Record<
        string,
        FieldSchema
      >,
    }));
export const actionDefinitions: ActionDefinition[] = schema.$defs.action.oneOf
  .filter((item) => "const" in item.properties.type)
  .map((item) => ({
    type: item.properties.type.const as ActionType,
    title: item.title,
    fields: item.properties.data.properties as unknown as Record<
      string,
      FieldSchema
    >,
    target: item["x-target"] as ActionDefinition["target"],
    components: item["x-components"],
  }));
export const materialFields = schema.$defs.material
  .properties as unknown as Record<string, FieldSchema>;
export const settingFields = schema.$defs.settings
  .properties as unknown as Record<string, FieldSchema>;

export function fieldDefaults(
  fields: Record<string, FieldSchema>,
): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [
      key,
      structuredClone(
        field["x-editor"] === "uuid"
          ? crypto.randomUUID()
          : (field.default ??
              (field.properties ? fieldDefaults(field.properties) : null)),
      ),
    ]),
  );
}

export function createComponent(type: ComponentType): SceneComponent {
  const definition = componentDefinitions.find((item) => item.type === type);
  if (!definition) throw new Error(`未知组件 ${type}`);
  return { type, enabled: true, data: fieldDefaults(definition.fields) };
}

export function createAction(type: ActionType): BehaviorAction {
  const definition = actionDefinitions.find((item) => item.type === type);
  if (!definition) throw new Error(`未知动作 ${type}`);
  return {
    id: crypto.randomUUID(),
    type,
    targetId: "",
    wait: type === "FlyTo",
    data: fieldDefaults(definition.fields),
    ...(type === "If"
      ? {
          condition: { type: "all" as const, conditions: [] },
          then: [],
          else: [],
        }
      : {}),
  };
}

export function createMaterial(name = "材质"): SceneMaterial {
  return {
    ...fieldDefaults(materialFields),
    id: crypto.randomUUID(),
    name,
  } as unknown as SceneMaterial;
}

export function createEntity(
  name = "节点",
  parentId: string | null = null,
): Entity {
  return {
    id: crypto.randomUUID(),
    name,
    parentId,
    visible: true,
    locked: false,
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
    components: [],
    legacyUuid: "",
  };
}

export function createDocument(name = "未命名场景"): SceneDocument {
  return {
    documentVersion: 2,
    requiredExtensions: [],
    contents: [],
    viewpoints: [],
    tours: [],
    variables: [],
    ui: createUiDocument(),
    sceneId: crypto.randomUUID(),
    name,
    units: "mm",
    assets: [],
    entities: [],
    materials: [],
    behaviors: [],
    settings: fieldDefaults(settingFields) as unknown as SceneSettings,
  };
}

export function getComponent(
  entity: Entity,
  type: ComponentType,
): SceneComponent | undefined {
  return entity.components.find(
    (component) => component.type === type && component.enabled,
  );
}

function fieldReferences(
  value: JsonValue | undefined,
  field: FieldSchema,
  visit: (kind: string, id: string) => void,
): void {
  if (typeof value === "string" && field["x-reference"] && value)
    visit(field["x-reference"], value);
  if (Array.isArray(value) && field.items)
    value.forEach((item) => fieldReferences(item, field.items!, visit));
  if (
    value &&
    !Array.isArray(value) &&
    typeof value === "object" &&
    field.properties
  ) {
    for (const [key, nested] of Object.entries(field.properties))
      fieldReferences(value[key], nested, visit);
  }
}

export function entityReferences(
  entity: Entity,
): { kind: string; id: string }[] {
  const references: { kind: string; id: string }[] = [];
  for (const component of entity.components) {
    const definition = componentDefinitions.find(
      (d) => d.type === component.type,
    );
    for (const [key, field] of Object.entries(definition?.fields ?? {}))
      if (fieldActive(field, component.data))
        fieldReferences(component.data[key], field, (kind, id) =>
          references.push({ kind, id }),
        );
  }
  return references;
}

export function documentReferences(
  document: SceneDocument,
): { kind: string; id: string }[] {
  const references: { kind: string; id: string }[] = [];
  const visit = (kind: string, id: string) => references.push({ kind, id });
  for (const entity of document.entities)
    references.push(...entityReferences(entity));
  const action = (a: BehaviorAction) => {
    const definition = actionDefinitions.find((d) => d.type === a.type);
    for (const [key, field] of Object.entries(definition?.fields ?? {}))
      fieldReferences(a.data[key], field, visit);
  };
  for (const behavior of document.behaviors)
    walkActions(behavior.actions, action);
  for (const node of document.ui.nodes)
    if (node.action) walkActions([node.action], action);
  fieldReferences(
    document.settings as unknown as JsonValue,
    schema.$defs.settings as unknown as FieldSchema,
    visit,
  );
  for (const material of document.materials)
    fieldReferences(
      material as unknown as JsonValue,
      schema.$defs.material as unknown as FieldSchema,
      visit,
    );
  experienceReferences(document, actionDefinitions, visit);
  return references;
}

export function validateDocument(value: unknown, forPublish = false): string[] {
  if (!validateShape(value))
    return (validateShape.errors ?? [])
      .slice(0, 20)
      .map((error) => `${error.instancePath || "/"} ${error.message}`);
  const document = value as unknown as SceneDocument;
  const errors: string[] = forPublish ? extensionErrors(document) : [];
  for (const entity of document.entities)
    for (const component of entity.components) {
      const requirement = requiredExtension(component.type);
      if (
        forPublish &&
        (!componentDefinitions.some((d) => d.type === component.type) ||
          (requirement &&
            !document.requiredExtensions.some((e) => e.id === requirement.id)))
      )
        errors.push("未声明或缺失组件扩展 " + component.type);
    }
  const groups = {
    entity: document.entities,
    asset: document.assets,
    material: document.materials,
    behavior: document.behaviors,
    content: document.contents,
    viewpoint: document.viewpoints,
    tour: document.tours,
    variable: document.variables,
    ui: document.ui.nodes,
    layout: document.ui.layouts,
  };
  const sets = Object.fromEntries(
    Object.entries(groups).map(([kind, items]) => [
      kind,
      new Set(items.map((item) => item.id)),
    ]),
  );
  for (const [kind, items] of Object.entries(groups)) {
    if (sets[kind].size !== items.length) errors.push(`${kind} ID 重复`);
    if (items.some((item) => !/^[a-zA-Z0-9_-]{1,100}$/.test(item.id)))
      errors.push(`${kind} ID 非法`);
  }
  const entities = new Map(
    document.entities.map((entity) => [entity.id, entity]),
  );
  for (const entity of document.entities) {
    if (entity.parentId && !entities.has(entity.parentId))
      errors.push(`${entity.name} 的父节点不存在`);
    const visited = new Set<string>();
    let cursor: Entity | undefined = entity;
    while (cursor) {
      if (visited.has(cursor.id)) {
        errors.push(`${entity.name} 存在层级环`);
        break;
      }
      visited.add(cursor.id);
      cursor = cursor.parentId ? entities.get(cursor.parentId) : undefined;
    }
    if (
      new Set(entity.components.map((item) => item.type)).size !==
      entity.components.length
    )
      errors.push(`${entity.name} 存在重复组件`);
    const q = entity.transform.rotation;
    if (Math.abs(q.reduce((sum, n) => sum + n * n, 0) - 1) > 0.001)
      errors.push(`${entity.name} 四元数未归一化`);
    if (entity.transform.scale.some((n) => Math.abs(n) < 0.000001))
      errors.push(`${entity.name} 缩放不可为零`);
    for (const component of entity.components) {
      if (
        forPublish &&
        component.enabled &&
        ["Mesh", "Model", "Avatar", "Audio"].includes(component.type) &&
        !component.data.assetId
      )
        errors.push(`${entity.name}/${component.type} 尚未指定资源`);
      if (component.type === "ModelNode" && !component.enabled)
        errors.push(entity.name + " 模型子节点身份不可禁用，请使用节点可见性");
      if (
        component.type === "ModelNode" &&
        !entities
          .get(String(component.data.modelEntityId))
          ?.components.some((item) => item.type === "Model" && item.enabled)
      )
        errors.push(entity.name + " 所属模型必须启用");
      if (
        component.type === "ModelNode" &&
        !entities
          .get(String(component.data.modelEntityId))
          ?.components.some((item) => item.type === "Model")
      )
        errors.push(`${entity.name} 的模型实例引用无效`);
      if (
        component.type === "Animation" &&
        forPublish &&
        component.enabled &&
        (!component.data.clip ||
          !entities
            .get(String(component.data.modelEntityId))
            ?.components.some((item) => item.type === "Model" && item.enabled))
      )
        errors.push(`${entity.name} 的动画配置不完整`);
    }
  }
  for (const reference of documentReferences(document))
    if (!sets[reference.kind]?.has(reference.id))
      errors.push(`无效的 ${reference.kind} 引用 ${reference.id}`);
  for (const asset of document.assets) {
    if (!asset.files.includes(asset.entry))
      errors.push(`${asset.name} 入口不在资源包中`);
    if (
      asset.files.some(
        (path) =>
          path.startsWith("/") ||
          path.includes("\\") ||
          path
            .split("/")
            .some((part) => part === ".." || part === "." || !part),
      )
    )
      errors.push(`${asset.name} 包含非法文件路径`);
  }
  for (const entity of document.entities) {
    const renderers = entity.components.filter((c) =>
      ["Mesh", "Model", "ModelNode", "Avatar"].includes(c.type),
    );
    if (renderers.length > 1)
      errors.push(entity.name + " 只能有一个几何/模型/角色组件");
    const binding = entity.components.find((c) => c.type === "ModelNode");
    if (binding) {
      const modelId = String(binding.data.modelEntityId);
      const parent = entities.get(entity.parentId ?? "");
      const parentBinding = parent?.components.find(
        (c) => c.type === "ModelNode",
      );
      if (
        entity.parentId !== modelId &&
        String(parentBinding?.data.modelEntityId ?? "") !== modelId
      )
        errors.push(entity.name + " 必须属于同一模型实例的层级");
    }
    for (const component of entity.components) {
      const kind = (
        {
          Mesh: "mesh",
          Model: "model",
          Avatar: "model",
          Audio: "audio",
        } as Record<string, string>
      )[component.type];
      const asset = document.assets.find(
        (a) => a.id === component.data.assetId,
      );
      if (
        kind &&
        asset &&
        asset.kind !== kind &&
        !(kind === "image" && asset.kind === "texture")
      )
        errors.push(entity.name + "/" + component.type + " 资源类型不匹配");
    }
  }
  const bindings = document.entities.flatMap((e) =>
    e.components
      .filter(
        (c) => c.type === "ModelNode" && c.data.sourceStatus !== "unresolved",
      )
      .map(
        (c) => String(c.data.modelEntityId) + ":" + String(c.data.nodeIndex),
      ),
  );
  if (new Set(bindings).size !== bindings.length)
    errors.push("模型子节点索引重复绑定");
  if (
    ![0, 6].includes(document.settings.environmentAssetIds.length) ||
    document.materials.some((m) => ![0, 6].includes(m.envAssetIds.length))
  )
    errors.push("环境立方体必须提供完整六面资源");
  if (document.settings.near >= document.settings.far)
    errors.push("相机远裁剪面必须大于近裁剪面");
  errors.push(
    ...validateSemanticComponents(document, componentDefinitions, forPublish),
  );
  errors.push(...validateExperience(document, actionDefinitions, forPublish));
  return [...new Set(errors)];
}

export function assertDocument(
  value: unknown,
  forPublish = false,
): asserts value is SceneDocument {
  const errors = validateDocument(value, forPublish);
  if (errors.length) throw new Error(errors.join("\n"));
}

export function createBehavior(name = "新交互"): Behavior {
  return {
    id: crypto.randomUUID(),
    name,
    enabled: true,
    event: "click",
    sourceKind: "entity",
    sourceId: "",
    once: false,
    concurrency: "ignore",
    condition: { type: "all", conditions: [] },
    actions: [],
  };
}

export * from "./model-identity";

export { fieldOptions } from "./field-options";
