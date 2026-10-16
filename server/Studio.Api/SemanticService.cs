using System.Text.Json;
using System.Text.Json.Nodes;
using System.IO.Compression;
using System.Text;
using static Studio.Database;
namespace Studio;
public class SemanticRecordRow {public string AssetId{get;set;}="";public string SourceElementId{get;set;}="";public string Name{get;set;}="";public string ClassId{get;set;}="";public string SearchText{get;set;}="";public string RecordJson{get;set;}="";}
public class SemanticValueRow {public string SourceElementId{get;set;}="";public string? ValueText{get;set;}}
public record SemanticPage(long Total,int Page,int PageSize,JsonElement[] Items,string[] SourceIds,Dictionary<string,double?>? Values=null,string[]? ModelRevisions=null);
public record SemanticMapRequest(string ClassId,JsonElement[] Fields,bool Apply,string SourceClassId="");
public record SemanticMapResponse(int Count,int EmptyCount,int ErrorCount,string[] Errors,JsonElement[] Samples,AssetResponse? Asset);
public sealed class SemanticService(Database database,ObjectStore objects)
{
 private static JsonElement Parse(string json)=>JsonDocument.Parse(json).RootElement.Clone();
 public async Task<int> Index(string assetId,CancellationToken ct) {
  using var db=database.Open();var existing=db.Ado.SqlQuery<CountRow>("SELECT RecordCount AS Value FROM SemanticDatasets WHERE AssetId=@id",P("id",assetId)).SingleOrDefault();if(existing!=null)return existing.Value;
  var asset=objects.Get(assetId);if(asset.Kind!="semantic"&&!asset.Files.Contains("semantics.json"))throw new ApiException(422,"资源不是属性数据集");var file=asset.Files.FirstOrDefault(f=>f=="semantics.json")??asset.Entry;var bytes=await objects.Read("assets/"+assetId+"/"+file,ct);if(bytes.LongLength>512L*1024*1024)throw new ApiException(413,"属性数据超过服务预算");
  using var json=JsonDocument.Parse(bytes);var records=json.RootElement.ValueKind==JsonValueKind.Array?json.RootElement:json.RootElement.GetProperty("records");if(records.GetArrayLength()>2000000)throw new ApiException(413,"属性数量超限");
  var rows=records.EnumerateArray().ToArray();var ids=new HashSet<string>();db.Ado.BeginTran();try{
   if(db.Ado.SqlQuery<IdRow>("SELECT Id FROM Assets WHERE Id=@id FOR UPDATE",P("id",assetId)).Count!=1)throw new ApiException(404,"属性资产已删除");
   var concurrent=db.Ado.SqlQuery<CountRow>("SELECT RecordCount AS Value FROM SemanticDatasets WHERE AssetId=@id",P("id",assetId)).SingleOrDefault();if(concurrent!=null){db.Ado.CommitTran();return concurrent.Value;}

   for(var start=0;start<rows.Length;start+=200){ct.ThrowIfCancellationRequested();var values=new List<string>();var parameters=new List<SqlSugar.SugarParameter>();for(var i=start;i<Math.Min(rows.Length,start+200);i++){var r=rows[i];var id=DocumentContract.Text(r,"sourceElementId");if(id.Length is <1 or >255||!ids.Add(id))throw new ApiException(422,"属性来源身份为空、重复或过长");if(!r.TryGetProperty("properties",out var props)||props.ValueKind!=JsonValueKind.Object)throw new ApiException(422,"属性记录缺少 properties");var raw=r.GetRawText();values.Add($"(@asset{i},@source{i},@name{i},@class{i},@search{i},@record{i})");parameters.AddRange([P("asset"+i,assetId),P("source"+i,id),P("name"+i,DocumentContract.Text(r,"name")),P("class"+i,DocumentContract.Text(r,"classId")),P("search"+i,(DocumentContract.Text(r,"name")+" "+id+" "+props.GetRawText())[..Math.Min(8192,(DocumentContract.Text(r,"name")+" "+id+" "+props.GetRawText()).Length)]),P("record"+i,raw)]);}db.Ado.ExecuteCommand("INSERT INTO SemanticRecords(AssetId,SourceElementId,Name,ClassId,SearchText,RecordJson) VALUES "+string.Join(',',values),parameters.ToArray());}
   db.Ado.ExecuteCommand("INSERT INTO SemanticDatasets(AssetId,RecordCount,CreatedAt) VALUES(@id,@count,@now)",P("id",assetId),P("count",rows.Length),P("now",Now()));db.Ado.CommitTran();return rows.Length;
  }catch{db.Ado.RollbackTran();throw;}
 }
 public SemanticPage Query(string assetId,string query,int page,int pageSize,string filters,bool idsOnly=false,string valueField=""){
  objects.Get(assetId);using(var check=database.Open())if(check.Ado.SqlQuery<CountRow>("SELECT COUNT(*) AS Value FROM SemanticDatasets WHERE AssetId=@id",P("id",assetId))[0].Value==0)throw new ApiException(422,"属性索引尚未建立；请先导入或执行索引");page=Math.Max(0,page);pageSize=Math.Clamp(pageSize,1,200);var parameters=new List<SqlSugar.SugarParameter>{P("asset",assetId)};var where="AssetId=@asset";
  if(!string.IsNullOrWhiteSpace(query)){where+=" AND (Name LIKE @query OR SourceElementId LIKE @query OR SearchText LIKE @query)";parameters.Add(P("query","%"+query.Replace("%","\\%").Replace("_","\\_")+"%"));}
  if(!string.IsNullOrWhiteSpace(filters)){
   var list=JsonDocument.Parse(filters).RootElement.EnumerateArray().ToArray();if(list.Length>32)throw new ApiException(422,"过滤条件过多");var expression="";
   for(var i=0;i<list.Length;i++){var f=list[i];var field=DocumentContract.Text(f,"field");if(field.Length>200||field.Any(c=>c is '"' or '\\'||char.IsControl(c)))throw new ApiException(422,"过滤字段非法");var op=DocumentContract.Text(f,"operator");var value=DocumentContract.Text(f,"value");var path="$.properties.\""+field+"\"";parameters.Add(P("path"+i,path));parameters.Add(P("leaf"+i,path+".value"));parameters.Add(P("value"+i,op=="contains"?"%"+value+"%":value));var scalar=$"COALESCE(JSON_UNQUOTE(JSON_EXTRACT(RecordJson,@leaf{i})),JSON_UNQUOTE(JSON_EXTRACT(RecordJson,@path{i})))";if(new[]{"gt","gte","lt","lte"}.Contains(op)){try{_=Units.Number(value);}catch(FormatException error){throw new ApiException(422,error.Message);}parameters.Add(P("numberPattern"+i,Units.DecimalPattern));}var numeric=$"(CASE WHEN REGEXP_LIKE(TRIM({scalar}),@numberPattern{i}) THEN CAST({scalar} AS DOUBLE) ELSE NULL END)";var term=op switch{"eq"=>$"{scalar}=@value{i}","neq"=>$"{scalar}<>@value{i}","contains"=>$"{scalar} LIKE @value{i}","gt"=>$"{numeric}>CAST(@value{i} AS DOUBLE)","gte"=>$"{numeric}>=CAST(@value{i} AS DOUBLE)","lt"=>$"{numeric}<CAST(@value{i} AS DOUBLE)","lte"=>$"{numeric}<=CAST(@value{i} AS DOUBLE)","empty"=>$"({scalar} IS NULL OR {scalar}='')",_=>throw new ApiException(422,"过滤操作无效")};expression=expression==""?term:"("+expression+(DocumentContract.Text(f,"join")=="or"?" OR ":" AND ")+term+")";}
   if(expression!="")where+=" AND ("+expression+")";
  }
  using var db=database.Open();var total=db.Ado.SqlQuery<CountRow>("SELECT COUNT(*) AS Value FROM SemanticRecords WHERE "+where,parameters.ToArray())[0].Value;
  var revisions=db.Ado.SqlQuery<SemanticValueRow>("SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(RecordJson,'$.modelRevision')) AS ValueText FROM SemanticRecords WHERE AssetId=@asset LIMIT 2048",P("asset",assetId)).Select(r=>r.ValueText??"").Where(r=>r!="").ToArray();
  if(idsOnly){if(total>200000)throw new ApiException(413,"筛选结果超过当前视口预算，请细化条件");var ids=db.Ado.SqlQuery<SemanticRecordRow>("SELECT SourceElementId FROM SemanticRecords WHERE "+where+" ORDER BY SourceElementId LIMIT 200000",parameters.ToArray()).Select(r=>r.SourceElementId).ToArray();Dictionary<string,double?>? values=null;
   if(valueField!=""){if(valueField.Length>200||valueField.Any(c=>c is '\"' or '\\'||char.IsControl(c)))throw new ApiException(422,"颜色字段非法");var path="$.properties.\""+valueField+"\"";parameters.Add(P("colorPath",path));parameters.Add(P("colorLeaf",path+".value"));var valueRows=db.Ado.SqlQuery<SemanticValueRow>("SELECT SourceElementId,COALESCE(JSON_UNQUOTE(JSON_EXTRACT(RecordJson,@colorLeaf)),JSON_UNQUOTE(JSON_EXTRACT(RecordJson,@colorPath))) AS ValueText FROM SemanticRecords WHERE "+where+" ORDER BY SourceElementId LIMIT 200000",parameters.ToArray());values=valueRows.ToDictionary(r=>r.SourceElementId,r=>double.TryParse(r.ValueText,System.Globalization.NumberStyles.Float,System.Globalization.CultureInfo.InvariantCulture,out var value)&&double.IsFinite(value)?(double?)value:null);}
   return new(total,page,pageSize,[],ids,values,revisions);}
  parameters.Add(P("offset",(long)page*pageSize));parameters.Add(P("limit",pageSize));var rows=db.Ado.SqlQuery<SemanticRecordRow>("SELECT * FROM SemanticRecords WHERE "+where+" ORDER BY SourceElementId LIMIT @limit OFFSET @offset",parameters.ToArray());return new(total,page,pageSize,rows.Select(r=>Parse(r.RecordJson)).ToArray(),[],null,revisions);
 }
 public async Task<SemanticMapResponse> Map(string id,SemanticMapRequest request,CancellationToken ct) {
  SemanticMapping.Validate(request.Fields);
  if(string.IsNullOrWhiteSpace(request.ClassId)||request.ClassId.Length>200)throw new ApiException(422,"目标分类无效");
  await Index(id,ct);using var db=database.Open();var errors=new List<string>();var samples=new List<JsonElement>();var count=0;var empty=0;var bad=0;
  var temp=Path.Combine(Path.GetTempPath(),"studio-map-"+Id());Directory.CreateDirectory(temp);
  try {
   var output=Path.Combine(temp,"semantics.json");
   await using(var stream=File.Create(output)) {
    using var writer=new Utf8JsonWriter(stream);writer.WriteStartObject();writer.WriteString("sourceDatasetId",id);writer.WriteString("mappingClassId",request.ClassId);writer.WritePropertyName("records");writer.WriteStartArray();
    var last="";
    while(true) {
     ct.ThrowIfCancellationRequested();var rows=db.Ado.SqlQuery<SemanticRecordRow>("SELECT * FROM SemanticRecords WHERE AssetId=@id AND SourceElementId>@last ORDER BY SourceElementId LIMIT 500",P("id",id),P("last",last));if(rows.Count==0)break;last=rows[^1].SourceElementId;
     foreach(var row in rows) {
      if(request.SourceClassId!=""&&row.ClassId!=request.SourceClassId){writer.WriteRawValue(row.RecordJson);continue;}
      var record=JsonNode.Parse(row.RecordJson)!.AsObject();
      foreach(var field in request.Fields){var result=SemanticMapping.Apply(record,field);if(result.Empty)empty++;if(result.Error!=null){bad++;if(errors.Count<100)errors.Add(row.SourceElementId+" / "+DocumentContract.Text(field,"id")+" "+result.Error);}}
      record["classId"]=request.ClassId;record.WriteTo(writer);if(samples.Count<5)samples.Add(Parse(record.ToJsonString()));count++;
     }
    }
    writer.WriteEndArray();writer.WriteEndObject();await writer.FlushAsync(ct);
   }
   AssetResponse? asset=null;
   if(request.Apply) {
    if(bad>0)throw new ApiException(422,"字段映射失败；源数据未修改",errors.ToArray());
    var source=objects.Get(id);var archive=Path.Combine(temp,"dataset.zip");
    using(var zip=ZipFile.Open(archive,ZipArchiveMode.Create)) {
     zip.CreateEntryFromFile(output,"semantics.json");
     foreach(var file in source.Files.Where(file=>file!=source.Entry&&file!="semantics.json")) {
      var bytes=await objects.Read("assets/"+id+"/"+file,ct);
      if(file=="semantic-model.json") {
       var metadata=JsonNode.Parse(bytes)!.AsObject();var classes=metadata["classes"] as JsonArray??new JsonArray();var existing=classes.FirstOrDefault(c=>c?["id"]?.GetValue<string>()==request.ClassId);if(existing!=null)classes.Remove(existing);
       var fields=new JsonArray(request.Fields.Select(field=>{var node=JsonNode.Parse(field.GetRawText())!.AsObject();if(!node.ContainsKey("precision"))node["precision"]=3;return (JsonNode)node;}).ToArray());
       var targetClass=existing?.DeepClone().AsObject()??new JsonObject{["id"]=request.ClassId,["code"]=request.ClassId,["name"]=request.ClassId,["parentId"]=""};targetClass["fields"]=fields;classes.Add((JsonNode)targetClass);metadata["classes"]=classes;metadata["sourceDatasetId"]=id;bytes=Encoding.UTF8.GetBytes(metadata.ToJsonString());
      }
      await using var entry=zip.CreateEntry(file).Open();await entry.WriteAsync(bytes,ct);
     }
    }
    await using var input=File.OpenRead(archive);asset=await objects.Upload(input,"映射属性修订","semantic","semantics.json",ct);await Index(asset.Id,ct);
   }
   return new(count,empty,bad,errors.ToArray(),samples.ToArray(),asset);
  }finally{Directory.Delete(temp,true);}
 }
}
