import { useEffect, useState, type ReactNode } from "react";
import type { ExtensionPanelProps } from "../editor-contract";
import type { ProjectGraph } from "./core";
/** One owned object URL for all project image authoring surfaces. Coordinates match the actual image. */
export function AssetPlane({
  assetId,
  graph,
  services,
  onPoint,
  onSize,
  children,
}: {
  assetId: string;
  graph: ProjectGraph;
  services: ExtensionPanelProps["services"];
  onPoint?: (x: number, y: number, width: number, height: number) => void;
  onSize?: (width: number, height: number) => void;
  children?: ReactNode;
}) {
  const [image, setImage] = useState({ id: "", url: "", error: "" });
  const asset = graph.assets.find((a) => a.id === assetId);
  useEffect(() => {
    if (!asset) return;
    const abort = new AbortController();
    let url = "";
    void services
      .assetBytes(asset.id, asset.entry, abort.signal)
      .then((bytes) => {
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(new Blob([bytes]));
        setImage({ id: asset.id, url, error: "" });
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setImage({ id: asset.id, url: "", error: String(error) });
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [asset?.id, asset?.entry, services.assetBytes]);
  if (!asset || image.id !== asset.id || !image.url)
    return (
      <p role="status">
        {image.id === assetId && image.error ? image.error : "选择已归档的图像"}
      </p>
    );
  return (
    <div className="project-asset-plane">
      <img
        className="tour-media-editor"
        alt={asset.name}
        src={image.url}
        onLoad={(event) =>
          onSize?.(
            event.currentTarget.naturalWidth,
            event.currentTarget.naturalHeight,
          )
        }
        onClick={(event) => {
          const img = event.currentTarget,
            r = img.getBoundingClientRect();
          onPoint?.(
            (event.clientX - r.left) / r.width,
            (event.clientY - r.top) / r.height,
            img.naturalWidth,
            img.naturalHeight,
          );
        }}
      />
      {children}
    </div>
  );
}
