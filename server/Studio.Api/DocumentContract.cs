using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Studio;

// Deliberately implements the finite keyword set in our embedded document contract.
// Schema changes are checked by the cross-language contract fixtures.
public sealed class DocumentContract
{
    private readonly JsonElement schema;
    public static readonly JsonElement Catalog = ReadCatalog();
    public static string CatalogHash => Text(Catalog,"hash");
    private static JsonElement ReadCatalog() { using var stream=typeof(DocumentContract).Assembly.GetManifestResourceStream("extension-catalog.json")!;return JsonDocument.Parse(stream).RootElement.Clone(); }
    public static JsonElement Migrate(JsonElement input) {
        if(input.TryGetProperty("documentVersion",out var version)) { if(version.ValueKind!=JsonValueKind.Number||version.GetInt32()!=2)throw new ApiException(422,"不支持的文档版本");return input; }
        var document=JsonNode.Parse(input.GetRawText())!.AsObject();document["documentVersion"]=2;document["requiredExtensions"]=new JsonArray();return JsonDocument.Parse(document.ToJsonString()).RootElement.Clone();
    }
    public DocumentContract()
    {
        using var stream = typeof(DocumentContract).Assembly.GetManifestResourceStream("scene-document.schema.json")!;
        schema = JsonDocument.Parse(stream).RootElement.Clone();
    }
    public static string Text(JsonElement value, string key) => value.TryGetProperty(key, out var found) ? found.GetString() ?? "" : "";
    private JsonElement Resolve(JsonElement spec) {
        if (!spec.TryGetProperty("$ref", out var reference)) return spec;
        if(reference.GetString()=="#")return schema;
        var node=schema;foreach(var key in reference.GetString()![2..].Split('/'))node=node.GetProperty(key);return node;
    }
    public JsonElement Compile(JsonElement document) => PrefabCompiler.Compile(document,schema);
    public string[] LibraryAssetIds(string type,JsonElement data){
        var spec=schema.GetProperty("$defs").GetProperty("libraryDocument").GetProperty("oneOf").EnumerateArray().First(d=>Text(d.GetProperty("properties").GetProperty("type"),"const")==type).GetProperty("properties").GetProperty("data");
        var ids=References(data,spec).Where(r=>r.Kind=="asset"&&r.Id!="").Select(r=>r.Id).ToList();if(data.TryGetProperty("assets",out var assets))ids.AddRange(assets.EnumerateArray().Select(a=>Text(a,"id")));return ids.Distinct().ToArray();
    }
    public void AssertLibraryData(string type,JsonElement data){
        var spec=schema.GetProperty("$defs").GetProperty("libraryDocument").GetProperty("oneOf").EnumerateArray().FirstOrDefault(d=>Text(d.GetProperty("properties").GetProperty("type"),"const")==type);
        if(spec.ValueKind==JsonValueKind.Undefined)throw new ApiException(422,"未知资源库文档类型");var errors=new List<string>();Check(data,spec.GetProperty("properties").GetProperty("data"),"$",errors);if(errors.Count>0)throw new ApiException(422,"资源库结构无效",errors.ToArray());
    }
    public void AssertComponentData(string type, JsonElement data) {
        var spec=schema.GetProperty("$defs").GetProperty("component").GetProperty("oneOf").EnumerateArray().FirstOrDefault(d=>d.GetProperty("properties").GetProperty("type").TryGetProperty("const",out var value)&&value.GetString()==type);
        if(spec.ValueKind==JsonValueKind.Undefined)throw new ApiException(422,"未知文档类型");
        var errors=new List<string>();Check(data,spec.GetProperty("properties").GetProperty("data"),"$",errors);if(errors.Count>0)throw new ApiException(422,"文档结构无效",errors.ToArray());
    }
    public string[] Validate(JsonElement document, bool publish = false)
    {
        var errors = new List<string>();
        Check(document, schema, "$", errors);
        if (errors.Count > 0) return errors.Take(30).ToArray();
        try { document=Compile(document); } catch(ApiException error) { return [error.Message]; }
        var available=Catalog.GetProperty("manifests").EnumerateArray().ToDictionary(m=>Text(m,"id"));
        var declared=new HashSet<string>();
        foreach(var requirement in document.GetProperty("requiredExtensions").EnumerateArray()) {
            var id=Text(requirement,"id");if(!declared.Add(id))errors.Add("扩展声明重复");
            if(publish&&(!available.TryGetValue(id,out var manifest)||!SupportsExtension(Text(manifest,"version"),Text(requirement,"version"))))errors.Add("缺失或不兼容扩展 "+id);
        }
        if(publish)foreach(var entity in document.GetProperty("entities").EnumerateArray())foreach(var component in entity.GetProperty("components").EnumerateArray()) {
            var type=Text(component,"type");var known=schema.GetProperty("$defs").GetProperty("component").GetProperty("oneOf").EnumerateArray().Any(s=>s.GetProperty("properties").GetProperty("type").TryGetProperty("const",out var identity)&&identity.GetString()==type);
            if(!known)errors.Add("缺失组件扩展 "+type);
            foreach(var manifest in available.Values)if(type.StartsWith(Text(manifest,"id")+".",StringComparison.Ordinal)&&!declared.Contains(Text(manifest,"id")))errors.Add("未声明扩展 "+Text(manifest,"id"));
        }
        var groups = new Dictionary<string, HashSet<string>>();
        foreach (var (kind, property) in new[] { ("entity", "entities"), ("asset", "assets"), ("material", "materials"), ("behavior", "behaviors"), ("content", "contents"), ("viewpoint", "viewpoints"), ("tour", "tours"), ("variable", "variables") }) {
            var ids = new HashSet<string>();
            foreach (var item in document.GetProperty(property).EnumerateArray()) {
                var id = Text(item, "id");
                if (!Regex.IsMatch(id, "^[a-zA-Z0-9_-]{1,100}$", RegexOptions.CultureInvariant) || !ids.Add(id)) errors.Add(kind + " ID 无效或重复: " + id);
            }
            groups[kind] = ids;
        }
        if (errors.Count > 0) return errors.Take(30).ToArray();
        groups["ui"] = document.GetProperty("ui").GetProperty("nodes").EnumerateArray().Select(n=>Text(n,"id")).ToHashSet();
        groups["layout"] = document.GetProperty("ui").GetProperty("layouts").EnumerateArray().Select(n=>Text(n,"id")).ToHashSet();
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
                if (publish && component.GetProperty("enabled").GetBoolean() && new[] { "Mesh", "Model", "Avatar", "Audio" }.Contains(type) && Text(data, "assetId") == "") errors.Add(id + "/" + type + " 未指定资源");
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
                    if(Text(data,"sourceStatus")!="unresolved"&&!nodeBindings.Add(modelId+":"+data.GetProperty("nodeIndex").GetInt32()))errors.Add("模型子节点索引重复绑定");
                }
                var expected=type switch {"Mesh"=>"mesh","Model" or "Avatar"=>"model","Audio"=>"audio","studio.virtualTour.Panorama"=>data.GetProperty("video").GetBoolean()?"video":"image",_=>""};
                if(expected!="") {
                    var asset=document.GetProperty("assets").EnumerateArray().FirstOrDefault(a=>Text(a,"id")==Text(data,"assetId"));
                    if(asset.ValueKind==JsonValueKind.Object&&Text(asset,"kind")!=expected&&!(expected=="image"&&Text(asset,"kind")=="texture"))errors.Add(Text(entity,"name")+"/"+type+" 资源类型不匹配");
                }
            }
        }
        var environmentCount=document.GetProperty("settings").GetProperty("environmentAssetIds").GetArrayLength();
        if(environmentCount!=0&&environmentCount!=6||document.GetProperty("materials").EnumerateArray().Any(m=>m.GetProperty("envAssetIds").GetArrayLength() is not (0 or 6)))errors.Add("环境立方体必须提供完整六面资源");
        foreach (var reference in References(document, schema)) if (reference.Id != "" && groups.ContainsKey(reference.Kind) && !groups[reference.Kind].Contains(reference.Id)) errors.Add("无效的 " + reference.Kind + " 引用 " + reference.Id);
        foreach (var asset in document.GetProperty("assets").EnumerateArray()) {
            var files = asset.GetProperty("files").EnumerateArray().Select(x => x.GetString()!).ToArray();
            if (!files.Contains(Text(asset, "entry")) || files.Any(x => !ObjectStore.ValidPath(x))) errors.Add(Text(asset, "name") + " 资源包路径非法");
        }
        var settings = document.GetProperty("settings");
        if (settings.GetProperty("near").GetDouble() >= settings.GetProperty("far").GetDouble()) errors.Add("近裁剪面必须小于远裁剪面");
        CreativeContract.Validate(document,errors,publish);
        SemanticContract.Validate(document,schema,errors,publish);
        ExperienceContract.Validate(document, schema, groups, errors, publish);
        return errors.Distinct().Take(30).ToArray();
    }
    public void AssertActions(JsonElement document,JsonElement actions) {
        if(actions.GetArrayLength()==0)return;
        var context=JsonNode.Parse(document.GetRawText())!.AsObject();
        context["behaviors"]!.AsArray().Add((JsonNode)new JsonObject { ["id"]=Database.Id(),["name"]="项目导览动作",["enabled"]=true,["sourceKind"]="scene",["sourceId"]="",["event"]="ready",["once"]=false,["concurrency"]="ignore",["condition"]=JsonNode.Parse("{\"type\":\"all\",\"conditions\":[]}"),["actions"]=JsonNode.Parse(actions.GetRawText()) });
        Assert(JsonDocument.Parse(context.ToJsonString()).RootElement,true);
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
        if(spec.TryGetProperty("not",out var excluded)){var local=new List<string>();Check(value,excluded,path,local);if(local.Count==0)errors.Add(path+" 不允许该值");}
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
    public static string RuntimeVersion=>Catalog.GetProperty("runtimeBuild").GetString()!;
    public static bool SupportsExtension(string installed,string requested)=>Regex.IsMatch(requested,@"^\d+\.\d+\.\d+$")&&Version.TryParse(installed,out var current)&&Version.TryParse(requested,out var needed)&&current.Major==needed.Major&&needed<=current;
    public sealed record ReferenceEdge(string Kind,string Id,string Path,string SceneId="",string OwnerId="",string OwnerKind="",string ComponentType="",string ModelRevision="",string SourceElementId="",string LibraryRevision="");
    public ReferenceEdge[] ReferenceEdges(JsonElement document) {
        var scene=Text(document,"sceneId");var entities=document.GetProperty("entities").EnumerateArray().ToDictionary(e=>Text(e,"id"));
        return References(document,schema).Select(edge=>{
            var revision="";var source="";var libraryRevision="";
            if(edge.OwnerKind=="entities"&&entities.TryGetValue(edge.OwnerId,out var entity)) {
                var binding=entity.GetProperty("components").EnumerateArray().FirstOrDefault(c=>Text(c,"type")=="ModelNode"&&c.GetProperty("enabled").GetBoolean());
                if(binding.ValueKind!=JsonValueKind.Undefined){revision=Text(binding.GetProperty("data"),"meshRevision");source=Text(binding.GetProperty("data"),"sourceElementId");}
                if(document.TryGetProperty("prefabs",out var instances))foreach(var instance in instances.EnumerateArray())if(instance.GetProperty("bindings").GetProperty("entity").EnumerateObject().Any(p=>p.Value.GetString()==edge.OwnerId)){libraryRevision=Text(instance,"revisionId");break;}
            }
            return edge with {SceneId=scene,ModelRevision=revision,SourceElementId=source,LibraryRevision=libraryRevision};
        }).OrderBy(edge=>edge.Path,StringComparer.Ordinal).ThenBy(edge=>edge.Kind,StringComparer.Ordinal).ToArray();
    }
    private IEnumerable<ReferenceEdge> References(JsonElement value,JsonElement raw,string path="",string owner="",string ownerKind="",string component="",JsonElement parent=default,string propertyKey="") {
        var spec=Resolve(raw);
        if(spec.TryGetProperty("x-reference-scope",out var scope)&&scope.GetString()=="local")yield break;
        if(value.ValueKind==JsonValueKind.Object&&Regex.IsMatch(path,@"^/(entities|materials|behaviors|contents|viewpoints|tours|ui/nodes)/\d+$")){owner=Text(value,"id");ownerKind=path.Split('/')[1];component="";}
        if(value.ValueKind==JsonValueKind.Object&&Regex.IsMatch(path,@"/components/\d+$"))component=Text(value,"type");
        var kind=spec.TryGetProperty("x-reference",out var referenceKind)?referenceKind.GetString()!:"";
        if(kind==""&&parent.ValueKind==JsonValueKind.Object){
            if(propertyKey=="sourceId"&&Text(parent,"sourceKind") is not ("scene" or "key"))kind=Text(parent,"sourceKind");
            if(propertyKey=="key"&&Text(parent,"type")=="compare"&&Text(parent,"source")=="variable")kind="variable";
            if(propertyKey=="targetId")kind=Text(parent,"kind") switch {"audioControls" or "animationControls" or "panoramaControls" or "configurator" or "storyboard" or "industrial"=>"entity","viewpointList"=>"viewpoint","tourControls"=>"tour",_=>""};
        }
        if(kind!=""&&value.ValueKind==JsonValueKind.String&&value.GetString()!="")yield return new(kind,value.GetString()!,path,OwnerId:owner,OwnerKind:ownerKind,ComponentType:component);
        if(spec.TryGetProperty("oneOf",out var alternatives)) {
            foreach(var alternative in alternatives.EnumerateArray()) {var errors=new List<string>();Check(value,alternative,"$",errors);if(errors.Count==0){foreach(var edge in References(value,alternative,path,owner,ownerKind,component,parent,propertyKey))yield return edge;break;}}
        } else if(value.ValueKind==JsonValueKind.Object&&spec.TryGetProperty("properties",out var properties)) {
            foreach(var property in properties.EnumerateObject()) {
                var hasPredicate=property.Value.TryGetProperty("x-visible-when",out var predicate)||property.Value.TryGetProperty("x-reference-when",out predicate);
                if(hasPredicate&&(!value.TryGetProperty(Text(predicate,"field"),out var discriminator)||!predicate.GetProperty("values").EnumerateArray().Any(item=>(item.ValueKind==JsonValueKind.String?item.GetString():item.GetRawText())==(discriminator.ValueKind==JsonValueKind.String?discriminator.GetString():discriminator.GetRawText()))))continue;
                if(value.TryGetProperty(property.Name,out var child))foreach(var edge in References(child,property.Value,path+"/"+property.Name.Replace("~","~0").Replace("/","~1"),owner,ownerKind,component,value,property.Name))yield return edge;
            }
        } else if(value.ValueKind==JsonValueKind.Array&&spec.TryGetProperty("items",out var items)) {var index=0;foreach(var child in value.EnumerateArray()){foreach(var edge in References(child,items,path+"/"+index,owner,ownerKind,component))yield return edge;index++;}}
    }
}
