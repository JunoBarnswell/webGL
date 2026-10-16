using System.Text.Json;
using System.Text.Json.Nodes;
namespace Studio;
/** Scalar mapping and provenance; database and browser consume this same typed value shape. */
public static class SemanticMapping {
    public static void Validate(JsonElement[] fields) {
        var ids=new HashSet<string>();
        foreach(var field in fields) {
            if(field.ValueKind!=JsonValueKind.Object)throw new ApiException(422,"属性定义必须为对象");
            foreach(var name in new[]{"id","name","dataType","unit","sourcePath","sourceUnit","emptyPolicy","defaultValue"})if(!field.TryGetProperty(name,out var value)||value.ValueKind!=JsonValueKind.String)throw new ApiException(422,"属性定义缺少字符串字段："+name);
            var id=DocumentContract.Text(field,"id");if(id.Length is <1 or >200||id is "__proto__" or "constructor" or "prototype"||!ids.Add(id))throw new ApiException(422,"属性字段 ID 无效或重复");
            if(!field.TryGetProperty("required",out var required)||required.ValueKind is not (JsonValueKind.True or JsonValueKind.False))throw new ApiException(422,"属性定义缺少 required");
            if(DocumentContract.Text(field,"dataType") is not ("string" or "number" or "boolean")||DocumentContract.Text(field,"emptyPolicy") is not ("keep" or "default" or "reject"))throw new ApiException(422,"属性映射类型或空值策略无效");
            if(DocumentContract.Text(field,"dataType")=="number") {var to=DocumentContract.Text(field,"unit");Units.Get(to);var from=DocumentContract.Text(field,"sourceUnit");if(from!=""&&!Units.Compatible(from,to))throw new ApiException(422,"源单位量纲不兼容："+id);}
        }
    }
    public static (bool Empty,bool Changed,string? Error) Apply(JsonObject record,JsonElement field) {
        var properties=record["properties"]!.AsObject();var path=DocumentContract.Text(field,"sourcePath");var id=DocumentContract.Text(field,"id");var boxed=properties[path];var box=boxed as JsonObject;
        var raw=(box?.ContainsKey("value")==true?box["value"]:boxed)?.DeepClone();var missing=raw==null||raw.ToJsonString()=="\"\"";var origin="source";
        if(missing){var policy=DocumentContract.Text(field,"emptyPolicy");if(policy=="keep"&&!field.GetProperty("required").GetBoolean())return(true,false,null);if(policy=="default"){raw=JsonValue.Create(DocumentContract.Text(field,"defaultValue"));origin="default";}else return(true,false,"缺失");}
        try {
            var type=DocumentContract.Text(field,"dataType");var targetUnit=DocumentContract.Text(field,"unit");var sourceUnit=origin=="default"?targetUnit:DocumentContract.Text(field,"sourceUnit");if(sourceUnit==""&&origin!="default")sourceUnit=box?["unit"]?.GetValue<string>()??"";
            using var parsed=JsonDocument.Parse(raw!.ToJsonString());var value=parsed.RootElement;JsonNode mapped;
            if(type=="number")mapped=JsonValue.Create(Units.Convert(Units.Number(value),sourceUnit,targetUnit))!;
            else if(type=="boolean") {var text=value.ValueKind==JsonValueKind.String?value.GetString():value.ValueKind==JsonValueKind.Number?Units.NumberText(Units.Number(value)):value.GetRawText();if(text is not ("true" or "false" or "1" or "0"))throw new FormatException("非法布尔值");mapped=JsonValue.Create(text is "true" or "1")!;}
            else {if(value.ValueKind is not (JsonValueKind.String or JsonValueKind.Number or JsonValueKind.True or JsonValueKind.False))throw new FormatException("字符串映射只接受标量");mapped=JsonValue.Create(value.ValueKind==JsonValueKind.String?value.GetString():value.ValueKind==JsonValueKind.Number?Units.NumberText(Units.Number(value)):value.GetRawText())!;}
            var provenance=new JsonObject{["path"]=path,["rawValue"]=raw,["rawUnit"]=origin=="source"&&box?["unit"]!=null?box["unit"]!.DeepClone():JsonValue.Create(sourceUnit),["modelRevision"]=record["modelRevision"]?.DeepClone()??JsonValue.Create(""),["sourceElementId"]=record["sourceElementId"]?.DeepClone()??JsonValue.Create(""),["origin"]=origin};
            if(DocumentContract.Text(field,"sourceUnit")!="")provenance["declaredUnit"]=DocumentContract.Text(field,"sourceUnit");
            if(box?["source"]!=null)provenance["upstream"]=box["source"]!.DeepClone();
            properties[id]=new JsonObject{["value"]=mapped,["unit"]=targetUnit,["source"]=provenance};return(missing,true,null);
        }catch(Exception error)when(error is FormatException or InvalidOperationException or ApiException){return(missing,false,error.Message);}
    }
}
