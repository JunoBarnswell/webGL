using System.Text.Json;
using System.Threading.RateLimiting;
using Amazon.S3;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.FileProviders;
using SqlSugar;
using Studio;

StaticConfig.EnableAot = true;
var builder = WebApplication.CreateSlimBuilder(args);
builder.Services.ConfigureHttpJsonOptions(options => { options.SerializerOptions.TypeInfoResolverChain.Insert(0, ApiJson.Default); options.SerializerOptions.RespectRequiredConstructorParameters = true; });
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 1024L * 1024 * 1024);
builder.Services.AddMemoryCache(options => options.SizeLimit = 32 * 1024 * 1024);
builder.Services.AddSingleton<Database>(); builder.Services.AddSingleton<DocumentContract>();
builder.Services.AddSingleton<Authentication>(); builder.Services.AddSingleton<ObjectStore>(); builder.Services.AddSingleton<StudioService>(); builder.Services.AddSingleton<LibraryService>(); builder.Services.AddSingleton<ProjectService>(); builder.Services.AddSingleton<ProjectArchiveService>(); builder.Services.AddSingleton<SemanticService>(); builder.Services.AddSingleton<ProcessingService>(); builder.Services.AddHostedService(service=>service.GetRequiredService<ProcessingService>());
builder.Services.AddRateLimiter(options => options.AddPolicy("login", context => RateLimitPartition.GetFixedWindowLimiter(context.Connection.RemoteIpAddress?.ToString() ?? "local", _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 })));
var app = builder.Build();
app.Use(async (context, next) => {
    context.Response.Headers.XContentTypeOptions = "nosniff";
    try {
        var path = context.Request.Path;
        if (path.StartsWithSegments("/api") && !path.StartsWithSegments("/api/player") && path != "/api/health" && path != "/api/auth/login") {
            var authorization = context.Request.Headers.Authorization.ToString();
            if (!authorization.StartsWith("Bearer ", StringComparison.Ordinal) || !context.RequestServices.GetRequiredService<Authentication>().Valid(authorization[7..])) throw new ApiException(401, "请重新登录");
        }
        await next();
    } catch (ApiException error) when (!context.Response.HasStarted) {
        context.Response.StatusCode = error.Status; await context.Response.WriteAsJsonAsync(new ErrorResponse(error.Message, error.Details), ApiJson.Default.ErrorResponse);
    } catch (Exception error) when (!context.Response.HasStarted && error is JsonException or InvalidDataException) {
        context.Response.StatusCode = 422; await context.Response.WriteAsJsonAsync(new ErrorResponse("请求格式无效", [error.Message]), ApiJson.Default.ErrorResponse);
    } catch (Exception error) when (!context.Response.HasStarted && error is not OperationCanceledException) {
        app.Logger.LogError(error, "Studio operation failed"); context.Response.StatusCode = 503;
        await context.Response.WriteAsJsonAsync(new ErrorResponse("持久化服务暂时不可用，操作未完成", []), ApiJson.Default.ErrorResponse);
    }
});
app.UseRateLimiter();
app.MapPost("/api/auth/login", (LoginRequest request, Authentication authentication) => Results.Json(authentication.Login(request), ApiJson.Default.LoginResponse)).RequireRateLimiting("login");
app.MapGet("/api/health", (Database database) => { using var db = database.Open(); db.Ado.SqlQuery<CountRow>("SELECT 1 AS Value"); return Results.Json(new HealthResponse("ready", System.Runtime.InteropServices.RuntimeInformation.RuntimeIdentifier + "/native-aot", "mysql/minio"), ApiJson.Default.HealthResponse); });
app.MapGet("/api/projects", (StudioService service) => Results.Json(service.Projects(), ApiJson.Default.ProjectResponseArray));
app.MapPost("/api/projects", (ProjectRequest request, StudioService service) => Results.Json(service.Create(request), ApiJson.Default.DraftResponse));
app.MapPost("/api/projects/{id}/copy", (string id, ProjectArchiveService service) => Results.Json(service.Copy(id), ApiJson.Default.DraftResponse));
app.MapDelete("/api/projects/{id}", (string id, StudioService service) => { service.DeleteProject(id); return Results.NoContent(); });
app.MapGet("/api/projects/{id}/export", async (string id, HttpContext context, ProjectArchiveService service) => {
    // Stage the complete export before sending headers: failures remain truthful JSON errors.
    var path = Path.Combine(Path.GetTempPath(), "studio-export-" + Database.Id() + ".zip");
    try { await using (var output = File.Create(path)) await service.Export(id, output, context.RequestAborted); context.Response.ContentType = "application/zip"; context.Response.Headers.ContentDisposition = "attachment; filename=project.studio.zip"; await context.Response.SendFileAsync(path, context.RequestAborted); }
    finally { File.Delete(path); }
});
app.MapPost("/api/projects/import", async (HttpContext context, ProjectArchiveService service) => Results.Json(await service.Import(context.Request.Body, context.RequestAborted), ApiJson.Default.DraftResponse));
app.MapGet("/api/scenes/{id}/draft", (string id, StudioService service) => Results.Json(service.Read(id), ApiJson.Default.DraftResponse));
app.MapPut("/api/scenes/{id}/draft", (string id, SaveRequest request, StudioService service) => Results.Json(service.Save(id, request), ApiJson.Default.DraftResponse));
app.MapGet("/api/scenes/{id}/versions/{version}",(string id,string version,StudioService service)=>Results.Json(service.ReadVersion(id,version),ApiJson.Default.SceneVersionResponse));
app.MapGet("/api/scenes/{id}/versions", (string id, StudioService service) => Results.Json(service.Versions(id), ApiJson.Default.VersionResponseArray));
app.MapPost("/api/scenes/{id}/versions", (string id, RevisionRequest request, StudioService service) => Results.Json(service.Snapshot(id, request.ExpectedRevision), ApiJson.Default.VersionResponse));
app.MapPost("/api/scenes/{id}/versions/{version}/restore", (string id, string version, RevisionRequest request, StudioService service) => Results.Json(service.Restore(id, version, request.ExpectedRevision), ApiJson.Default.DraftResponse));
app.MapPost("/api/scenes/{id}/publish", async (string id, RevisionRequest request, StudioService service, CancellationToken ct) => Results.Json(await service.Publish(id, request.ExpectedRevision, ct), ApiJson.Default.PublishResponse));
app.MapDelete("/api/scenes/{id}/publish", (string id, StudioService service) => { service.Unpublish(id); return Results.NoContent(); });
app.MapGet("/api/assets/{id}",(string id,ObjectStore objects)=>Results.Json(objects.Get(id),ApiJson.Default.AssetResponse));
app.MapGet("/api/assets", (Database database) => { using var db = database.Open(); return Results.Json(db.Ado.SqlQuery<AssetRow>("SELECT * FROM Assets ORDER BY CreatedAt DESC").Select(row => new AssetStatusResponse(ObjectStore.ToAsset(row), row.Status)).ToArray(), ApiJson.Default.AssetStatusResponseArray); });
app.MapPost("/api/assets", async (HttpContext context, ObjectStore objects) => Results.Json(await objects.Upload(context.Request.Body, context.Request.Query["name"].ToString(), context.Request.Query["kind"].ToString(), context.Request.Query["entry"].ToString(), context.RequestAborted, context.Request.Query["importTaskId"].FirstOrDefault()), ApiJson.Default.AssetResponse));
app.MapPut("/api/assets/{id}/preview", async (string id, int width, int height, HttpContext context, ObjectStore objects) => Results.Json(await objects.Preview(id,context.Request.Body,width,height,context.RequestAborted),ApiJson.Default.AssetResponse));
app.MapDelete("/api/imports/{taskId}",async(string taskId,ObjectStore objects,CancellationToken ct)=>{await objects.CleanupImport(taskId,ct);return Results.NoContent();});
app.MapDelete("/api/assets/{id}", async (string id, ObjectStore objects, CancellationToken ct) => { await objects.Delete(id, ct); return Results.NoContent(); });
static async Task FileResponse(string id, string path, HttpContext context, ObjectStore objects) {
    var asset = objects.Get(id); if (!ObjectStore.ValidPath(path) || !(asset.Files.Contains(path)||asset.Preview?.File==path)) throw new ApiException(404, "资源文件不存在");
    context.Response.ContentType = ObjectStore.Mime(path); context.Response.Headers.CacheControl = "private, max-age=0, must-revalidate";
    await objects.CopyTo("assets/" + id + "/" + path, context.Response.Body, context.RequestAborted);
}
app.MapGet("/api/assets/{id}/files/{**path}", FileResponse);
app.MapGet("/api/player/{id}/manifest", async (string id, StudioService service, CancellationToken ct) => Results.Json(await service.Manifest(id, ct), ApiJson.Default.ManifestResponse));
app.MapGet("/api/player/{scene}/versions/{version}/assets/{id}/files/{**path}", async (string scene, string version, string id, string path, HttpContext context, StudioService service, ObjectStore objects) => { service.AuthorizeAsset(scene, version, id); await FileResponse(id, path, context, objects); });
var webRoot = Path.Combine(app.Environment.ContentRootPath, "wwwroot");
if (Directory.Exists(webRoot)) {
    app.UseStaticFiles(new StaticFileOptions { FileProvider = new PhysicalFileProvider(webRoot) });
    app.MapGet("/", () => Results.Redirect("/editor/"));
    app.MapFallback((HttpContext context) => { var application = context.Request.Path.StartsWithSegments("/player") ? "player" : "editor"; if (context.Request.Path.StartsWithSegments("/api")) return Results.NotFound(); return Results.File(Path.Combine(webRoot, application, "index.html"), "text/html"); });
}
app.MapGet("/api/library/{kind}",(string kind,LibraryService library)=>Results.Json(library.List(kind),ApiJson.Default.LibraryResponseArray));
app.MapGet("/api/library/{kind}/{id}",(string kind,string id,LibraryService library)=>Results.Json(library.Read(kind,id),ApiJson.Default.LibraryResponse));
app.MapPut("/api/library/{kind}/{id}",(string kind,string id,LibraryRequest request,LibraryService library)=>Results.Json(library.Save(kind,id,request),ApiJson.Default.LibraryResponse));
app.MapGet("/api/library/{kind}/{id}/revisions",(string kind,string id,LibraryService library)=>Results.Json(library.History(kind,id),ApiJson.Default.LibraryResponseArray));
app.MapGet("/api/library/{kind}/{id}/revisions/{version}",(string kind,string id,string version,LibraryService library)=>Results.Json(library.Read(kind,id,version),ApiJson.Default.LibraryResponse));
app.MapGet("/api/library/{kind}/{id}/usage",(string kind,string id,LibraryService library)=>Results.Json(library.Usage(kind,id),ApiJson.Default.LibraryReferenceRowArray));
app.MapDelete("/api/library/{kind}/{id}",(string kind,string id,LibraryService library)=>{library.Delete(kind,id);return Results.NoContent();});
app.MapGet("/api/projects/{id}/scenes",(string id,StudioService service)=>Results.Json(service.Scenes(id),ApiJson.Default.DraftResponseArray));
app.MapPost("/api/projects/{id}/scenes",(string id,ProjectRequest request,StudioService service)=>Results.Json(service.AddScene(id,request),ApiJson.Default.DraftResponse));
app.MapPost("/api/projects/{id}/publish",async(string id,ProjectPublishRequest request,ProjectService service,CancellationToken ct)=>Results.Json(await service.Publish(id,request,ct),ApiJson.Default.PublishResponse));
app.MapDelete("/api/projects/{id}/publish",(string id,ProjectService service)=>{service.Unpublish(id);return Results.NoContent();});
app.MapGet("/api/projects/{id}/publications",(string id,ProjectService service)=>Results.Json(service.History(id),ApiJson.Default.ProjectPublicationRowArray));
app.MapPost("/api/projects/{id}/publications/{version}/restore",async(string id,string version,RevisionRequest request,ProjectService service,CancellationToken ct)=>Results.Json(await service.Restore(id,version,request.ExpectedRevision,ct),ApiJson.Default.LibraryResponse));
app.MapGet("/api/player/projects/{id}/manifest",async(string id,ProjectService service,CancellationToken ct)=>Results.Json(await service.Manifest(id,null,ct),ApiJson.Default.ProjectManifestResponse));
app.MapGet("/api/player/projects/{id}/versions/{version}/scenes/{scene}",async(string id,string version,string scene,ProjectService service,CancellationToken ct)=>Results.Json(await service.SceneManifest(id,version,scene,ct),ApiJson.Default.ManifestResponse));
app.MapGet("/api/player/projects/{project}/versions/{version}/assets/{id}/files/{**path}",async(string project,string version,string id,string path,HttpContext context,ProjectService service,ObjectStore objects)=>{service.AuthorizeAsset(project,version,id);await FileResponse(id,path,context,objects);});
app.MapPost("/api/semantics/{id}/index",async(string id,SemanticService service,CancellationToken ct)=>Results.Json(new CountResponse(await service.Index(id,ct)),ApiJson.Default.CountResponse));
app.MapGet("/api/semantics/{id}",(string id,HttpContext context,SemanticService service)=>Results.Json(service.Query(id,context.Request.Query["q"].ToString(),int.TryParse(context.Request.Query["page"],out var page)?page:0,int.TryParse(context.Request.Query["pageSize"],out var size)?size:100,context.Request.Query["filters"].ToString(),context.Request.Query["idsOnly"]=="1",context.Request.Query["valueField"].ToString()),ApiJson.Default.SemanticPage));
app.MapPost("/api/semantics/{id}/map",async(string id,SemanticMapRequest request,SemanticService service,CancellationToken ct)=>Results.Json(await service.Map(id,request,ct),ApiJson.Default.SemanticMapResponse));
app.MapGet("/api/player/{scene}/versions/{version}/semantics/{id}",(string scene,string version,string id,HttpContext context,StudioService scenes,SemanticService service)=>{scenes.AuthorizeAsset(scene,version,id);return Results.Json(service.Query(id,context.Request.Query["q"].ToString(),int.TryParse(context.Request.Query["page"],out var page)?page:0,100,context.Request.Query["filters"].ToString(),context.Request.Query["idsOnly"]=="1",context.Request.Query["valueField"].ToString()),ApiJson.Default.SemanticPage);});
app.MapGet("/api/player/projects/{project}/versions/{version}/semantics/{id}",(string project,string version,string id,HttpContext context,ProjectService projects,SemanticService service)=>{projects.AuthorizeAsset(project,version,id);return Results.Json(service.Query(id,context.Request.Query["q"].ToString(),int.TryParse(context.Request.Query["page"],out var page)?page:0,100,context.Request.Query["filters"].ToString(),context.Request.Query["idsOnly"]=="1",context.Request.Query["valueField"].ToString()),ApiJson.Default.SemanticPage);});
app.MapPost("/api/jobs",(ProcessingRequest request,ProcessingService service)=>Results.Json(service.Create(request),ApiJson.Default.ProcessingJobRow));
app.MapGet("/api/jobs",(ProcessingService service)=>Results.Json(service.List(),ApiJson.Default.ProcessingJobRowArray));
app.MapGet("/api/jobs/{id}",(string id,ProcessingService service)=>Results.Json(service.Read(id),ApiJson.Default.ProcessingJobRow));
app.MapDelete("/api/jobs/{id}",(string id,ProcessingService service)=>{service.Cancel(id);return Results.NoContent();});
app.MapPost("/api/jobs/{id}/retry",(string id,ProcessingService service)=>Results.Json(service.Retry(id),ApiJson.Default.ProcessingJobRow));
var database = app.Services.GetRequiredService<Database>(); database.Migrate();
_ = app.Services.GetRequiredService<Authentication>();
await app.Services.GetRequiredService<ObjectStore>().Initialize(CancellationToken.None);
await app.RunAsync();
