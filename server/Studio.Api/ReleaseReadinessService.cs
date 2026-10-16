using System.Text.Json;
using static Studio.Database;
namespace Studio;
public record ReadinessCheck(string Code,string Status,string Severity,string Message,string Path,string OwnerId,string SceneId,string[] Details);
public record ReleaseReadinessReport(string SubjectKind,string SubjectId,string CheckedAt,bool Ready,int ErrorCount,int WarningCount,ReadinessCheck[] Checks);
public sealed class ReleaseReadinessService(DocumentContract contract,LibraryService library,ObjectStore objects,SemanticService semantics)
{
    public static ReleaseReadinessReport Summarize(string kind,string id,IEnumerable<ReadinessCheck> entries) {
        var checks=entries.ToArray();var errors=checks.Count(c=>c.Status!="pass"&&c.Severity=="error");
        return new(kind,id,Now(),errors==0,errors,checks.Count(c=>c.Status!="pass"&&c.Severity=="warning"),checks);
    }
    public async Task<ReleaseReadinessReport> Check(string sceneId,JsonElement authored,CancellationToken ct) {
        var checks=new List<ReadinessCheck>();
        void Add(string code,string status,string message,string path="",string owner="",string[]? details=null,string? severity=null)=>checks.Add(new(code,status,severity??(status=="fail"?"error":status=="unverified"?"warning":"info"),message,path,owner,sceneId,details??[]));
        var structural=contract.Validate(authored,true);
        Add("schema",structural.Length==0?"pass":"fail",structural.Length==0?"文档与扩展契约通过":"文档或扩展契约未通过",details:structural);
        if(structural.Length>0)return Summarize("scene",sceneId,checks);
        var document=contract.Compile(authored);Add("reference","pass","当前场景引用闭合");
        try{library.AssertPins(authored);Add("revision","pass","模板和目录固定修订一致");}catch(ApiException error){Add("revision","fail",error.Message,details:error.Details);}
        var assets=document.GetProperty("assets").EnumerateArray().ToArray();var resourceReady=true;
        for(var i=0;i<assets.Length;i++) {
            var asset=assets[i];
            try{await objects.Confirm(objects.VerifyMetadata(asset),ct);}
            catch(ApiException error){resourceReady=false;Add("resource",error.Status>=500?"unverified":"fail",error.Message,"/assets/"+i,details:error.Details,severity:"error");}
            catch(Exception error)when(error is not OperationCanceledException){resourceReady=false;Add("resource-unavailable","unverified","对象存储暂不可用","/assets/"+i,severity:"error");}
        }
        if(resourceReady) {
            Add("resource","pass","资产元数据、摘要与对象存储闭包通过");
            await CheckBindings(document,sceneId,checks,ct);
            foreach(var entity in document.GetProperty("entities").EnumerateArray())foreach(var component in entity.GetProperty("components").EnumerateArray())if(DocumentContract.Text(component,"type")=="studio.industrial.Review"&&component.GetProperty("enabled").GetBoolean()&&DocumentContract.Text(component.GetProperty("data"),"semanticAssetId") is {Length:>0} dataset) {
                try{await semantics.Index(dataset,ct);}catch(ApiException error){Add("semantic","fail",error.Message,owner:DocumentContract.Text(entity,"id"),details:error.Details);}
            }
        } else Add("visual","unverified","资源恢复后才能核对模型与视觉绑定");
        Add("workspace","pass","工作区使用共享文档及运行契约");
        var policy=document.GetProperty("settings").TryGetProperty("releasePolicy",out var configured)?configured:default;
        var requiredBudget=policy.ValueKind==JsonValueKind.Object&&DocumentContract.Text(policy,"budget")=="required";
        var requiredHardware=policy.ValueKind==JsonValueKind.Object&&DocumentContract.Text(policy,"hardware")=="required";
        Add("budget","unverified","尚需与资产处理预算报告核对","/settings/releasePolicy/budget",severity:requiredBudget?"error":"warning");
        Add("hardware","unverified","尚无与本模型、画质和设备绑定的硬件测量证据","/settings/evidenceAssetIds",severity:requiredHardware?"error":"warning");
        return Summarize("scene",sceneId,checks);
    }
    private async Task CheckBindings(JsonElement document,string sceneId,List<ReadinessCheck> checks,CancellationToken ct) {
        var entities=document.GetProperty("entities").EnumerateArray().ToArray();var byId=entities.ToDictionary(e=>DocumentContract.Text(e,"id"));var definitions=new Dictionary<string,JsonElement>();var failures=0;
        async Task<JsonElement> Definition(string id){if(!definitions.TryGetValue(id,out var definition)){definition=await objects.ModelDefinition(objects.Get(id),ct);definitions[id]=definition;}return definition;}
        for(var ei=0;ei<entities.Length;ei++) {
            var entity=entities[ei];var components=entity.GetProperty("components").EnumerateArray().ToArray();
            for(var ci=0;ci<components.Length;ci++) {
                var component=components[ci];if(!component.GetProperty("enabled").GetBoolean())continue;
                var type=DocumentContract.Text(component,"type");var data=component.GetProperty("data");var path="/entities/"+ei+"/components/"+ci+"/data";
                void Fail(string message,string suffix=""){failures++;checks.Add(new("visual","fail","error",message,path+suffix,DocumentContract.Text(entity,"id"),sceneId,[]));}
                try {
                    if(type is "Model" or "Avatar")_ = await Definition(DocumentContract.Text(data,"assetId"));
                    if(type is "ModelNode" or "Animation") {
                        var owner=byId[DocumentContract.Text(data,"modelEntityId")];var model=owner.GetProperty("components").EnumerateArray().First(c=>DocumentContract.Text(c,"type")=="Model").GetProperty("data");var definition=await Definition(DocumentContract.Text(model,"assetId"));
                        if(type=="ModelNode") {
                            var asset=objects.Get(DocumentContract.Text(model,"assetId"));
                            if(DocumentContract.Text(data,"meshRevision")!=asset.Sha256)Fail("模型绑定摘要与不可变资产修订不一致","/meshRevision");
                            if(!ModelIdentity.Read(definition).TryGetValue(data.GetProperty("nodeIndex").GetInt32(),out var identity))Fail("glTF 节点索引不属于当前模型场景","/nodeIndex");
                            else if(identity!=DocumentContract.Text(data,"sourceElementId"))Fail("模型节点来源身份与索引不一致","/sourceElementId");
                        }
                        if(type=="Animation") {var clips=definition.TryGetProperty("animations",out var animations)?animations.EnumerateArray().Select((a,i)=>a.TryGetProperty("name",out var name)?name.GetString()!:"animation_"+i).ToArray():[];if(!clips.Contains(DocumentContract.Text(data,"clip")))Fail("动画片段不存在","/clip");}
                    }
                    if(type=="studio.configurator.Catalog")foreach(var group in data.GetProperty("groups").EnumerateArray()) {
                        var mappings=group.GetProperty("options").EnumerateArray().SelectMany(o=>o.GetProperty("visuals").EnumerateArray()).Concat(group.TryGetProperty("visuals",out var numeric)?numeric.EnumerateArray().ToArray():Array.Empty<JsonElement>());
                        foreach(var mapping in mappings) {
                            var operation=DocumentContract.Text(mapping,"operation");
                            if(operation=="swapPart"&&objects.Get(DocumentContract.Text(mapping,"assetId")).Kind!="model")Fail("部件替换资源必须是模型");
                            if(operation!="variant")continue;
                            var target=byId[DocumentContract.Text(mapping,"targetId")];var node=target.GetProperty("components").EnumerateArray().FirstOrDefault(c=>DocumentContract.Text(c,"type")=="ModelNode");if(node.ValueKind!=JsonValueKind.Undefined)target=byId[DocumentContract.Text(node.GetProperty("data"),"modelEntityId")];
                            var model=target.GetProperty("components").EnumerateArray().FirstOrDefault(c=>DocumentContract.Text(c,"type")=="Model"&&c.GetProperty("enabled").GetBoolean());if(model.ValueKind==JsonValueKind.Undefined){Fail("材质变体目标必须属于启用的 GLTF 模型");continue;}
                            var definition=await Definition(DocumentContract.Text(model.GetProperty("data"),"assetId"));var name=DocumentContract.Text(mapping,"variant");
                            if(!definition.TryGetProperty("extensions",out var extensions)||!extensions.TryGetProperty("KHR_materials_variants",out var variants)||!variants.TryGetProperty("variants",out var list)||list.ValueKind!=JsonValueKind.Array||!list.EnumerateArray().Any(v=>DocumentContract.Text(v,"name")==name))Fail("GLTF 材质变体不存在："+name);
                        }
                    }
                }catch(ApiException error){Fail(error.Message);}catch(KeyNotFoundException){Fail("视觉绑定的来源对象不存在");}
            }
        }
        if(failures==0)checks.Add(new("visual","pass","info","模型节点、动画与材质变体绑定通过","","",sceneId,[]));
    }
}
