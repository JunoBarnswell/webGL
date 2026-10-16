import { useEffect, useState } from "react";
import type { SceneRuntime } from "@studio/scene-runtime";
export function RuntimeAssetImage({
  runtime,
  id,
  alt,
}: {
  runtime: SceneRuntime | null;
  id: string;
  alt: string;
}) {
  const [url, setUrl] = useState("");
  const store = runtime?.store;
  useEffect(() => {
    let active = true;
    setUrl("");
    if (store && id)
      void store
        .blobUrl(id)
        .then((url) => {
          if (active) setUrl(url);
        })
        .catch(() => {
          if (active) setUrl("");
        });
    return () => {
      active = false;
    };
  }, [store, id]);
  return url ? <img src={url} alt={alt} /> : null;
}
