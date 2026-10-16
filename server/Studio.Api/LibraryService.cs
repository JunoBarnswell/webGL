using System.Text.Json;
using SqlSugar;
using static Studio.Database;
namespace Studio;
public record LibraryRequest(string Name,long ExpectedRevision,JsonElement Document);
public record LibraryResponse(string Kind,string Id,string Name,long Revision,string VersionId,JsonElement Document,string UpdatedAt);
public class LibraryHeadRow { public string Kind {get;set;}=""; public string Id {get;set;}="";public string Name {get;set;}="";public long Revision {get;set;}public string VersionId {get;set;}="";public string UpdatedAt {get;set;}=""; }
public class LibraryVersionRow { public string Id {get;set;}="";public string Kind {get;set;}="";public string DocumentId {get;set;}="";public string Content {get;set;}="";public string CreatedAt {get;set;}=""; }
public class LibraryReferenceRow {public string OwnerType {get;set;}="";public string OwnerId {get;set;}="";public string Kind {get;set;}="";public string LibraryId {get;set;}="";public string VersionId {get;set;}="";}
public sealed class LibraryService(Database database,DocumentContract contract)
{
    private static JsonElement Parse(string value)=>JsonDocument.Parse(value).RootElement.Clone();
    private static void Kind(string kind) {if(kind is not ("prefab" or "catalog" or "project"))throw new ApiException(404,"未知资源库类型");}
    public LibraryResponse Read(string kind,string id,string? version=null) {
        Kind(kind);using var db=database.Open();var head=db.Ado.SqlQuery<LibraryHeadRow>("SELECT * FROM LibraryHeads WHERE Kind=@kind AND Id=@id",P("kind",kind),P("id",id)).SingleOrDefault()??throw new ApiException(404,"资源库对象不存在");
        var item=Version(db,kind,id,version??head.VersionId);return new(kind,id,head.Name,head.Revision,item.Id,Parse(item.Content),item.CreatedAt);
    }
    public LibraryResponse[] List(string kind) {Kind(kind);using var db=database.Open();return db.Ado.SqlQuery<LibraryHeadRow>("SELECT * FROM LibraryHeads WHERE Kind=@kind ORDER BY UpdatedAt DESC",P("kind",kind)).Select(h=>Read(kind,h.Id)).ToArray();}
    public LibraryResponse[] History(string kind,string id) {Kind(kind);using var db=database.Open();return db.Ado.SqlQuery<LibraryVersionRow>("SELECT * FROM LibraryVersions WHERE Kind=@kind AND DocumentId=@id ORDER BY CreatedAt DESC",P("kind",kind),P("id",id)).Select(v=>new LibraryResponse(kind,id,"",0,v.Id,Parse(v.Content),v.CreatedAt)).ToArray();}
    public LibraryReferenceRow[] Usage(string kind,string id) {Kind(kind);using var db=database.Open();return db.Ado.SqlQuery<LibraryReferenceRow>("SELECT * FROM LibraryReferences WHERE Kind=@kind AND LibraryId=@id",P("kind",kind),P("id",id)).ToArray();}
    public static LibraryVersionRow Version(SqlSugarClient db,string kind,string id,string version) => db.Ado.SqlQuery<LibraryVersionRow>("SELECT * FROM LibraryVersions WHERE Id=@version AND Kind=@kind AND DocumentId=@id",P("version",version),P("kind",kind),P("id",id)).SingleOrDefault()??throw new ApiException(422,"固定资源版本不存在："+kind+"/"+id+"@"+version);
    private void Validate(string kind,JsonElement document) {
        if(kind=="prefab") {contract.AssertLibraryData("studio.prefab.Definition",document);if(!document.TryGetProperty("document",out var scene)||DocumentContract.Text(document,"rootLocalId")=="")throw new ApiException(422,"预制体定义不完整");contract.Assert(scene);var expanded=contract.Compile(scene);var root=DocumentContract.Text(document,"rootLocalId");var roots=expanded.GetProperty("entities").EnumerateArray().Where(e=>e.GetProperty("parentId").ValueKind==JsonValueKind.Null).ToArray();if(roots.Length!=1||DocumentContract.Text(roots[0],"id")!=root)throw new ApiException(422,"预制体必须包含唯一的稳定根节点");}
        else contract.AssertLibraryData(kind=="catalog"?"studio.configurator.Catalog":"studio.virtualTour.Project",document);
    }
    public LibraryResponse Save(string kind,string id,LibraryRequest request) {
        using var db=database.Open();db.Ado.BeginTran();try{var result=SaveInTransaction(db,kind,id,request);db.Ado.CommitTran();return result;}catch{db.Ado.RollbackTran();throw;}
    }
    internal LibraryResponse SaveInTransaction(SqlSugarClient db,string kind,string id,LibraryRequest request){
        Kind(kind);if(!System.Text.RegularExpressions.Regex.IsMatch(id,"^[a-zA-Z0-9_-]{1,100}$")||string.IsNullOrWhiteSpace(request.Name)||request.Name.Length>255)throw new ApiException(422,"资源库标识或名称非法");Validate(kind,request.Document);
            var head=db.Ado.SqlQuery<LibraryHeadRow>("SELECT * FROM LibraryHeads WHERE Kind=@kind AND Id=@id FOR UPDATE",P("kind",kind),P("id",id)).SingleOrDefault();
            if((head?.Revision??0)!=request.ExpectedRevision)throw new ApiException(409,"资源库版本冲突；本地编辑已保留");
            var version=Id();var now=Now();var document=request.Document;if(kind=="catalog"){var canonical=System.Text.Json.Nodes.JsonNode.Parse(document.GetRawText())!.AsObject();canonical["catalogId"]=id;canonical["libraryVersionId"]=version;document=Parse(canonical.ToJsonString());}
            db.Ado.ExecuteCommand("INSERT INTO LibraryVersions(Id,Kind,DocumentId,Content,CreatedAt) VALUES(@version,@kind,@id,@content,@now)",P("version",version),P("kind",kind),P("id",id),P("content",document.GetRawText()),P("now",now));
            if(head==null)db.Ado.ExecuteCommand("INSERT INTO LibraryHeads(Kind,Id,Name,Revision,VersionId,UpdatedAt) VALUES(@kind,@id,@name,1,@version,@now)",P("kind",kind),P("id",id),P("name",request.Name),P("version",version),P("now",now));
            else db.Ado.ExecuteCommand("UPDATE LibraryHeads SET Name=@name,Revision=Revision+1,VersionId=@version,UpdatedAt=@now WHERE Kind=@kind AND Id=@id",P("name",request.Name),P("version",version),P("now",now),P("kind",kind),P("id",id));
            if(kind=="prefab")Bind(db,"library",version,document.GetProperty("document"),id);

        BindAssets(db,version,contract.LibraryAssetIds(kind=="prefab"?"studio.prefab.Definition":kind=="catalog"?"studio.configurator.Catalog":"studio.virtualTour.Project",document));
        if(kind=="project")db.Ado.ExecuteCommand("UPDATE Projects SET Name=@name WHERE Id=@id",P("name",request.Name),P("id",id));
        return new(kind,id,request.Name,(head?.Revision??0)+1,version,document,now);
    }
    private void BindAssets(SqlSugarClient db,string owner,IEnumerable<string> ids){foreach(var id in ids.Distinct().Order()){var row=db.Ado.SqlQuery<AssetRow>("SELECT * FROM Assets WHERE Id=@id FOR UPDATE",P("id",id)).SingleOrDefault();if(row?.Status!="Ready")throw new ApiException(422,"资源库资产尚未就绪："+id);db.Ado.ExecuteCommand("INSERT IGNORE INTO Dependencies(OwnerType,OwnerId,AssetId) VALUES('library',@owner,@id)",P("owner",owner),P("id",id));}}
    internal void ImportVersions(SqlSugarClient db,LibraryResponse[] records){
        foreach(var record in records){
            if(record.Kind is not ("prefab" or "catalog")||!System.Text.RegularExpressions.Regex.IsMatch(record.Id,"^[a-zA-Z0-9_-]{1,100}$")||!System.Text.RegularExpressions.Regex.IsMatch(record.VersionId,"^[a-zA-Z0-9_-]{1,100}$"))throw new ApiException(422,"导入资源库版本标识非法");Validate(record.Kind,record.Document);
            if(record.Kind=="catalog"&&(DocumentContract.Text(record.Document,"catalogId")!=record.Id||DocumentContract.Text(record.Document,"libraryVersionId")!=record.VersionId))throw new ApiException(422,"目录修订身份不一致");
            var existing=db.Ado.SqlQuery<LibraryVersionRow>("SELECT * FROM LibraryVersions WHERE Id=@id",P("id",record.VersionId)).SingleOrDefault();
            if(existing!=null){if(existing.Kind!=record.Kind||existing.DocumentId!=record.Id||!JsonElement.DeepEquals(Parse(existing.Content),record.Document))throw new ApiException(422,"资源库版本身份冲突");continue;}
            db.Ado.ExecuteCommand("INSERT INTO LibraryVersions(Id,Kind,DocumentId,Content,CreatedAt) VALUES(@version,@kind,@id,@content,@now)",P("version",record.VersionId),P("kind",record.Kind),P("id",record.Id),P("content",record.Document.GetRawText()),P("now",Now()));
            db.Ado.ExecuteCommand("INSERT IGNORE INTO LibraryHeads(Kind,Id,Name,Revision,VersionId,UpdatedAt) VALUES(@kind,@id,@name,1,@version,@now)",P("kind",record.Kind),P("id",record.Id),P("name",record.Name),P("version",record.VersionId),P("now",Now()));
        }
        foreach(var record in records){if(record.Kind=="prefab")Bind(db,"library",record.VersionId,record.Document.GetProperty("document"),record.Id);BindAssets(db,record.VersionId,contract.LibraryAssetIds(record.Kind=="prefab"?"studio.prefab.Definition":"studio.configurator.Catalog",record.Document));}
    }
    public void AssertCatalogPins(JsonElement scene){using var db=database.Open();foreach(var entity in scene.GetProperty("entities").EnumerateArray())foreach(var c in entity.GetProperty("components").EnumerateArray())if(DocumentContract.Text(c,"type")=="studio.configurator.Catalog"&&c.GetProperty("enabled").GetBoolean()){
        var data=c.GetProperty("data");var version=DocumentContract.Text(data,"libraryVersionId");if(version=="")continue;var source=Version(db,"catalog",DocumentContract.Text(data,"catalogId"),version);if(!JsonElement.DeepEquals(Parse(source.Content),data))throw new ApiException(422,"目录已修改，请先保存目录新修订再发布");
    }}
    private (string Kind,string Id,string Version)[] ReadPins(SqlSugarClient db,JsonElement scene,string? ownerPrefabId=null,bool locked=false) {
        var occurrences=new List<(string Kind,string Id,string Version,string Root,JsonElement Snapshot)>();
        void Visit(JsonElement document,List<string> chain) {
            if(!document.TryGetProperty("prefabs",out var instances))return;
            foreach(var instance in instances.EnumerateArray()) {
                var id=DocumentContract.Text(instance,"prefabId");if(chain.Contains(id)||chain.Count>=8)throw new ApiException(422,"模板依赖循环或过深");
                occurrences.Add(("prefab",id,DocumentContract.Text(instance,"revisionId"),DocumentContract.Text(instance,"rootLocalId"),instance.GetProperty("source")));
                Visit(instance.GetProperty("source"),[..chain,id]);
            }
        }
        Visit(scene,ownerPrefabId==null?[]:[ownerPrefabId]);
        foreach(var entity in contract.Compile(scene).GetProperty("entities").EnumerateArray())foreach(var component in entity.GetProperty("components").EnumerateArray())if(DocumentContract.Text(component,"type")=="studio.configurator.Catalog") {
            var data=component.GetProperty("data");var version=DocumentContract.Text(data,"libraryVersionId");if(version!="")occurrences.Add(("catalog",DocumentContract.Text(data,"catalogId"),version,"",default));
        }
        var pins=occurrences.Select(o=>(o.Kind,o.Id,o.Version)).Distinct().OrderBy(o=>o.Kind,StringComparer.Ordinal).ThenBy(o=>o.Id,StringComparer.Ordinal).ThenBy(o=>o.Version,StringComparer.Ordinal).ToArray();
        foreach(var pin in pins) {
            if(locked&&db.Ado.SqlQuery<LibraryHeadRow>("SELECT * FROM LibraryHeads WHERE Kind=@kind AND Id=@id FOR UPDATE",P("kind",pin.Kind),P("id",pin.Id)).Count!=1)throw new ApiException(422,"引用的资源库对象已删除");
            var stored=Parse(Version(db,pin.Kind,pin.Id,pin.Version).Content);
            foreach(var occurrence in occurrences.Where(o=>o.Kind==pin.Kind&&o.Id==pin.Id&&o.Version==pin.Version))if(pin.Kind=="prefab"&&(DocumentContract.Text(stored,"rootLocalId")!=occurrence.Root||!JsonElement.DeepEquals(stored.GetProperty("document"),occurrence.Snapshot)))throw new ApiException(422,"固定模板源与不可变版本不一致");
        }
        return pins;
    }
    public void AssertPins(JsonElement scene) {using var db=database.Open();_=ReadPins(db,scene);AssertCatalogPins(contract.Compile(scene));}
    public void Bind(SqlSugarClient db,string ownerType,string ownerId,JsonElement scene,string? ownerPrefabId=null) {
        db.Ado.ExecuteCommand("DELETE FROM LibraryReferences WHERE OwnerType=@type AND OwnerId=@id",P("type",ownerType),P("id",ownerId));
        foreach(var pin in ReadPins(db,scene,ownerPrefabId,true))db.Ado.ExecuteCommand("INSERT IGNORE INTO LibraryReferences(OwnerType,OwnerId,Kind,LibraryId,VersionId) VALUES(@type,@owner,@kind,@id,@version)",P("type",ownerType),P("owner",ownerId),P("kind",pin.Kind),P("id",pin.Id),P("version",pin.Version));

        if(ownerType=="library")foreach(var asset in contract.Compile(scene).GetProperty("assets").EnumerateArray()) {
            var id=DocumentContract.Text(asset,"id");var ready=db.Ado.SqlQuery<AssetRow>("SELECT * FROM Assets WHERE Id=@id FOR UPDATE",P("id",id)).SingleOrDefault();if(ready?.Status!="Ready")throw new ApiException(422,"模板依赖资源未就绪");
            db.Ado.ExecuteCommand("INSERT IGNORE INTO Dependencies(OwnerType,OwnerId,AssetId) VALUES('library',@owner,@asset)",P("owner",ownerId),P("asset",id));
        }
    }
    public void Delete(string kind,string id) {
        Kind(kind);using var db=database.Open();db.Ado.BeginTran();try {
            _=db.Ado.SqlQuery<LibraryHeadRow>("SELECT * FROM LibraryHeads WHERE Kind=@kind AND Id=@id FOR UPDATE",P("kind",kind),P("id",id));
            if(db.Ado.SqlQuery<CountRow>("SELECT COUNT(*) AS Value FROM LibraryReferences WHERE Kind=@kind AND LibraryId=@id",P("kind",kind),P("id",id))[0].Value>0)throw new ApiException(409,"仍有草稿、模板或历史版本引用该对象");
            db.Ado.ExecuteCommand("DELETE FROM Dependencies WHERE OwnerType='library' AND OwnerId IN (SELECT Id FROM LibraryVersions WHERE Kind=@kind AND DocumentId=@id)",P("kind",kind),P("id",id));
            db.Ado.ExecuteCommand("DELETE FROM LibraryReferences WHERE OwnerType='library' AND OwnerId IN (SELECT Id FROM LibraryVersions WHERE Kind=@kind AND DocumentId=@id)",P("kind",kind),P("id",id));
            db.Ado.ExecuteCommand("DELETE FROM LibraryVersions WHERE Kind=@kind AND DocumentId=@id",P("kind",kind),P("id",id));db.Ado.ExecuteCommand("DELETE FROM LibraryHeads WHERE Kind=@kind AND Id=@id",P("kind",kind),P("id",id));db.Ado.CommitTran();
        }catch{db.Ado.RollbackTran();throw;}
    }
}
