using System.Text.Json;
using static Studio.Database;
namespace Studio;
public record PrefabUseImpact(string OwnerType,string OwnerId,string ProjectId,string SceneId,long Revision,string OldRevision,bool Historical,bool RequiresAncestorRevision,string[] RemovedLocalIds,DocumentContract.ReferenceEdge[] References);
public record PrefabImpactReport(string PrefabId,string NewRevision,PrefabUseImpact[] Uses);
/// <summary>Read-only impact discovery. Each affected draft still needs its own immutable update plan/CAS.</summary>
public sealed class PrefabImpactService(Database database,LibraryService library,DocumentContract contract)
{
    public PrefabImpactReport Check(string id,string? version) {
        var target=library.Read("prefab",id,version);var latest=contract.Compile(target.Document.GetProperty("document"));var latestIds=latest.GetProperty("entities").EnumerateArray().Select(e=>DocumentContract.Text(e,"id")).ToHashSet();var uses=new List<PrefabUseImpact>();
        using var db=database.Open();
        foreach(var use in library.Usage("prefab",id).DistinctBy(r=>(r.OwnerType,r.OwnerId))) {
            JsonElement authored;var projectId="";var sceneId="";long revision=0;
            if(use.OwnerType=="draft") {var row=db.Ado.SqlQuery<SceneRow>("SELECT * FROM Scenes WHERE Id=@id",P("id",use.OwnerId)).SingleOrDefault();if(row==null)continue;authored=JsonDocument.Parse(row.Document).RootElement.Clone();projectId=row.ProjectId;sceneId=row.Id;revision=row.Revision;}
            else if(use.OwnerType=="version") {var row=db.Ado.SqlQuery<VersionRow>("SELECT * FROM Versions WHERE Id=@id",P("id",use.OwnerId)).SingleOrDefault();if(row==null)continue;authored=JsonDocument.Parse(row.Document).RootElement.Clone();sceneId=row.SceneId;projectId=db.Ado.SqlQuery<SceneRow>("SELECT * FROM Scenes WHERE Id=@id",P("id",sceneId)).SingleOrDefault()?.ProjectId??"";}
            else if(use.OwnerType=="library") {var row=db.Ado.SqlQuery<LibraryVersionRow>("SELECT * FROM LibraryVersions WHERE Id=@id AND Kind='prefab'",P("id",use.OwnerId)).SingleOrDefault();if(row==null)continue;authored=JsonDocument.Parse(row.Content).RootElement.GetProperty("document").Clone();}
            else continue;
            var expanded=contract.Compile(authored);var references=contract.ReferenceEdges(expanded);
            void Visit(JsonElement document,Dictionary<string,string>? parent,int depth) {
                if(!document.TryGetProperty("prefabs",out var instances))return;
                foreach(var instance in instances.EnumerateArray()) {
                    var bindings=instance.GetProperty("bindings").GetProperty("entity").EnumerateObject().ToDictionary(p=>p.Name,p=>parent!=null&&parent.TryGetValue(p.Value.GetString()!,out var global)?global:p.Value.GetString()!);
                    if(DocumentContract.Text(instance,"prefabId")==id) {
                        var previous=contract.Compile(instance.GetProperty("source"));var removed=previous.GetProperty("entities").EnumerateArray().Select(e=>DocumentContract.Text(e,"id")).Where(local=>!latestIds.Contains(local)).ToArray();var globalIds=removed.Where(bindings.ContainsKey).Select(local=>bindings[local]).ToHashSet();
                        var affected=references.Where(edge=>edge.Kind=="entity"&&globalIds.Contains(edge.Id)&&!(edge.OwnerKind=="entities"&&globalIds.Contains(edge.OwnerId))).ToArray();
                        uses.Add(new(use.OwnerType,use.OwnerId,projectId,sceneId,revision,DocumentContract.Text(instance,"revisionId"),use.OwnerType!="draft",depth>0||use.OwnerType=="library",removed,affected));
                    }
                    Visit(instance.GetProperty("source"),bindings,depth+1);
                }
            }
            Visit(authored,null,0);
        }
        return new(id,target.VersionId,uses.ToArray());
    }
}
