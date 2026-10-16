using System.Text.Json;
using System.Text.Json.Nodes;
namespace Studio;

public static class PrefabCompiler
{
    private static readonly Dictionary<string,string> Groups = new() { ["entities"]="entity",["materials"]="material",["contents"]="content",["viewpoints"]="viewpoint",["tours"]="tour",["variables"]="variable",["behaviors"]="behavior" };
    private static JsonNode Copy(JsonNode node) => node.DeepClone();
    private static string Text(JsonNode? node) => node?.GetValue<string>() ?? "";
    private static JsonObject Object(JsonNode? node) => node?.AsObject() ?? throw new ApiException(422,"预制体对象缺失");
    private static JsonArray Array(JsonNode? node) => node?.AsArray() ?? throw new ApiException(422,"预制体集合缺失");
    public static JsonElement Compile(JsonElement input, JsonElement schema) {
        var result=CompileNode(JsonNode.Parse(input.GetRawText())!.AsObject(),schema,[]);
        return JsonSerializer.SerializeToElement(result,ApiJson.Default.JsonNode);
    }
    private static JsonElement Resolve(JsonElement spec, JsonElement schema) {
        if(!spec.TryGetProperty("$ref",out var reference)) return spec;
        var path=reference.GetString()!; if(path=="#") return schema;
        var node=schema;foreach(var key in path[2..].Split('/')) node=node.GetProperty(key);return node;
    }
    private static bool Matches(JsonNode? node,JsonElement raw,JsonElement schema) {
        var spec=Resolve(raw,schema);
        if(spec.TryGetProperty("const",out var constant))return JsonNode.DeepEquals(node,JsonNode.Parse(constant.GetRawText()));
        if(spec.TryGetProperty("type",out var type)&&type.ValueKind==JsonValueKind.String&&type.GetString()=="null")return node==null;
        if(spec.TryGetProperty("properties",out var props)&&props.TryGetProperty("type",out var discriminator)&&discriminator.TryGetProperty("const",out var identity))return node is JsonObject obj&&Text(obj["type"])==identity.GetString();
        if(spec.TryGetProperty("oneOf",out var choices))return choices.EnumerateArray().Any(c=>Matches(node,c,schema));
        return node!=null;
    }
    private static JsonNode? Remap(JsonNode? node,JsonElement raw,JsonObject bindings,JsonElement schema) {
        var spec=Resolve(raw,schema);
        if(spec.TryGetProperty("x-reference-scope",out var scope)&&scope.GetString()=="local")return node?.DeepClone();
        if(spec.TryGetProperty("oneOf",out var choices)) { var chosen=choices.EnumerateArray().FirstOrDefault(c=>Matches(node,c,schema));if(chosen.ValueKind!=JsonValueKind.Undefined)spec=Resolve(chosen,schema); }
        string Map(string kind,string value)=>Text(bindings[kind]?[value]) is {Length:>0} mapped?mapped:value;
        if(node is JsonValue value&&value.TryGetValue<string>(out var text)&&spec.TryGetProperty("x-reference",out var kind))return JsonValue.Create(Map(kind.GetString()!,text));
        if(node is JsonArray items) { var result=new JsonArray();var has=spec.TryGetProperty("items",out var itemSpec);foreach(var item in items)result.Add(has?Remap(item,itemSpec,bindings,schema):item?.DeepClone());return result; }
        if(node is JsonObject obj) {
            var result=new JsonObject();var has=spec.TryGetProperty("properties",out var props);
            foreach(var property in obj)result[property.Key]=has&&props.TryGetProperty(property.Key,out var child)?Remap(property.Value,child,bindings,schema):property.Value?.DeepClone();
            if(obj["sourceKind"]!=null&&obj["sourceId"]!=null)result["sourceId"]=Map(Text(obj["sourceKind"]),Text(obj["sourceId"]));
            if(Text(obj["type"])=="compare"&&Text(obj["source"])=="variable")result["key"]=Map("variable",Text(obj["key"]));
            var targetKind=Text(obj["kind"]) switch {"audioControls" or "animationControls" or "panoramaControls" or "configurator" or "storyboard" or "industrial"=>"entity","viewpointList"=>"viewpoint","tourControls"=>"tour",_=>""};
            if(targetKind!="")result["targetId"]=Map(targetKind,Text(obj["targetId"]));return result;
        }
        return node?.DeepClone();
    }
    private static JsonObject CompileNode(JsonObject document,JsonElement schema,List<string> chain) {
        if(document["prefabs"] is not JsonArray instances||instances.Count==0)return document;
        foreach(var raw in instances) {
            var instance=Object(raw);var bindings=Object(instance["bindings"]);
            foreach(var (group,kind) in Groups) { var generated=Object(bindings[kind]).Select(p=>Text(p.Value)).ToHashSet();var items=Array(document[group]);for(var n=items.Count-1;n>=0;n--)if(generated.Contains(Text(items[n]?["id"])))items.RemoveAt(n); }
            foreach(var (group,kind) in new[]{("nodes","ui"),("layouts","layout")}) {var generated=Object(bindings[kind]).Select(p=>Text(p.Value)).ToHashSet();var items=Array(document["ui"]?[group]);for(var n=items.Count-1;n>=0;n--)if(generated.Contains(Text(items[n]?["id"])))items.RemoveAt(n);}
        }
        var unique=Array(document["entities"]).Select(e=>Text(e?["id"])).ToHashSet();
        foreach(var raw in instances) {
            var instance=Object(raw);var bindings=Object(instance["bindings"]);var prefabId=Text(instance["prefabId"]);
            if(chain.Count>=8||chain.Contains(prefabId))throw new ApiException(422,"预制体循环或嵌套过深");
            var source=CompileNode(Object(instance["source"]?.DeepClone()),schema,[..chain,prefabId]);
            foreach(var addition in Array(instance["additions"]))Array(source["entities"]).Add(addition?.DeepClone());
            var removed=Array(instance["tombstones"]).Select(n=>Text(n)).ToHashSet();
            for(var changed=true;changed;) {changed=false;foreach(var entity in Array(source["entities"]))if(removed.Contains(Text(entity?["parentId"]))&&removed.Add(Text(entity?["id"])))changed=true;}
            var entities=Array(source["entities"]);for(var i=entities.Count-1;i>=0;i--)if(removed.Contains(Text(entities[i]?["id"])))entities.RemoveAt(i);
            foreach(var value in Array(instance["overrides"])) {
                var change=Object(value);var local=Text(change["localId"]);var component=Text(change["componentType"]);var path=Array(change["path"]).Select(n=>Text(n)).ToArray();
                if(path.Any(p=>p is "__proto__" or "constructor" or "prototype"))throw new ApiException(422,"覆盖路径非法");
                JsonNode target=(component=="$material"?Array(source["materials"]):entities).FirstOrDefault(e=>Text(e?["id"])==local)??throw new ApiException(422,"覆盖目标已丢失");
                if(component!=""&&component!="$material") {
                    var components=Array(target["components"]);var existing=components.FirstOrDefault(c=>Text(c?["type"])==component);
                    if(path.Length==0) {if(existing!=null)components.Remove(existing);if(change["remove"]!.GetValue<bool>()==false)components.Add(change["value"]?.DeepClone());continue;}
                    target=existing??throw new ApiException(422,"覆盖组件已丢失");
                }
                if(path.Length==0)throw new ApiException(422,"覆盖路径为空");
                foreach(var key in path[..^1])target=target[key]??throw new ApiException(422,"覆盖路径不可解析");
                if(change["remove"]!.GetValue<bool>())Object(target).Remove(path[^1]);else target[path[^1]]=change["value"]?.DeepClone();
            }
            if(!entities.Any(e=>Text(e?["id"])==Text(instance["rootLocalId"])))throw new ApiException(422,"预制体根节点已丢失");
            var mapped=Object(Remap(source,schema,bindings,schema));
            foreach(var (group,kind) in Groups)foreach(var item in Array(mapped[group])) {
                var local=Text(item?["id"]);var id=Text(bindings[kind]?[local]);if(id=="")throw new ApiException(422,"预制体映射缺失");
                if(kind=="entity"&&!unique.Add(id))throw new ApiException(422,"预制体实体映射冲突");
                item!["id"]=id;
                if(kind=="entity"&&local==Text(instance["rootLocalId"])) {item["name"]=Copy(instance["name"]!);item["parentId"]=instance["parentId"]?.DeepClone();item["transform"]=Copy(instance["transform"]!);}
                Array(document[group]).Add(item.DeepClone());
            }
            foreach(var (group,kind) in new[]{("nodes","ui"),("layouts","layout")})foreach(var item in Array(mapped["ui"]?[group])) {var id=Text(bindings[kind]?[Text(item?["id"])]);if(id=="")throw new ApiException(422,"预制体 UI 映射缺失");item!["id"]=id;Array(document["ui"]?[group]).Add(item.DeepClone());}
            foreach(var asset in Array(source["assets"]))if(!Array(document["assets"]).Any(a=>Text(a?["id"])==Text(asset?["id"])))Array(document["assets"]).Add(asset?.DeepClone());
            foreach(var requirement in Array(source["requiredExtensions"]))if(!Array(document["requiredExtensions"]).Any(r=>Text(r?["id"])==Text(requirement?["id"])))Array(document["requiredExtensions"]).Add(requirement?.DeepClone());
            if(Array(document["entities"]).Count>100000)throw new ApiException(422,"预制体实体限额超出");
        }
        return document;
    }
}
