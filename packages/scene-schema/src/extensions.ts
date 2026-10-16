import runtime from "../runtime-version.json";
export const runtimeVersion = runtime.version;
import catalog from "../extension-catalog.json";
import type { SceneDocument } from "./types";
export { catalog as extensionCatalog };
export interface ExtensionManifest {
  id: string;
  version: string;
  minRuntimeVersion: string;
  dependsOn: Record<string, string>;
  permissions: string[];
  contributions?: {
    workspaces?: string[];
    documentKinds?: string[];
    playerWidgets?: string[];
    compilerPasses?: string[];
  };
}
export function orderExtensions(
  manifests: readonly ExtensionManifest[],
): ExtensionManifest[] {
  const available = new Map<string, ExtensionManifest>();
  for (const manifest of manifests) {
    if (available.has(manifest.id)) throw Error("扩展 ID 重复 " + manifest.id);
    if (
      !/^\d+\.\d+\.\d+$/.test(manifest.version) ||
      !/^\d+\.\d+\.\d+$/.test(manifest.minRuntimeVersion) ||
      compareVersions(manifest.minRuntimeVersion, runtimeVersion) > 0 ||
      manifest.permissions.length
    )
      throw Error("不支持的扩展版本/权限 " + manifest.id);
    available.set(manifest.id, manifest);
  }
  const ordered: ExtensionManifest[] = [],
    visiting = new Set<string>(),
    done = new Set<string>();
  const visit = (id: string) => {
    if (done.has(id)) return;
    if (visiting.has(id)) throw Error("扩展循环依赖 " + id);
    const manifest = available.get(id);
    if (!manifest) throw Error("缺失扩展 " + id);
    visiting.add(id);
    for (const [dependency, version] of Object.entries(manifest.dependsOn)) {
      visit(dependency);
      if (available.get(dependency)!.version !== version)
        throw Error("扩展版本冲突 " + dependency);
    }
    visiting.delete(id);
    done.add(id);
    ordered.push(manifest);
  };
  for (const id of [...available.keys()].sort()) visit(id);
  return ordered;
}
export function extensionErrors(document: SceneDocument): string[] {
  const errors: string[] = [];
  const declared = new Map(
    document.requiredExtensions.map((e) => [e.id, e.version]),
  );
  if (declared.size !== document.requiredExtensions.length)
    errors.push("扩展声明重复");
  for (const requirement of document.requiredExtensions) {
    const manifest = catalog.manifests.find((m) => m.id === requirement.id);
    if (!manifest || !supportsExtension(manifest.version, requirement.version))
      errors.push(
        "缺失或不兼容扩展 " + requirement.id + "@" + requirement.version,
      );
  }
  return errors;
}
export function requiredExtension(
  type: string,
): { id: string; version: string } | undefined {
  const manifest = catalog.manifests.find((m) => type.startsWith(m.id + "."));
  return manifest && { id: manifest.id, version: manifest.version };
}
export function declareExtension(document: SceneDocument, type: string): void {
  const requirement = requiredExtension(type);
  if (
    requirement &&
    !document.requiredExtensions.some((e) => e.id === requirement.id)
  )
    document.requiredExtensions.push(requirement);
  else if (requirement) {
    const current = document.requiredExtensions.find(
      (e) => e.id === requirement.id,
    )!;
    if (supportsExtension(requirement.version, current.version))
      current.version = requirement.version;
  }
}
export interface MigrationReport {
  from: number;
  to: 2;
  entities: number;
  components: number;
  referencesPreserved: boolean;
}
export function migrateDocument(input: unknown): {
  document: SceneDocument;
  report: MigrationReport;
} {
  const document = structuredClone(input) as SceneDocument;
  const version = document.documentVersion;
  if (version !== undefined && version !== 2)
    throw Error("不支持的文档版本 " + version);
  if (version === undefined) {
    document.documentVersion = 2;
    document.requiredExtensions = [];
  }
  return {
    document,
    report: {
      from: version ?? 1,
      to: 2,
      entities: document.entities?.length ?? 0,
      components:
        document.entities?.reduce((n, e) => n + e.components.length, 0) ?? 0,
      referencesPreserved: true,
    },
  };
}

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number),
    right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}
/** Additive minor versions share one contract; future and different-major requirements are rejected. */
export function supportsExtension(
  installed: string,
  requested: string,
): boolean {
  return (
    /^\d+\.\d+\.\d+$/.test(requested) &&
    installed.split(".")[0] === requested.split(".")[0] &&
    compareVersions(requested, installed) <= 0
  );
}
