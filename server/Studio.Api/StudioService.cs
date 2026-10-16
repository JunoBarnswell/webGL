using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Caching.Memory;
using SqlSugar;
using static Studio.Database;

namespace Studio;

public sealed class StudioService(Database database, DocumentContract contract, ObjectStore objects, IMemoryCache cache)
{
    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement.Clone();
    private static DraftResponse Draft(SceneRow row) => new(row.ProjectId, row.Id, row.Revision, Parse(row.Document), row.PublishedVersionId);
    private static SceneRow Scene(SqlSugarClient db, string id, bool locked = false) => db.Ado.SqlQuery<SceneRow>("SELECT * FROM Scenes WHERE Id=@id" + (locked ? " FOR UPDATE" : ""), P("id", id)).SingleOrDefault() ?? throw new ApiException(404, "场景不存在");
    public DraftResponse Read(string id) { using var db = database.Open(); return Draft(Scene(db, id)); }
    public ProjectResponse[] Projects()
    {
        using var db = database.Open();
        return db.Ado.SqlQuery<ProjectListRow>("SELECT p.Id,p.Name,s.Id AS SceneId,s.Revision,s.PublishedVersionId,s.UpdatedAt FROM Projects p JOIN Scenes s ON p.Id=s.ProjectId ORDER BY s.UpdatedAt DESC").Select(p => new ProjectResponse(p.Id, p.Name, p.SceneId, p.Revision, p.PublishedVersionId, p.UpdatedAt)).ToArray();
    }
    private static void Dependencies(SqlSugarClient db, string kind, string id, JsonElement document)
    {
        var ids = document.GetProperty("assets").EnumerateArray().Select(a => DocumentContract.Text(a, "id")).Order(StringComparer.Ordinal).ToArray();
        foreach (var assetId in ids) db.Ado.SqlQuery<AssetRow>("SELECT * FROM Assets WHERE Id=@id FOR UPDATE", P("id", assetId));
        db.Ado.ExecuteCommand("DELETE FROM Dependencies WHERE OwnerType=@kind AND OwnerId=@id", P("kind", kind), P("id", id));
        foreach (var assetId in ids) db.Ado.ExecuteCommand("INSERT INTO Dependencies(OwnerType,OwnerId,AssetId) VALUES(@kind,@id,@asset)", P("kind", kind), P("id", id), P("asset", assetId));
    }
    public DraftResponse Create(ProjectRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Length > 255) throw new ApiException(400, "工程名称无效");
        contract.Assert(request.Document);
        var projectId = Id(); var sceneId = Id(); var now = Now();
        var document = JsonNode.Parse(request.Document.GetRawText())!.AsObject(); document["sceneId"] = sceneId; document["name"] = request.Name;
        var element = Parse(document.ToJsonString());
        using var db = database.Open(); db.Ado.BeginTran();
        try {
            db.Ado.ExecuteCommand("INSERT INTO Projects(Id,Name,CreatedAt) VALUES(@id,@name,@now)", P("id", projectId), P("name", request.Name), P("now", now));
            db.Ado.ExecuteCommand("INSERT INTO Scenes(Id,ProjectId,Revision,Document,UpdatedAt) VALUES(@id,@project,0,@document,@now)", P("id", sceneId), P("project", projectId), P("document", element.GetRawText()), P("now", now));
            Dependencies(db, "draft", sceneId, element); db.Ado.CommitTran();
        } catch { db.Ado.RollbackTran(); throw; }
        return new(projectId, sceneId, 0, element, null);
    }
    public DraftResponse Copy(string projectId)
    {
        using var db = database.Open(); var row = db.Ado.SqlQuery<SceneRow>("SELECT * FROM Scenes WHERE ProjectId=@id", P("id", projectId)).SingleOrDefault() ?? throw new ApiException(404, "工程不存在");
        var document = Parse(row.Document); return Create(new(DocumentContract.Text(document, "name") + " 副本", document));
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
            db.Ado.ExecuteCommand("UPDATE Projects SET Name=@name WHERE Id=@id", P("name", DocumentContract.Text(request.Document, "name")), P("id", row.ProjectId));
            Dependencies(db, "draft", id, request.Document); db.Ado.CommitTran();
            return new(row.ProjectId, id, row.Revision + 1, request.Document, row.PublishedVersionId);
        } catch { db.Ado.RollbackTran(); throw; }
    }
    public void DeleteProject(string id)
    {
        using var db = database.Open(); db.Ado.BeginTran();
        try {
            var scenes = db.Ado.SqlQuery<SceneRow>("SELECT * FROM Scenes WHERE ProjectId=@id FOR UPDATE", P("id", id));
            if (scenes.Count == 0) throw new ApiException(404, "工程不存在");
            foreach (var scene in scenes) {
                db.Ado.ExecuteCommand("DELETE FROM Dependencies WHERE (OwnerType='draft' AND OwnerId=@id) OR (OwnerType='version' AND OwnerId IN (SELECT Id FROM Versions WHERE SceneId=@id))", P("id", scene.Id));
                db.Ado.ExecuteCommand("DELETE FROM Versions WHERE SceneId=@id", P("id", scene.Id));
            }
            db.Ado.ExecuteCommand("DELETE FROM Scenes WHERE ProjectId=@id", P("id", id)); db.Ado.ExecuteCommand("DELETE FROM Projects WHERE Id=@id", P("id", id)); db.Ado.CommitTran();
        } catch { db.Ado.RollbackTran(); throw; }
    }
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
    public async Task<PublishResponse> Publish(string id, long revision, CancellationToken ct)
    {
        var draft = Read(id); if (draft.Revision != revision) throw new ApiException(409, "发布草稿版本已变化");
        contract.Assert(draft.Document, true);
        var assets = draft.Document.GetProperty("assets").EnumerateArray().ToArray();
        var errors = new List<string>();
        foreach (var asset in assets) {
            try {
                var stored = objects.Get(DocumentContract.Text(asset, "id"));
                var files = asset.GetProperty("files").EnumerateArray().Select(x => x.GetString()!).Order(StringComparer.Ordinal);
                if (stored.Entry != DocumentContract.Text(asset, "entry") || stored.Kind != DocumentContract.Text(asset, "kind") || stored.Sha256 != DocumentContract.Text(asset, "sha256") || !stored.Files.Order(StringComparer.Ordinal).SequenceEqual(files)) errors.Add(stored.Name + " 元数据不一致");
                else await objects.Confirm(stored, ct);
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
        if (errors.Count > 0) throw new ApiException(422, "发布依赖校验失败", errors.ToArray());
        var versionId = Id(); var now = Now(); var key = "manifests/" + id + "/" + versionId + ".json";
        var manifest = new ManifestResponse( versionId, now, draft.Document);
        await objects.PutManifest(key, JsonSerializer.SerializeToUtf8Bytes(manifest, ApiJson.Default.ManifestResponse), ct);
        using var db = database.Open(); db.Ado.BeginTran();
        try {
            var current = Scene(db, id, true);
            if (current.Revision != revision || current.PublishedVersionId != draft.PublishedVersionId) throw new ApiException(409, "发布过程中草稿或发布状态已变化");
            var version = new VersionRow { Id = versionId, SceneId = id, Document = draft.Document.GetRawText(), ManifestKey = key, CreatedAt = now, Published = true };
            InsertVersion(db, version); Dependencies(db, "version", versionId, draft.Document);
            foreach (var asset in assets) if (db.Ado.SqlQuery<AssetRow>("SELECT * FROM Assets WHERE Id=@id", P("id", DocumentContract.Text(asset, "id"))).SingleOrDefault()?.Status != "Ready") throw new ApiException(422, "发布资源状态发生变化");
            db.Ado.ExecuteCommand("UPDATE Scenes SET PublishedVersionId=@version WHERE Id=@id", P("version", versionId), P("id", id)); db.Ado.CommitTran();
        } catch { db.Ado.RollbackTran(); throw; }
        return new(versionId, "/player/?scene=" + id);
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
    public async Task Export(string projectId, Stream output, CancellationToken ct)
    {
        using var db = database.Open(); var row = db.Ado.SqlQuery<SceneRow>("SELECT * FROM Scenes WHERE ProjectId=@id", P("id", projectId)).SingleOrDefault() ?? throw new ApiException(404, "工程不存在");
        var document = Parse(row.Document); using var zip = new ZipArchive(output, ZipArchiveMode.Create, true);
        await using (var stream = zip.CreateEntry("document.json").Open()) await stream.WriteAsync(System.Text.Encoding.UTF8.GetBytes(row.Document), ct);
        foreach (var item in document.GetProperty("assets").EnumerateArray()) {
            var asset = objects.Get(DocumentContract.Text(item, "id"));
            foreach (var file in asset.Files.Concat(asset.Preview is {} preview ? [preview.File] : Array.Empty<string>())) { await using var stream = zip.CreateEntry("assets/" + asset.Id + "/" + file).Open(); await objects.CopyTo("assets/" + asset.Id + "/" + file, stream, ct); }
        }
    }
    public async Task<DraftResponse> Import(Stream input, CancellationToken ct)
    {
        var temp = Path.Combine(Path.GetTempPath(), "studio-project-" + Id() + ".zip");
        try {
            await using (var stream = File.Create(temp)) await input.CopyToAsync(stream, ct);
            using var zip = ZipFile.OpenRead(temp);
            if (zip.Entries.Count > 20000 || zip.Entries.Sum(x => x.Length) > 2L * 1024 * 1024 * 1024) throw new ApiException(413, "工程包过大");
            var entry = zip.GetEntry("document.json") ?? throw new ApiException(422, "工程包缺少 document.json");
            using var source = entry.Open(); var doc = await JsonDocument.ParseAsync(source, cancellationToken: ct); var document = doc.RootElement.Clone(); contract.Assert(document);
            foreach (var item in document.GetProperty("assets").EnumerateArray()) {
                var id = DocumentContract.Text(item, "id"); var assetPath = Path.Combine(Path.GetTempPath(), "studio-asset-" + Id() + ".zip");
                try {
                    using (var bundle = ZipFile.Open(assetPath, ZipArchiveMode.Create)) foreach (var file in item.GetProperty("files").EnumerateArray().Select(x => x.GetString()!)) {
                        var content = zip.GetEntry("assets/" + id + "/" + file) ?? throw new ApiException(422, "工程资源缺失: " + file);
                        await using var from = content.Open(); await using var to = bundle.CreateEntry(file).Open(); await from.CopyToAsync(to, ct);
                    }
                    await using var upload = File.OpenRead(assetPath); var stored = await objects.Upload(upload, DocumentContract.Text(item, "name"), DocumentContract.Text(item, "kind"), DocumentContract.Text(item, "entry"), ct);
                    if (stored.Id != id) throw new ApiException(422, "工程资源摘要不匹配: " + id);
                    if(item.TryGetProperty("preview",out var preview)&&preview.ValueKind==JsonValueKind.Object){var file=DocumentContract.Text(preview,"file");if(!ObjectStore.ValidPath(file))throw new ApiException(422,"缩略图路径无效");var thumbnail=zip.GetEntry("assets/"+id+"/"+file)??throw new ApiException(422,"工程缩略图缺失");await using var content=thumbnail.Open();await objects.Preview(id,content,preview.GetProperty("width").GetInt32(),preview.GetProperty("height").GetInt32(),ct);}
                } finally { File.Delete(assetPath); }
            }
            return Create(new(DocumentContract.Text(document, "name"), document));
        } finally { File.Delete(temp); }
    }
}
