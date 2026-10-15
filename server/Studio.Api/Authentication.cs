using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Studio;

public sealed class Authentication
{
    private const string Header = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
    private readonly byte[] key;
    private readonly byte[] salt = RandomNumberGenerator.GetBytes(32);
    private readonly byte[] passwordHash;
    private readonly string username;
    public Authentication(IConfiguration config)
    {
        key = Encoding.UTF8.GetBytes(config["STUDIO_JWT_KEY"] ?? throw new InvalidOperationException("STUDIO_JWT_KEY is required"));
        if (key.Length < 32) throw new InvalidOperationException("JWT key must contain at least 32 bytes");
        username = config["STUDIO_ADMIN_USER"] ?? "admin";
        var password = config["STUDIO_ADMIN_PASSWORD"] ?? throw new InvalidOperationException("STUDIO_ADMIN_PASSWORD is required");
        if (password.Length < 12) throw new InvalidOperationException("Administrator password must contain at least 12 characters");
        passwordHash = Hash(password);
    }
    private byte[] Hash(string value) => Rfc2898DeriveBytes.Pbkdf2(value, salt, 100_000, HashAlgorithmName.SHA256, 32);
    private static string Encode(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static byte[] Decode(string value) => Convert.FromBase64String(value.Replace('-', '+').Replace('_', '/').PadRight((value.Length + 3) / 4 * 4, '='));
    public LoginResponse Login(LoginRequest input)
    {
        if (!CryptographicOperations.FixedTimeEquals(Hash(input.Password ?? ""), passwordHash) || input.Username != username)
            throw new ApiException(401, "用户名或密码错误");
        var exp = DateTimeOffset.UtcNow.AddHours(8).ToUnixTimeSeconds();
        var payload = Encode(JsonSerializer.SerializeToUtf8Bytes(new TokenClaims("admin", "webgl-studio", "studio-api", exp), ApiJson.Default.TokenClaims));
        var message = Header + "." + payload;
        return new(message + "." + Encode(HMACSHA256.HashData(key, Encoding.ASCII.GetBytes(message))), exp);
    }
    public bool Valid(string token)
    {
        try {
            var parts = token.Split('.');
            if (parts.Length != 3 || parts[0] != Header || token.Length > 4096) return false;
            if (!CryptographicOperations.FixedTimeEquals(Decode(parts[2]), HMACSHA256.HashData(key, Encoding.ASCII.GetBytes(parts[0] + "." + parts[1])))) return false;
            var claims = JsonSerializer.Deserialize(Decode(parts[1]), ApiJson.Default.TokenClaims);
            return claims is { Sub: "admin", Iss: "webgl-studio", Aud: "studio-api" } && claims.Exp > DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        } catch (Exception e) when (e is FormatException or JsonException) { return false; }
    }
}
