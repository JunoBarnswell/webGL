import { editablePoint } from "../shell/DocumentPoint";
import { useEffect, useRef } from "react";
import { commands } from "../shell/commands";
import { prepareModel } from "../panels/Resources";
import { ProjectNavigation } from "../../../../packages/extensions/virtual-tour/navigation";
import { useRuntime } from "@studio/player-ui";
import {
  documentDefinitions,
  componentDefinitions,
  type JsonValue,
} from "@studio/scene-schema";
import {
  extensionPanels,
  extensionCommands,
} from "../../../../packages/extensions/editor";
import type { ExtensionPanelProps } from "../../../../packages/extensions/editor-contract";
import { SceneTree } from "../panels/SceneTree";
import { ContentPanel } from "../panels/ContentPanel";
import { TourPanel } from "../panels/TourPanel";
import { Interactions } from "../panels/Interactions";
import { ReferenceAssets } from "../components/ReferencePicker";
import { Fields } from "../components/Fields";
import { useStudio } from "../state/studio";
import { persistDocumentDraft, recoverDocumentDraft } from "../state/journal";
import { request, upload, authHeaders, saveBlob } from "../state/api";
export const workspaceCatalog = [
  {
    id: "scene",
    title: "场景搭建",
    description: "搭建空间与外观",
    icon: "◈",
    Sidebar: SceneTree,
  },
  {
    id: "content",
    title: "热点内容",
    description: "作品与介绍",
    icon: "◉",
    Sidebar: ContentPanel,
  },
  {
    id: "tour",
    title: "导览巡航",
    description: "记录镜头与路线",
    icon: "⌁",
    Sidebar: TourPanel,
  },
  {
    id: "interaction",
    title: "事件交互",
    description: "当…如果…就…",
    icon: "⚡",
    Sidebar: Interactions,
  },
  {
    id: "interface",
    title: "界面设计",
    description: "设计 Player 界面",
    icon: "▦",
    Sidebar: SceneTree,
  },
  ...extensionPanels
    .filter((p) => p.workspace)
    .map((p) => ({ ...p.workspace!, Sidebar: SceneTree })),
];
export function useExtensionProps(): ExtensionPanelProps | null {
  const runtime = useStudio((s) => s.runtime),
    state = useRuntime(runtime),
    document = useStudio((s) => s.document),
    selectedIds = useStudio((s) => s.selected),
    mode = useStudio((s) => s.mode),
    projectId = useStudio((s) => s.projectId),
    activeTool = useStudio((s) => s.domainTool);
  if (!document) return null;
  const studio = useStudio.getState();
  return {
    runtime,
    state,
    document,
    selectedIds,
    mode,
    command: studio.command,
    select: (ids) => studio.select(ids),
    focus: (ids) => studio.view?.focus(ids),
    dispatch: async (action) => {
      await studio.runtime?.dispatch(action);
    },
    placeAnchor: (id) => studio.set({ placingAnnotation: id }),
    inspect: (id) => {
      studio.select([id]);
      studio.set({ inspectorOpen: true });
    },
    services: {
      projectId,
      activeTool,
      activateTool: (id) => studio.set({ domainTool: id }),
      dragPrefab: (revision) => studio.set({ draggingPrefab: revision }),
      downloadFile: (name, value) => saveBlob(value, name),
      downloadJson: (name, value) =>
        saveBlob(
          new Blob([JSON.stringify(value, null, 2)], {
            type: "application/json",
          }),
          name,
        ),
      prepareModel,
      previewProject: async (graph) => {
        await studio.save();
        if (useStudio.getState().saveState !== "saved" || !runtime)
          throw Error("请先保存场景");
        const original = document,
          pose = runtime.getCameraPose();
        const navigation = new ProjectNavigation(
          runtime,
          {
            versionId: "draft",
            projectId,
            graphVersionId: "draft",
            document: graph,
            sceneVersions: {},
            assets: graph.assets,
            publishedAt: "",
            runtimeBuild: "2.2.0",
          },
          async (node, signal) => {
            const result = await request<{ document: typeof document }>(
              "/scenes/" +
                node.sceneId +
                (node.sceneVersionId
                  ? "/versions/" + node.sceneVersionId
                  : "/draft"),
              { signal },
            );
            return result.document;
          },
        );
        studio.set({
          mode: "play",
          previewController: {
            dispose: () => navigation.dispose(),
            stop: async () => {
              navigation.dispose();
              await runtime.loadDocument(original);
              await runtime.setMode("edit");
              runtime.applyCameraPose(pose);
              studio.set({ mode: "edit", previewController: null });
            },
          },
        });
        await navigation.navigate(graph.entryNodeId);
        await runtime.setMode("play");
      },
      scratchActive: studio.scratchActive,
      beginScratch: studio.beginScratch,
      cancelScratch: studio.cancelScratch,
      historyTarget: (target, save) =>
        studio.set({ historyTarget: target, activeDocumentSave: save ?? null }),
      persistDraft: persistDocumentDraft,
      recoverDraft: recoverDocumentDraft,
      sourceEditing: Boolean(studio.editingLibrary),
      editSource: studio.editSource,
      returnToScene: studio.returnToScene,
      request,
      upload,
      saveScene: studio.save,
      openScene: async (id) =>
        studio.open(await request("/scenes/" + id + "/draft")),
      assetBytes: async (id, path, signal) => {
        const response = await fetch(
          "/api/assets/" +
            id +
            "/files/" +
            path.split("/").map(encodeURIComponent).join("/"),
          { headers: authHeaders(), signal },
        );
        if (!response.ok) throw Error("读取资源失败 " + response.status);
        return response.arrayBuffer();
      },
      run: studio.run,
    },
    renderDocumentFields: (type, value, keys, onChange) => (
      <ReferenceAssets.Provider
        value={
          Array.isArray(value.assets)
            ? [
                ...new Map(
                  [
                    ...document.assets,
                    ...(value.assets as unknown as import("@studio/scene-schema").SceneAsset[]),
                  ].map((asset) => [asset.id, asset]),
                ).values(),
              ]
            : document.assets
        }
      >
        <Fields
          fields={Object.fromEntries(
            Object.entries(
              [...documentDefinitions, ...componentDefinitions].find(
                (d) => d.type === type,
              )?.fields ?? {},
            ).filter(([key]) => keys.includes(key)),
          )}
          value={value}
          path={type}
          onChange={onChange}
        />
      </ReferenceAssets.Provider>
    ),
    renderFields: (entityId, type, keys) => (
      <DomainFields entityId={entityId} type={type} keys={keys} />
    ),
  };
}
function DomainFields({
  entityId,
  type,
  keys,
}: {
  entityId: string;
  type: string;
  keys: string[];
}) {
  const document = useStudio((s) => s.document),
    mode = useStudio((s) => s.mode);
  const entity = document?.entities.find((e) => e.id === entityId),
    component = entity?.components.find((c) => c.type === type),
    definition = componentDefinitions.find((d) => d.type === type);
  if (!component || !definition) return null;
  return (
    <fieldset disabled={mode === "play" || entity?.locked}>
      <Fields
        fields={Object.fromEntries(
          Object.entries(definition.fields).filter(([key]) =>
            keys.includes(key),
          ),
        )}
        value={component.data}
        targetId={entityId}
        path={type}
        onChange={(key, value) =>
          useStudio.getState().command({
            label: "编辑 " + definition.title,
            mutate(doc) {
              const c = doc.entities
                .find((e) => e.id === entityId)
                ?.components.find((c) => c.type === type);
              if (c) c.data[key] = value as JsonValue;
            },
          })
        }
        onSpatialEdit={(path, _value, space, targetField) =>
          useStudio.getState().set({
            editingPoint: editablePoint(
              document!,
              [
                "entities",
                { id: entityId },
                "components",
                { type },
                "data",
                ...path,
              ],
              definition.title,
              space,
              entityId,
              targetField,
            ),
            tool: "translate",
          })
        }
      />
    </fieldset>
  );
}
export function WorkspaceSidebar() {
  const id = useStudio((s) => s.workspace);
  const Component =
    workspaceCatalog.find((w) => w.id === id)?.Sidebar ?? SceneTree;
  return <Component />;
}
export function WorkspaceDesigner() {
  const id = useStudio((s) => s.workspace),
    props = useExtensionProps(),
    latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const unregister = extensionCommands
      .filter((command) => command.workspace === id)
      .map((command) =>
        commands.register({
          id: command.id,
          title: command.title,
          category: "工作空间",
          scope: command.scope,
          shortcuts: command.shortcuts,
          enabled: () => Boolean(latest.current?.mode === "edit"),
          execute: async () => {
            if (latest.current) await command.execute(latest.current);
          },
        }),
      );
    return () => unregister.forEach((remove) => remove());
  }, [id]);
  const panel = extensionPanels.find((p) => p.workspace?.id === id);
  if (!panel || !props) return null;
  const Component = panel.Component;
  return (
    <section className="designer-drawer" aria-label={panel.title}>
      <header>
        <h2>{panel.title}</h2>
        <small>{panel.workspace?.description}</small>
      </header>
      <Component {...props} />
    </section>
  );
}
