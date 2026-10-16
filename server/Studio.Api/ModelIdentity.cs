using System.Text.Json;
namespace Studio;
/** Same canonical source identity contract as scene-schema/model-identity.ts. */
public static class ModelIdentity {
    private static string Encode(string value)=>Uri.EscapeDataString(value).Replace("%21","!").Replace("%27","'").Replace("%28","(").Replace("%29",")").Replace("%2A","*");
    public static Dictionary<int,string> Read(JsonElement definition) {
        var nodes=definition.TryGetProperty("nodes",out var list)?list.EnumerateArray().ToArray():[];
        var scene=definition.TryGetProperty("scene",out var selected)?selected.GetInt32():0;
        var roots=definition.TryGetProperty("scenes",out var scenes)&&scene>=0&&scene<scenes.GetArrayLength()&&scenes[scene].TryGetProperty("nodes",out var indices)?indices.EnumerateArray().Select(v=>v.GetInt32()).ToArray():[];
        var result=new Dictionary<int,string>();var used=new HashSet<string>();
        void Visit(int index,string parent,bool unstable,int[] siblings) {
            if(result.ContainsKey(index))throw new ApiException(422,"模型层级重复或循环");
            if(index<0||index>=nodes.Length)throw new ApiException(422,"模型节点越界");
            var node=nodes[index];string external="";
            if(node.TryGetProperty("extras",out var extras)&&extras.ValueKind==JsonValueKind.Object)foreach(var key in new[]{"sourceElementId","ElementId","GlobalId","guid"}) {
                if(!extras.TryGetProperty(key,out var value)||value.ValueKind==JsonValueKind.Null)continue;
                if(value.ValueKind is not (JsonValueKind.String or JsonValueKind.Number))throw new ApiException(422,"模型来源身份必须为字符串或数字");
                if(value.ValueKind==JsonValueKind.Number&&(!value.TryGetDouble(out var numeric)||!double.IsFinite(numeric)||numeric!=Math.Truncate(numeric)||Math.Abs(numeric)>9007199254740991))throw new ApiException(422,"数字来源身份必须为安全整数");
                external=value.ValueKind==JsonValueKind.String?value.GetString()!:value.GetDouble()==0?"":value.GetDouble().ToString("F0",System.Globalization.CultureInfo.InvariantCulture);break;
            }
            var name=DocumentContract.Text(node,"name");
            var ambiguous=unstable||name==""||siblings.Count(i=>i>=0&&i<nodes.Length&&DocumentContract.Text(nodes[i],"name")==name)>1;
            var identity=external!=""?"external:"+external:ambiguous?"unresolved:"+parent+"/"+Encode(name)+"#"+index:parent+"/"+Encode(name);
            if(!used.Add(identity))throw new ApiException(422,"模型来源身份不唯一："+identity);
            result[index]=identity;
            var children=node.TryGetProperty("children",out var childList)?childList.EnumerateArray().Select(v=>v.GetInt32()).ToArray():[];
            foreach(var child in children)Visit(child,identity,external==""&&ambiguous,children);
        }
        foreach(var root in roots)Visit(root,"",false,roots);return result;
    }
}
