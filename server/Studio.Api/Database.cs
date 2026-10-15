using SqlSugar;

namespace Studio;

public sealed class Database(IConfiguration configuration)
{
    public SqlSugarClient Open() => new(new ConnectionConfig {
        ConnectionString = configuration["STUDIO_MYSQL"] ?? throw new InvalidOperationException("STUDIO_MYSQL is required"),
        DbType = DbType.MySqlConnector, IsAutoCloseConnection = true, InitKeyType = InitKeyType.Attribute
    });
    public static SugarParameter P(string key, object? value) => new("@" + key, value ?? DBNull.Value);
    public static string Id() => Guid.NewGuid().ToString("N");
    public static string Now() => DateTimeOffset.UtcNow.ToString("O");
    public void Migrate()
    {
        using var db = Open();
        foreach (var path in Directory.GetFiles(Path.Combine(AppContext.BaseDirectory, "migrations"), "*.sql").Order())
            foreach (var sql in File.ReadAllText(path).Split(';', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
                db.Ado.ExecuteCommand(sql);
    }
}
