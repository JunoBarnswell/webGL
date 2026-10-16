using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Caching.Memory;
using static Studio.Database;

namespace Studio;

public sealed class ObjectStore : IDisposable
{
    private readonly AmazonS3Client client;
    private readonly string bucket;
    private readonly Database database;
    private readonly IMemoryCache cache;
    public ObjectStore(IConfiguration config, Database database, IMemoryCache cache)
    {
        this.database = database; this.cache = cache;
        bucket = config["STUDIO_S3_BUCKET"] ?? "webgl-studio";
        client = new AmazonS3Client(new BasicAWSCredentials(config["STUDIO_S3_ACCESS_KEY"], config["STUDIO_S3_SECRET_KEY"]), new AmazonS3Config {
            ServiceURL = config["STUDIO_S3_ENDPOINT"] ?? "http://127.0.0.1:19000", ForcePathStyle = true,
            AuthenticationRegion = "us-east-1", RequestChecksumCalculation = RequestChecksumCalculation.WHEN_REQUIRED,
            ResponseChecksumValidation = ResponseChecksumValidation.WHEN_REQUIRED
        });
    }
    public async Task Initialize(CancellationToken ct)
    {
        var buckets = await client.ListBucketsAsync(ct);
        if (!(buckets.Buckets ?? []).Any(b => b.BucketName == bucket)) await client.PutBucketAsync(new PutBucketRequest { BucketName = bucket, UseClientRegion = false }, ct);
    }
    public static bool ValidPath(string path) => path.Length is > 0 and <= 1024 && !path.Any(c => char.IsControl(c) || "\\:?#%".Contains(c)) && !path.StartsWith('/') && path.Split('/').All(p => p is not ("" or "." or ".."));
    public static string Mime(string path) => Path.GetExtension(path).ToLowerInvariant() switch {
        ".json" or ".gltf" => "application/json", ".glb" => "model/gltf-binary", ".jpg" or ".jpeg" => "image/jpeg", ".png" => "image/png", ".webp" => "image/webp", ".mp3" => "audio/mpeg", ".wav" => "audio/wav", ".ogg" => "audio/ogg", _ => "application/octet-stream"
    };
    public async Task Put(string key, Stream stream, string type, string sha256, CancellationToken ct)
    {
        var request = new PutObjectRequest { BucketName = bucket, Key = key, InputStream = stream, ContentType = type, AutoCloseStream = false, UseChunkEncoding = false };
        request.Metadata["sha256"] = sha256;
        await client.PutObjectAsync(request, ct);
        var head = await client.GetObjectMetadataAsync(new GetObjectMetadataRequest { BucketName = bucket, Key = key }, ct);
        if (head.ContentLength != stream.Length || head.Metadata["x-amz-meta-sha256"] != sha256) throw new IOException("MinIO 对象确认失败: " + key);
    }
    public async Task PutManifest(string key, byte[] bytes, CancellationToken ct) { using var stream = new MemoryStream(bytes); await Put(key, stream, "application/json", Convert.ToHexStringLower(SHA256.HashData(bytes)), ct); }
    public async Task<byte[]> Read(string key, CancellationToken ct)
    {
        using var response = await client.GetObjectAsync(bucket, key, ct);
        using var memory = new MemoryStream(); await response.ResponseStream.CopyToAsync(memory, ct); return memory.ToArray();
    }
    public async Task CopyTo(string key, Stream output, CancellationToken ct)
    { using var response = await client.GetObjectAsync(bucket, key, ct); await response.ResponseStream.CopyToAsync(output, ct); }
    public async Task Confirm(AssetResponse asset, CancellationToken ct)
    {
        try { foreach (var file in asset.Files) await client.GetObjectMetadataAsync(new GetObjectMetadataRequest { BucketName = bucket, Key = "assets/" + asset.Id + "/" + file }, ct); }
        catch(AmazonS3Exception error) when(error.StatusCode==System.Net.HttpStatusCode.NotFound) { throw new ApiException(422,"资源对象缺失："+asset.Id); }
    }
    public AssetResponse VerifyMetadata(JsonElement source) { var asset=Get(DocumentContract.Text(source,"id")); if(asset.Sha256!=DocumentContract.Text(source,"sha256")||asset.Kind!=DocumentContract.Text(source,"kind")||asset.Entry!=DocumentContract.Text(source,"entry")||!asset.Files.Order(StringComparer.Ordinal).SequenceEqual(source.GetProperty("files").EnumerateArray().Select(f=>f.GetString()!).Order(StringComparer.Ordinal)))throw new ApiException(422,"资源元数据不一致："+asset.Id);return asset; }
    public static AssetResponse ToAsset(AssetRow row) => new(row.Id, row.Name, row.Kind, row.Entry, JsonSerializer.Deserialize(row.FilesJson, ApiJson.Default.StringArray)!, row.Sha256, row.PreviewJson == null ? null : JsonSerializer.Deserialize(row.PreviewJson, ApiJson.Default.AssetPreview), row.ImportTaskId);
    public AssetResponse Get(string id)
    {
        if (cache.TryGetValue<AssetResponse>("asset:" + id, out var cached) && cached != null) return cached;
        using var db = database.Open();
        var row = db.Ado.SqlQuery<AssetRow>("SELECT * FROM Assets WHERE Id=@id AND Status='Ready'", P("id", id)).SingleOrDefault() ?? throw new ApiException(404, "资源不存在或未就绪: " + id);
        var asset = ToAsset(row); cache.Set("asset:" + id, asset, new MemoryCacheEntryOptions { Size = row.FilesJson.Length + 1024, AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10) }); return asset;
    }
    public async Task<AssetResponse> Upload(Stream input, string name, string kind, string entry, CancellationToken ct, string? importTaskId = null)
    {
        if (importTaskId != null && !System.Text.RegularExpressions.Regex.IsMatch(importTaskId,"^[a-zA-Z0-9_-]{1,100}$")) throw new ApiException(400,"导入任务 ID 无效");
        if (name.Length is < 1 or > 255 || !new[] { "mesh", "model", "image", "audio", "texture", "source", "semantic" }.Contains(kind) || !ValidPath(entry)) throw new ApiException(400, "资源名称、类型或入口无效");
        if(importTaskId!=null){using var jobDb=database.Open();jobDb.Ado.ExecuteCommand("INSERT IGNORE INTO ImportJobs(Id) VALUES(@task)",P("task",importTaskId));if(jobDb.Ado.SqlQuery<CountRow>("SELECT COUNT(*) AS Value FROM ImportJobs WHERE Id=@task AND Cancelled=1",P("task",importTaskId))[0].Value>0)throw new ApiException(409,"导入任务已取消");}
        var stage = Path.Combine(Path.GetTempPath(), "studio-upload-" + Id()); Directory.CreateDirectory(stage);
        try {
            var archivePath = Path.Combine(stage, "bundle.zip");
            await using (var output = File.Create(archivePath)) { await input.CopyToAsync(output, ct); if (output.Length > 512L * 1024 * 1024) throw new ApiException(413, "资源压缩包过大"); }
            using var archive = ZipFile.OpenRead(archivePath);
            var files = archive.Entries.Where(x => !x.FullName.EndsWith('/')).OrderBy(x => x.FullName, StringComparer.Ordinal).ToArray();
            if (files.Length is < 1 or > 2048 || files.Select(x => x.FullName).Distinct().Count() != files.Length || files.Any(x => !ValidPath(x.FullName) || (x.ExternalAttributes >> 16 & 0xf000) == 0xa000) || files.Sum(x => x.Length) > 1024L * 1024 * 1024 || files.Any(x => x.Length > 256L * 1024 * 1024)) throw new ApiException(400, "资源包包含非法或过大的文件");
            if (!files.Any(x => x.FullName == entry)) throw new ApiException(400, "入口文件不存在");
            using var digest = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            digest.AppendData(Encoding.UTF8.GetBytes(kind + "\0" + entry + "\0"));
            var hashes = new Dictionary<string, string>();
            foreach (var file in files) {
                var path = Path.Combine(stage, "files", file.FullName); Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                await using (var stream = file.Open()) await using (var output = File.Create(path)) await stream.CopyToAsync(output, ct);
                await using var content = File.OpenRead(path); var hash = Convert.ToHexStringLower(await SHA256.HashDataAsync(content, ct)); hashes[file.FullName] = hash;
                digest.AppendData(Encoding.UTF8.GetBytes(file.FullName + "\0" + hash + "\n"));
            }
            if (kind == "model") ValidateGltf(Path.Combine(stage, "files"), entry, files.Select(x => x.FullName).ToHashSet());
            var sha = Convert.ToHexStringLower(digest.GetHashAndReset()); var id = "a-" + sha;
            var asset = new AssetResponse(id, name, kind, entry, files.Select(x => x.FullName).ToArray(), sha, null, importTaskId);
            using (var db = database.Open()) {
                var previous = db.Ado.SqlQuery<AssetRow>("SELECT * FROM Assets WHERE Id=@id", P("id", id)).SingleOrDefault();
                if (previous?.Status == "Ready") return ToAsset(previous);
                db.Ado.ExecuteCommand("INSERT IGNORE INTO Assets(Id,Name,Kind,Entry,FilesJson,Sha256,Status,CreatedAt,ImportTaskId) VALUES(@id,@name,@kind,@entry,@files,@sha,'Pending',@now,@task)", P("id", id), P("name", name), P("kind", kind), P("entry", entry), P("files", JsonSerializer.Serialize(asset.Files, ApiJson.Default.StringArray)), P("sha", sha), P("now", Now()), P("task", importTaskId));
            }
            foreach (var file in files) { await using var content = File.OpenRead(Path.Combine(stage, "files", file.FullName)); await Put("assets/" + id + "/" + file.FullName, content, Mime(file.FullName), hashes[file.FullName], ct); }
            if(importTaskId!=null){using var jobDb=database.Open();if(jobDb.Ado.SqlQuery<CountRow>("SELECT COUNT(*) AS Value FROM ImportJobs WHERE Id=@task AND Cancelled=1",P("task",importTaskId))[0].Value>0){await Delete(id,CancellationToken.None);throw new ApiException(409,"导入任务已取消");}}
            using (var db = database.Open()) db.Ado.ExecuteCommand("UPDATE Assets SET Status='Ready' WHERE Id=@id", P("id", id));
            cache.Remove("asset:" + id); return asset;
        } finally { Directory.Delete(stage, true); }
    }
    public async Task<AssetResponse> Preview(string id, Stream input, int width, int height, CancellationToken ct)
    {
        var asset=Get(id); if(!new[]{"image","texture"}.Contains(asset.Kind)||width is <1 or >256||height is <1 or >256)throw new ApiException(422,"缩略图参数无效");
        using var bytes=new MemoryStream();await input.CopyToAsync(bytes,ct);var data=bytes.ToArray();
        if(data.Length is <12 or >1048576 || Encoding.ASCII.GetString(data,0,4)!="RIFF" || Encoding.ASCII.GetString(data,8,4)!="WEBP")throw new ApiException(422,"缩略图必须为 WebP");
        if(asset.Preview!=null)return asset;
        bytes.Position=0;await Put("assets/"+id+"/_preview.webp",bytes,"image/webp",Convert.ToHexStringLower(SHA256.HashData(data)),ct);
        var preview=new AssetPreview("_preview.webp",width,height);
        using var db=database.Open();db.Ado.ExecuteCommand("UPDATE Assets SET PreviewJson=@preview WHERE Id=@id AND PreviewJson IS NULL",P("preview",JsonSerializer.Serialize(preview,ApiJson.Default.AssetPreview)),P("id",id));cache.Remove("asset:"+id);return Get(id);
    }
    public async Task CleanupImport(string taskId,CancellationToken ct)
    {
        using var db=database.Open();db.Ado.ExecuteCommand("INSERT INTO ImportJobs(Id,Cancelled) VALUES(@task,1) ON DUPLICATE KEY UPDATE Cancelled=1",P("task",taskId));var ids=db.Ado.SqlQuery<IdRow>("SELECT Id FROM Assets WHERE ImportTaskId=@task AND Id NOT IN(SELECT AssetId FROM Dependencies)",P("task",taskId));
        foreach(var row in ids) { try { await Delete(row.Id,ct); } catch(ApiException error) when(error.Status==409) { /* A concurrent save acquired ownership. */ } }
    }
    public async Task<JsonElement> ModelDefinition(AssetResponse asset,CancellationToken ct)
    {
        var bytes=await Read("assets/"+asset.Id+"/"+asset.Entry,ct);
        if(asset.Entry.EndsWith(".glb",StringComparison.OrdinalIgnoreCase)){
            if(bytes.Length<20)throw new ApiException(422,"GLB 文件头无效");
            var length=BitConverter.ToInt32(bytes,12);if(length<2||length>bytes.Length-20)throw new ApiException(422,"GLB JSON 区块无效");
            bytes=bytes.AsSpan(20,length).ToArray();
        }
        return JsonDocument.Parse(bytes).RootElement.Clone();
    }
    private static void ValidateGltf(string root, string entry, HashSet<string> files)
    {
        byte[] bytes = File.ReadAllBytes(Path.Combine(root, entry));
        if (entry.EndsWith(".glb", StringComparison.OrdinalIgnoreCase)) {
            if (bytes.Length < 20 || BitConverter.ToUInt32(bytes, 0) != 0x46546c67) throw new ApiException(422, "GLB 文件头无效");
            var length = BitConverter.ToInt32(bytes, 12); if (length < 2 || length > bytes.Length - 20) throw new ApiException(422, "GLB JSON 区块无效"); bytes = bytes.AsSpan(20, length).ToArray();
        }
        using var document = JsonDocument.Parse(bytes);
        foreach (var group in new[] { "buffers", "images" }) if (document.RootElement.TryGetProperty(group, out var items)) foreach (var item in items.EnumerateArray()) if (item.TryGetProperty("uri", out var uri)) {
            var value = uri.GetString()!; if (value.StartsWith("data:")) continue;
            if (Uri.TryCreate(value, UriKind.Absolute, out _)) throw new ApiException(422, "glTF 外部依赖必须归档为相对文件");
            var basePath = new Uri("https://studio.invalid/" + entry); var normalized = new Uri(basePath, value);
            var path = Uri.UnescapeDataString(normalized.AbsolutePath.TrimStart('/'));
            if (!ValidPath(path) || !files.Contains(path)) throw new ApiException(422, "glTF 缺失依赖: " + path);
        }
    }
    public async Task Delete(string id, CancellationToken ct)
    {
        using var db = database.Open(); db.Ado.BeginTran(); AssetRow row;
        try {
            row = db.Ado.SqlQuery<AssetRow>("SELECT * FROM Assets WHERE Id=@id FOR UPDATE", P("id", id)).SingleOrDefault() ?? throw new ApiException(404, "资源不存在");
            if (db.Ado.SqlQuery<CountRow>("SELECT COUNT(*) AS Value FROM Dependencies WHERE AssetId=@id", P("id", id))[0].Value > 0) throw new ApiException(409, "资源被草稿或历史版本引用，不能删除");
            db.Ado.ExecuteCommand("DELETE FROM Assets WHERE Id=@id", P("id", id)); db.Ado.CommitTran();
        } catch { db.Ado.RollbackTran(); throw; }
        cache.Remove("asset:" + id);
        foreach (var file in ToAsset(row).Files.Concat(ToAsset(row).Preview is {} preview ? [preview.File] : Array.Empty<string>())) await client.DeleteObjectAsync(bucket, "assets/" + id + "/" + file, ct);
    }
    public void Dispose() => client.Dispose();
}
