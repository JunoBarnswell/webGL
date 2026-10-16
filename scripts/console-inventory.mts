import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import ts from "typescript";
import { extensionPanels, extensionTools, extensionCommands } from "../packages/extensions/editor";
import { windows, layoutPresets } from "../apps/editor/src/shell/windows";

const baseline = "ab5502c3f96f24eee226a52c97787fbed2ae42ad";
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
const files = git("ls-tree", "-r", "--name-only", baseline, "apps/editor/src", "packages/extensions", "packages/player-ui", "apps/player/src").trim().split(/\r?\n/).filter((file) => /\.(tsx?|mts)$/.test(file));
const panelWindows: Record<string, string> = { Viewport: "viewport", SceneTree: "scene", Inspector: "properties", Resources: "resources", ContentPanel: "content", TourPanel: "tour", Interactions: "interaction", InterfaceCanvas: "interface", UiInspector: "interface" };
function destination(file: string, owner = "") {
  if (file.includes("player-ui") || file.includes("apps/player") || file.endsWith("/player.tsx")) return "player:/player/";
  const extension = file.match(/packages\/extensions\/([^/]+)\//)?.[1];
  if (extension) return (file.endsWith(".tsx") || file.endsWith("/editor.ts")) && extension !== "sample" ? "window:extension." + extension : "shared:" + file;
  if (file.startsWith("packages/extensions/")) return "shared:" + file;
  if (file.includes("Dialogs")) return owner === "ProjectsDialog" ? "window:projects" : owner === "VersionsDialog" ? "window:versions" : owner === "Login" ? "page:Login" : "dialog:RecoveryDialog";
  const window = panelWindows[file.split("/").at(-1)!.replace(/\.(tsx?|mts)$/, "")];
  return window ? "window:" + window : file.includes("ReleaseReadiness") ? "dialog:ReleaseReadinessDialog" : file.includes("WorkspaceHost") ? "shell:extensions/ExtensionHost" : "shell:" + file;
}
type Feature = { id: string; kind: string; label: string; source: { file: string; line: number }; newEntry: string; uat: string; mapping: string; acceptance: "unverified" };
const features: Feature[] = [];
const seen = new Map<string, number>();
function add(kind: string, label: string, file: string, line: number, explicitId?: string, owner = "") {
  const identity = explicitId ?? createHash("sha256").update(file + "\n" + kind + "\n" + label).digest("hex").slice(0, 12);
  const count = seen.get(identity) ?? 0;
  seen.set(identity, count + 1);
  const newEntry = kind === "command" || kind === "extension-tool" ? "command:" + explicitId : kind === "workspace" ? "command:workspace." + explicitId : destination(file, owner);
  features.push({ id: kind + ":" + identity + (count ? ":" + count : ""), kind, label: label.slice(0, 300), source: { file, line }, newEntry, uat: file.includes("storyboard") ? "U09" : file.includes("virtual-tour") ? "U08" : file.includes("industrial") ? "U11" : file.includes("configurator") ? "U10" : file.includes("prefab") ? "U07" : file.includes("optimization") ? "U12" : file.includes("player") ? "U18" : "U17", mapping: ["apps/editor/src/App.tsx", "apps/editor/src/workspaces/WorkspaceHost.tsx", "apps/editor/src/shell/commands.ts"].includes(file) ? "moved" : "unchanged", acceptance: "unverified" });
}
for (const file of files) {
  const source = git("show", baseline + ":" + file), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node: ts.Node) => {
    const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
    let scope: ts.Node | undefined = node;
    while (scope && !ts.isFunctionDeclaration(scope)) scope = scope.parent;
    const owner = scope && ts.isFunctionDeclaration(scope) ? scope.name?.text ?? "" : "";
    if (ts.isFunctionDeclaration(node) && node.name && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) add("export", node.name.text, file, line, undefined, node.name.text);
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(ast);
      if (["button", "summary", "input", "select", "textarea"].includes(tag)) {
        const label = node.attributes.properties.find((item) => ts.isJsxAttribute(item) && ["aria-label", "title"].includes(item.name.getText(ast)));
        const parent = ts.isJsxElement(node.parent) ? node.parent.getText(ast) : node.getText(ast);
        add("control", label?.getText(ast) ?? parent.replace(/\s+/g, " ").slice(0, 220), file, line, undefined, owner);
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(ast);
      if (/^(request|upload|download|fetch|services\.request|services\.upload|props\.services\.request|props\.services\.upload)$/.test(callee)) add("service", node.getText(ast).replace(/\s+/g, " "), file, line, undefined, owner);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}
for (const panel of extensionPanels) {
  const file = `packages/extensions/${panel.id}/editor.ts`;
  add("panel", panel.title, file, 1, panel.id);
  if (panel.workspace) add("workspace", panel.workspace.title, file, 1, panel.workspace.id);
}
for (const tool of extensionTools) add("extension-tool", tool.title, `packages/extensions/${tool.id.split(".")[0]}/editor.ts`, 1, "extension." + tool.id);
for (const command of extensionCommands) add("command", command.title, `packages/extensions/${command.workspace}/editor.ts`, 1, command.id);

// Expand the actual loops in the original command source, retaining every public ID.
const commandFile = "apps/editor/src/shell/commands.ts";
const commandAst = ts.createSourceFile(commandFile, git("show", baseline + ":" + commandFile), ts.ScriptTarget.Latest, true);
type Env = Record<string, unknown>;
function evaluate(node: ts.Node | undefined, env: Env): unknown {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return ts.isNumericLiteral(node) ? Number(node.text) : node.text;
  if (ts.isIdentifier(node)) return env[node.text];
  if (ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node)) return evaluate(node.expression, env);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((item) => evaluate(item, env));
  if (ts.isPropertyAccessExpression(node)) return (evaluate(node.expression, env) as Record<string, unknown> | undefined)?.[node.name.text];
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = evaluate(node.left, env), right = evaluate(node.right, env);
    return left === undefined || right === undefined ? undefined : String(left) + String(right);
  }
  if (ts.isCallExpression(node) && node.expression.getText(commandAst) === "String") return String(evaluate(node.arguments[0], env));
  return undefined;
}
const commandIds = new Set(extensionCommands.map((item) => item.id));
function visitCommands(node: ts.Node, env: Env) {
  if (ts.isForOfStatement(node)) {
    const values = evaluate(node.expression, env);
    if (Array.isArray(values) && ts.isVariableDeclarationList(node.initializer)) {
      const binding = node.initializer.declarations[0].name;
      for (const value of values) {
        const scoped = { ...env };
        if (ts.isIdentifier(binding)) scoped[binding.text] = value;
        if (ts.isArrayBindingPattern(binding)) binding.elements.forEach((item, index) => { if (ts.isBindingElement(item) && ts.isIdentifier(item.name)) scoped[item.name.text] = (value as unknown[])?.[index]; });
        visitCommands(node.statement, scoped);
      }
      return;
    }
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression.getText(commandAst);
    let id: unknown;
    if (callee === "viewport") id = evaluate(node.arguments[0], env);
    if (callee === "commands.register" && ts.isObjectLiteralExpression(node.arguments[0])) {
      const property = node.arguments[0].properties.find((item) => ts.isPropertyAssignment(item) && item.name.getText(commandAst) === "id");
      if (property && ts.isPropertyAssignment(property)) id = evaluate(property.initializer, env);
    }
    if (typeof id === "string" && !commandIds.has(id)) {
      commandIds.add(id);
      add("command", id, commandFile, commandAst.getLineAndCharacterOfPosition(node.getStart()).line + 1, id);
    }
  }
  ts.forEachChild(node, (child) => visitCommands(child, env));
}
visitCommands(commandAst, { extensionPanels, extensionTools });
for (const panel of extensionPanels) if (panel.workspace) commandIds.add("workspace." + panel.workspace.id);
for (const tool of extensionTools) commandIds.add("extension." + tool.id);
const path = "docs/existing-feature-inventory.json";
const registered = new Set(windows.map((item) => item.id));
for (const feature of features) if (feature.newEntry.startsWith("window:") && !registered.has(feature.newEntry.slice(7))) throw Error("入口指向未注册窗口：" + feature.newEntry);
await mkdir("docs", { recursive: true });
await writeFile(path, JSON.stringify({ baseline, generatedFrom: "Git baseline AST and unchanged extension catalog", note: "Source mapping is not runtime acceptance. See console-shell-acceptance.md for actual evidence and Blocked items.", files: files.length, counts: Object.fromEntries([...new Set(features.map((item) => item.kind))].map((kind) => [kind, features.filter((item) => item.kind === kind).length])), windows, presets: layoutPresets, requiredCommandIds: [...commandIds].sort(), features }, null, 2) + "\n");
console.log(JSON.stringify({ path, files: files.length, features: features.length, publicCommands: commandIds.size }));
