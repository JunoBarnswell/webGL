using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
namespace Studio;
/** The same unit catalog and strict numeric grammar as scene-schema/units.ts. */
public static class Units {
    public const string DecimalPattern=@"^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$";
    public record Definition(string Id,string Quantity,int[] Dimension,double Scale,double Offset);
    private static string Normalize(string text)=>Regex.Replace(text.Trim().Replace("²","2").Replace("³","3"),@"\s+","");
    private static readonly Dictionary<string,Definition> Catalog=Read();
    private static Dictionary<string,Definition> Read(){
        using var stream=typeof(Units).Assembly.GetManifestResourceStream("unit-catalog.json")!;using var document=JsonDocument.Parse(stream);var result=new Dictionary<string,Definition>(StringComparer.Ordinal);
        foreach(var value in document.RootElement.GetProperty("units").EnumerateArray()){
            var unit=new Definition(DocumentContract.Text(value,"id"),DocumentContract.Text(value,"quantity"),value.GetProperty("dimension").EnumerateArray().Select(v=>v.GetInt32()).ToArray(),value.GetProperty("scale").GetDouble(),value.GetProperty("offset").GetDouble());
            foreach(var alias in value.GetProperty("aliases").EnumerateArray().Select(v=>v.GetString()!).Prepend(unit.Id)){var key=Normalize(alias);if(result.TryGetValue(key,out var existing)&&existing.Id!=unit.Id)throw new InvalidOperationException("单位别名重复："+alias);result[key]=unit;}
        }return result;
    }
    public static Definition Get(string value)=>Catalog.TryGetValue(Normalize(value),out var unit)?unit:throw new ApiException(422,"不支持的单位："+value);
    public static bool Compatible(string from,string to){var a=Get(from);var b=Get(to);return a.Quantity==b.Quantity&&a.Dimension.SequenceEqual(b.Dimension);}
    public static double Convert(double value,string from,string to){
        if(!double.IsFinite(value))throw new ApiException(422,"单位换算只接受有限数值");var a=Get(from);var b=Get(to);if(!Compatible(from,to))throw new ApiException(422,"单位量纲不一致："+from+" → "+to);var result=(value*a.Scale+a.Offset-b.Offset)/b.Scale;if(!double.IsFinite(result))throw new ApiException(422,"单位换算超出有限数值范围");return result;
    }
    public static double Number(JsonElement raw){
        if(raw.ValueKind is not (JsonValueKind.String or JsonValueKind.Number))throw new FormatException("数值必须为十进制字符串或数字");
        return Number(raw.ValueKind==JsonValueKind.String?raw.GetString()!:raw.GetRawText());
    }
    public static double Number(string raw){var text=raw.Trim();if(!Regex.IsMatch(text,DecimalPattern,RegexOptions.CultureInvariant,TimeSpan.FromSeconds(1))||!double.TryParse(text,NumberStyles.Float,CultureInfo.InvariantCulture,out var value)||!double.IsFinite(value))throw new FormatException("非法有限十进制数值");return value;}
    public static string NumberText(double value) {
        if(!double.IsFinite(value))throw new FormatException("数值必须有限");if(value==0)return "0";
        var text=value.ToString("R",CultureInfo.InvariantCulture);var marker=text.IndexOf('E');if(marker<0)return text;
        var negative=text[0]=='-';var mantissa=text[(negative?1:0)..marker];var exponent=int.Parse(text[(marker+1)..],CultureInfo.InvariantCulture);var sign=negative?"-":"";
        if(exponent is >=-6 and <21){var digits=mantissa.Replace(".","");var point=exponent+1;return sign+(point<=0?"0."+new string('0',-point)+digits:point>=digits.Length?digits+new string('0',point-digits.Length):digits[..point]+"."+digits[point..]);}
        return sign+mantissa+"e"+(exponent>=0?"+":"")+exponent.ToString(CultureInfo.InvariantCulture);
    }
}
