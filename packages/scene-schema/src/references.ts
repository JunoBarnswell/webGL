import schema from "../scene-document.schema.json";
import { fieldActive } from "./field-rules";
import type { Entity, FieldSchema, JsonValue, SceneDocument } from "./types";

export interface ReferenceSchema {
  $ref?: string;
  oneOf?: ReferenceSchema[];
  properties?: Record<string, ReferenceSchema>;
  items?: ReferenceSchema;
  const?: unknown;
  type?: string | string[];
  [key: string]: unknown;
}
export interface ReferenceIdentity {
  sceneId: string;
  ownerId: string;
  ownerKind: string;
  componentType: string;
  modelRevision: string;
  sourceElementId: string;
  libraryRevision: string;
}
export interface ReferenceEdge extends ReferenceIdentity {
  kind: string;
  id: string;
  path: string;
}
const root = schema as unknown as ReferenceSchema;
export function resolveReferenceSchema(
  raw: ReferenceSchema,
  value?: unknown,
): ReferenceSchema {
  let spec = raw.$ref
    ? raw.$ref === "#"
      ? root
      : (raw.$ref
          .slice(2)
          .split("/")
          .reduce<unknown>(
            (node, key) => (node as Record<string, unknown>)[key],
            schema,
          ) as ReferenceSchema)
    : raw;
  if (spec.oneOf) {
    const matches = spec.oneOf
      .map((s) => resolveReferenceSchema(s))
      .filter((s) => {
        if (s.const !== undefined) return s.const === value;
        if (s.type === "null") return value === null;
        if (value === null || typeof value !== "object") return false;
        return Object.entries(s.properties ?? {}).every(
          ([key, child]) =>
            child.const === undefined ||
            (value as Record<string, unknown>)[key] === child.const,
        );
      });
    const selected =
      matches.find((s) =>
        Object.values(s.properties ?? {}).some((p) => p.const !== undefined),
      ) ?? matches[0];
    if (selected) spec = { ...spec, ...selected, oneOf: undefined };
  }
  return spec;
}
const pointer = (value: string) =>
  value.replaceAll("~", "~0").replaceAll("/", "~1");
