using System.Text.Json;
using System.Text.RegularExpressions;

namespace Studio;

// Deliberately implements the finite keyword set in our embedded v1 contract.
// Schema changes are checked by the cross-language contract fixtures.
public sealed class DocumentContract
{
    private readonly JsonElement schema;
    public DocumentContract()
    {
        using var stream = typeof(DocumentContract).Assembly.GetManifestResourceStream("scene-document.schema.json")!;
        schema = JsonDocument.Parse(stream).RootElement.Clone();
    }
    public static string Text(JsonElement value, string key) => value.TryGetProperty(key, out var found) ? found.GetString() ?? "" : "";
    private JsonElement Resolve(JsonElement spec) => spec.TryGetProperty("$ref", out var reference) ? schema.GetProperty("$defs").GetProperty(reference.GetString()!.Split('/').Last()) : spec;
    public string[] Validate(JsonElement document, bool publish = false)
    {
        var errors = new List<string>();
        Check(document, schema, "$", errors);
        if (errors.Count > 0) return errors.Take(30).ToArray();
        var groups = new Dictionary<string, HashSet<string>>();
        foreach (var (kind, property) in new[] { ("entity", "entities"), ("asset", "assets"), ("material", "materials"), ("behavior", "behaviors") }) {
            var ids = new HashSet<string>();
            foreach (var item in document.GetProperty(property).EnumerateArray()) {
                var id = Text(item, "id");
                if (!Regex.IsMatch(id, "^[a-zA-Z0-9_-]{1,100}$", RegexOptions.CultureInvariant) || !ids.Add(id)) errors.Add(kind + " ID 无效或重复: " + id);
            }
            groups[kind] = ids;
        }
        var entities = document.GetProperty("entities").EnumerateArray().GroupBy(x => Text(x, "id")).ToDictionary(x => x.Key, x => x.First());
        foreach (var entity in entities.Values) {
            var id = Text(entity, "id"); var cursor = entity; var visited = new HashSet<string>();
            while (true) {
                if (!visited.Add(Text(cursor, "id"))) { errors.Add(id + " 层级存在环"); break; }
                var parent = cursor.GetProperty("parentId");
                if (parent.ValueKind == JsonValueKind.Null) break;
                if (!entities.TryGetValue(parent.GetString()!, out cursor)) { errors.Add(id + " 父节点不存在"); break; }
            }
            var transform = entity.GetProperty("transform");
            if (Math.Abs(transform.GetProperty("rotation").EnumerateArray().Sum(x => x.GetDouble() * x.GetDouble()) - 1) > .001) errors.Add(id + " 四元数未归一化");
            if (transform.GetProperty("scale").EnumerateArray().Any(x => Math.Abs(x.GetDouble()) < .000001)) errors.Add(id + " 缩放不可为零");
            var components = entity.GetProperty("components").EnumerateArray().ToArray();
            if (components.Select(x => Text(x, "type")).Distinct().Count() != components.Length) errors.Add(id + " 重复组件");
            foreach (var component in components) {
                var type = Text(component, "type"); var data = component.GetProperty("data");
                if (publish && component.GetProperty("enabled").GetBoolean() && new[] { "Mesh", "Model", "Avatar", "Audio", "Artwork" }.Contains(type) && Text(data, "assetId") == "") errors.Add(id + "/" + type + " 未指定资源");
                if (type == "ModelNode" || type == "Animation" && publish && component.GetProperty("enabled").GetBoolean()) {
                    if (!entities.TryGetValue(Text(data, "modelEntityId"), out var model) || !model.GetProperty("components").EnumerateArray().Any(c => Text(c, "type") == "Model")) errors.Add(id + " 模型实例引用无效");
                    if (type == "Animation" && publish && (Text(data, "clip") == "" || !entities.TryGetValue(Text(data,"modelEntityId"),out var owner) || !owner.GetProperty("components").EnumerateArray().Any(c => Text(c,"type") == "Model" && c.GetProperty("enabled").GetBoolean()))) errors.Add(id + " 动画配置不完整");
                }
            }
        }
        var nodeBindings = new HashSet<string>();
        foreach(var entity in entities.Values) {
            var components=entity.GetProperty("components").EnumerateArray().ToArray();
            if(components.Count(c=>new[]{"Mesh","Model","ModelNode","Avatar"}.Contains(Text(c,"type")))>1)errors.Add(Text(entity,"name")+" 只能有一个几何/模型/角色组件");
            foreach(var component in components) {
                var type=Text(component,"type");var data=component.GetProperty("data");
                if(type=="ModelNode") {
                    if(!component.GetProperty("enabled").GetBoolean())errors.Add("模型子节点身份不可禁用");
                    if(!entities.TryGetValue(Text(data,"modelEntityId"),out var owner)||!owner.GetProperty("components").EnumerateArray().Any(c=>Text(c,"type")=="Model"&&c.GetProperty("enabled").GetBoolean()))errors.Add("所属模型必须启用");
                    var modelId=Text(data,"modelEntityId");
                    var parentId=entity.GetProperty("parentId").GetString()??"";
                    var sameParent=parentId==modelId;
                    if(entities.TryGetValue(parentId,out var parent))sameParent|=parent.GetProperty("components").EnumerateArray().Any(c=>Text(c,"type")=="ModelNode"&&Text(c.GetProperty("data"),"modelEntityId")==modelId);
                    if(!sameParent)errors.Add(Text(entity,"name")+" 必须属于同一模型实例的层级");
                    if(!nodeBindings.Add(modelId+":"+data.GetProperty("nodeIndex").GetInt32()))errors.Add("模型子节点索引重复绑定");
                }
                var expected=type switch {"Mesh"=>"mesh","Model" or "Avatar"=>"model","Audio"=>"audio","Artwork"=>"image",_=>""};
                if(expected!="") {
                    var asset=document.GetProperty("assets").EnumerateArray().FirstOrDefault(a=>Text(a,"id")==Text(data,"assetId"));
                    if(asset.ValueKind==JsonValueKind.Object&&Text(asset,"kind")!=expected&&!(expected=="image"&&Text(asset,"kind")=="texture"))errors.Add(Text(entity,"name")+"/"+type+" 资源类型不匹配");
                }
            }
        }
        var environmentCount=document.GetProperty("settings").GetProperty("environmentAssetIds").GetArrayLength();
        if(environmentCount!=0&&environmentCount!=6||document.GetProperty("materials").EnumerateArray().Any(m=>m.GetProperty("envAssetIds").GetArrayLength() is not (0 or 6)))errors.Add("环境立方体必须提供完整六面资源");
        foreach (var reference in References(document, schema)) if (reference.Id != "" && !groups[reference.Kind].Contains(reference.Id)) errors.Add("无效的 " + reference.Kind + " 引用 " + reference.Id);
        foreach (var asset in document.GetProperty("assets").EnumerateArray()) {
            var files = asset.GetProperty("files").EnumerateArray().Select(x => x.GetString()!).ToArray();
            if (!files.Contains(Text(asset, "entry")) || files.Any(x => !ObjectStore.ValidPath(x))) errors.Add(Text(asset, "name") + " 资源包路径非法");
        }
        var settings = document.GetProperty("settings");
        if (settings.GetProperty("near").GetDouble() >= settings.GetProperty("far").GetDouble()) errors.Add("近裁剪面必须小于远裁剪面");
        if (publish) foreach (var behavior in document.GetProperty("behaviors").EnumerateArray()) {
            if (behavior.GetProperty("actions").GetArrayLength() == 0) errors.Add(Text(behavior, "name") + " 未配置动作");
            if (Text(behavior, "event") != "ready" && Text(behavior, "sourceId") == "") errors.Add(Text(behavior, "name") + " 未指定事件源");
            foreach (var action in behavior.GetProperty("actions").EnumerateArray()) if (!new[] { "DisplayMode", "ViewMode", "OpenInfo" }.Contains(Text(action, "type")) && Text(action, "targetId") == "") errors.Add("动作未指定目标");
        }
        return errors.Distinct().Take(30).ToArray();
    }
    public void Assert(JsonElement document, bool publish = false) { var errors = Validate(document, publish); if (errors.Length > 0) throw new ApiException(422, "场景文档校验失败", errors); }
    private static bool Equal(JsonElement a, JsonElement b) => JsonElement.DeepEquals(a, b);
    private void Check(JsonElement value, JsonElement raw, string path, List<string> errors)
    {
        var spec = Resolve(raw);
        if (spec.TryGetProperty("oneOf", out var alternatives)) {
            var matches = 0;
            foreach (var alternative in alternatives.EnumerateArray()) { var local = new List<string>(); Check(value, alternative, path, local); if (local.Count == 0) matches++; }
            if (matches != 1) errors.Add(path + " 不符合唯一组件/动作结构");
            return;
        }
        if (spec.TryGetProperty("const", out var constant) && !Equal(value, constant)) errors.Add(path + " 常量不匹配");
        if (spec.TryGetProperty("enum", out var options) && !options.EnumerateArray().Any(x => Equal(value, x))) errors.Add(path + " 枚举值无效");
        bool Type(string type) => type switch { "object" => value.ValueKind == JsonValueKind.Object, "array" => value.ValueKind == JsonValueKind.Array, "string" => value.ValueKind == JsonValueKind.String, "number" => value.ValueKind == JsonValueKind.Number, "integer" => value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out _), "boolean" => value.ValueKind is JsonValueKind.True or JsonValueKind.False, "null" => value.ValueKind == JsonValueKind.Null, _ => false };
        if (spec.TryGetProperty("type", out var types) && !(types.ValueKind == JsonValueKind.Array ? types.EnumerateArray().Any(x => Type(x.GetString()!)) : Type(types.GetString()!))) { errors.Add(path + " 类型错误"); return; }
        if (value.ValueKind == JsonValueKind.Object) {
            if (spec.TryGetProperty("required", out var required)) foreach (var key in required.EnumerateArray()) if (!value.TryGetProperty(key.GetString()!, out _)) errors.Add(path + "/" + key.GetString() + " 缺失");
            var hasProperties = spec.TryGetProperty("properties", out var properties);
            foreach (var property in value.EnumerateObject()) {
                if (hasProperties && properties.TryGetProperty(property.Name, out var child)) Check(property.Value, child, path + "/" + property.Name, errors);
                else if (spec.TryGetProperty("additionalProperties", out var additional)) {
                    if (additional.ValueKind == JsonValueKind.False) errors.Add(path + "/" + property.Name + " 未声明字段");
                    else if (additional.ValueKind == JsonValueKind.Object) Check(property.Value, additional, path + "/" + property.Name, errors);
                }
            }
        } else if (value.ValueKind == JsonValueKind.Array) {
            var count = value.GetArrayLength();
            foreach (var bound in new[] { "minItems", "maxItems" }) if (spec.TryGetProperty(bound, out var limit) && (bound == "minItems" ? count < limit.GetInt32() : count > limit.GetInt32())) errors.Add(path + " 数组长度无效");
            if (spec.TryGetProperty("uniqueItems", out var unique) && unique.GetBoolean() && value.EnumerateArray().Select(x => x.GetRawText()).Distinct().Count() != count) errors.Add(path + " 数组值重复");
            if (spec.TryGetProperty("items", out var itemSpec)) { var i = 0; foreach (var item in value.EnumerateArray()) Check(item, itemSpec, path + "/" + i++, errors); }
        } else if (value.ValueKind == JsonValueKind.Number) {
            var number = value.GetDouble();
            if (!double.IsFinite(number)) errors.Add(path + " 数值非有限");
            if (spec.TryGetProperty("minimum", out var min) && number < min.GetDouble() || spec.TryGetProperty("maximum", out var max) && number > max.GetDouble()) errors.Add(path + " 数值越界");
        } else if (value.ValueKind == JsonValueKind.String) {
            var text = value.GetString()!;
            if (spec.TryGetProperty("pattern", out var pattern) && !Regex.IsMatch(text, pattern.GetString()!, RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1))) errors.Add(path + " 格式错误");
            if (spec.TryGetProperty("minLength", out var min) && text.Length < min.GetInt32() || spec.TryGetProperty("maxLength", out var max) && text.Length > max.GetInt32()) errors.Add(path + " 文本长度无效");
        }
    }
    private IEnumerable<(string Kind, string Id)> References(JsonElement value, JsonElement raw)
    {
        var spec = Resolve(raw);
        if (value.ValueKind == JsonValueKind.String && spec.TryGetProperty("x-reference", out var kind)) yield return (kind.GetString()!, value.GetString()!);
        if (spec.TryGetProperty("oneOf", out var alternatives)) {
            if (value.ValueKind == JsonValueKind.Object && value.TryGetProperty("type", out var type)) foreach (var alternative in alternatives.EnumerateArray()) if (alternative.GetProperty("properties").GetProperty("type").GetProperty("const").GetString() == type.GetString()) foreach (var reference in References(value, alternative)) yield return reference;
        } else if (value.ValueKind == JsonValueKind.Object && spec.TryGetProperty("properties", out var properties)) {
            foreach (var property in properties.EnumerateObject()) if (value.TryGetProperty(property.Name, out var child)) foreach (var reference in References(child, property.Value)) yield return reference;
        } else if (value.ValueKind == JsonValueKind.Array && spec.TryGetProperty("items", out var items)) foreach (var child in value.EnumerateArray()) foreach (var reference in References(child, items)) yield return reference;
    }
}
