import { useEffect, useState } from "react";
import {
  createEntity,
  createComponent,
  getComponent,
  type JsonValue,
} from "../scene-schema/src/index";
import type { ExtensionPanelProps } from "./editor-contract";
export function useDomainEntity<T>(type: string, props: ExtensionPanelProps) {
  const [chosen, setChosen] = useState("");
  const entities = props.document.entities.filter((e) => getComponent(e, type));
  const entity =
    entities.find((e) => props.selectedIds.includes(e.id)) ??
    entities.find((e) => e.id === chosen) ??
    entities[0];
  const data = entity
    ? (getComponent(entity, type)!.data as unknown as T)
    : undefined;
  const mutate = (label: string, change: (data: T) => void) => {
    if (!entity) return;
    props.command({
      label,
      mutate(doc) {
        const c = doc.entities
          .find((e) => e.id === entity.id)
          ?.components.find((c) => c.type === type);
        if (c) change(c.data as unknown as T);
      },
    });
  };
  const create = (name: string, initialize?: (data: T) => void) => {
    const e = createEntity(name),
      c = createComponent(type);
    if (initialize) initialize(c.data as unknown as T);
    e.components.push(c);
    if (
      props.command({
        label: "新建 " + name,
        mutate(doc) {
          doc.entities.push(e);
        },
      })
    ) {
      setChosen(e.id);
      props.select([e.id]);
    }
  };
  return {
    entities,
    entity,
    data,
    mutate,
    create,
    choose: (id: string) => {
      setChosen(id);
      props.select([id]);
    },
    fields: (keys: string[]) =>
      entity ? props.renderFields(entity.id, type, keys) : null,
  };
}
export const asJson = <T,>(value: T): JsonValue =>
  value as unknown as JsonValue;

export async function captureThumbnail(
  props: ExtensionPanelProps,
  name: string,
) {
  const runtime = props.runtime;
  if (!runtime) throw Error("视口未就绪");
  runtime.engine.renderer.render(runtime.engine.scene, runtime.engine.camera);
  const blob = await new Promise<Blob>((resolve, reject) =>
    runtime.engine.renderer.domElement.toBlob(
      (b) => (b ? resolve(b) : reject(Error("快照失败"))),
      "image/png",
    ),
  );
  return props.services.upload(
    name,
    "image",
    "snapshot.png",
    new Map([["snapshot.png", new Uint8Array(await blob.arrayBuffer())]]),
  );
}
export function AssetThumbnail({
  id,
  assets,
  services,
  alt,
}: {
  id: string;
  assets: import("../scene-schema/src/types").SceneAsset[];
  services: ExtensionPanelProps["services"];
  alt: string;
}) {
  const [url, setUrl] = useState("");
  const asset = assets.find((a) => a.id === id);
  useEffect(() => {
    setUrl("");
    if (!asset) return;
    const abort = new AbortController();
    let url = "";
    void services
      .assetBytes(asset.id, asset.entry, abort.signal)
      .then((bytes) => {
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(new Blob([bytes]));
        setUrl(url);
      })
      .catch(() => {});
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [asset?.id]);
  return url ? (
    <img className="designer-thumbnail" src={url} alt={alt} />
  ) : (
    <span className="thumbnail-placeholder" aria-label={alt}>
      ◇
    </span>
  );
}
