using System.Text.Json;
using System.Text.Json.Serialization;
using SqlSugar;

namespace Studio;

public record LoginRequest(string Username, string Password);
public record LoginResponse(string Token, long ExpiresAt);
public record TokenClaims(string Sub, string Iss, string Aud, long Exp);
public record ProjectRequest(string Name, JsonElement Document);
public record SaveRequest(long ExpectedRevision, JsonElement Document);
public record RevisionRequest(long ExpectedRevision);
public record DraftResponse(string ProjectId, string SceneId, long Revision, JsonElement Document, string? PublishedVersionId);
public record ProjectResponse(string Id, string Name, string SceneId, long Revision, string? PublishedVersionId, string UpdatedAt);
public record AssetPreview(string File, int Width, int Height);
public record AssetResponse(string Id, string Name, string Kind, string Entry, string[] Files, string Sha256, AssetPreview? Preview = null, string? ImportTaskId = null);
public record AssetStatusResponse(AssetResponse Asset, string Status);
public record SceneVersionResponse(string VersionId,string SceneId,JsonElement Document,string CreatedAt);
public record VersionResponse(string Id, string SceneId, string CreatedAt, bool Published);
public record ManifestResponse( string VersionId, string PublishedAt, JsonElement Document, string RuntimeBuild = "1.0.0", string ExtensionCatalogHash = "");
public record PreparedScene(DraftResponse Draft,ManifestResponse Manifest,string Key,JsonElement AuthoringDocument);
public record PublishResponse(string VersionId, string PlayerUrl);
public record HealthResponse(string Status, string Platform, string Storage);
public record CountResponse(int Count);
public record ErrorResponse(string Error, string[] Details);

[SugarTable("Projects")]
public class ProjectRow { public string? PublishedProjectVersionId {get;set;} public string Id { get; set; } = ""; public string Name { get; set; } = ""; public string CreatedAt { get; set; } = ""; }
[SugarTable("Scenes")]
public class SceneRow { public string Id { get; set; } = ""; public string ProjectId { get; set; } = ""; public long Revision { get; set; } public string Document { get; set; } = ""; public string? PublishedVersionId { get; set; } public string UpdatedAt { get; set; } = ""; }
[SugarTable("Assets")]
public class AssetRow { public string? PreviewJson { get; set; } public string? ImportTaskId { get; set; } public string Id { get; set; } = ""; public string Name { get; set; } = ""; public string Kind { get; set; } = ""; public string Entry { get; set; } = ""; public string FilesJson { get; set; } = ""; public string Sha256 { get; set; } = ""; public string Status { get; set; } = ""; public string CreatedAt { get; set; } = ""; }
[SugarTable("Versions")]
public class VersionRow { public string Id { get; set; } = ""; public string SceneId { get; set; } = ""; public string Document { get; set; } = ""; public string ManifestKey { get; set; } = ""; public string CreatedAt { get; set; } = ""; public bool Published { get; set; } }
public class CountRow { public int Value { get; set; } }
public class IdRow { public string Id { get; set; } = ""; }
public class ProjectListRow { public string Id { get; set; } = ""; public string Name { get; set; } = ""; public string SceneId { get; set; } = ""; public long Revision { get; set; } public string? PublishedVersionId { get; set; } public string UpdatedAt { get; set; } = ""; }

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(ProjectPublishRequest))][JsonSerializable(typeof(ProjectManifestResponse))][JsonSerializable(typeof(ProjectPublicationRow[]))]
[JsonSerializable(typeof(SemanticPage))][JsonSerializable(typeof(SemanticMapRequest))][JsonSerializable(typeof(SemanticMapResponse))]
[JsonSerializable(typeof(OptimizationSettings))][JsonSerializable(typeof(ProcessingRequest))][JsonSerializable(typeof(ProcessingResult))][JsonSerializable(typeof(ProcessingJobRow))][JsonSerializable(typeof(ProcessingJobRow[]))]
[JsonSerializable(typeof(ArchiveSceneVersion))][JsonSerializable(typeof(ProjectArchiveInfo))]
[JsonSerializable(typeof(LibraryRequest))][JsonSerializable(typeof(LibraryResponse))][JsonSerializable(typeof(LibraryResponse[]))][JsonSerializable(typeof(LibraryReferenceRow[]))]
[JsonSerializable(typeof(LoginRequest))][JsonSerializable(typeof(LoginResponse))][JsonSerializable(typeof(TokenClaims))]
[JsonSerializable(typeof(ProjectRequest))][JsonSerializable(typeof(SaveRequest))][JsonSerializable(typeof(RevisionRequest))]
[JsonSerializable(typeof(DraftResponse))][JsonSerializable(typeof(DraftResponse[]))][JsonSerializable(typeof(ProjectResponse[]))]
[JsonSerializable(typeof(AssetResponse))][JsonSerializable(typeof(AssetResponse[]))][JsonSerializable(typeof(AssetStatusResponse[]))]
[JsonSerializable(typeof(SceneVersionResponse))]
[JsonSerializable(typeof(VersionResponse))][JsonSerializable(typeof(VersionResponse[]))]
[JsonSerializable(typeof(ManifestResponse))][JsonSerializable(typeof(PublishResponse))]
[JsonSerializable(typeof(CountResponse))][JsonSerializable(typeof(HealthResponse))][JsonSerializable(typeof(ErrorResponse))]
[JsonSerializable(typeof(AssetPreview))]
[JsonSerializable(typeof(System.Text.Json.Nodes.JsonNode))]
[JsonSerializable(typeof(JsonElement))][JsonSerializable(typeof(string[]))]
public partial class ApiJson : JsonSerializerContext { }

public sealed class ApiException(int status, string message, params string[] details) : Exception(message)
{ public int Status { get; } = status; public string[] Details { get; } = details; }