const dynamicKind = (value: Record<string, unknown>, key: string): string => {
  if (
    key === "sourceId" &&
    typeof value.sourceKind === "string" &&
    !["scene", "key"].includes(value.sourceKind)
  )
    return value.sourceKind;
  if (key === "key" && value.type === "compare" && value.source === "variable")
    return "variable";
  if (key === "targetId")
    return (
      (
        {
          audioControls: "entity",
          animationControls: "entity",
          panoramaControls: "entity",
          configurator: "entity",
          storyboard: "entity",
          industrial: "entity",
          viewpointList: "viewpoint",
          tourControls: "tour",
        } as Record<string, string>
      )[String(value.kind)] ?? ""
    );
  return "";
};
interface WalkOptions {
  activeOnly: boolean;
  identity: ReferenceIdentity;
  path: string;
  parent?: Record<string, unknown>;
  key?: string;
}
function visitReferences(
  value: unknown,
  raw: ReferenceSchema,
  options: WalkOptions,
  visit: (edge: ReferenceEdge) => string,
): unknown {
  const spec = resolveReferenceSchema(raw, value);
  // Local source snapshots and binding tables are checked by their own compiler context.
  if (spec["x-reference-scope"] === "local")
    return options.activeOnly || value === undefined
      ? value
      : JSON.parse(JSON.stringify(value));
  const kind =
    typeof spec["x-reference"] === "string"
      ? spec["x-reference"]
      : options.parent && options.key
        ? dynamicKind(options.parent, options.key)
        : "";
  if (typeof value === "string" && value && kind)
    return visit({ ...options.identity, kind, id: value, path: options.path });
  if (Array.isArray(value)) {
    const walk = (item: unknown, index: number) =>
      visitReferences(
        item,
        spec.items ?? {},
        {
          ...options,
          path: options.path + "/" + index,
          parent: undefined,
          key: undefined,
        },
        visit,
      );
    if (options.activeOnly) {
      value.forEach(walk);
      return value;
    }
    return value.map(walk);
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    const identity = { ...options.identity };
    if (
      typeof object.id === "string" &&
      /^\/(entities|materials|behaviors|contents|viewpoints|tours|ui\/nodes)\/\d+$/.test(
        options.path,
      )
    ) {
      identity.ownerId = object.id;
      identity.ownerKind = options.path.split("/")[1];
      identity.componentType = "";
      if (identity.ownerKind === "entities") {
        const binding = (object as unknown as Entity).components.find(
          (c) => c.enabled && c.type === "ModelNode",
        );
        identity.modelRevision = String(binding?.data.meshRevision ?? "");
        identity.sourceElementId = String(binding?.data.sourceElementId ?? "");
      }
    }
    if (
      typeof object.type === "string" &&
      /\/components\/\d+$/.test(options.path)
    )
      identity.componentType = object.type;
    const walk = ([key, child]: [string, unknown]): [string, unknown] => {
      const childSpec = spec.properties?.[key] ?? {};
      if (
        options.activeOnly &&
        !fieldActive(
          childSpec as FieldSchema,
          object as Record<string, JsonValue>,
        )
      )
        return [key, child];
      return [
        key,
        visitReferences(
          child,
          childSpec,
          {
            ...options,
            identity,
            path: options.path + "/" + pointer(key),
            parent: object,
            key,
          },
          visit,
        ),
      ];
    };
    if (options.activeOnly) {
      Object.entries(object).forEach(walk);
      return object;
    }
    return Object.fromEntries(Object.entries(object).map(walk));
  }
  return value;
}
function identityFor(document: SceneDocument): ReferenceIdentity {
  return {
    sceneId: document.sceneId,
    ownerId: "",
    ownerKind: "scene",
    componentType: "",
    modelRevision: "",
    sourceElementId: "",
    libraryRevision: "",
  };
}
/** Canonical active reference graph: used by validation, planning and publication. */
export function documentReferenceEdges(
  document: SceneDocument,
): ReferenceEdge[] {
  const edges: ReferenceEdge[] = [];
  visitReferences(
    document,
    root,
    { activeOnly: true, path: "", identity: identityFor(document) },
    (edge) => {
      edges.push(edge);
      return edge.id;
    },
  );
  const ownership = new Map(
    (document.prefabs ?? []).flatMap((instance) =>
      Object.values(instance.bindings.entity ?? {}).map(
        (id) => [id, instance.revisionId] as const,
      ),
    ),
  );
  for (const edge of edges)
    if (edge.ownerKind === "entities")
      edge.libraryRevision = ownership.get(edge.ownerId) ?? "";
  return edges;
}
export function entityReferenceEdges(entity: Entity): ReferenceEdge[] {
  const edges: ReferenceEdge[] = [];
  visitReferences(
    entity,
    root.properties!.entities.items!,
    {
      activeOnly: true,
      path: "/entities/0",
      identity: {
        sceneId: "",
        ownerId: entity.id,
        ownerKind: "entities",
        componentType: "",
        modelRevision: "",
        sourceElementId: "",
        libraryRevision: "",
      },
    },
    (edge) => {
      edges.push(edge);
      return edge.id;
    },
  );
  return edges;
}
/** Remapping visits the same contract, including dormant fields, without touching local snapshots. */
export function remapSceneReferences(
  value: unknown,
  raw: ReferenceSchema,
  bindings: Record<string, Record<string, string>>,
): unknown {
  return visitReferences(
    value,
    raw,
    {
      activeOnly: false,
      path: "",
      identity: {
        sceneId: "",
        ownerId: "",
        ownerKind: "",
        componentType: "",
        modelRevision: "",
        sourceElementId: "",
        libraryRevision: "",
      },
    },
    (edge) => bindings[edge.kind]?.[edge.id] ?? edge.id,
  );
}
export function rewriteDocumentReferences(
  document: SceneDocument,
  bindings: Record<string, Record<string, string>>,
): SceneDocument {
  return remapSceneReferences(document, root, bindings) as SceneDocument;
}
