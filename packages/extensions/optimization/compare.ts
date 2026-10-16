import type { SceneDocument } from "../../scene-schema/src/types";
import type { SceneRuntime } from "../../scene-runtime/src/SceneRuntime";
export interface Comparison {
  source: string;
  derived: string;
  rmse: number;
  sourceStats: unknown;
  derivedStats: unknown;
  environment: {
    userAgent: string;
    dpr: number;
    gpu: string;
    width: number;
    height: number;
  };
  note: string;
}
export async function compareDocuments(
  runtime: SceneRuntime,
  candidate: SceneDocument,
): Promise<Comparison> {
  const original = runtime.document;
  if (!original || runtime.mode !== "edit") throw Error("请在编辑模式比较资产");
  const pose = runtime.getCameraPose(),
    renderer = runtime.engine.renderer;
  const capture = () => {
    renderer.render(runtime.engine.scene, runtime.engine.camera);
    return renderer.domElement.toDataURL("image/png");
  };
  const source = capture(),
    sourceStats = runtime.stats();
  let derived = "",
    derivedStats: unknown;
  try {
    await runtime.loadDocument(candidate);
    runtime.applyCameraPose(pose);
    derived = capture();
    derivedStats = runtime.stats();
  } finally {
    await runtime.loadDocument(original);
    runtime.applyCameraPose(pose);
  }
  const pixels = async (url: string) => {
    const image = await createImageBitmap(await (await fetch(url)).blob());
    const canvas = new OffscreenCanvas(image.width, image.height),
      context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    image.close();
    return context.getImageData(0, 0, canvas.width, canvas.height);
  };
  const [a, b] = await Promise.all([pixels(source), pixels(derived)]);
  let sum = 0;
  for (let i = 0; i < a.data.length; i += 4)
    for (let channel = 0; channel < 3; channel++)
      sum += (a.data[i + channel] - b.data[i + channel]) ** 2;
  const gl = renderer.getContext(),
    info = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    source,
    derived,
    rmse: Math.sqrt(sum / (a.width * a.height * 3)),
    sourceStats,
    derivedStats,
    environment: {
      userAgent: navigator.userAgent,
      dpr: window.devicePixelRatio,
      gpu: info
        ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
        : "unavailable",
      width: a.width,
      height: a.height,
    },
    note: "同一 Canvas、同相机和曝光的顺序快照；软件 GPU 结果不能代表真实硬件。GPU 时间以现有 timer telemetry 为准，不使用 RAF 代替。",
  };
}
