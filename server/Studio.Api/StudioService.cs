using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Caching.Memory;
using SqlSugar;
using static Studio.Database;

namespace Studio;

public sealed class StudioService(Database database, DocumentContract contract, ObjectStore objects, IMemoryCache cache, LibraryService library, SemanticService semantics)
{
    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement.Clone();
    private static DraftResponse Draft(SceneRow row) => new(row.ProjectId, row.Id, row.Revision, DocumentContract.Migrate(Parse(row.Document)), row.PublishedVersionId);
    private static SceneRow Scene(SqlSugarClient db, string id, bool locked = false) => db.Ado.SqlQuery<SceneRow>("SELECT * FROM Scenes WHERE Id=@id" + (locked ? " FOR UPDATE" : ""), P("id", id)).SingleOrDefault() ?? throw new ApiException(404, "场景不存在");
    public DraftResponse Read(string id) { using var db = database.Open(); return Draft(Scene(db, id)); }
    public ProjectResponse[] Projects()
    {
        using var db = database.Open();
        return db.Ado.SqlQuery<ProjectListRow>("SELECT p.Id,p.Name,s.Id AS SceneId,s.Revision,s.PublishedVersionId,s.UpdatedAt FROM Projects p JOIN Scenes s ON p.Id=s.ProjectId WHERE s.Id=(SELECT s2.Id FROM Scenes s2 WHERE s2.ProjectId=p.Id ORDER BY s2.UpdatedAt DESC,s2.Id LIMIT 1) ORDER BY s.UpdatedAt DESC").Select(p => new ProjectResponse(p.Id, p.Name, p.SceneId, p.Revision, p.PublishedVersionId, p.UpdatedAt)).ToArray();
    }
    private void Dependencies(SqlSugarClient db, string kind, string id, JsonElement document)
    {
        library.Bind(db, kind, id, document);
        document = contract.Compile(document);
        var ids = document.GetProperty("assets").EnumerateArray().Select(a => DocumentContract.Text(a, "id")).Order(StringComparer.Ordinal).ToArray();
        foreach (var assetId in ids) db.Ado.SqlQuery<AssetRow>("SELECT * FROM Assets WHERE Id=@id FOR UPDATE", P("id", assetId));
        db.Ado.ExecuteCommand("DELETE FROM Dependencies WHERE OwnerType=@kind AND OwnerId=@id", P("kind", kind), P("id", id));
        foreach (var assetId in ids) db.Ado.ExecuteCommand("INSERT INTO Dependencies(OwnerType,OwnerId,AssetId) VALUES(@kind,@id,@asset)", P("kind", kind), P("id", id), P("asset", assetId));
    }
    public DraftResponse Create(ProjectRequest request)=>CreateCollection(request.Name,[request.Document],null,[]);
    internal DraftResponse CreateCollection(string name,JsonElement[] documents,JsonElement? graph,LibraryResponse[] templates,ArchiveSceneVersion[]? pinnedVersions=null){
        if(string.IsNullOrWhiteSpace(name)||name.Length>255||documents.Length==0)throw new ApiException(422,"工程名称或场景集合无效");
        var projectId=Id();var now=Now();var map=documents.ToDictionary(d=>DocumentContract.Text(d,"sceneId"),_=>Id());var rows=new List<DraftResponse>();
        foreach(var input in documents){var document=JsonNode.Parse(DocumentContract.Migrate(input).GetRawText())!.AsObject();var old=DocumentContract.Text(input,"sceneId");document["sceneId"]=map[old];var element=Parse(document.ToJsonString());contract.Assert(element);rows.Add(new(projectId,map[old],0,element,null));}
        var versionMap=(pinnedVersions??[]).ToDictionary(v=>v.Id,_=>Id());
        using var db=database.Open();db.Ado.BeginTran();try{
            library.ImportVersions(db,templates);db.Ado.ExecuteCommand("INSERT INTO Projects(Id,Name,CreatedAt) VALUES(@id,@name,@now)",P("id",projectId),P("name",name),P("now",now));
            foreach(var row in rows){db.Ado.ExecuteCommand("INSERT INTO Scenes(Id,ProjectId,Revision,Document,UpdatedAt) VALUES(@id,@project,0,@document,@now)",P("id",row.SceneId),P("project",projectId),P("document",row.Document.GetRawText()),P("now",now));Dependencies(db,"draft",row.SceneId,row.Document);}
            foreach(var pinned in pinnedVersions??[]){if(!map.TryGetValue(pinned.SceneId,out var owner))throw new ApiException(422,"固定版本引用外部场景");var document=JsonNode.Parse(pinned.Document.GetRawText())!.AsObject();document["sceneId"]=owner;var element=Parse(document.ToJsonString());contract.Assert(element);var row=new VersionRow{Id=versionMap[pinned.Id],SceneId=owner,Document=element.GetRawText(),CreatedAt=now,ManifestKey="",Published=false};InsertVersion(db,row);Dependencies(db,"version",row.Id,element);}
            if(graph.HasValue){var node=JsonNode.Parse(graph.Value.GetRawText())!.AsObject();node["name"]=name;foreach(var item in node["nodes"]!.AsArray())if(item?["kind"]?.GetValue<string>()=="scene3d"){var old=item["sceneId"]!.GetValue<string>();if(!map.TryGetValue(old,out var id))throw new ApiException(422,"工程包项目图引用缺失场景");item["sceneId"]=id;var oldVersion=item["sceneVersionId"]?.GetValue<string>()??"";item["sceneVersionId"]=oldVersion!=""&&versionMap.TryGetValue(oldVersion,out var mappedVersion)?mappedVersion:"";}if(node["skinSceneId"] is {} skin&&map.TryGetValue(skin.GetValue<string>(),out var mappedSkin))node["skinSceneId"]=mappedSkin;var oldSkinVersion=node["skinSceneVersionId"]?.GetValue<string>()??"";node["skinSceneVersionId"]=oldSkinVersion!=""&&versionMap.TryGetValue(oldSkinVersion,out var mappedSkinVersion)?mappedSkinVersion:"";library.SaveInTransaction(db,"project",projectId,new(name,0,Parse(node.ToJsonString())));}
            db.Ado.CommitTran();return rows[0];
        }catch{db.Ado.RollbackTran();throw;}
    }
    public DraftResponse[] Scenes(string projectId) {using var db=database.Open();return db.Ado.SqlQuery<SceneRow>("SELECT * FROM Scenes WHERE ProjectId=@id ORDER BY UpdatedAt,Id",P("id",projectId)).Select(Draft).ToArray();}
    public DraftResponse AddScene(string projectId,ProjectRequest request) {
        contract.Assert(request.Document);using var db=database.Open();if(db.Ado.SqlQuery<ProjectRow>("SELECT * FROM Projects WHERE Id=@id",P("id",projectId)).Count!=1)throw new ApiException(404,"工程不存在");
        var id=Id();var document=JsonNode.Parse(request.Document.GetRawText())!.AsObject();document["sceneId"]=id;document["name"]=request.Name;var element=Parse(document.ToJsonString());db.Ado.BeginTran();try{db.Ado.ExecuteCommand("INSERT INTO Scenes(Id,ProjectId,Revision,Document,UpdatedAt) VALUES(@id,@project,0,@document,@now)",P("id",id),P("project",projectId),P("document",element.GetRawText()),P("now",Now()));Dependencies(db,"draft",id,element);db.Ado.CommitTran();}catch{db.Ado.RollbackTran();throw;}return new(projectId,id,0,element,null);
    }
    public DraftResponse Save(string id, SaveRequest request)
    {
        contract.Assert(request.Document);
        if (DocumentContract.Text(request.Document, "sceneId") != id) throw new ApiException(422, "文档场景 ID 与请求不一致");
        using var db = database.Open(); db.Ado.BeginTran();
        try {
            var row = Scene(db, id, true);
            if (row.Revision != request.ExpectedRevision) throw new ApiException(409, "云端版本已变化，本地修改已保留");
            var count = db.Ado.ExecuteCommand("UPDATE Scenes SET Document=@document,Revision=Revision+1,UpdatedAt=@now WHERE Id=@id AND Revision=@expected", P("document", request.Document.GetRawText()), P("now", Now()), P("id", id), P("expected", request.ExpectedRevision));
            if (count != 1) throw new ApiException(409, "保存版本冲突");
            Dependencies(db, "draft", id, request.Document); db.Ado.CommitTran();
            return new(row.ProjectId, id, row.Revision + 1, request.Document, row.PublishedVersionId);
        } catch { db.Ado.RollbackTran(); throw; }
    }
    public void DeleteProject(string id){
        using var db=database.Open();db.Ado.BeginTran();try{
            var project=db.Ado.SqlQuery<ProjectRow>("SELECT * FROM Projects WHERE Id=@id FOR UPDATE",P("id",id)).SingleOrDefault()??throw new ApiException(404,"工程不存在");
            if(db.Ado.SqlQuery<CountRow>("SELECT COUNT(*) AS Value FROM ProjectSceneVersions p JOIN Versions v ON p.SceneVersionId=v.Id JOIN Scenes s ON s.Id=v.SceneId JOIN ProjectPublications pp ON pp.Id=p.ProjectVersionId WHERE s.ProjectId=@id AND pp.ProjectId<>@id",P("id",id))[0].Value>0)throw new ApiException(409,"场景版本被其他发布项目引用");
            foreach(var type in new[]{"Dependencies","LibraryReferences"}){
                db.Ado.ExecuteCommand("DELETE FROM "+type+" WHERE OwnerType='project' AND OwnerId IN (SELECT Id FROM ProjectPublications WHERE ProjectId=@id)",P("id",id));
                db.Ado.ExecuteCommand("DELETE FROM "+type+" WHERE OwnerType='version' AND OwnerId IN (SELECT v.Id FROM Versions v JOIN Scenes s ON v.SceneId=s.Id WHERE s.ProjectId=@id)",P("id",id));
                db.Ado.ExecuteCommand("DELETE FROM "+type+" WHERE OwnerType='draft' AND OwnerId IN (SELECT Id FROM Scenes WHERE ProjectId=@id)",P("id",id));
                db.Ado.ExecuteCommand("DELETE FROM "+type+" WHERE OwnerType='library' AND OwnerId IN (SELECT Id FROM LibraryVersions WHERE Kind='project' AND DocumentId=@id)",P("id",id));
            }
            db.Ado.ExecuteCommand("DELETE FROM ProjectSceneVersions WHERE ProjectVersionId IN (SELECT Id FROM ProjectPublications WHERE ProjectId=@id)",P("id",id));
            db.Ado.ExecuteCommand("DELETE FROM ProjectPublications WHERE ProjectId=@id",P("id",id));db.Ado.ExecuteCommand("DELETE FROM LibraryHeads WHERE Kind='project' AND Id=@id",P("id",id));db.Ado.ExecuteCommand("DELETE FROM LibraryVersions WHERE Kind='project' AND DocumentId=@id",P("id",id));
            db.Ado.ExecuteCommand("DELETE v FROM Versions v JOIN Scenes s ON v.SceneId=s.Id WHERE s.ProjectId=@id",P("id",id));db.Ado.ExecuteCommand("DELETE FROM Scenes WHERE ProjectId=@id",P("id",id));db.Ado.ExecuteCommand("DELETE FROM Projects WHERE Id=@id",P("id",id));db.Ado.CommitTran();
        }catch{db.Ado.RollbackTran();throw;}
    }
    public SceneVersionResponse ReadVersion(string id,string version){using var db=database.Open();var row=db.Ado.SqlQuery<VersionRow>("SELECT * FROM Versions WHERE Id=@version AND SceneId=@scene",P("version",version),P("scene",id)).SingleOrDefault()??throw new ApiException(404,"固定场景版本不存在");return new(row.Id,row.SceneId,DocumentContract.Migrate(Parse(row.Document)),row.CreatedAt);}
    public VersionResponse[] Versions(string id)
    { using var db = database.Open(); Scene(db, id); return db.Ado.SqlQuery<VersionRow>("SELECT * FROM Versions WHERE SceneId=@id ORDER BY CreatedAt DESC", P("id", id)).Select(v => new VersionResponse(v.Id, v.SceneId, v.CreatedAt, v.Published)).ToArray(); }
    public VersionResponse Snapshot(string id, long revision)
    {
        using var db = database.Open(); db.Ado.BeginTran();
        try {
            var row = Scene(db, id, true); if (row.Revision != revision) throw new ApiException(409, "创建版本时草稿已变化");
            var version = new VersionRow { Id = Id(), SceneId = id, Document = row.Document, CreatedAt = Now() };
            InsertVersion(db, version); Dependencies(db, "version", version.Id, Parse(row.Document)); db.Ado.CommitTran(); return new(version.Id, id, version.CreatedAt, false);
        } catch { db.Ado.RollbackTran(); throw; }
    }
    private static void InsertVersion(SqlSugarClient db, VersionRow v) => db.Ado.ExecuteCommand("INSERT INTO Versions(Id,SceneId,Document,ManifestKey,CreatedAt,Published) VALUES(@id,@scene,@document,@manifest,@now,@published)", P("id", v.Id), P("scene", v.SceneId), P("document", v.Document), P("manifest", v.ManifestKey), P("now", v.CreatedAt), P("published", v.Published));
    public DraftResponse Restore(string sceneId, string versionId, long revision)
    {
        using var db = database.Open();
        var version = db.Ado.SqlQuery<VersionRow>("SELECT * FROM Versions WHERE Id=@version AND SceneId=@scene", P("version", versionId), P("scene", sceneId)).SingleOrDefault() ?? throw new ApiException(404, "历史版本不存在");
        return Save(sceneId, new(revision, Parse(version.Document)));
    }
    public async Task<PreparedScene> PreparePublication(string id, long revision, CancellationToken ct, JsonElement? sourceOverride = null)
    {
        var draft = Read(id); if (draft.Revision != revision) throw new ApiException(409, "发布草稿版本已变化");
        if(sourceOverride.HasValue)draft=draft with {Document=sourceOverride.Value};
        var authoringDocument=draft.Document;
        contract.Assert(draft.Document, true);
        draft = draft with { Document = contract.Compile(draft.Document) };
        library.AssertCatalogPins(draft.Document);
        foreach(var entity in draft.Document.GetProperty("entities").EnumerateArray())foreach(var component in entity.GetProperty("components").EnumerateArray())if(DocumentContract.Text(component,"type")=="studio.industrial.Review"&&component.GetProperty("enabled").GetBoolean()&&DocumentContract.Text(component.GetProperty("data"),"semanticAssetId") is {Length:>0} dataset)await semantics.Index(dataset,ct);
        var assets = draft.Document.GetProperty("assets").EnumerateArray().ToArray();
        var errors = new List<string>();
        foreach (var asset in assets) {
            try {
                var stored=objects.VerifyMetadata(asset);
                await objects.Confirm(stored,ct);
            } catch (ApiException e) { errors.Add(e.Message); }
        }
        if(errors.Count==0) {
            var definitions=new Dictionary<string,JsonElement>();
            foreach(var entity in draft.Document.GetProperty("entities").EnumerateArray())foreach(var component in entity.GetProperty("components").EnumerateArray()) {
                var type=DocumentContract.Text(component,"type");if(!component.GetProperty("enabled").GetBoolean() || type is not ("Model" or "Avatar"))continue;
                var data=component.GetProperty("data");var assetId=DocumentContract.Text(data,"assetId");
                if(!definitions.ContainsKey(assetId))definitions[assetId]=await objects.ModelDefinition(objects.Get(assetId),ct);
            }
            var entities=draft.Document.GetProperty("entities").EnumerateArray().ToDictionary(e=>DocumentContract.Text(e,"id"));
            foreach(var entity in entities.Values)foreach(var component in entity.GetProperty("components").EnumerateArray()) {
                if(!component.GetProperty("enabled").GetBoolean())continue;
                var type=DocumentContract.Text(component,"type");if(type is not ("ModelNode" or "Animation"))continue;
                var data=component.GetProperty("data");var model=entities[DocumentContract.Text(data,"modelEntityId")];
                var source=model.GetProperty("components").EnumerateArray().First(c=>DocumentContract.Text(c,"type")=="Model").GetProperty("data");
                var definition=definitions[DocumentContract.Text(source,"assetId")];
                if(type=="ModelNode"&&(!definition.TryGetProperty("nodes",out var nodes)||data.GetProperty("nodeIndex").GetInt32()>=nodes.GetArrayLength()))errors.Add(DocumentContract.Text(entity,"name")+" glTF 节点索引不存在");
                if(type=="Animation") {
                    var clips=definition.TryGetProperty("animations",out var animations)?animations.EnumerateArray().Select((a,i)=>a.TryGetProperty("name",out var name)?name.GetString()!:"animation_"+i).ToArray():[];
                    if(!clips.Contains(DocumentContract.Text(data,"clip")))errors.Add(DocumentContract.Text(entity,"name")+" 动画片段不存在");
                }
            }
        }
        foreach(var entity in draft.Document.GetProperty("entities").EnumerateArray())foreach(var component in entity.GetProperty("components").EnumerateArray())if(DocumentContract.Text(component,"type")=="studio.configurator.Catalog"&&component.GetProperty("enabled").GetBoolean()){
            foreach(var group in component.GetProperty("data").GetProperty("groups").EnumerateArray()){
                var mappings=group.GetProperty("options").EnumerateArray().SelectMany(o=>o.GetProperty("visuals").EnumerateArray()).Concat(group.TryGetProperty("visuals",out var numericVisuals)?numericVisuals.EnumerateArray().ToArray():Array.Empty<JsonElement>());
                foreach(var mapping in mappings){var op=DocumentContract.Text(mapping,"operation");if(op=="swapPart"&&objects.Get(DocumentContract.Text(mapping,"assetId")).Kind!="model")errors.Add("部件替换资源必须是模型");if(op!="variant")continue;
                    var target=draft.Document.GetProperty("entities").EnumerateArray().First(e=>DocumentContract.Text(e,"id")==DocumentContract.Text(mapping,"targetId"));var node=target.GetProperty("components").EnumerateArray().FirstOrDefault(c=>DocumentContract.Text(c,"type")=="ModelNode");if(node.ValueKind!=JsonValueKind.Undefined)target=draft.Document.GetProperty("entities").EnumerateArray().First(e=>DocumentContract.Text(e,"id")==DocumentContract.Text(node.GetProperty("data"),"modelEntityId"));
                    var model=target.GetProperty("components").EnumerateArray().FirstOrDefault(c=>DocumentContract.Text(c,"type")=="Model"&&c.GetProperty("enabled").GetBoolean());if(model.ValueKind==JsonValueKind.Undefined){errors.Add("材质变体目标必须属于启用的 GLTF 模型");continue;}
                    var definition=await objects.ModelDefinition(objects.Get(DocumentContract.Text(model.GetProperty("data"),"assetId")),ct);var name=DocumentContract.Text(mapping,"variant");if(!definition.TryGetProperty("extensions",out var extensions)||!extensions.TryGetProperty("KHR_materials_variants",out var variants)||!variants.TryGetProperty("variants",out var variantList)||variantList.ValueKind!=JsonValueKind.Array||!variantList.EnumerateArray().Any(v=>DocumentContract.Text(v,"name")==name))errors.Add("GLTF 材质变体不存在："+name);
                }
            }
        }
        if (errors.Count > 0) throw new ApiException(422, "发布依赖校验失败", errors.ToArray());
        var versionId = Id(); var now = Now(); var key = "manifests/" + id + "/" + versionId + ".json";
        var compiled = JsonNode.Parse(draft.Document.GetRawText())!.AsObject(); compiled.Remove("prefabs");
        var manifest = new ManifestResponse(versionId,now,Parse(compiled.ToJsonString()),"2.2.0",DocumentContract.CatalogHash);
        await objects.PutManifest(key, JsonSerializer.SerializeToUtf8Bytes(manifest, ApiJson.Default.ManifestResponse), ct);
        return new(draft, manifest, key, authoringDocument);
    }
    internal void CommitPublication(SqlSugarClient db, PreparedScene prepared, bool setPointer) {
        var draft=prepared.Draft;var current=Scene(db,draft.SceneId,true);
        if(current.Revision!=draft.Revision||current.PublishedVersionId!=draft.PublishedVersionId)throw new ApiException(409,"发布过程中草稿或发布状态变化");
        var version=new VersionRow{Id=prepared.Manifest.VersionId,SceneId=draft.SceneId,Document=prepared.AuthoringDocument.GetRawText(),ManifestKey=prepared.Key,CreatedAt=prepared.Manifest.PublishedAt,Published=true};
        InsertVersion(db,version);Dependencies(db,"version",version.Id,prepared.AuthoringDocument);
        foreach(var asset in prepared.Manifest.Document.GetProperty("assets").EnumerateArray())if(db.Ado.SqlQuery<AssetRow>("SELECT * FROM Assets WHERE Id=@id",P("id",DocumentContract.Text(asset,"id"))).SingleOrDefault()?.Status!="Ready")throw new ApiException(422,"发布资源状态变化");
        if(setPointer)db.Ado.ExecuteCommand("UPDATE Scenes SET PublishedVersionId=@version WHERE Id=@id",P("version",version.Id),P("id",draft.SceneId));
    }
    public async Task<PublishResponse> Publish(string id,long revision,CancellationToken ct) {
        var prepared=await PreparePublication(id,revision,ct);using var db=database.Open();db.Ado.BeginTran();
        try{CommitPublication(db,prepared,true);db.Ado.CommitTran();}catch{db.Ado.RollbackTran();throw;}
        return new(prepared.Manifest.VersionId,"/player/?scene="+id);
    }
    public void Unpublish(string id) { using var db = database.Open(); Scene(db, id); db.Ado.ExecuteCommand("UPDATE Scenes SET PublishedVersionId=NULL WHERE Id=@id", P("id", id)); }
    public async Task<ManifestResponse> Manifest(string id, CancellationToken ct)
    {
        using var db = database.Open(); var scene = Scene(db, id);
        if (scene.PublishedVersionId == null) throw new ApiException(404, "场景尚未发布");
        var version = PublicVersion(db, scene, scene.PublishedVersionId);
        if (cache.TryGetValue<ManifestResponse>("manifest:" + version.Id, out var cached) && cached != null) return cached;
        var bytes = await objects.Read(version.ManifestKey, ct); var manifest = JsonSerializer.Deserialize(bytes, ApiJson.Default.ManifestResponse)!;
        cache.Set("manifest:" + version.Id, manifest, new MemoryCacheEntryOptions { Size = bytes.Length, AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(30) }); return manifest;
    }
    private static VersionRow PublicVersion(SqlSugarClient db, SceneRow scene, string versionId)
    {
        if (scene.PublishedVersionId == null) throw new ApiException(404, "场景已取消发布");
        return db.Ado.SqlQuery<VersionRow>("SELECT * FROM Versions WHERE Id=@id AND SceneId=@scene AND Published=1", P("id", versionId), P("scene", scene.Id)).SingleOrDefault() ?? throw new ApiException(404, "公开版本不存在");
    }
    public void AuthorizeAsset(string sceneId, string versionId, string assetId)
    {
        using var db = database.Open();
        var count=db.Ado.SqlQuery<CountRow>("SELECT COUNT(*) AS Value FROM Scenes s JOIN Versions v ON v.SceneId=s.Id AND v.Published=1 JOIN Dependencies d ON d.OwnerType='version' AND d.OwnerId=v.Id WHERE s.Id=@scene AND s.PublishedVersionId IS NOT NULL AND v.Id=@version AND d.AssetId=@asset",P("scene",sceneId),P("version",versionId),P("asset",assetId))[0].Value;
        if(count!=1)throw new ApiException(404,"资源不属于有效的公开版本");
    }
}
