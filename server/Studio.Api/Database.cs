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
        db.Ado.ExecuteCommand("CREATE TABLE IF NOT EXISTS SchemaMigrations(Version INT PRIMARY KEY, AppliedAt VARCHAR(40) NOT NULL)");
        foreach (var path in Directory.GetFiles(Path.Combine(AppContext.BaseDirectory, "migrations"), "*.sql").Order()) {
            var version = int.Parse(Path.GetFileName(path).Split('_')[0], System.Globalization.CultureInfo.InvariantCulture);
            if (db.Ado.SqlQuery<CountRow>("SELECT COUNT(*) AS Value FROM SchemaMigrations WHERE Version=@version", P("version", version))[0].Value != 0) continue;
            foreach (var sql in File.ReadAllText(path).Split(';', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)) db.Ado.ExecuteCommand(sql);
            db.Ado.ExecuteCommand("INSERT INTO SchemaMigrations(Version,AppliedAt) VALUES(@version,@now)", P("version",version), P("now",Now()));
        }
    }
}
