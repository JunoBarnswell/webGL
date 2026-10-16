using System.Text.Json;
using System.Text.RegularExpressions;
using static Studio.DocumentContract;

namespace Studio;

public static class ExperienceContract
{
    public static void Validate(JsonElement doc, JsonElement schema, Dictionary<string, HashSet<string>> groups, List<string> errors, bool publish)
    {
        var entities = doc.GetProperty("entities").EnumerateArray().ToDictionary(e => Text(e,"id"));
        var contents = doc.GetProperty("contents").EnumerateArray().ToDictionary(e => Text(e,"id"));
        var tours = doc.GetProperty("tours").EnumerateArray().ToDictionary(e => Text(e,"id"));
        var variables = doc.GetProperty("variables").EnumerateArray().ToDictionary(e => Text(e,"id"));
        var ui = doc.GetProperty("ui");
        var nodes = ui.GetProperty("nodes").EnumerateArray().GroupBy(e => Text(e,"id")).ToDictionary(e=>e.Key,e=>e.First());
        bool Has(string id, string type) => entities.TryGetValue(id,out var entity) && entity.GetProperty("components").EnumerateArray().Any(c => Text(c,"type")==type && c.GetProperty("enabled").GetBoolean());
        void Ref(string kind, string id) { if(id!="" && (!groups.TryGetValue(kind,out var ids) || !ids.Contains(id))) errors.Add("无效的 "+kind+" 引用 "+id); }
        string ValueType(JsonElement v) => v.ValueKind switch {JsonValueKind.True or JsonValueKind.False=>"boolean",JsonValueKind.Number=>"number",JsonValueKind.String=>"string",_=>"invalid"};
        void Condition(JsonElement c, int depth=0) {
            if(depth>12) { errors.Add("条件嵌套超过 12 层"); return; }
            if(Text(c,"type")!="compare") { foreach(var child in c.GetProperty("conditions").EnumerateArray()) Condition(child,depth+1); return; }
            if(Text(c,"source")=="variable") Ref("variable",Text(c,"key"));
            else if(!new[]{"viewMode","displayMode","tour.status","contentId"}.Contains(Text(c,"key"))) errors.Add("未知运行状态字段");
        }
        var definitions = schema.GetProperty("$defs").GetProperty("action").GetProperty("oneOf").EnumerateArray().Where(a=>a.GetProperty("properties").GetProperty("type").TryGetProperty("const",out _)).ToDictionary(a => a.GetProperty("properties").GetProperty("type").GetProperty("const").GetString()!);
        void Actions(JsonElement actions, int depth=0) {
            if(depth>12) { errors.Add("动作分支嵌套超过 12 层"); return; }
            var ids=new HashSet<string>();
            foreach(var a in actions.EnumerateArray()) {
                if(!ids.Add(Text(a,"id"))) errors.Add("动作 ID 重复");
                var type=Text(a,"type"); if(!definitions.TryGetValue(type,out var definition)){if(publish)errors.Add("未知动作 "+type);continue;} var target=Text(a,"targetId");
                var kind=Text(definition,"x-target"); if(kind!="") { Ref(kind,target); if(publish && target=="") errors.Add(type+" 未指定目标"); }
                var capabilities=definition.GetProperty("x-components").EnumerateArray().Select(c=>c.GetString()!).ToArray();
                if(target!="" && capabilities.Length>0 && !capabilities.Any(c=>Has(target,c))) errors.Add(type+" 目标能力不匹配");
                if(type=="SetVariable" && variables.TryGetValue(target,out var variable) && Text(variable,"type")!=ValueType(a.GetProperty("data").GetProperty("value"))) errors.Add("变量赋值类型不匹配");
                if(a.GetProperty("wait").GetBoolean()) {
                    var loop=type=="PlayAnimation" && a.GetProperty("data").GetProperty("loop").GetBoolean();
                    loop |= (type is "StartCruise" or "ReplayCruise") && tours.TryGetValue(target,out var tour) && tour.GetProperty("loop").GetBoolean();
                    loop |= type=="PlayAudio" && entities.TryGetValue(target,out var e) && e.GetProperty("components").EnumerateArray().Any(c=>Text(c,"type")=="Audio" && c.GetProperty("data").GetProperty("loop").GetBoolean());
                    if(loop) errors.Add(type+" 循环播放不能等待自然结束");
                }
                if(a.TryGetProperty("condition",out var condition)) Condition(condition);
                if(a.TryGetProperty("then",out var yes)) Actions(yes,depth+1);
                if(a.TryGetProperty("else",out var no)) Actions(no,depth+1);
            }
        }
        foreach(var c in contents.Values) {
            Ref("asset",Text(c,"imageAssetId")); Ref("entity",Text(c,"audioEntityId")); Ref("layout",Text(c,"layoutId"));
            if(Text(c,"audioEntityId")!=""&&!Has(Text(c,"audioEntityId"),"Audio")) errors.Add(Text(c,"name")+" 解说音频引用无效");
            if(!ui.GetProperty("layouts").EnumerateArray().Any(l=>Text(l,"id")==Text(c,"layoutId")&&Text(l,"scope")=="content"))errors.Add("内容版式类型无效");
            var image=doc.GetProperty("assets").EnumerateArray().FirstOrDefault(a=>Text(a,"id")==Text(c,"imageAssetId"));
            if(image.ValueKind==JsonValueKind.Object&&!new[]{"image","texture"}.Contains(Text(image,"kind")))errors.Add("内容图片类型无效");
        }
        foreach(var e in entities.Values) foreach(var c in e.GetProperty("components").EnumerateArray()) if(publish&&Text(c,"type")=="Artwork"&&c.GetProperty("enabled").GetBoolean()&&(!contents.TryGetValue(Text(c.GetProperty("data"),"contentId"),out var content)||Text(content,"imageAssetId")==""))errors.Add(Text(e,"name")+" 作品图片未配置");
        if(publish)foreach(var material in doc.GetProperty("materials").EnumerateArray())foreach(var binding in material.GetProperty("maps").EnumerateObject())if(Text(binding.Value,"assetId")=="")errors.Add(Text(material,"name")+" 贴图尚未绑定资源");
        foreach(var v in doc.GetProperty("viewpoints").EnumerateArray()) {var thumbnail=doc.GetProperty("assets").EnumerateArray().FirstOrDefault(a=>Text(a,"id")==Text(v,"thumbnailAssetId"));if(thumbnail.ValueKind==JsonValueKind.Object&&!new[]{"image","texture"}.Contains(Text(thumbnail,"kind")))errors.Add("视点缩略图类型不匹配"); Ref("entity",Text(v,"anchorId")); Ref("asset",Text(v,"thumbnailAssetId")); }
        foreach(var t in tours.Values) {
            var stops=t.GetProperty("stops").EnumerateArray().ToArray(); if(stops.Select(s=>Text(s,"id")).Distinct().Count()!=stops.Length)errors.Add("停靠点 ID 重复");
            if(publish&&stops.Length<2)errors.Add(Text(t,"name")+" 至少需要两个视点"); foreach(var s in stops)Ref("viewpoint",Text(s,"viewpointId"));
        }
        foreach(var v in variables.Values) if(Text(v,"type")!=ValueType(v.GetProperty("initial")))errors.Add("变量初始值类型不匹配");
        foreach(var b in doc.GetProperty("behaviors").EnumerateArray()) {
            var eventType=Text(b,"event");var expectedKind=eventType switch {"ready"=>"scene","viewpointArrive"=>"viewpoint","tourEnd"=>"tour","variableChange"=>"variable","uiClick" or "uiChange"=>"ui","key"=>"key",_=>"entity"};
            var kind=Text(b,"sourceKind");if(kind!=expectedKind)errors.Add(Text(b,"name")+" 事件来源类型不匹配");if(kind is not ("scene" or "key"))Ref(kind,Text(b,"sourceId")); Condition(b.GetProperty("condition")); Actions(b.GetProperty("actions"));
            if(publish&&b.GetProperty("enabled").GetBoolean()&&(b.GetProperty("actions").GetArrayLength()==0||Text(b,"event")!="ready"&&Text(b,"sourceId")==""))errors.Add(Text(b,"name")+" 规则未配置完整");
        }
        foreach(var group in new[]{"layouts","nodes"}) {var list=ui.GetProperty(group).EnumerateArray().ToArray(); if(list.Select(n=>Text(n,"id")).Distinct().Count()!=list.Length || list.Any(n=>!Regex.IsMatch(Text(n,"id"),"^[a-zA-Z0-9_-]{1,100}$")))errors.Add("界面 ID 无效或重复");}
        foreach(var node in nodes.Values) {
            var image=doc.GetProperty("assets").EnumerateArray().FirstOrDefault(a=>Text(a,"id")==Text(node,"assetId"));if(Text(node,"kind")=="image"&&image.ValueKind==JsonValueKind.Object&&!new[]{"image","texture"}.Contains(Text(image,"kind")))errors.Add("界面图片类型不匹配");if(publish&&Text(node,"kind")=="image"&&Text(node,"binding")!="content.image"&&Text(node,"assetId")=="")errors.Add(Text(node,"name")+" 界面图片尚未绑定资源");
            var controlKind=Text(node,"kind") switch {"tourControls"=>"tour","viewpointList"=>"viewpoint","audioControls" or "animationControls" or "panoramaControls"=>"entity",_=>""};if(controlKind!="")Ref(controlKind,Text(node,"targetId"));
            var capability=Text(node,"kind") switch {"audioControls"=>"Audio","animationControls"=>"Animation","panoramaControls"=>"Panorama",_=>""};if(capability!=""&&Text(node,"targetId")!=""&&!Has(Text(node,"targetId"),capability))errors.Add("界面控制对象能力不匹配");
            Ref("layout",Text(node,"layoutId"));Ref("ui",Text(node,"parentId")); Ref("asset",Text(node,"assetId"));
            var cursor=node;var seen=new HashSet<string>();while(cursor.ValueKind==JsonValueKind.Object) {if(!seen.Add(Text(cursor,"id"))){errors.Add("界面层级存在环");break;}if(Text(cursor,"layoutId")!=Text(node,"layoutId")){errors.Add("界面跨版式挂载");break;}cursor=nodes.GetValueOrDefault(Text(cursor,"parentId"));}
            foreach(var style in new[]{"style","tablet","mobile"})foreach(var key in new[]{"width","height"})if(node.GetProperty(style).TryGetProperty(key,out var size)&&(size.ValueKind==JsonValueKind.Number?size.GetDouble()<=0:!Regex.IsMatch(size.GetString()!,"^(auto|fill|hug|[0-9]+(\\.[0-9]+)?%)$")))errors.Add("界面尺寸无效");
            if(node.GetProperty("action").ValueKind!=JsonValueKind.Null) {using var array=JsonDocument.Parse("["+node.GetProperty("action").GetRawText()+"]");Actions(array.RootElement);}
        }
    }
}
