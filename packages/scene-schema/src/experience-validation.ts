import type {
  ActionDefinition,
  BehaviorAction,
  Condition,
  SceneDocument,
} from "./types";

export function walkActions(
  actions: BehaviorAction[],
  visit: (action: BehaviorAction) => void,
): void {
  for (const action of actions) {
    visit(action);
    if (action.then) walkActions(action.then, visit);
    if (action.else) walkActions(action.else, visit);
  }
}
export function conditionReferences(
  condition: Condition,
  visit: (kind: string, id: string) => void,
): void {
  if (condition.type === "compare") {
    if (condition.source === "variable" && condition.key)
      visit("variable", condition.key);
  } else
    condition.conditions.forEach((child) => conditionReferences(child, visit));
}
export function experienceReferences(
  doc: SceneDocument,
  definitions: ActionDefinition[],
  visit: (kind: string, id: string) => void,
): void {
  const reference = (kind: string, id: string | null) => {
    if (id) visit(kind, id);
  };
  for (const c of doc.contents) {
    reference("asset", c.imageAssetId);
    reference("entity", c.audioEntityId);
    reference("layout", c.layoutId);
  }
  for (const v of doc.viewpoints) {
    reference("entity", v.anchorId);
    reference("asset", v.thumbnailAssetId);
  }
  for (const t of doc.tours)
    for (const stop of t.stops) reference("viewpoint", stop.viewpointId);
  const action = (a: BehaviorAction) => {
    const definition = definitions.find((d) => d.type === a.type);
    if (definition?.target) reference(definition.target, a.targetId);
    if (a.condition) conditionReferences(a.condition, visit);
  };
  for (const b of doc.behaviors) {
    if (!["scene", "key"].includes(b.sourceKind))
      reference(b.sourceKind, b.sourceId);
    conditionReferences(b.condition, visit);
    walkActions(b.actions, action);
  }
  for (const node of doc.ui.nodes) {
    reference("layout", node.layoutId);
    reference("ui", node.parentId);
    reference("asset", node.assetId);
    if (node.action) walkActions([node.action], action);
    const kind = (
      {
        tourControls: "tour",
        viewpointList: "viewpoint",
        audioControls: "entity",
        animationControls: "entity",
        panoramaControls: "entity",
      } as Record<string, string>
    )[node.kind];
    if (kind) reference(kind, node.targetId);
  }
}
export function validateExperience(
  doc: SceneDocument,
  definitions: ActionDefinition[],
  publish: boolean,
): string[] {
  const errors: string[] = [];
  const entities = new Map(doc.entities.map((e) => [e.id, e])),
    nodes = new Map(doc.ui.nodes.map((n) => [n.id, n]));
  for (const c of doc.contents) {
    const image = doc.assets.find((a) => a.id === c.imageAssetId);
    if (image && !["image", "texture"].includes(image.kind))
      errors.push(c.name + " 图片类型不匹配");
    if (
      c.audioEntityId &&
      !entities
        .get(c.audioEntityId)
        ?.components.some((a) => a.type === "Audio" && a.enabled)
    )
      errors.push(c.name + " 解说音频引用无效");
    if (
      !doc.ui.layouts.some((l) => l.id === c.layoutId && l.scope === "content")
    )
      errors.push(c.name + " 内容版式无效");
  }
  for (const entity of doc.entities) {
    const artwork = entity.components.find(
      (c) => c.type === "Artwork" && c.enabled,
    );
    if (
      publish &&
      artwork &&
      !doc.contents.find((c) => c.id === artwork.data.contentId)?.imageAssetId
    )
      errors.push(entity.name + " 作品图片未配置");
  }
  if (publish)
    for (const material of doc.materials)
      for (const binding of Object.values(material.maps))
        if (!binding.assetId) errors.push(material.name + " 贴图尚未绑定资源");
  for (const view of doc.viewpoints) {
    const asset = doc.assets.find((a) => a.id === view.thumbnailAssetId);
    if (asset && !["image", "texture"].includes(asset.kind))
      errors.push(view.name + " 缩略图类型不匹配");
  }
  for (const t of doc.tours) {
    if (new Set(t.stops.map((s) => s.id)).size !== t.stops.length)
      errors.push(t.name + " 停靠点 ID 重复");
    if (publish && t.stops.length < 2)
      errors.push(t.name + " 至少需要两个视点");
  }
  for (const v of doc.variables)
    if (typeof v.initial !== v.type) errors.push(v.name + " 初始值类型不匹配");
  for (const node of doc.ui.nodes) {
    const image = doc.assets.find((a) => a.id === node.assetId);
    if (
      node.kind === "image" &&
      image &&
      !["image", "texture"].includes(image.kind)
    )
      errors.push(node.name + " 界面图片类型不匹配");
    if (
      publish &&
      node.kind === "image" &&
      node.binding !== "content.image" &&
      !node.assetId
    )
      errors.push(node.name + " 界面图片尚未绑定资源");
    let cursor: typeof node | undefined = node;
    const seen = new Set<string>();
    while (cursor) {
      if (seen.has(cursor.id)) {
        errors.push(node.name + " 界面层级存在环");
        break;
      }
      seen.add(cursor.id);
      if (cursor.layoutId !== node.layoutId) {
        errors.push(node.name + " 跨版式挂载");
        break;
      }
      cursor = cursor.parentId ? nodes.get(cursor.parentId) : undefined;
    }
    for (const style of [node.style, node.tablet, node.mobile])
      for (const key of ["width", "height"] as const) {
        const value = style[key];
        if (
          value !== undefined &&
          (typeof value === "number"
            ? value <= 0
            : !/^(auto|fill|hug|\d+(\.\d+)?%)$/.test(value))
        )
          errors.push(node.name + " 界面尺寸无效");
      }
  }
  const checkCondition = (condition: Condition, depth = 0): void => {
    if (depth > 12) {
      errors.push("条件嵌套超过 12 层");
      return;
    }
    if (condition.type !== "compare")
      condition.conditions.forEach((c) => checkCondition(c, depth + 1));
    else if (
      condition.source === "runtime" &&
      !["viewMode", "displayMode", "tour.status", "contentId"].includes(
        condition.key,
      )
    )
      errors.push("未知的运行状态字段 " + condition.key);
  };
  const checkActions = (actions: BehaviorAction[], depth = 0): void => {
    if (depth > 12) {
      errors.push("动作分支嵌套超过 12 层");
      return;
    }
    for (const a of actions) {
      const def = definitions.find((d) => d.type === a.type);
      if (!def) {
        if (publish) errors.push("未知动作 " + a.type);
        continue;
      }
      if (publish && def.target && !a.targetId)
        errors.push(def.title + " 未指定目标");
      if (
        a.targetId &&
        def.components.length &&
        !entities
          .get(a.targetId)
          ?.components.some((c) => c.enabled && def.components.includes(c.type))
      )
        errors.push(def.title + " 目标能力不匹配");
      if (
        a.wait &&
        ((a.type === "PlayAnimation" && a.data.loop) ||
          (["StartCruise", "ReplayCruise"].includes(a.type) &&
            doc.tours.find((t) => t.id === a.targetId)?.loop) ||
          (a.type === "PlayAudio" &&
            entities
              .get(a.targetId)
              ?.components.some((c) => c.type === "Audio" && c.data.loop)))
      )
        errors.push(def.title + " 循环动作不能等待自然完成");
      if (a.type === "SetVariable") {
        const variable = doc.variables.find((v) => v.id === a.targetId);
        if (variable && typeof a.data.value !== variable.type)
          errors.push("设置变量的值类型不匹配");
      }
      if (a.condition) checkCondition(a.condition);
      if (a.then) checkActions(a.then, depth + 1);
      if (a.else) checkActions(a.else, depth + 1);
    }
  };
  const eventKinds: Record<string, string> = {
    click: "entity",
    hover: "entity",
    enter: "entity",
    leave: "entity",
    ready: "scene",
    animationEnd: "entity",
    mediaEnd: "entity",
    viewpointArrive: "viewpoint",
    tourEnd: "tour",
    variableChange: "variable",
    uiClick: "ui",
    uiChange: "ui",
    key: "key",
  };
  for (const b of doc.behaviors) {
    if (eventKinds[b.event] !== b.sourceKind)
      errors.push(b.name + " 事件来源类型不匹配");
    checkCondition(b.condition);
    checkActions(b.actions);
    if (
      publish &&
      b.enabled &&
      (!b.actions.length || (b.event !== "ready" && !b.sourceId))
    )
      errors.push(b.name + " 规则未配置完整");
  }
  for (const node of doc.ui.nodes) {
    const capability = (
      {
        audioControls: "Audio",
        animationControls: "Animation",
        panoramaControls: "Panorama",
      } as Record<string, string>
    )[node.kind];
    if (
      capability &&
      node.targetId &&
      !entities
        .get(node.targetId)
        ?.components.some((c) => c.enabled && c.type === capability)
    )
      errors.push(node.name + " 控制对象能力不匹配");
    if (node.action) checkActions([node.action]);
  }
  return errors;
}
