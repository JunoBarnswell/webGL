using System.Globalization;
using System.Text.Json;
namespace Studio;

/// <summary>Publication validation of the same rule IR semantics used by the shared Player runtime.</summary>
public static class ConfigurationRules
{
    private sealed record Group(string Id,string Name,string Control,int Minimum,int Maximum,string[] Defaults,JsonElement[] Options,double Low,double High,double Step,double Default);
    private sealed record Rule(string Id,string Type,string FromGroup,string FromOption,string ToGroup,string ToOption,double Minimum,double Maximum,double Priority,string Reason,JsonElement[] Conditions,string Join);
    private sealed record Edge(string From,string To,double Priority,string RuleId);
    private sealed record Reach(double Priority,string[] Path);
    private sealed record Vote(bool Selected,double Priority,string[] Rules);
    private static string T(JsonElement data,string field)=>DocumentContract.Text(data,field);
    private static double N(JsonElement data,string field,double fallback=0)=>data.TryGetProperty(field,out var value)&&value.ValueKind==JsonValueKind.Number?value.GetDouble():fallback;
    private static JsonElement[] A(JsonElement data,string field)=>data.TryGetProperty(field,out var array)&&array.ValueKind==JsonValueKind.Array?array.EnumerateArray().ToArray():[];
    private static string K(string group,string option,bool selected=true)=>group.Length+":"+group+option.Length+":"+option+(selected?"+":"-");
    private static string Opposite(string key)=>key[..^1]+(key[^1]=='+'?"-":"+");
    private static bool Same(Dictionary<string,List<string>> a,Dictionary<string,List<string>> b,Dictionary<string,double> x,Dictionary<string,double> y)=>a.Count==b.Count&&a.All(p=>b.TryGetValue(p.Key,out var values)&&p.Value.SequenceEqual(values))&&x.Count==y.Count&&x.All(p=>y.TryGetValue(p.Key,out var value)&&value==p.Value);
    private static bool Active(Rule rule,Dictionary<string,List<string>> selections,Dictionary<string,double> numbers) {
        if(rule.FromGroup!=""&&(!selections.TryGetValue(rule.FromGroup,out var source)||!source.Contains(rule.FromOption)))return false;
        bool Match(JsonElement condition) {
            var id=T(condition,"groupId");var option=T(condition,"optionId");var op=T(condition,"operator");
            if(op is "selected" or "notSelected"){var selected=selections.TryGetValue(id,out var values)&&values.Contains(option);return op=="selected"?selected:!selected;}
            if(!numbers.TryGetValue(id,out var number))return false;var expected=N(condition,"value");return op=="gte"?number>=expected:op=="lte"?number<=expected:number==expected;
        }
        return rule.Conditions.Length==0||(rule.Join=="any"?rule.Conditions.Any(Match):rule.Conditions.All(Match));
    }
    public static string[] Validate(JsonElement data) {
        var errors=new List<string>();
        var groups=A(data,"groups").Select(g=>new Group(T(g,"id"),T(g,"name"),T(g,"control"),(int)N(g,"min"),(int)N(g,"max",1),A(g,"defaultIds").Select(v=>v.GetString()!).Distinct().ToArray(),A(g,"options"),N(g,"numericMinimum"),N(g,"numericMaximum",1),N(g,"numericStep",.01),N(g,"numericDefault",N(g,"numericMinimum")))).ToArray();
        var rules=A(data,"rules").Select(r=>new Rule(T(r,"id"),T(r,"type"),T(r.GetProperty("when"),"groupId"),T(r.GetProperty("when"),"optionId"),T(r.GetProperty("then"),"groupId"),T(r.GetProperty("then"),"optionId"),N(r,"minimum"),N(r,"maximum"),N(r,"priority"),T(r,"reason"),A(r,"conditions"),T(r,"conditionJoin"))).OrderByDescending(r=>r.Priority).ThenBy(r=>r.Id,StringComparer.Ordinal).ToArray();
        if(groups.Select(g=>g.Id).Distinct().Count()!=groups.Length)errors.Add("属性组 ID 重复");
        if(rules.Select(r=>r.Id).Distinct().Count()!=rules.Length)errors.Add("规则 ID 重复");
        if(errors.Count>0)return errors.ToArray();
        var byId=groups.ToDictionary(g=>g.Id);
        foreach(var group in groups) {
            if(group.Options.Select(o=>T(o,"id")).Distinct().Count()!=group.Options.Length)errors.Add("选项 ID 重复："+group.Name);
            if(group.Minimum>group.Maximum||group.Minimum<0||group.Maximum<1)errors.Add("选项数量范围无效："+group.Name);
            if(group.Defaults.Any(id=>!group.Options.Any(o=>T(o,"id")==id)))errors.Add("默认选项不存在");
            if(group.Control=="number"&&(!double.IsFinite(group.Low)||!double.IsFinite(group.High)||group.Low>group.High||!double.IsFinite(group.Step)||group.Step<=0))errors.Add("数值范围或步长无效："+group.Name);
        }
        foreach(var rule in rules) {
            if(!byId.TryGetValue(rule.ToGroup,out var target)||(!(rule.Type is "count" or "range")&&!target.Options.Any(o=>T(o,"id")==rule.ToOption))||(rule.FromGroup!=""&&(!byId.TryGetValue(rule.FromGroup,out var source)||!source.Options.Any(o=>T(o,"id")==rule.FromOption))))errors.Add("规则引用选项不存在："+rule.Id);
            if(!double.IsFinite(rule.Priority)||!new[]{"require","implies","exclude","default","count","range","bundle"}.Contains(rule.Type))errors.Add("规则类型或优先级无效："+rule.Id);
            if((rule.Type is "count" or "range")&&(!double.IsFinite(rule.Minimum)||!double.IsFinite(rule.Maximum)||rule.Minimum>rule.Maximum))errors.Add("规则范围无效："+rule.Id);
            foreach(var condition in rule.Conditions)if(!byId.TryGetValue(T(condition,"groupId"),out var group)||(T(condition,"operator") is "selected" or "notSelected"?!group.Options.Any(o=>T(o,"id")==T(condition,"optionId")):group.Control!="number"||!double.IsFinite(N(condition,"value"))))errors.Add("条件字段或类型无效："+rule.Id);
        }
        if(errors.Count>0)return errors.Distinct().ToArray();
        var edges=new List<Edge>();
        foreach(var group in groups.Where(g=>g.Control!="number"&&g.Maximum==1))foreach(var option in group.Options)foreach(var other in group.Options)if(T(option,"id")!=T(other,"id"))edges.Add(new(K(group.Id,T(option,"id")),K(group.Id,T(other,"id"),false),double.MaxValue,"@cardinality:"+group.Id));
        foreach(var rule in rules.Where(r=>r.FromGroup!=""&&r.Conditions.Length==0&&(r.Type is "require" or "implies" or "bundle" or "exclude")))edges.Add(new(K(rule.FromGroup,rule.FromOption),K(rule.ToGroup,rule.ToOption,rule.Type!="exclude"),rule.Priority,rule.Id));
        var adjacency=edges.GroupBy(e=>e.From).ToDictionary(g=>g.Key,g=>g.ToArray());
        foreach(var group in groups.Where(g=>g.Control!="number"))foreach(var option in group.Options) {
            var seed=K(group.Id,T(option,"id"));var reached=new Dictionary<string,Reach>{{seed,new(double.PositiveInfinity,[])}};var queue=new List<string>{seed};var failed=false;
            for(var cursor=0;cursor<queue.Count&&!failed;cursor++) {
                var key=queue[cursor];if(!reached.TryGetValue(key,out var state)||!adjacency.TryGetValue(key,out var outgoing))continue;
                foreach(var edge in outgoing) {
                    var priority=Math.Min(state.Priority,edge.Priority);var opposite=Opposite(edge.To);
                    if(reached.TryGetValue(opposite,out var opposing)&&opposing.Priority!=priority&&double.IsFinite(opposing.Priority)&&double.IsFinite(priority)){if(opposing.Priority>priority)continue;reached.Remove(opposite);}
                    if(!reached.TryGetValue(edge.To,out var previous)||previous.Priority<priority){reached[edge.To]=new(priority,[..state.Path,edge.RuleId]);queue.Add(edge.To);}
                    if(reached.TryGetValue(opposite,out var conflict)) {errors.Add("不可达选项 "+group.Id+" / "+T(option,"id")+"："+string.Join(" → ",state.Path.Append(edge.RuleId).Concat(conflict.Path).Where(id=>!id.StartsWith('@')).Distinct()));failed=true;break;}
                }
            }
        }
        var original=groups.ToDictionary(g=>g.Id,g=>g.Defaults.ToList());var baseNumbers=groups.Where(g=>g.Control=="number").ToDictionary(g=>g.Id,g=>g.Default);
        foreach(var group in groups.Where(g=>g.Control=="number"))if(!double.IsFinite(group.Default)||group.Default<group.Low||group.Default>group.High)errors.Add("数值越界："+group.Name);
        var selections=original.ToDictionary(p=>p.Key,p=>p.Value.ToList());var numbers=new Dictionary<string,double>(baseNumbers);var seen=new HashSet<string>();var converged=false;
        for(var pass=0;pass<Math.Min(1024,Math.Max(32,rules.Length*4+groups.Length*2));pass++) {
            var signature=string.Join('|',groups.Select(g=>K(g.Id,string.Join(',',selections[g.Id]))))+"/"+string.Join('|',numbers.Select(p=>p.Key+":"+p.Value.ToString("R",CultureInfo.InvariantCulture)));
            if(!seen.Add(signature)){errors.Add("规则条件形成无法收敛的冲突路径");break;}
            var active=rules.Where(r=>Active(r,selections,numbers)).ToArray();var votes=new Dictionary<string,Vote>();var shadowed=new HashSet<string>();
            foreach(var group in groups)foreach(var option in group.Options)votes[K(group.Id,T(option,"id"))]=new(original[group.Id].Contains(T(option,"id")),double.NegativeInfinity,[]);
            void Cast(string groupId,string optionId,bool selected,Rule rule) {
                var key=K(groupId,optionId);if(!votes.TryGetValue(key,out var prior))return;
                if(prior.Priority>rule.Priority){shadowed.Add(rule.Id);return;}
                if(prior.Priority==rule.Priority&&prior.Selected!=selected){errors.Add("同优先级规则互相矛盾："+string.Join(" → ",prior.Rules.Append(rule.Id)));return;}
                votes[key]=new(selected,rule.Priority,[rule.Id]);
                if(selected&&byId[groupId].Maximum==1)foreach(var option in byId[groupId].Options)if(T(option,"id")!=optionId) {
                    var other=votes[K(groupId,T(option,"id"))];
                    if(other.Selected&&other.Priority==rule.Priority){errors.Add("单选组的同优先级规则要求不同选项："+string.Join(" → ",other.Rules.Append(rule.Id)));continue;}
                    if(other.Priority<=rule.Priority)votes[K(groupId,T(option,"id"))]=new(false,rule.Priority,[rule.Id]);
                }
            }
            foreach(var rule in active) {
                var group=byId[rule.ToGroup];
                if(rule.Type is "require" or "implies" or "bundle")Cast(group.Id,rule.ToOption,true,rule);
                else if(rule.Type=="exclude")Cast(group.Id,rule.ToOption,false,rule);
                else if(rule.Type=="range"&&group.Control!="number")foreach(var option in group.Options)if(!double.TryParse(T(option,"name"),NumberStyles.Float,CultureInfo.InvariantCulture,out var value)||!double.IsFinite(value)||value<rule.Minimum||value>rule.Maximum)Cast(group.Id,T(option,"id"),false,rule);
            }
            foreach(var rule in active.Where(r=>r.Type=="default")) {var group=byId[rule.ToGroup];if(original[group.Id].Count==0&&!group.Options.Any(o=>votes[K(group.Id,T(o,"id"))].Selected)&&votes[K(group.Id,rule.ToOption)].Priority==double.NegativeInfinity)Cast(group.Id,rule.ToOption,true,rule);}
            var next=new Dictionary<string,List<string>>();var nextNumbers=new Dictionary<string,double>(baseNumbers);
            foreach(var group in groups) {
                if(group.Control=="number") {
                    var low=group.Low;var high=group.High;
                    foreach(var rule in active.Where(r=>r.ToGroup==group.Id&&r.Type=="range")){var min=Math.Max(low,rule.Minimum);var max=Math.Min(high,rule.Maximum);if(min>max){errors.Add(rule.Reason==""?"数值约束没有交集":rule.Reason);continue;}low=min;high=max;}
                    var minIndex=Math.Ceiling((low-group.Low)/group.Step-1e-9);var maxIndex=Math.Floor((high-group.Low)/group.Step+1e-9);
                    if(minIndex>maxIndex){errors.Add("范围内没有符合步长的数值："+group.Name);next[group.Id]=[];continue;}
                    var index=Math.Floor((baseNumbers[group.Id]-group.Low)/group.Step+.5);var value=group.Low+Math.Max(minIndex,Math.Min(maxIndex,index))*group.Step;
                    nextNumbers[group.Id]=double.Parse(value.ToString("G14",CultureInfo.InvariantCulture),CultureInfo.InvariantCulture);next[group.Id]=[];
                } else {
                    var selected=group.Options.Where(o=>votes[K(group.Id,T(o,"id"))].Selected).OrderByDescending(o=>votes[K(group.Id,T(o,"id"))].Priority).Select(o=>T(o,"id")).Take(group.Maximum).ToList();
                    foreach(var rule in active.Where(r=>r.ToGroup==group.Id&&r.Type=="count")) {if(selected.Count>rule.Maximum)selected=selected.Take((int)rule.Maximum).ToList();foreach(var option in group.Options)if(selected.Count<rule.Minimum&&!selected.Contains(T(option,"id"))&&!(!votes[K(group.Id,T(option,"id"))].Selected&&votes[K(group.Id,T(option,"id"))].Priority>=rule.Priority))selected.Add(T(option,"id"));}
                    next[group.Id]=selected;
                }
            }
            if(Same(next,selections,nextNumbers,numbers)){selections=next;numbers=nextNumbers;converged=true;break;}selections=next;numbers=nextNumbers;
        }
        if(!converged&&errors.Count==0)errors.Add("配置求解超过确定性迭代预算");
        foreach(var group in groups.Where(g=>g.Control!="number"))if(selections[group.Id].Count<group.Minimum||selections[group.Id].Count>group.Maximum)errors.Add(group.Name+" 选项数量不满足要求");
        return errors.Distinct().ToArray();
    }
}
