using System.Text.Json;
namespace Studio;
public static class IndustrialSemantics {
    private sealed record Field(string Type,string Unit,bool Required);
    private static string T(JsonElement value,string key)=>DocumentContract.Text(value,key);
    private static JsonElement[] Rows(JsonElement value,string key)=>value.TryGetProperty(key,out var list)?list.EnumerateArray().ToArray():[];
    public static string[] Validate(JsonElement review,bool publish) {
        var errors=new List<string>();var classes=new Dictionary<string,JsonElement>();var templates=new Dictionary<string,JsonElement>();
        foreach(var item in Rows(review,"classes"))if(!classes.TryAdd(T(item,"id"),item))errors.Add("分类 ID 重复");
        foreach(var item in Rows(review,"propertyTemplates"))if(!templates.TryAdd(T(item,"id"),item))errors.Add("属性模板 ID 重复");
        foreach(var item in classes.Values) {
            try {
                var chain=new List<JsonElement>();var seen=new HashSet<string>();var cursor=item;
                while(true){var id=T(cursor,"id");if(!seen.Add(id))throw new ApiException(422,"分类层级循环");chain.Insert(0,cursor);var parent=T(cursor,"parentId");if(parent=="")break;if(!classes.TryGetValue(parent,out cursor))throw new ApiException(422,"分类父项不存在");}
                var fields=new Dictionary<string,Field>();
                void AddFields(JsonElement owner) {
                    var local=new HashSet<string>();
                    foreach(var field in Rows(owner,"fields")) {
                        var id=T(field,"id");if(!local.Add(id))throw new ApiException(422,"属性字段 ID 重复");
                        var type=T(field,"dataType");var unit=T(field,"unit");var required=field.GetProperty("required").GetBoolean();
                        if(fields.TryGetValue(id,out var inherited)){if(inherited.Type!=type||publish&&type=="number"&&!Units.Compatible(inherited.Unit,unit))throw new ApiException(422,"继承字段类型或量纲不兼容："+id);required|=inherited.Required;}
                        if(publish&&type=="number"){Units.Get(unit);var source=T(field,"sourceUnit");if(source!=""&&!Units.Compatible(source,unit))throw new ApiException(422,"源单位量纲不兼容："+id);}
                        fields[id]=new(type,unit,required);
                    }
                }
                foreach(var ancestor in chain){foreach(var id in Rows(ancestor,"templateIds").Select(v=>v.GetString()!)){if(!templates.TryGetValue(id,out var template))throw new ApiException(422,"属性模板不存在："+id);AddFields(template);}AddFields(ancestor);}
            }catch(ApiException error){errors.Add(error.Message);}
        }
        var systems=new HashSet<string>();
        foreach(var system in Rows(review,"systems")) {
            var systemId=T(system,"id");if(!systems.Add(systemId))errors.Add("系统 ID 重复");var members=Rows(system,"elementIds").Select(v=>v.GetString()!).ToHashSet();var ports=new Dictionary<string,JsonElement>();
            foreach(var port in Rows(system,"ports")){if(!ports.TryAdd(T(port,"id"),port))errors.Add("系统端口 ID 重复");if(!members.Contains(T(port,"elementId"))||T(port,"systemId")!=""&&T(port,"systemId")!=systemId)errors.Add("端口不属于系统成员："+T(port,"id"));}
            var connections=new HashSet<string>();foreach(var edge in Rows(system,"connections")){var id=T(edge,"id");if(!connections.Add(id))errors.Add("连接 ID 重复");if(!ports.TryGetValue(T(edge,"fromPortId"),out var from)||!ports.TryGetValue(T(edge,"toPortId"),out var to))errors.Add("连接端口不存在："+id);else if(T(edge,"direction")=="forward"&&(T(from,"direction")=="in"||T(to,"direction")=="out"))errors.Add("端口流向与连接方向冲突："+id);}
        }
        return errors.Distinct().ToArray();
    }
}
