using System.Text.Json;
namespace Studio;
/** Canonical catalog ownership and default per-primitive admission; no rendering objects enter the document. */
public static class ConfigurationVisuals {
    private static string T(JsonElement value,string key)=>DocumentContract.Text(value,key);
    private static JsonElement[] A(JsonElement value,string key)=>value.TryGetProperty(key,out var array)?array.EnumerateArray().ToArray():[];
    private static JsonElement Component(JsonElement entity,string type)=>A(entity,"components").FirstOrDefault(c=>T(c,"type")==type&&c.GetProperty("enabled").GetBoolean());
    public static Dictionary<string,List<string>> Ownership(JsonElement document,IEnumerable<DocumentContract.ReferenceEdge> references) {
        var entities=A(document,"entities").ToDictionary(e=>T(e,"id"));var catalogs=entities.Values.Where(e=>Component(e,"studio.configurator.Catalog").ValueKind==JsonValueKind.Object).Select(e=>T(e,"id")).ToArray();var targets=catalogs.ToDictionary(id=>id,_=>new HashSet<string>());
        foreach(var edge in references)if(edge.Kind=="entity"&&edge.ComponentType=="studio.configurator.Catalog"&&targets.TryGetValue(edge.OwnerId,out var set))set.Add(edge.Id);
        bool Under(string id,HashSet<string> ancestors){var seen=new HashSet<string>();while(entities.TryGetValue(id,out var entity)&&seen.Add(id)){if(ancestors.Contains(id))return true;id=entity.GetProperty("parentId").GetString()??"";}return false;}
        var claims=new Dictionary<string,HashSet<string>>();
        foreach(var(owner,ids)in targets){var models=new HashSet<string>();foreach(var target in ids){var current=target;var found=false;var seen=new HashSet<string>();while(entities.TryGetValue(current,out var entity)&&seen.Add(current)){var node=Component(entity,"ModelNode");if(node.ValueKind==JsonValueKind.Object){models.Add(T(node.GetProperty("data"),"modelEntityId"));found=true;break;}if(Component(entity,"Model").ValueKind==JsonValueKind.Object){models.Add(current);found=true;break;}current=entity.GetProperty("parentId").GetString()??"";}if(!found)foreach(var model in entities.Values.Where(e=>Component(e,"Model").ValueKind==JsonValueKind.Object))if(Under(T(model,"id"),[target]))models.Add(T(model,"id"));}claims[owner]=models;}
        var errors=new Dictionary<string,List<string>>();for(var i=0;i<catalogs.Length;i++)for(var j=i+1;j<catalogs.Length;j++){var a=catalogs[i];var b=catalogs[j];if(claims[a].Overlaps(claims[b])||targets[a].Any(id=>Under(id,targets[b]))||targets[b].Any(id=>Under(id,targets[a]))){var message="同一模型或槽位由多个目录控制："+T(entities[a],"name")+" ↔ "+T(entities[b],"name")+"；请把配置维度合并为同一目录的属性组";if(!errors.TryGetValue(a,out var first))errors[a]=first=[];if(!errors.TryGetValue(b,out var second))errors[b]=second=[];first.Add(message);second.Add(message);}}
        return errors;
    }
    public static string[] ValidateCatalog(JsonElement data) {
        var errors=new List<string>();var ids=new HashSet<string>();
        foreach(var group in A(data,"groups"))foreach(var mapping in A(group,"visuals").Concat(A(group,"options").SelectMany(o=>A(o,"visuals")))){
            var id=T(mapping,"id");if(id==""||!ids.Add(id))errors.Add("视觉映射 ID 为空或重复："+id);
            var operation=T(mapping,"operation");var numeric=T(group,"control")=="number"&&A(group,"visuals").Any(m=>JsonElement.DeepEquals(m,mapping));
            if(numeric){
                if(operation is not ("transform" or "opacity"))errors.Add("数值属性支持变换或透明度映射："+id);
                var binding=mapping.TryGetProperty("numericBinding",out var configured)?configured:default;
                if(operation=="transform"&&binding.ValueKind!=JsonValueKind.Object)errors.Add("数值变换需要明确绑定属性、轴和单位："+id);
                try{var property=binding.ValueKind==JsonValueKind.Object?T(binding,"property"):"opacity";var target=property=="position"?"mm":property=="rotation"?"rad":"1";var unit=T(group,"numericUnit");if(unit=="")unit=target=="rad"?"deg":target;
                    var reference=binding.ValueKind==JsonValueKind.Object&&binding.TryGetProperty("reference",out var baseline)?baseline.GetDouble():0;
                    if(target=="1"&&reference>0)_=Units.Get(unit);else if(!Units.Compatible(unit,target))errors.Add("数值映射单位不兼容："+id);
                    if(binding.ValueKind==JsonValueKind.Object){if(reference<0)errors.Add("数值映射基准不可为负："+id);if(property=="rotation"&&T(binding,"axis")=="all")errors.Add("旋转绑定必须选择单轴："+id);if(operation=="opacity"&&property!="opacity"||operation=="transform"&&property=="opacity")errors.Add("数值绑定与操作不匹配："+id);}
                }catch(ApiException){errors.Add("数值映射单位不兼容："+id);}
            }else if(operation=="opacity")try{var value=Units.Number(T(mapping,"value"));if(value<0||value>1)errors.Add("透明度必须为 0～1 的数值："+id);}catch(FormatException){errors.Add("透明度必须为 0～1 的数值："+id);}
            if(operation=="visibility"&&T(mapping,"value") is not ("true" or "false"))errors.Add("可见性必须明确为 true 或 false："+id);
        }
        foreach(var part in A(data,"groups").SelectMany(g=>A(g,"options")).SelectMany(o=>A(o,"bom")).GroupBy(p=>T(p,"partId")))if(!double.IsFinite(part.Sum(p=>p.GetProperty("quantity").GetDouble())))errors.Add("BOM 数量求和超出有限范围："+part.Key);
        return errors.Distinct().ToArray();
    }
    private sealed record Mapping(JsonElement Spec,string Group,string Option,double Priority,double? Number,string Unit);
    public static async Task<ReadinessCheck[]> Check(JsonElement document,string sceneId,Func<string,Task<JsonElement>> definition) {
        var checks=new List<ReadinessCheck>();var entities=A(document,"entities").ToDictionary(e=>T(e,"id"));
        bool Under(string id,string ancestor){var seen=new HashSet<string>();while(entities.TryGetValue(id,out var entity)&&seen.Add(id)){if(id==ancestor)return true;id=entity.GetProperty("parentId").GetString()??"";}return false;}
        HashSet<int> GltfScope(JsonElement gltf,IEnumerable<int> roots,HashSet<int>? excluded=null){var result=new HashSet<int>();var nodes=A(gltf,"nodes");var pending=new Stack<int>(roots);while(pending.Count>0){var index=pending.Pop();if(index<0||index>=nodes.Length||excluded?.Contains(index)==true||!result.Add(index))continue;foreach(var child in A(nodes[index],"children"))pending.Push(child.GetInt32());}return result;}
        foreach(var entity in entities.Values) {
            var component=Component(entity,"studio.configurator.Catalog");if(component.ValueKind!=JsonValueKind.Object)continue;
            var owner=T(entity,"id");var data=component.GetProperty("data");var solved=ConfigurationRules.ResolveDefaults(data);if(solved.Errors.Length>0)continue;
            void Fail(string message,string field="")=>checks.Add(new("visual","fail","error",message,field,owner,sceneId,[]));
            var selected=new List<Mapping>();
            foreach(var group in A(data,"groups")){var id=T(group,"id");if(T(group,"control")=="number")foreach(var mapping in A(group,"visuals"))selected.Add(new(mapping,id,"",mapping.TryGetProperty("priority",out var priority)?priority.GetDouble():0,solved.NumericValues[id],T(group,"numericUnit")));else foreach(var option in A(group,"options").Where(o=>solved.Selections[id].Contains(T(o,"id"))))foreach(var mapping in A(option,"visuals"))selected.Add(new(mapping,id,T(option,"id"),mapping.TryGetProperty("priority",out var priority)?priority.GetDouble():0,null,""));}
            var slots=new Dictionary<string,Mapping>();foreach(var grouping in selected.Where(m=>T(m.Spec,"operation")=="swapPart").GroupBy(m=>T(m.Spec,"targetId"))){var ordered=grouping.OrderByDescending(m=>m.Priority).ToArray();if(ordered.Where(m=>m.Priority==ordered[0].Priority).Select(m=>T(m.Spec,"assetId")).Distinct().Count()>1){Fail("同优先级部件映射冲突："+grouping.Key);continue;}slots[grouping.Key]=ordered[0];}
            foreach(var a in slots.Keys)foreach(var b in slots.Keys)if(a!=b&&Under(a,b))Fail("配置部件槽位重叠："+a+" / "+b);
            var candidates=new Dictionary<string,List<(int Material,double Priority,string Mapping,string Variant)>>();var globalVariants=new Dictionary<string,string>();
            foreach(var mapping in selected.Where(m=>T(m.Spec,"operation")=="variant")) {
                var spec=mapping.Spec;var target=T(spec,"targetId");var variant=T(spec,"variant");var field="/entities/"+Array.FindIndex(A(document,"entities"),e=>T(e,"id")==owner)+"/components";
                try {
                    var slot=slots.Keys.FirstOrDefault(slot=>Under(target,slot));var targetEntity=entities[target];var binding=Component(targetEntity,"ModelNode");var modelOwner=binding.ValueKind==JsonValueKind.Object?T(binding.GetProperty("data"),"modelEntityId"):target;string asset;HashSet<int> scope;JsonElement gltf;
                    if(slot!=null){asset=T(slots[slot].Spec,"assetId");gltf=await definition(asset);if(target==slot){var scenes=A(gltf,"scenes");var index=gltf.TryGetProperty("scene",out var current)?current.GetInt32():0;scope=GltfScope(gltf,A(scenes[index],"nodes").Select(v=>v.GetInt32()));}else{var source=binding.ValueKind==JsonValueKind.Object?T(binding.GetProperty("data"),"sourceElementId"):"";if(source==""||source.StartsWith("unresolved:"))throw new ApiException(422,"替换部件的子映射需要稳定来源 ID");var matches=ModelIdentity.Read(gltf).Where(pair=>pair.Value==source).Select(pair=>pair.Key).ToArray();if(matches.Length!=1)throw new ApiException(422,"替换部件中子绑定缺失或不唯一："+source);scope=GltfScope(gltf,matches);}modelOwner=slot;}
                    else {var model=Component(entities[modelOwner],"Model");if(model.ValueKind!=JsonValueKind.Object)throw new ApiException(422,"变体目标必须属于 GLTF 模型");asset=T(model.GetProperty("data"),"assetId");gltf=await definition(asset);var bound=entities.Values.Select(e=>(Entity:e,Binding:Component(e,"ModelNode"))).Where(row=>row.Binding.ValueKind==JsonValueKind.Object&&T(row.Binding.GetProperty("data"),"modelEntityId")==modelOwner).ToArray();var included=bound.Where(row=>Under(T(row.Entity,"id"),target)).Select(row=>row.Binding.GetProperty("data").GetProperty("nodeIndex").GetInt32()).ToHashSet();var excluded=bound.Where(row=>!Under(T(row.Entity,"id"),target)).Select(row=>row.Binding.GetProperty("data").GetProperty("nodeIndex").GetInt32()).ToHashSet();var roots=included.AsEnumerable();if(target==modelOwner){var scenes=A(gltf,"scenes");roots=roots.Concat(A(scenes[gltf.TryGetProperty("scene",out var current)?current.GetInt32():0],"nodes").Select(v=>v.GetInt32()));}scope=GltfScope(gltf,roots,excluded);}
                    if(T(data,"variantPolicy")=="global-variant"){if(target!=modelOwner)throw new ApiException(422,"全局 glTF 变体必须绑定模型或部件根");if(globalVariants.TryGetValue(modelOwner,out var prior)&&prior!=variant)throw new ApiException(422,"同一 GLTF 模型只能激活一个全局变体");globalVariants[modelOwner]=variant;}
                    var variants=gltf.TryGetProperty("extensions",out var extensions)&&extensions.TryGetProperty("KHR_materials_variants",out var variantExtension)?A(variantExtension,"variants"):[];var variantIndex=Array.FindIndex(variants,v=>T(v,"name")==variant);if(variantIndex<0)throw new ApiException(422,"GLTF 材质变体不存在："+variant);
                    var nodes=A(gltf,"nodes");var meshes=A(gltf,"meshes");var count=0;
                    foreach(var nodeIndex in scope)if(nodes[nodeIndex].TryGetProperty("mesh",out var meshIndex)) {var primitives=A(meshes[meshIndex.GetInt32()],"primitives");for(var primitive=0;primitive<primitives.Length;primitive++){if(!primitives[primitive].TryGetProperty("extensions",out var primitiveExtensions)||!primitiveExtensions.TryGetProperty("KHR_materials_variants",out var materialVariants))continue;var entry=A(materialVariants,"mappings").FirstOrDefault(m=>A(m,"variants").Any(index=>index.GetInt32()==variantIndex));if(entry.ValueKind!=JsonValueKind.Object)continue;var key=modelOwner+":"+nodeIndex+":"+meshIndex.GetInt32()+":"+primitive;var values=candidates.GetValueOrDefault(key)??[];values.Add((entry.GetProperty("material").GetInt32(),mapping.Priority,T(spec,"id"),variant));candidates[key]=values;count++;}}
                    if(count==0)throw new ApiException(422,"所选目标没有此变体的 primitive 映射："+variant);
                }catch(ApiException error){Fail(error.Message,field);}catch(Exception error)when(error is KeyNotFoundException or IndexOutOfRangeException or InvalidOperationException){Fail("变体绑定或模型定义无效："+T(spec,"id"),field);}
            }
            foreach(var(key,values)in candidates){var priority=values.Max(v=>v.Priority);var active=values.Where(v=>v.Priority==priority).ToArray();if(active.Select(v=>v.Material).Distinct().Count()>1)Fail("同优先级 primitive 材质冲突："+key+"；"+string.Join(" ↔ ",active.Select(v=>v.Mapping)));}
            checks.Add(new("configuration-coverage","unverified","warning","已核对默认组合；未将有限采样当作所有组合的可满足性证明","",owner,sceneId,[]));
        }
        return checks.ToArray();
    }
}
