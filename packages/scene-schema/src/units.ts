import catalog from "../unit-catalog.json";
export const unitCatalog = catalog;
export type UnitDefinition = (typeof catalog.units)[number];
const normalize = (value: string) =>
  value.trim().replaceAll("²", "2").replaceAll("³", "3").replace(/\s+/g, "");
const units = new Map<string, UnitDefinition>();
for (const unit of catalog.units)
  for (const name of [unit.id, ...unit.aliases]) {
    const key = normalize(name),
      existing = units.get(key);
    if (existing && existing.id !== unit.id)
      throw Error("单位别名重复：" + name);
    units.set(key, unit);
  }
export function unitDefinition(value: string): UnitDefinition {
  const unit = units.get(normalize(value));
  if (!unit) throw Error("不支持的单位：" + value);
  return unit;
}
export function compatibleUnits(from: string, to: string): boolean {
  const a = unitDefinition(from),
    b = unitDefinition(to);
  return (
    a.quantity === b.quantity &&
    a.dimension.every((value, i) => value === b.dimension[i])
  );
}
export function convertUnit(value: number, from: string, to: string): number {
  if (!Number.isFinite(value)) throw Error("单位换算只接受有限数值");
  const a = unitDefinition(from),
    b = unitDefinition(to);
  if (!compatibleUnits(from, to))
    throw Error("单位量纲不一致：" + from + " → " + to);
  const result = (value * a.scale + a.offset - b.offset) / b.scale;
  if (!Number.isFinite(result)) throw Error("单位换算超出有限数值范围");
  return result;
}
export function strictNumber(raw: unknown): number {
  if (typeof raw !== "number" && typeof raw !== "string")
    throw Error("数值必须为十进制字符串或数字");
  if (
    typeof raw === "string" &&
    !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim())
  )
    throw Error("非法十进制数值");
  const value = typeof raw === "number" ? raw : Number(raw.trim());
  if (!Number.isFinite(value)) throw Error("数值必须有限");
  return value;
}
