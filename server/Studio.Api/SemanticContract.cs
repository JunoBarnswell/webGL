using System.Text.Json;
namespace Studio;
public static class SemanticContract
{
    public static void Validate(JsonElement document,JsonElement schema,List<string> errors,bool publish)
    {
        var entities=document.GetProperty("entities").EnumerateArray().ToDictionary(e=>DocumentContract.Text(e,"id"));
        var definitions=schema.GetProperty("$defs").GetProperty("component").GetProperty("oneOf").EnumerateArray().Where(d=>d.GetProperty("properties").GetProperty("type").TryGetProperty("const",out _)).ToDictionary(d=>DocumentContract.Text(d.GetProperty("properties").GetProperty("type"),"const"));
        var unique=new Dictionary<string,string>();
        void Fields(JsonElement data,JsonElement fields,string owner,string type,bool enabled,string path)
        {
            foreach(var field in fields.EnumerateObject()){
                var spec=field.Value;
                var active=spec.TryGetProperty("x-visible-when",out var predicate)||spec.TryGetProperty("x-reference-when",out predicate);
                if(active&&(!data.TryGetProperty(DocumentContract.Text(predicate,"field"),out var discriminatorValue)||!predicate.GetProperty("values").EnumerateArray().Any(item=>JsonElement.DeepEquals(item,discriminatorValue))))continue;
                data.TryGetProperty(field.Name,out var value);var where=owner+"/"+path+"."+field.Name;
                var required=spec.TryGetProperty("x-required-publish",out var flag)&&flag.GetBoolean();
                if(spec.TryGetProperty("x-required-when",out var when)&&data.TryGetProperty(DocumentContract.Text(when,"field"),out var discriminator))required|=discriminator.ValueKind==JsonValueKind.String&&(when.TryGetProperty("values",out var values)?values.EnumerateArray().Any(v=>v.GetString()==discriminator.GetString()):discriminator.GetString()==DocumentContract.Text(when,"value"));
                if(publish&&enabled&&required&&(value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined||value.ValueKind==JsonValueKind.String&&value.GetString()==""))errors.Add(where+" 尚未配置");
                if(publish&&enabled&&value.ValueKind!=JsonValueKind.Undefined&&spec.TryGetProperty("x-publish-enum",out var allowed)&&!allowed.EnumerateArray().Any(item=>JsonElement.DeepEquals(item,value)))errors.Add(where+" 存在未解决的来源状态");
                if(spec.TryGetProperty("x-less-than",out var bound)&&value.ValueKind==JsonValueKind.Number&&data.TryGetProperty(bound.GetString()!,out var endpoint)&&value.GetDouble()>=endpoint.GetDouble())errors.Add(where+" 范围无效");
                var capabilities=spec.TryGetProperty("x-target-components",out var choices)?choices.EnumerateArray().Select(item=>item.GetString()!).ToArray():spec.TryGetProperty("x-target-component",out var capability)?new[]{capability.GetString()!}:Array.Empty<string>();
                if(capabilities.Length>0&&value.ValueKind==JsonValueKind.String&&value.GetString()!=""&&(!entities.TryGetValue(value.GetString()!,out var target)||!target.GetProperty("components").EnumerateArray().Any(c=>capabilities.Contains(DocumentContract.Text(c,"type"))&&c.GetProperty("enabled").GetBoolean())))errors.Add(where+" 目标能力不匹配");
                if(spec.TryGetProperty("x-unique",out var distinct)&&distinct.GetBoolean()&&value.ValueKind==JsonValueKind.String&&value.GetString()!=""){var key=type+":"+path+"."+field.Name+":"+value.GetRawText();if(unique.TryGetValue(key,out var other)&&other!=owner)errors.Add(where+" 重复");unique[key]=owner;}
                if(value.ValueKind==JsonValueKind.Array){
                    if(spec.TryGetProperty("x-sum",out var sum)&&Math.Abs(value.EnumerateArray().Sum(item=>item.GetDouble())-sum.GetDouble())>.001)errors.Add(where+" 坐标和无效");
                    if(spec.TryGetProperty("x-unique-by",out var identity)){var ids=value.EnumerateArray().Select(item=>DocumentContract.Text(item,identity.GetString()!)).ToArray();if(ids.Distinct().Count()!=ids.Length)errors.Add(where+" 存在重复身份");}
                    if(spec.TryGetProperty("items",out var itemSpec)&&itemSpec.TryGetProperty("properties",out var nested)){var i=0;foreach(var item in value.EnumerateArray()){if(item.ValueKind==JsonValueKind.Object)Fields(item,nested,owner,type,enabled,path+"."+field.Name+"["+i+"]");i++;}}
                }else if(value.ValueKind==JsonValueKind.Object&&spec.TryGetProperty("properties",out var nested))Fields(value,nested,owner,type,enabled,path+"."+field.Name);
            }
        }
        foreach(var entity in entities.Values)foreach(var component in entity.GetProperty("components").EnumerateArray()){
            var type=DocumentContract.Text(component,"type");if(!definitions.TryGetValue(type,out var definition))continue;var enabled=component.GetProperty("enabled").GetBoolean();var data=component.GetProperty("data");
            Fields(data,definition.GetProperty("properties").GetProperty("data").GetProperty("properties"),DocumentContract.Text(entity,"id"),type,enabled,type);
            if(publish&&enabled&&definition.TryGetProperty("x-anchor",out var anchor)&&anchor.GetBoolean()&&DocumentContract.Text(data,"anchorKind")=="surface"){
                if(!entities.TryGetValue(DocumentContract.Text(data,"entityId"),out var target)){errors.Add("标注附着目标不存在");continue;}
                var binding=target.GetProperty("components").EnumerateArray().FirstOrDefault(c=>DocumentContract.Text(c,"type")=="ModelNode"&&c.GetProperty("enabled").GetBoolean());
                var mesh=target.GetProperty("components").EnumerateArray().FirstOrDefault(c=>DocumentContract.Text(c,"type")=="Mesh"&&c.GetProperty("enabled").GetBoolean());
                var revision="";var identity=DocumentContract.Text(target,"id");
                if(binding.ValueKind==JsonValueKind.Object){var source=binding.GetProperty("data");revision=DocumentContract.Text(source,"meshRevision");identity=DocumentContract.Text(source,"sourceElementId");if(DocumentContract.Text(source,"sourceStatus")=="unresolved")errors.Add("标注来源模型未解决");}
                else if(mesh.ValueKind==JsonValueKind.Object){var asset=document.GetProperty("assets").EnumerateArray().FirstOrDefault(a=>DocumentContract.Text(a,"id")==DocumentContract.Text(mesh.GetProperty("data"),"assetId"));if(asset.ValueKind==JsonValueKind.Object)revision=DocumentContract.Text(asset,"sha256");}
                if(revision!=DocumentContract.Text(data,"meshRevision")||identity!=DocumentContract.Text(data,"sourceElementId"))errors.Add("标注来源或网格版本需要修复");
            }
        }
    }
    public static void ActionOptions(JsonElement document,JsonElement definition,JsonElement action,List<string> errors,bool publish)
    {
        var targetId=DocumentContract.Text(action,"targetId");var data=action.GetProperty("data");var entities=document.GetProperty("entities").EnumerateArray().ToArray();
        foreach(var field in definition.GetProperty("properties").GetProperty("data").GetProperty("properties").EnumerateObject()){
            if(!field.Value.TryGetProperty("x-options",out var rule))continue;var options=new HashSet<string>();
            foreach(var entity in entities){var c=entity.GetProperty("components").EnumerateArray().FirstOrDefault(c=>DocumentContract.Text(c,"type")==DocumentContract.Text(rule,"component")&&c.GetProperty("enabled").GetBoolean());if(c.ValueKind!=JsonValueKind.Object)continue;var related=DocumentContract.Text(c.GetProperty("data"),DocumentContract.Text(rule,"relation"));
                if(related!=targetId){var parent=entities.FirstOrDefault(e=>DocumentContract.Text(e,"id")==related);if(parent.ValueKind!=JsonValueKind.Object)continue;var root=parent.GetProperty("components").EnumerateArray().FirstOrDefault(c=>DocumentContract.Text(c,"type")==DocumentContract.Text(rule,"rootComponent")&&c.GetProperty("enabled").GetBoolean());if(root.ValueKind!=JsonValueKind.Object||DocumentContract.Text(root.GetProperty("data"),DocumentContract.Text(rule,"rootField"))!=targetId)continue;}
                if(c.GetProperty("data").TryGetProperty(DocumentContract.Text(rule,"array"),out var rows)&&rows.ValueKind==JsonValueKind.Array)foreach(var row in rows.EnumerateArray())options.Add(DocumentContract.Text(row,DocumentContract.Text(rule,"value")));
            }
            var value=DocumentContract.Text(data,field.Name);var required=publish&&field.Value.TryGetProperty("x-required-publish",out var flag)&&flag.GetBoolean();if((value!=""||required)&&!options.Contains(value))errors.Add(field.Name+" 引用的步骤不存在");
        }
    }

}
