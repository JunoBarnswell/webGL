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
builder.Services.AddSingleton<Authentication>(); builder.Services.AddSingleton<ObjectStore>(); builder.Services.AddSingleton<StudioService>();
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
app.MapGet("/api/health", (Database database) => { using var db = database.Open(); db.Ado.SqlQuery<CountRow>("SELECT 1 AS Value"); return Results.Json(new HealthResponse("ready", "linux-x64/native-aot", "mysql8/minio"), ApiJson.Default.HealthResponse); });
app.MapGet("/api/projects", (StudioService service) => Results.Json(service.Projects(), ApiJson.Default.ProjectResponseArray));
app.MapPost("/api/projects", (ProjectRequest request, StudioService service) => Results.Json(service.Create(request), ApiJson.Default.DraftResponse));
app.MapPost("/api/projects/{id}/copy", (string id, StudioService service) => Results.Json(service.Copy(id), ApiJson.Default.DraftResponse));
app.MapDelete("/api/projects/{id}", (string id, StudioService service) => { service.DeleteProject(id); return Results.NoContent(); });
app.MapGet("/api/projects/{id}/export", async (string id, HttpContext context, StudioService service) => {
    // Stage the complete export before sending headers: failures remain truthful JSON errors.
    var path = Path.Combine(Path.GetTempPath(), "studio-export-" + Database.Id() + ".zip");
    try { await using (var output = File.Create(path)) await service.Export(id, output, context.RequestAborted); context.Response.ContentType = "application/zip"; context.Response.Headers.ContentDisposition = "attachment; filename=project.studio.zip"; await context.Response.SendFileAsync(path, context.RequestAborted); }
    finally { File.Delete(path); }
});
app.MapPost("/api/projects/import", async (HttpContext context, StudioService service) => Results.Json(await service.Import(context.Request.Body, context.RequestAborted), ApiJson.Default.DraftResponse));
app.MapGet("/api/scenes/{id}/draft", (string id, StudioService service) => Results.Json(service.Read(id), ApiJson.Default.DraftResponse));
app.MapPut("/api/scenes/{id}/draft", (string id, SaveRequest request, StudioService service) => Results.Json(service.Save(id, request), ApiJson.Default.DraftResponse));
app.MapGet("/api/scenes/{id}/versions", (string id, StudioService service) => Results.Json(service.Versions(id), ApiJson.Default.VersionResponseArray));
app.MapPost("/api/scenes/{id}/versions", (string id, RevisionRequest request, StudioService service) => Results.Json(service.Snapshot(id, request.ExpectedRevision), ApiJson.Default.VersionResponse));
app.MapPost("/api/scenes/{id}/versions/{version}/restore", (string id, string version, RevisionRequest request, StudioService service) => Results.Json(service.Restore(id, version, request.ExpectedRevision), ApiJson.Default.DraftResponse));
app.MapPost("/api/scenes/{id}/publish", async (string id, RevisionRequest request, StudioService service, CancellationToken ct) => Results.Json(await service.Publish(id, request.ExpectedRevision, ct), ApiJson.Default.PublishResponse));
app.MapDelete("/api/scenes/{id}/publish", (string id, StudioService service) => { service.Unpublish(id); return Results.NoContent(); });
app.MapGet("/api/assets", (Database database) => { using var db = database.Open(); return Results.Json(db.Ado.SqlQuery<AssetRow>("SELECT * FROM Assets ORDER BY CreatedAt DESC").Select(row => new AssetStatusResponse(ObjectStore.ToAsset(row), row.Status)).ToArray(), ApiJson.Default.AssetStatusResponseArray); });
app.MapPost("/api/assets", async (HttpContext context, ObjectStore objects) => Results.Json(await objects.Upload(context.Request.Body, context.Request.Query["name"].ToString(), context.Request.Query["kind"].ToString(), context.Request.Query["entry"].ToString(), context.RequestAborted), ApiJson.Default.AssetResponse));
app.MapDelete("/api/assets/{id}", async (string id, ObjectStore objects, CancellationToken ct) => { await objects.Delete(id, ct); return Results.NoContent(); });
static async Task FileResponse(string id, string path, HttpContext context, ObjectStore objects) {
    var asset = objects.Get(id); if (!ObjectStore.ValidPath(path) || !asset.Files.Contains(path)) throw new ApiException(404, "资源文件不存在");
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
var database = app.Services.GetRequiredService<Database>(); database.Migrate();
_ = app.Services.GetRequiredService<Authentication>();
await app.Services.GetRequiredService<ObjectStore>().Initialize(CancellationToken.None);
await app.RunAsync();
