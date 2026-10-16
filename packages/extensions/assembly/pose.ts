import * as THREE from "three";
import type { JsonValue, Vec3, Quat } from "../../scene-schema/src/index";
export interface AssemblyStage {
  id: string;
  name: string;
  start: number;
  end: number;
  path: Vec3[];
  rotation: Vec3;
  scale: Vec3;
  easing: "linear" | "smooth" | "ease-in" | "ease-out";
  trail: boolean;
  visibility: "inherit" | "show" | "hide";
}
export function stages(value: JsonValue | undefined): AssemblyStage[] {
  return (Array.isArray(value) ? value : []) as unknown as AssemblyStage[];
}
export function pathCurve(points: Vec3[]): THREE.Curve<THREE.Vector3> {
  const vectors = [
    new THREE.Vector3(),
    ...points.map((p) => new THREE.Vector3().fromArray(p)),
  ];
  return vectors.length > 2
    ? new THREE.CatmullRomCurve3(vectors, false, "centripetal")
    : new THREE.LineCurve3(
        vectors[0] ?? new THREE.Vector3(),
        vectors[1] ?? new THREE.Vector3(),
      );
}
export function stageProgress(stage: AssemblyStage, progress: number): number {
  const t = THREE.MathUtils.clamp(
    (progress - stage.start) / Math.max(0.000001, stage.end - stage.start),
    0,
    1,
  );
  return stage.easing === "linear"
    ? t
    : stage.easing === "ease-in"
      ? t * t
      : stage.easing === "ease-out"
        ? 1 - (1 - t) * (1 - t)
        : t * t * (3 - 2 * t);
}
export interface BasePose {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  scale: THREE.Vector3;
  visible: boolean;
}
export function evaluatePose(
  base: BasePose,
  recipe: readonly AssemblyStage[],
  progress: number,
  units = 1,
): {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  scale: THREE.Vector3;
  visible: boolean;
} {
  const position = base.position.clone(),
    rotation = base.rotation.clone(),
    scale = base.scale.clone();
  let visible = base.visible;
  if (progress <= 0) return { position, rotation, scale, visible };
  for (const stage of [...recipe].sort((a, b) => a.start - b.start)) {
    const t = stageProgress(stage, progress);
    const curve = pathCurve(stage.path);
    const offset = curve.getPoint(t).sub(curve.getPoint(0)).divideScalar(units);
    position.add(offset);
    const end = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        ...(stage.rotation.map(THREE.MathUtils.degToRad) as Vec3),
      ),
    );
    rotation.multiply(new THREE.Quaternion().slerp(end, t));
    scale.multiply(
      new THREE.Vector3(1, 1, 1).lerp(
        new THREE.Vector3().fromArray(stage.scale),
        t,
      ),
    );
    if (progress >= stage.end && stage.visibility !== "inherit")
      visible = stage.visibility === "show";
  }
  return { position, rotation: rotation.normalize(), scale, visible };
}
export function serializedPose(pose: ReturnType<typeof evaluatePose>): {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
} {
  return {
    position: pose.position.toArray(),
    rotation: pose.rotation.toArray() as Quat,
    scale: pose.scale.toArray(),
  };
}
