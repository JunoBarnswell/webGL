using System.Text.Json;
using System.Text.Json.Nodes;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.IO.Compression;
using static Studio.Database;
namespace Studio;
public record OptimizationBudget(long? MaxTriangles=null,long? MaxGpuTextureBytes=null,long? MaxEncodedBytes=null);
public record OptimizationSettings(bool UseMeshopt=true,string TextureCodec="retain",bool PreserveSemantics=true,string[]? ProtectedSourceIds=null,OptimizationBudget? Budget=null);
public record ProcessingRequest(string SourceAssetId,string Operation,OptimizationSettings Settings);
public record ProcessingResult(JsonElement Report,AssetResponse[] Assets);
public class ProcessingJobRow {public string Id{get;set;}="";public string SourceAssetId{get;set;}="";public string SourceSha256{get;set;}="";public string Operation{get;set;}="";public string SettingsJson{get;set;}="";public string SettingsHash{get;set;}="";public string Status{get;set;}="";public string Stage{get;set;}="";public double Progress{get;set;}public string LogsJson{get;set;}="[]";public string? ResultJson{get;set;}public string Error{get;set;}="";public bool CancelRequested{get;set;}public string CreatedAt{get;set;}="";public string UpdatedAt{get;set;}="";public string OwnerId{get;set;}="";public DateTime? LeaseUntil{get;set;}public long LeaseEpoch{get;set;}public int Attempt{get;set;}}
/** DB time, owner and monotonic epoch govern every mutable job write and logical result commit. */
public sealed class ProcessingService(Database database,ObjectStore objects,SemanticService semantics,IConfiguration config,ILogger<ProcessingService> logger):BackgroundService
{
 private readonly string ownerId=Id();private string? runningId;private CancellationTokenSource? runningCancellation;
 private const string Fence="Id=@id AND OwnerId=@owner AND LeaseEpoch=@epoch AND Status='Running' AND LeaseUntil>UTC_TIMESTAMP(6)";
 public ProcessingJobRow Create(ProcessingRequest request,bool force=false){
  var asset=objects.Get(request.SourceAssetId);if(request.Operation is not ("diagnose" or "optimize" or "ifc"))throw new ApiException(422,"未知处理作业");if(request.Operation=="ifc"?asset.Kind!="source"||!asset.Entry.EndsWith(".ifc",StringComparison.OrdinalIgnoreCase):asset.Kind!="model")throw new ApiException(422,"作业输入资源类型不匹配");
  if(request.Settings.TextureCodec is not ("retain" or "ktx2")||!request.Settings.PreserveSemantics)throw new ApiException(422,"首期处理必须保留来源语义；纹理策略仅支持 retain/ktx2");
  var budget=request.Settings.Budget;foreach(var value in new[]{budget?.MaxTriangles,budget?.MaxGpuTextureBytes,budget?.MaxEncodedBytes})if(value is <0 or >9007199254740991)throw new ApiException(422,"预算必须为安全范围内的非负整数");
  var settingsValue=request.Settings with {ProtectedSourceIds=(request.Settings.ProtectedSourceIds??[]).Distinct().Order(StringComparer.Ordinal).ToArray(),Budget=budget??new()};
  using var db=database.Open();var id=Id();var now=Now();var settings=JsonSerializer.Serialize(settingsValue,ApiJson.Default.OptimizationSettings);var hash=Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes("studio-asset-worker@2.3.0:2\0"+settings)));
  if(!force){var cached=db.Ado.SqlQuery<ProcessingJobRow>("SELECT * FROM ProcessingJobs WHERE SourceSha256=@sha AND Operation=@op AND SettingsHash=@hash AND Status='Succeeded' ORDER BY UpdatedAt DESC LIMIT 1",P("sha",asset.Sha256),P("op",request.Operation),P("hash",hash)).SingleOrDefault();if(cached!=null)return cached;}
  if(db.Ado.SqlQuery<CountRow>("SELECT COUNT(*) AS Value FROM ProcessingJobs WHERE Status IN ('Queued','Running')")[0].Value>=50)throw new ApiException(429,"处理队列已满");db.Ado.BeginTran();try{
   db.Ado.ExecuteCommand("INSERT INTO ProcessingJobs(Id,SourceAssetId,SourceSha256,Operation,SettingsJson,SettingsHash,Status,Stage,Progress,LogsJson,Error,CancelRequested,CreatedAt,UpdatedAt) VALUES(@id,@asset,@sha,@operation,@settings,@hash,'Queued','Queued',0,'[]','',0,@now,@now)",P("id",id),P("asset",asset.Id),P("sha",asset.Sha256),P("operation",request.Operation),P("settings",settings),P("hash",hash),P("now",now));db.Ado.ExecuteCommand("INSERT INTO Dependencies(OwnerType,OwnerId,AssetId) VALUES('job',@id,@asset)",P("id",id),P("asset",asset.Id));db.Ado.CommitTran();
  }catch{db.Ado.RollbackTran();throw;}return Read(id);
 }
 public ProcessingJobRow Read(string id){using var db=database.Open();return db.Ado.SqlQuery<ProcessingJobRow>("SELECT * FROM ProcessingJobs WHERE Id=@id",P("id",id)).SingleOrDefault()??throw new ApiException(404,"作业不存在");}
 public ProcessingJobRow[] List(){using var db=database.Open();return db.Ado.SqlQuery<ProcessingJobRow>("SELECT * FROM ProcessingJobs ORDER BY CreatedAt DESC LIMIT 100").ToArray();}
 public ProcessingJobRow Retry(string id){var source=Read(id);if(source.Status is "Queued" or "Running")throw new ApiException(409,"作业尚未结束");return Create(new(source.SourceAssetId,source.Operation,JsonSerializer.Deserialize(source.SettingsJson,ApiJson.Default.OptimizationSettings)!),true);}
 public void Cancel(string id){_ = Read(id);using var db=database.Open();db.Ado.ExecuteCommand("UPDATE ProcessingJobs SET CancelRequested=1,Status=IF(Status='Queued','Cancelled',Status),UpdatedAt=@now WHERE Id=@id AND Status IN ('Queued','Running')",P("now",Now()),P("id",id));if(runningId==id)runningCancellation?.Cancel();}
 private ProcessingJobRow? Claim(){using var db=database.Open();db.Ado.BeginTran();try{
   db.Ado.ExecuteCommand("UPDATE ProcessingJobs SET Status='Cancelled',Stage='Cancelled',OwnerId='',LeaseUntil=NULL WHERE CancelRequested=1 AND Status='Running' AND (LeaseUntil IS NULL OR LeaseUntil<=UTC_TIMESTAMP(6))");
   var job=db.Ado.SqlQuery<ProcessingJobRow>("SELECT * FROM ProcessingJobs WHERE CancelRequested=0 AND (Status='Queued' OR Status='Running' AND (LeaseUntil IS NULL OR LeaseUntil<=UTC_TIMESTAMP(6))) ORDER BY CreatedAt LIMIT 1 FOR UPDATE SKIP LOCKED").SingleOrDefault();
   if(job!=null){db.Ado.ExecuteCommand("UPDATE ProcessingJobs SET Status='Running',OwnerId=@owner,LeaseEpoch=LeaseEpoch+1,Attempt=Attempt+1,LeaseUntil=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 15 SECOND),Stage='Staging',Progress=0,UpdatedAt=@now WHERE Id=@id",P("owner",ownerId),P("now",Now()),P("id",job.Id));job=db.Ado.SqlQuery<ProcessingJobRow>("SELECT * FROM ProcessingJobs WHERE Id=@id",P("id",job.Id)).Single();}db.Ado.CommitTran();return job;
  }catch{db.Ado.RollbackTran();throw;}}
 private async Task Heartbeat(ProcessingJobRow job,CancellationTokenSource execution,CancellationToken stop){
  try{while(!stop.IsCancellationRequested){await Task.Delay(2000,stop);using var db=database.Open();if(db.Ado.ExecuteCommand("UPDATE ProcessingJobs SET LeaseUntil=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 15 SECOND) WHERE "+Fence+" AND CancelRequested=0",P("id",job.Id),P("owner",ownerId),P("epoch",job.LeaseEpoch))!=1){execution.Cancel();return;}}}
  catch(OperationCanceledException)when(stop.IsCancellationRequested){}catch(Exception error){logger.LogWarning(error,"Job lease heartbeat lost for {Id}",job.Id);execution.Cancel();}
 }
 protected override async Task ExecuteAsync(CancellationToken stoppingToken){
  while(!stoppingToken.IsCancellationRequested){try{var job=Claim();if(job==null){await Task.Delay(1000,stoppingToken);continue;}
    using var execution=CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);execution.CancelAfter(TimeSpan.FromMinutes(15));using var heartbeatStop=new CancellationTokenSource();runningId=job.Id;runningCancellation=execution;var heartbeat=Heartbeat(job,execution,heartbeatStop.Token);
    try{await Process(job,execution.Token);}catch(OperationCanceledException)when(stoppingToken.IsCancellationRequested){Finish(job,"Queued","等待服务恢复",null);}catch(OperationCanceledException){Finish(job,"Cancelled","作业取消、执行时限或租约失效",null);}catch(Exception error){logger.LogWarning(error,"Asset job {Id} failed",job.Id);Finish(job,"Failed",error.Message[..Math.Min(4000,error.Message.Length)],null);}finally{heartbeatStop.Cancel();await heartbeat;runningId=null;runningCancellation=null;}
   }catch(OperationCanceledException)when(stoppingToken.IsCancellationRequested){break;}catch(Exception error){logger.LogError(error,"Asset queue unavailable");await Task.Delay(2000,stoppingToken);}}
 }
 private void Finish(ProcessingJobRow job,string status,string error,ProcessingResult? result){using var db=database.Open();db.Ado.BeginTran();try{
  var active=db.Ado.SqlQuery<ProcessingJobRow>("SELECT * FROM ProcessingJobs WHERE "+Fence+" FOR UPDATE",P("id",job.Id),P("owner",ownerId),P("epoch",job.LeaseEpoch)).SingleOrDefault();if(active==null){db.Ado.RollbackTran();return;}if(active.CancelRequested){status="Cancelled";result=null;error="作业已取消";}
  if(result!=null)for(var ordinal=0;ordinal<result.Assets.Length;ordinal++){var asset=result.Assets[ordinal];db.Ado.ExecuteCommand("INSERT INTO ProcessingOutputs(JobId,Ordinal,AssetId) VALUES(@id,@ordinal,@asset)",P("id",job.Id),P("ordinal",ordinal),P("asset",asset.Id));db.Ado.ExecuteCommand("INSERT IGNORE INTO Dependencies(OwnerType,OwnerId,AssetId) VALUES('job',@id,@asset)",P("id",job.Id),P("asset",asset.Id));}
  if(db.Ado.ExecuteCommand("UPDATE ProcessingJobs SET Status=@status,Stage=@status,Progress=IF(@status IN ('Succeeded','UnmetBudget'),1,Progress),ResultJson=@result,Error=@error,UpdatedAt=@now,OwnerId='',LeaseUntil=NULL WHERE "+Fence,P("status",status),P("result",result==null?null:JsonSerializer.Serialize(result,ApiJson.Default.ProcessingResult)),P("error",error),P("now",Now()),P("id",job.Id),P("owner",ownerId),P("epoch",job.LeaseEpoch))!=1){db.Ado.RollbackTran();return;}db.Ado.CommitTran();
 }catch{db.Ado.RollbackTran();throw;}}
 public ReadinessCheck[] BudgetChecks(JsonElement document,string sceneId,bool required,HashSet<string> referencedAssets){
  using var db=database.Open();var checks=new List<ReadinessCheck>();var settings=document.GetProperty("settings");var pins=settings.TryGetProperty("processingReports",out var configured)?configured.EnumerateArray().ToArray():[];
  foreach(var model in document.GetProperty("assets").EnumerateArray().Where(a=>DocumentContract.Text(a,"kind")=="model"&&referencedAssets.Contains(DocumentContract.Text(a,"id")))){
   var id=DocumentContract.Text(model,"id");var selected=pins.Where(pin=>DocumentContract.Text(pin,"assetId")==id).ToArray();
   if(selected.Length!=1){checks.Add(new("budget",selected.Length>1?"fail":"unverified",selected.Length>1||required?"error":"warning",selected.Length>1?"同一资产固定了多份预算报告":"模型尚未固定预算报告："+id,"/settings/processingReports",id,sceneId,[]));continue;}
   var job=db.Ado.SqlQuery<ProcessingJobRow>("SELECT j.* FROM ProcessingJobs j WHERE j.Id=@job AND j.Status IN ('Succeeded','UnmetBudget') AND (j.SourceAssetId=@asset OR EXISTS(SELECT 1 FROM ProcessingOutputs o WHERE o.JobId=j.Id AND o.AssetId=@asset))",P("job",DocumentContract.Text(selected[0],"jobId")),P("asset",id)).SingleOrDefault();
   if(job?.ResultJson==null){checks.Add(new("budget","fail","error","预算报告不存在、未完成或不属于此资产","/settings/processingReports",id,sceneId,[]));continue;}
   using var result=JsonDocument.Parse(job.ResultJson);var report=result.RootElement.GetProperty("report");var reportKey=id==job.SourceAssetId&&job.Operation!="diagnose"?"sourceBudget":"budget";var configuredBudget=report.TryGetProperty(reportKey,out var budget)&&budget.ValueKind==JsonValueKind.Object&&DocumentContract.Text(budget,"status")!="notConfigured";
   var validHash=DocumentContract.Text(report,"settingsHash")==job.SettingsHash&&DocumentContract.Text(report,"sourceSha256")==job.SourceSha256;var met=configuredBudget&&DocumentContract.Text(budget,"status")=="met"&&validHash;
   checks.Add(new("budget",met?"pass":configuredBudget?"fail":"unverified",met?"info":configuredBudget||required?"error":"warning",met?"固定资产预算通过（GPU 为保守估算）":configuredBudget?"固定报告未达预算或策略 Hash 不一致":"固定报告未配置预算","/settings/processingReports",id,sceneId,["job="+job.Id,"settingsHash="+job.SettingsHash,configuredBudget?budget.GetRawText():""]));
  }
  if(checks.Count==0)checks.Add(new("budget","unverified",required?"error":"warning","没有模型预算报告","/assets","",sceneId,[]));return checks.ToArray();
 }
 private async Task Process(ProcessingJobRow job,CancellationToken ct){
  var root=Path.GetFullPath(config["STUDIO_JOB_ROOT"]??Path.Combine(AppContext.BaseDirectory,".jobs"));var work=Path.Combine(root,job.Id,job.LeaseEpoch.ToString(System.Globalization.CultureInfo.InvariantCulture));Directory.CreateDirectory(Path.Combine(work,"input"));var logs=new List<string>();
  try{var asset=objects.Get(job.SourceAssetId);if(asset.Sha256!=job.SourceSha256)throw new ApiException(422,"源资产摘要变化");await objects.Confirm(asset,ct);long total=0;foreach(var file in asset.Files){ct.ThrowIfCancellationRequested();if(!ObjectStore.ValidPath(file))throw new ApiException(422,"输入资源路径非法");var destination=Path.Combine(work,"input",file);Directory.CreateDirectory(Path.GetDirectoryName(destination)!);await using var stream=File.Create(destination);await objects.CopyTo("assets/"+asset.Id+"/"+file,stream,ct);total+=stream.Length;if(total>1024L*1024*1024)throw new ApiException(413,"作业输入超过 1 GiB 预算");}
   var task=new JsonObject{["sourceAssetId"]=asset.Id,["sourceSha256"]=asset.Sha256,["entry"]=asset.Entry,["operation"]=job.Operation,["settingsHash"]=job.SettingsHash,["settings"]=JsonNode.Parse(job.SettingsJson)};var taskPath=Path.Combine(work,"task.json");await File.WriteAllTextAsync(taskPath,task.ToJsonString(),ct);
   var start=new ProcessStartInfo(config["STUDIO_NODE"]??"node"){UseShellExecute=false,RedirectStandardOutput=true,RedirectStandardError=true,WorkingDirectory=work};start.ArgumentList.Add("--max-old-space-size=1024");start.ArgumentList.Add(Path.Combine(config["STUDIO_WORKER_ROOT"]??Path.Combine(AppContext.BaseDirectory,"workers"),"asset-worker.mjs"));start.ArgumentList.Add(taskPath);
   foreach(var key in new[]{"STUDIO_IFC_PYTHON","STUDIO_IFC_MODULES","STUDIO_IFC_THREADS","STUDIO_TOKTX"})if(config[key] is {Length:>0} value)start.Environment[key]=value;
   using var process=new System.Diagnostics.Process{StartInfo=start};process.Start();using var registration=ct.Register(()=>{try{if(!process.HasExited)process.Kill(true);}catch(InvalidOperationException){}});
   async Task ReadLines(StreamReader reader){while(await reader.ReadLineAsync(ct) is {} line){line=line[..Math.Min(2000,line.Length)];lock(logs){logs.Add(line);if(logs.Count>500)logs.RemoveAt(0);}string stage="Converting";double progress=.1;try{using var parsed=JsonDocument.Parse(line);if(parsed.RootElement.TryGetProperty("stage",out var value))stage=value.GetString()??stage;if(parsed.RootElement.TryGetProperty("progress",out var p))progress=Math.Clamp(p.GetDouble(),0,.99);}catch(JsonException){}using var db=database.Open();string[] snapshot;lock(logs)snapshot=logs.ToArray();db.Ado.ExecuteCommand("UPDATE ProcessingJobs SET Stage=@stage,Progress=@progress,LogsJson=@logs,UpdatedAt=@now WHERE Id=@id AND OwnerId=@owner AND LeaseEpoch=@epoch AND Status='Running' AND LeaseUntil>UTC_TIMESTAMP(6)",P("owner",ownerId),P("epoch",job.LeaseEpoch),P("stage",stage),P("progress",progress),P("logs",JsonSerializer.Serialize(snapshot,ApiJson.Default.StringArray)),P("now",Now()),P("id",job.Id));}}
   await Task.WhenAll(ReadLines(process.StandardOutput),ReadLines(process.StandardError),process.WaitForExitAsync(ct));ct.ThrowIfCancellationRequested();if(process.ExitCode!=0)throw new ApiException(422,"转换进程失败："+string.Join('\n',logs.TakeLast(8)));
   var result=JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(work,"result.json"),ct)).RootElement;var assets=new List<AssetResponse>();foreach(var output in result.GetProperty("outputs").EnumerateArray()){
    var kind=DocumentContract.Text(output,"kind");var entry=DocumentContract.Text(output,"entry");if(kind=="semantic"){
     var path=Path.Combine(work,"output",entry);var dataset=JsonNode.Parse(await File.ReadAllTextAsync(path,ct))!.AsObject();var model=assets.LastOrDefault(a=>a.Kind=="model");foreach(var record in dataset["records"]!.AsArray())record!["modelRevision"]=model?.Sha256??job.SourceSha256;if(model!=null)dataset["modelAssetId"]=model.Id;await File.WriteAllTextAsync(path,dataset.ToJsonString(),ct);
    }
    var zipPath=Path.Combine(work,"result-"+assets.Count+".zip");using(var zip=ZipFile.Open(zipPath,ZipArchiveMode.Create)){foreach(var item in output.GetProperty("files").EnumerateArray()){var file=item.GetString()!;if(!ObjectStore.ValidPath(file))throw new ApiException(422,"转换结果路径非法");var source=Path.GetFullPath(Path.Combine(work,"output",file));if(!source.StartsWith(Path.Combine(work,"output")+Path.DirectorySeparatorChar,StringComparison.Ordinal))throw new ApiException(422,"转换结果路径越界");zip.CreateEntryFromFile(source,file);}}
    await using var stream=File.OpenRead(zipPath);var derived=await objects.Upload(stream,asset.Name+" "+job.Operation,kind,entry,ct);assets.Add(derived);if(kind=="semantic")await semantics.Index(derived.Id,ct);
   }
   ct.ThrowIfCancellationRequested();if(Read(job.Id).CancelRequested)throw new OperationCanceledException(ct);
   var report=result.GetProperty("report").Clone();var unmet=report.TryGetProperty("budget",out var budget)&&DocumentContract.Text(budget,"status")=="unmet";
   Finish(job,unmet?"UnmetBudget":"Succeeded",unmet?"无损处理未达到预算；保留诊断报告，结果不可应用":"",new(report,assets.ToArray()));
  }finally{if(Directory.Exists(work))Directory.Delete(work,true);}
 }
}
