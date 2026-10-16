using System.Text.Json;
using System.Text.Json.Nodes;
using static Studio.Database;
namespace Studio;
public record ProjectPublishRequest(long ExpectedRevision,Dictionary<string,long> SceneRevisions);
public record ProjectManifestResponse(string VersionId,string ProjectId,string GraphVersionId,JsonElement Document,Dictionary<string,string> SceneVersions,AssetResponse[] Assets,string PublishedAt,string RuntimeBuild="2.2.0",string ExtensionCatalogHash="",ReleaseReadinessReport? Readiness=null);
public class ProjectPublicationRow {public string Id{get;set;}="";public string ProjectId{get;set;}="";public string GraphVersionId{get;set;}="";public string ManifestKey{get;set;}="";public string CreatedAt{get;set;}="";}
public sealed class ProjectService(Database database,LibraryService library,StudioService scenes,DocumentContract contract,ObjectStore objects,ReleaseReadinessService readiness)
{
 private static JsonElement Parse(string value)=>JsonDocument.Parse(value).RootElement.Clone();
 public async Task<PublishResponse> Publish(string projectId,ProjectPublishRequest request,CancellationToken ct) {
  var graph=library.Read("project",projectId);if(graph.Revision!=request.ExpectedRevision)throw new ApiException(409,"项目编排已变化");
  var document=graph.Document;ValidateGraph(document);var nodes=document.GetProperty("nodes").EnumerateArray().ToArray();var sceneIds=nodes.Where(n=>DocumentContract.Text(n,"kind")=="scene3d").Select(n=>DocumentContract.Text(n,"sceneId")).Concat(new[]{DocumentContract.Text(document,"skinSceneId")}).Where(id=>id!="").Distinct().Order().ToArray();
  var available=scenes.Scenes(projectId).ToDictionary(s=>s.SceneId);var prepared=new Dictionary<string,PreparedScene>();var pinned=new Dictionary<string,string>();var assets=new Dictionary<string,AssetResponse>();
  foreach(var id in sceneIds) {if(!available.TryGetValue(id,out var draft))throw new ApiException(422,"项目引用了不属于此工程的场景");if(!request.SceneRevisions.TryGetValue(id,out var expected)||expected!=draft.Revision)throw new ApiException(409,"场景修订未确认："+id);var pins=nodes.Where(n=>DocumentContract.Text(n,"sceneId")==id).Select(n=>DocumentContract.Text(n,"sceneVersionId")).Concat(id==DocumentContract.Text(document,"skinSceneId")?new[]{DocumentContract.Text(document,"skinSceneVersionId")}:Array.Empty<string>()).Where(v=>v!="").Distinct().ToArray();if(pins.Length>1)throw new ApiException(422,"同一场景引用了不同固定修订，请复制为独立场景");JsonElement? fixedSource=null;if(pins.Length==1){using var sourceDb=database.Open();var fixedVersion=sourceDb.Ado.SqlQuery<VersionRow>("SELECT * FROM Versions WHERE Id=@version AND SceneId=@id",P("version",pins[0]),P("id",id)).SingleOrDefault()??throw new ApiException(422,"固定场景修订不存在");fixedSource=Parse(fixedVersion.Document);}var item=await scenes.PreparePublication(id,expected,ct,fixedSource);prepared[id]=item;pinned[id]=item.Manifest.VersionId;foreach(var asset in item.Manifest.Document.GetProperty("assets").EnumerateArray()){var stored=objects.Get(DocumentContract.Text(asset,"id"));assets[stored.Id]=stored;}}
  foreach(var asset in document.GetProperty("assets").EnumerateArray()){var stored=objects.VerifyMetadata(asset);await objects.Confirm(stored,ct);assets[stored.Id]=stored;}
  ValidateContexts(document,prepared.ToDictionary(p=>p.Key,p=>p.Value.Manifest.Document),assets);
  var release=ProjectReport(projectId,document,prepared.Values.SelectMany(p=>p.Manifest.Readiness?.Checks??[]).Append(new ReadinessCheck("project","pass","info","项目连接、皮肤和动作上下文通过","","","",[])));
  if(!release.Ready)throw new ApiException(422,"项目发布策略未满足",release.Checks.Where(c=>c.Severity=="error"&&c.Status!="pass").Select(c=>c.Message).ToArray());
  var idVersion=Id();var now=Now();var key="project-manifests/"+projectId+"/"+idVersion+".json";
  var frozen=JsonNode.Parse(document.GetRawText())!.AsObject();foreach(var node in frozen["nodes"]!.AsArray())if(node?["kind"]?.GetValue<string>()=="scene3d")node["sceneVersionId"]=pinned[node["sceneId"]!.GetValue<string>()];
  if(DocumentContract.Text(document,"skinSceneId") is {Length:>0} pinnedSkinId)frozen["skinSceneVersionId"]=pinned[pinnedSkinId];
  var manifest=new ProjectManifestResponse(idVersion,projectId,graph.VersionId,Parse(frozen.ToJsonString()),pinned,assets.Values.ToArray(),now,DocumentContract.RuntimeVersion,DocumentContract.CatalogHash,release);
  await objects.PutManifest(key,JsonSerializer.SerializeToUtf8Bytes(manifest,ApiJson.Default.ProjectManifestResponse),ct);
  using var db=database.Open();db.Ado.BeginTran();try{
   var current=db.Ado.SqlQuery<LibraryHeadRow>("SELECT * FROM LibraryHeads WHERE Kind='project' AND Id=@id FOR UPDATE",P("id",projectId)).Single();if(current.Revision!=request.ExpectedRevision)throw new ApiException(409,"项目编排在发布中变化");
   foreach(var item in prepared.Values)scenes.CommitPublication(db,item,false);
   db.Ado.ExecuteCommand("INSERT INTO ProjectPublications(Id,ProjectId,GraphVersionId,ManifestKey,CreatedAt) VALUES(@id,@project,@graph,@key,@now)",P("id",idVersion),P("project",projectId),P("graph",graph.VersionId),P("key",key),P("now",now));
   foreach(var(scene,version)in pinned)db.Ado.ExecuteCommand("INSERT INTO ProjectSceneVersions(ProjectVersionId,SceneId,SceneVersionId) VALUES(@project,@scene,@version)",P("project",idVersion),P("scene",scene),P("version",version));
   foreach(var asset in assets.Values){if(db.Ado.SqlQuery<AssetRow>("SELECT * FROM Assets WHERE Id=@id FOR UPDATE",P("id",asset.Id)).SingleOrDefault()?.Status!="Ready")throw new ApiException(422,"发布资源已失效");db.Ado.ExecuteCommand("INSERT INTO Dependencies(OwnerType,OwnerId,AssetId) VALUES('project',@id,@asset)",P("id",idVersion),P("asset",asset.Id));}
   db.Ado.ExecuteCommand("INSERT INTO LibraryReferences(OwnerType,OwnerId,Kind,LibraryId,VersionId) VALUES('project',@id,'project',@project,@version)",P("id",idVersion),P("project",projectId),P("version",graph.VersionId));
   db.Ado.ExecuteCommand("UPDATE Projects SET PublishedProjectVersionId=@version WHERE Id=@id",P("version",idVersion),P("id",projectId));db.Ado.CommitTran();
  }catch{db.Ado.RollbackTran();throw;}
  return new(idVersion,"/player/?project="+projectId);
 }
 private void ValidateContexts(JsonElement document,Dictionary<string,JsonElement> documents,Dictionary<string,AssetResponse> assets) {
  var nodes=document.GetProperty("nodes").EnumerateArray().ToArray();
  foreach(var node in nodes)if(DocumentContract.Text(node,"kind")!="scene3d"&&!assets.ContainsKey(DocumentContract.Text(node,"assetId")))throw new ApiException(422,"全景资源未归档到项目");
  foreach(var node in nodes)foreach(var hotspot in node.GetProperty("hotspots").EnumerateArray()){
   var contentId=DocumentContract.Text(hotspot,"contentId");if(contentId=="")continue;var sourceScene=DocumentContract.Text(node,"kind")=="scene3d"?DocumentContract.Text(node,"sceneId"):DocumentContract.Text(document,"skinSceneId");
   if(!documents.TryGetValue(sourceScene,out var source)||!source.GetProperty("contents").EnumerateArray().Any(c=>DocumentContract.Text(c,"id")==contentId))throw new ApiException(422,"热点内容来源不存在："+contentId);
  }
  var contexts=new Dictionary<string,JsonElement>();
  foreach(var node in nodes) {
   if(DocumentContract.Text(node,"kind")=="scene3d")contexts[DocumentContract.Text(node,"id")]=documents[DocumentContract.Text(node,"sceneId")];
   else {
    var skinId=DocumentContract.Text(document,"skinSceneId");if(skinId=="")skinId=nodes.Where(n=>DocumentContract.Text(n,"kind")=="scene3d").Select(n=>DocumentContract.Text(n,"sceneId")).FirstOrDefault()??"";
    if(!documents.TryGetValue(skinId,out var skin))throw new ApiException(422,"全景节点需要明确的皮肤场景");
    var context=JsonNode.Parse(skin.GetRawText())!.AsObject();
    var audioIds=context["contents"]!.AsArray().Select(c=>c?["audioEntityId"]?.GetValue<string>()??"").Where(id=>id!="").ToHashSet();
    var audio=new JsonArray();foreach(var entity in context["entities"]!.AsArray().Where(e=>audioIds.Contains(e?["id"]?.GetValue<string>()??""))){var copy=entity!.DeepClone();copy["parentId"]=null;copy["components"]=new JsonArray(copy["components"]!.AsArray().Where(c=>c?["type"]?.GetValue<string>()=="Audio").Select(c=>c!.DeepClone()).ToArray());audio.Add(copy);}
    context["entities"]=audio;foreach(var keyName in new[]{"behaviors","viewpoints","tours","materials"})context[keyName]=new JsonArray();
    if(!context["ui"]!["layouts"]!.AsArray().Any(l=>l?["id"]?.GetValue<string>()==DocumentContract.Text(document,"skinLayoutId")))throw new ApiException(422,"全景皮肤布局不存在");
    contract.Assert(Parse(context.ToJsonString()),true);contexts[DocumentContract.Text(node,"id")]=Parse(context.ToJsonString());
   }
  }
  foreach(var route in document.GetProperty("routes").EnumerateArray())foreach(var stop in route.GetProperty("stops").EnumerateArray()){
   if(stop.TryGetProperty("actions",out var actions))contract.AssertActions(contexts[DocumentContract.Text(stop,"nodeId")],actions);
   var audioId=DocumentContract.Text(stop,"audioAssetId");if(audioId!=""&&(!assets.TryGetValue(audioId,out var audioAsset)||audioAsset.Kind!="audio"))throw new ApiException(422,"导览语音资源无效");
  }
 }
 private static ReleaseReadinessReport ProjectReport(string id,JsonElement document,IEnumerable<ReadinessCheck> checks) {
  var requiredBudget=document.TryGetProperty("releasePolicy",out var policy)&&DocumentContract.Text(policy,"budget")=="required";
  var requiredHardware=policy.ValueKind==JsonValueKind.Object&&DocumentContract.Text(policy,"hardware")=="required";
  return ReleaseReadinessService.Summarize("project",id,checks.Select(c=>c.Status!="pass"&&(c.Code=="budget"&&requiredBudget||c.Code=="hardware"&&requiredHardware)?c with {Severity="error"}:c));
 }
 public async Task<ReleaseReadinessReport> Readiness(string id,CancellationToken ct) {
  var entries=new List<ReadinessCheck>();JsonElement document=default;
  try {
   var graph=library.Read("project",id);document=graph.Document;contract.AssertLibraryData("studio.virtualTour.Project",document);ValidateGraph(document);
   var nodes=document.GetProperty("nodes").EnumerateArray().ToArray();var available=scenes.Scenes(id).ToDictionary(s=>s.SceneId);var documents=new Dictionary<string,JsonElement>();var assets=new Dictionary<string,AssetResponse>();
   foreach(var sceneId in nodes.Where(n=>DocumentContract.Text(n,"kind")=="scene3d").Select(n=>DocumentContract.Text(n,"sceneId")).Append(DocumentContract.Text(document,"skinSceneId")).Where(value=>value!="").Distinct()) {
    if(!available.TryGetValue(sceneId,out var draft))throw new ApiException(422,"项目引用了不属于此工程的场景");
    var pins=nodes.Where(n=>DocumentContract.Text(n,"sceneId")==sceneId).Select(n=>DocumentContract.Text(n,"sceneVersionId")).Concat(sceneId==DocumentContract.Text(document,"skinSceneId")?new[]{DocumentContract.Text(document,"skinSceneVersionId")}:Array.Empty<string>()).Where(v=>v!="").Distinct().ToArray();
    if(pins.Length>1)throw new ApiException(422,"同一场景引用了不同固定修订，请复制为独立场景");
    var source=pins.Length==1?scenes.ReadVersion(sceneId,pins[0]).Document:draft.Document;var result=await readiness.Check(sceneId,source,ct);entries.AddRange(result.Checks);if(!result.Ready)continue;
    var compiled=contract.Compile(source);documents[sceneId]=compiled;foreach(var asset in compiled.GetProperty("assets").EnumerateArray()){var stored=objects.VerifyMetadata(asset);assets[stored.Id]=stored;}
   }
   foreach(var asset in document.GetProperty("assets").EnumerateArray()){var stored=objects.VerifyMetadata(asset);await objects.Confirm(stored,ct);assets[stored.Id]=stored;}
   if(entries.All(c=>c.Severity!="error"||c.Status=="pass")) {
    ValidateContexts(document,documents,assets);
    entries.Add(new("project","pass","info","项目连接、皮肤和动作上下文检查完成","","","",[]));
   } else entries.Add(new("project","unverified","warning","修复场景检查问题后才能核对项目上下文","","","",[]));
  }catch(ApiException error){entries.Add(new("project","fail","error",error.Message,"","","",error.Details));}
  return document.ValueKind==JsonValueKind.Object?ProjectReport(id,document,entries):ReleaseReadinessService.Summarize("project",id,entries);
 }
 public static void ValidateGraph(JsonElement document){
  var nodes=document.GetProperty("nodes").EnumerateArray().ToDictionary(n=>DocumentContract.Text(n,"id"));if(!nodes.ContainsKey(DocumentContract.Text(document,"entryNodeId")))throw new ApiException(422,"项目入口节点不存在");
  var floors=document.GetProperty("floors").EnumerateArray().Select(f=>DocumentContract.Text(f,"id")).ToHashSet();
  foreach(var node in nodes.Values){var floor=DocumentContract.Text(node,"floorId");if(floor!=""&&!floors.Contains(floor))throw new ApiException(422,"节点楼层不存在");foreach(var hotspot in node.GetProperty("hotspots").EnumerateArray()){var target=DocumentContract.Text(hotspot,"toNodeId");if(target!=""&&!nodes.ContainsKey(target))throw new ApiException(422,"热点目标断链");if(DocumentContract.Text(hotspot,"kind")=="polygon"&&hotspot.GetProperty("points").GetArrayLength()<3)throw new ApiException(422,"多边形热点至少需要三个顶点");}}
  foreach(var link in document.GetProperty("links").EnumerateArray())if(!nodes.ContainsKey(DocumentContract.Text(link,"fromNodeId"))||!nodes.ContainsKey(DocumentContract.Text(link,"toNodeId")))throw new ApiException(422,"项目链接断链");
  foreach(var route in document.GetProperty("routes").EnumerateArray())foreach(var stop in route.GetProperty("stops").EnumerateArray())if(!nodes.ContainsKey(DocumentContract.Text(stop,"nodeId")))throw new ApiException(422,"自动导览引用缺失节点");
 }
 private ProjectPublicationRow Publication(string projectId,string? version=null){using var db=database.Open();var project=db.Ado.SqlQuery<ProjectRow>("SELECT * FROM Projects WHERE Id=@id",P("id",projectId)).SingleOrDefault()??throw new ApiException(404,"工程不存在");if(project.PublishedProjectVersionId==null)throw new ApiException(404,"项目未发布");return db.Ado.SqlQuery<ProjectPublicationRow>("SELECT * FROM ProjectPublications WHERE Id=@version AND ProjectId=@project",P("version",version??project.PublishedProjectVersionId),P("project",projectId)).SingleOrDefault()??throw new ApiException(404,"项目公开版本不存在");}
 public async Task<ProjectManifestResponse> Manifest(string projectId,string? version,CancellationToken ct){var row=Publication(projectId,version);return JsonSerializer.Deserialize(await objects.Read(row.ManifestKey,ct),ApiJson.Default.ProjectManifestResponse)!;}
 public async Task<ManifestResponse> SceneManifest(string projectId,string version,string sceneId,CancellationToken ct){var manifest=await Manifest(projectId,version,ct);if(!manifest.SceneVersions.TryGetValue(sceneId,out var sceneVersion))throw new ApiException(404,"场景不属于公开项目版本");using var db=database.Open();var scene=db.Ado.SqlQuery<VersionRow>("SELECT * FROM Versions WHERE Id=@id AND SceneId=@scene",P("id",sceneVersion),P("scene",sceneId)).SingleOrDefault()??throw new ApiException(404,"固定场景版本缺失");return JsonSerializer.Deserialize(await objects.Read(scene.ManifestKey,ct),ApiJson.Default.ManifestResponse)!;}
 public void AuthorizeAsset(string projectId,string version,string assetId){_=Publication(projectId,version);using var db=database.Open();if(db.Ado.SqlQuery<CountRow>("SELECT COUNT(*) AS Value FROM Dependencies WHERE OwnerType='project' AND OwnerId=@version AND AssetId=@asset",P("version",version),P("asset",assetId))[0].Value!=1)throw new ApiException(404,"资产不属于公开项目");}
 public ProjectPublicationRow[] History(string id){using var db=database.Open();return db.Ado.SqlQuery<ProjectPublicationRow>("SELECT * FROM ProjectPublications WHERE ProjectId=@id ORDER BY CreatedAt DESC",P("id",id)).ToArray();}
 public async Task<LibraryResponse> Restore(string id,string version,long revision,CancellationToken ct){var manifest=await Manifest(id,version,ct);return library.Save("project",id,new(library.Read("project",id).Name,revision,manifest.Document));}
 public void Unpublish(string id){using var db=database.Open();db.Ado.ExecuteCommand("UPDATE Projects SET PublishedProjectVersionId=NULL WHERE Id=@id",P("id",id));}
}
