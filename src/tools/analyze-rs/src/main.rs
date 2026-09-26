use std::collections::{BTreeMap, HashMap, HashSet};
use std::env;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::process::exit;

fn map_grade(g: f64) -> f64 {
    if !g.is_finite() || g <= 0.0 {
        0.0
    } else if g <= 2.0 {
        2.0
    } else if g <= 4.0 {
        4.0
    } else if g <= 6.0 {
        6.0
    } else if g <= 8.0 {
        8.0
    } else {
        10.0
    }
}

fn find_key(s: &str, key: &str) -> Option<usize> {
    let pat = format!("\"{}\":", key);
    s.find(&pat).map(|i| i + pat.len())
}

fn parse_f64_after(s: &str, key: &str) -> Option<f64> {
    let i = find_key(s, key)?;
    let rest = s[i..].trim_start();
    let end = rest
        .find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-' || c == 'e' || c == 'E' || c == '+'))
        .unwrap_or(rest.len().min(32));
    rest[..end].parse::<f64>().ok()
}

fn parse_str_field<'a>(s: &'a str, key: &str) -> Option<&'a str> {
    let i = find_key(s, key)?;
    let rest = s[i..].trim_start();
    if !rest.starts_with('"') {
        return None;
    }
    let body = &rest[1..];
    let end = body.find('"')?;
    Some(&body[..end])
}

fn parse_time_prefix<'a>(s: &'a str, key: &str) -> Option<&'a str> {
    let i = find_key(s, key)?;
    let rest = s[i..].trim_start();
    if !rest.starts_with('"') {
        return None;
    }
    Some(&rest[1..])
}

fn period_key(publish: &str, grain: &str) -> Option<String> {
    if grain == "day" {
        if publish.len() < 10 {
            return None;
        }
        Some(publish[..10].to_string())
    } else if publish.len() >= 7 {
        Some(publish[..7].to_string())
    } else {
        None
    }
}

fn in_range(pk: &str, from: &str, to: &str) -> bool {
    if !from.is_empty() && pk < from {
        return false;
    }
    if !to.is_empty() && pk > to {
        return false;
    }
    true
}

#[derive(Default, Clone)]
struct Acc {
    n: u64,
    sum: f64,
    zero: u64,
    stars: [u64; 5],
}

fn acc_add(a: &mut Acc, gm: f64) {
    a.n += 1;
    a.sum += gm;
    if gm == 0.0 {
        a.zero += 1;
    } else {
        let star = ((gm / 2.0).round() as i32).clamp(1, 5) as usize;
        a.stars[star - 1] += 1;
    }
}

fn acc_json(a: &Acc) -> String {
    format!(
        "{{\"n\":{},\"sum\":{},\"zero\":{},\"stars\":[{},{},{},{},{}]}}",
        a.n, a.sum, a.zero, a.stars[0], a.stars[1], a.stars[2], a.stars[3], a.stars[4]
    )
}

fn read_lines(path: &str) -> Vec<String> {
    let f = match File::open(path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("open failed: {e}");
            exit(1);
        }
    };
    BufReader::with_capacity(1 << 22, f)
        .lines()
        .map_while(Result::ok)
        .collect()
}

fn cmd_series(path: &str, grain: &str, from: &str, to: &str) {
    let mut by: BTreeMap<String, Acc> = BTreeMap::new();
    for line in read_lines(path) {
        if line.len() < 20 {
            continue;
        }
        let publish = match parse_time_prefix(&line, "publish_time") {
            Some(p) => p,
            None => continue,
        };
        let pk = match period_key(publish, grain) {
            Some(k) => k,
            None => continue,
        };
        if !in_range(&pk, from, to) {
            continue;
        }
        let grade = parse_f64_after(&line, "grade").unwrap_or(0.0);
        acc_add(by.entry(pk).or_default(), map_grade(grade));
    }
    let mut out = String::from("{\"rows\":[");
    let mut first = true;
    for (period, a) in by {
        if !first {
            out.push(',');
        }
        first = false;
        out.push_str(&format!(
            "{{\"period\":\"{}\",{}}}",
            period,
            acc_json(&a).trim_start_matches('{').trim_end_matches('}')
        ));
    }
    out.push_str("]}");
    println!("{out}");
}

fn play_bucket(days: f64) -> &'static str {
    if !days.is_finite() || days <= 0.0 {
        "0"
    } else if days <= 30.0 {
        "1-30"
    } else if days <= 365.0 {
        "31-365"
    } else {
        "366+"
    }
}

fn cmd_factors(path: &str, grain: &str, from: &str, to: &str) {
    // period -> bucket -> Acc ; overall bucket -> Acc
    let mut by: BTreeMap<String, BTreeMap<String, Acc>> = BTreeMap::new();
    let mut overall: BTreeMap<String, Acc> = BTreeMap::new();
    for line in read_lines(path) {
        if line.len() < 20 {
            continue;
        }
        let publish = match parse_time_prefix(&line, "publish_time") {
            Some(p) => p,
            None => continue,
        };
        let pk = match period_key(publish, grain) {
            Some(k) => k,
            None => continue,
        };
        if !in_range(&pk, from, to) {
            continue;
        }
        let grade = parse_f64_after(&line, "grade").unwrap_or(0.0);
        let pd = parse_f64_after(&line, "play_duration").unwrap_or(0.0);
        let b = play_bucket(pd).to_string();
        let gm = map_grade(grade);
        acc_add(overall.entry(b.clone()).or_default(), gm);
        acc_add(by.entry(pk).or_default().entry(b).or_default(), gm);
    }
    let buckets = ["0", "1-30", "31-365", "366+"];
    let mut out = String::from("{\"series\":[");
    let mut first = true;
    for (period, m) in by {
        if !first {
            out.push(',');
        }
        first = false;
        // 周期总 n：供前端按数据量加权平均
        let period_n: u64 = buckets.iter().map(|bk| m.get(*bk).map(|a| a.n).unwrap_or(0)).sum();
        out.push_str(&format!(
            "{{\"period\":\"{}\",\"n\":{},\"buckets\":[",
            period, period_n
        ));
        for (i, bk) in buckets.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            let a = m.get(*bk).cloned().unwrap_or_default();
            out.push_str(&format!(
                "{{\"bucket\":\"{}\",{}}}",
                bk,
                acc_json(&a).trim_start_matches('{').trim_end_matches('}')
            ));
        }
        out.push_str("]}");
    }
    out.push_str("],\"overall\":[");
    for (i, bk) in buckets.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        let a = overall.get(*bk).cloned().unwrap_or_default();
        out.push_str(&format!(
            "{{\"bucket\":\"{}\",{}}}",
            bk,
            acc_json(&a).trim_start_matches('{').trim_end_matches('}')
        ));
    }
    out.push_str("]}");
    println!("{out}");
}

const STOP: &[&str] = &[
    "的","了","是","在","我","有","和","就","不","人","都","一","一个","上","也","很","到","说","要","去","会","着","没有","看","好","自己","这","那","什么","可以","还是","就是","没","吧","啊","呢","吗","呀","哦","嗯","哈","嘛","啦",
    "被","把","从","对","为","而","或","与","及","等","更","最","只","还","又","再","能","得","地","个","们","么","之","其","该","这个","那个","怎么","怎样","因为","所以","但是","而且","如果","虽然","然后","并且","或者",
    "真的","觉得","感觉","现在","时候","一下","一些","这种","那种","这么","那么","这样","那样","不是","不了","一样","一直","已经","还有","比较","非常","有点","多少","几个",
    "谢谢","哈哈","嘿嘿","呜呜","x_x","www","http","https","com","cn",
];

fn bump(freq: &mut HashMap<String, u32>, w: &str) {
    if w.chars().count() < 2 {
        return;
    }
    if STOP.contains(&w) {
        return;
    }
    if w.chars().all(|c| c.is_ascii_digit()) {
        return;
    }
    let mut chars = w.chars();
    if let (Some(c0), Some(_)) = (chars.next(), chars.next()) {
        if w.chars().all(|c| c == c0) {
            return;
        }
    }
    if w.chars().all(|c| "啊哈嘿哦嗯呀嘛啦哇唉咦呃呵嘻唔呦嗷".contains(c)) {
        return;
    }
    *freq.entry(w.to_string()).or_insert(0) += 1;
}

fn add_text(freq: &mut HashMap<String, u32>, text: &str) {
    // ASCII word | digits | CJK run
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < text.len() {
        let c = text[i..].chars().next().unwrap();
        let clen = c.len_utf8();
        if c.is_ascii_alphabetic() {
            let start = i;
            while i < text.len() {
                let ch = text[i..].chars().next().unwrap();
                if ch.is_ascii_alphanumeric() || ch == '_' {
                    i += ch.len_utf8();
                } else {
                    break;
                }
            }
            bump(freq, &text[start..i].to_lowercase());
        } else if c.is_ascii_digit() {
            while i < text.len() {
                let ch = text[i..].chars().next().unwrap();
                if ch.is_ascii_digit() {
                    i += ch.len_utf8();
                } else {
                    break;
                }
            }
        } else if ('\u{4e00}'..='\u{9fa5}').contains(&c) {
            let start = i;
            while i < text.len() {
                let ch = text[i..].chars().next().unwrap();
                if ('\u{4e00}'..='\u{9fa5}').contains(&ch) {
                    i += ch.len_utf8();
                } else {
                    break;
                }
            }
            let run = &text[start..i];
            let chars: Vec<char> = run.chars().collect();
            let n = chars.len();
            if (2..=4).contains(&n) {
                bump(freq, run);
            }
            if n >= 3 {
                for k in 0..n.saturating_sub(1) {
                    let s: String = chars[k..k + 2].iter().collect();
                    bump(freq, &s);
                }
            }
        } else {
            i += clen;
        }
    }
    let _ = bytes;
}

fn cmd_wordfreq(path: &str, source: &str, limit: usize) {
    let use_user = source == "both" || source == "user";
    let use_comment = source == "both" || source == "comment";
    let mut freq: HashMap<String, u32> = HashMap::new();
    let mut scanned = 0u64;
    for line in read_lines(path) {
        scanned += 1;
        if line.len() < 10 {
            continue;
        }
        if use_user {
            if let Some(u) = parse_str_field(&line, "user_name") {
                add_text(&mut freq, u);
            }
        }
        if use_comment {
            if let Some(c) = parse_str_field(&line, "content") {
                add_text(&mut freq, c);
            }
        }
    }
    let mut list: Vec<(&String, &u32)> = freq.iter().collect();
    list.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
    list.truncate(limit);
    let types = freq.len();
    let mut out = format!(
        "{{\"source\":\"{}\",\"types\":{},\"scanned\":{},\"words\":[",
        source, types, scanned
    );
    for (i, (w, c)) in list.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&format!("{{\"word\":\"{}\",\"count\":{}}}", w, c));
    }
    out.push_str("]}");
    println!("{out}");
}

fn erfc(x: f64) -> f64 {
    // Abramowitz-Stegun 7.1.26
    let z = x.abs();
    let t = 1.0 / (1.0 + z / 2.0);
    let r = t
        * (-z * z - 1.26551223
            + t * (1.00002368
                + t * (0.37409196
                    + t * (0.09678418
                        + t * (-0.18628806
                            + t * (0.27886807
                                + t * (-1.13520398
                                    + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))))
        .exp();
    if x >= 0.0 {
        r
    } else {
        2.0 - r
    }
}

fn chi2_ind(a: f64, b: f64, c: f64, d: f64) -> (Option<f64>, Option<f64>, Option<f64>, Option<bool>) {
    let n = a + b + c + d;
    if n <= 0.0 {
        return (None, None, None, None);
    }
    let r1 = a + b;
    let r2 = c + d;
    let c1 = a + c;
    let c2 = b + d;
    if r1 == 0.0 || r2 == 0.0 || c1 == 0.0 || c2 == 0.0 {
        return (None, None, None, None);
    }
    let num = n * (a * d - b * c) * (a * d - b * c);
    let den = r1 * r2 * c1 * c2;
    let chi2 = num / den;
    let p = erfc((chi2 / 2.0).sqrt());
    let phi = (a * d - b * c) / den.sqrt();
    (Some(chi2), Some(p), Some(phi), Some(p < 0.05))
}

fn cmd_crossdist(path_a: &str, path_b: &str, grain: &str, from: &str, to: &str) {
    // source file A -> target file B
    let mut src: HashMap<String, (f64, u32)> = HashMap::new();
    for line in read_lines(path_a) {
        if line.len() < 10 {
            continue;
        }
        let uid = match parse_str_field(&line, "uid").map(|s| s.to_string()).or_else(|| {
            parse_f64_after(&line, "uid").map(|f| f.to_string())
        }) {
            Some(u) => u,
            None => continue,
        };
        let grade = parse_f64_after(&line, "grade").unwrap_or(0.0);
        let e = src.entry(uid).or_insert((0.0, 0));
        e.0 += map_grade(grade);
        e.1 += 1;
    }
    let src_pos: HashSet<String> = src
        .iter()
        .filter(|(_, (s, n))| *n > 0 && *s / (*n as f64) >= 8.0)
        .map(|(k, _)| k.clone())
        .collect();

    // period -> (n, pp, pn, np, nn)
    let mut cells: BTreeMap<String, [u64; 5]> = BTreeMap::new();
    for line in read_lines(path_b) {
        if line.len() < 10 {
            continue;
        }
        let publish = match parse_time_prefix(&line, "publish_time") {
            Some(p) => p,
            None => continue,
        };
        let pk = match period_key(publish, grain) {
            Some(k) => k,
            None => continue,
        };
        if !in_range(&pk, from, to) {
            continue;
        }
        let uid = match parse_str_field(&line, "uid").map(|s| s.to_string()).or_else(|| {
            parse_f64_after(&line, "uid").map(|f| f.to_string())
        }) {
            Some(u) => u,
            None => continue,
        };
        if !src.contains_key(&uid) {
            continue;
        }
        let sh = src_pos.contains(&uid);
        let th = map_grade(parse_f64_after(&line, "grade").unwrap_or(0.0)) >= 8.0;
        let e = cells.entry(pk).or_insert([0; 5]);
        e[0] += 1;
        if sh && th {
            e[1] += 1;
        } else if sh && !th {
            e[2] += 1;
        } else if !sh && th {
            e[3] += 1;
        } else {
            e[4] += 1;
        }
    }

    let mut ov = [0u64; 5];
    let mut periods = String::new();
    let mut first = true;
    for (period, b) in &cells {
        for i in 0..5 {
            ov[i] += b[i];
        }
        let n = b[0] as f64;
        let z = if n > 0.0 { n } else { 1.0 };
        let (chi2, p, phi, related) = chi2_ind(b[1] as f64, b[2] as f64, b[3] as f64, b[4] as f64);
        if !first {
            periods.push(',');
        }
        first = false;
        periods.push_str(&format!(
            "{{\"period\":\"{}\",\"n\":{},\"pp\":{:.4},\"pn\":{:.4},\"np\":{:.4},\"nn\":{:.4},\"chi2\":{},\"p\":{},\"phi\":{},\"related\":{}}}",
            period,
            b[0],
            b[1] as f64 / z,
            b[2] as f64 / z,
            b[3] as f64 / z,
            b[4] as f64 / z,
            chi2.map(|x| format!("{:.4}", x)).unwrap_or("null".into()),
            p.map(|x| format!("{:.6}", x)).unwrap_or("null".into()),
            phi.map(|x| format!("{:.4}", x)).unwrap_or("null".into()),
            related.map(|x| x.to_string()).unwrap_or("null".into())
        ));
    }
    let n = ov[0] as f64;
    let z = if n > 0.0 { n } else { 1.0 };
    let (chi2, p, phi, related) = chi2_ind(ov[1] as f64, ov[2] as f64, ov[3] as f64, ov[4] as f64);
    println!(
        "{{\"direction\":\"A→B\",\"overview\":{{\"n\":{},\"pp\":{:.4},\"pn\":{:.4},\"np\":{:.4},\"nn\":{:.4},\"chi2\":{},\"p\":{},\"phi\":{},\"related\":{}}},\"periods\":[{}]}}",
        ov[0],
        ov[1] as f64 / z,
        ov[2] as f64 / z,
        ov[3] as f64 / z,
        ov[4] as f64 / z,
        chi2.map(|x| format!("{:.4}", x)).unwrap_or("null".into()),
        p.map(|x| format!("{:.6}", x)).unwrap_or("null".into()),
        phi.map(|x| format!("{:.4}", x)).unwrap_or("null".into()),
        related.map(|x| x.to_string()).unwrap_or("null".into()),
        periods
    );
}

fn cmd_keywords(path: &str, name: &str, aliases_csv: &str, grain: &str, from: &str, to: &str) {
    let aliases: Vec<String> = aliases_csv
        .split('|')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let mut by: BTreeMap<String, (Acc, Acc, Acc)> = BTreeMap::new(); // all, hit, miss
    for line in read_lines(path) {
        if line.len() < 10 {
            continue;
        }
        let publish = match parse_time_prefix(&line, "publish_time") {
            Some(p) => p,
            None => continue,
        };
        let pk = match period_key(publish, grain) {
            Some(k) => k,
            None => continue,
        };
        if !in_range(&pk, from, to) {
            continue;
        }
        let grade = map_grade(parse_f64_after(&line, "grade").unwrap_or(0.0));
        let text = parse_str_field(&line, "content").unwrap_or("");
        let hit = aliases.iter().any(|a| text.contains(a.as_str()));
        let e = by.entry(pk).or_default();
        acc_add(&mut e.0, grade);
        if hit {
            acc_add(&mut e.1, grade);
        } else {
            acc_add(&mut e.2, grade);
        }
    }
    let mut periods = String::new();
    let mut first = true;
    // 全量按样本数加权（不是周期均分的简单平均）
    let mut ov_all = Acc::default();
    let mut ov_hit = Acc::default();
    let mut ov_miss = Acc::default();
    for (period, (all, hit, miss)) in &by {
        ov_all.n += all.n;
        ov_all.sum += all.sum;
        ov_all.zero += all.zero;
        ov_hit.n += hit.n;
        ov_hit.sum += hit.sum;
        ov_hit.zero += hit.zero;
        ov_miss.n += miss.n;
        ov_miss.sum += miss.sum;
        ov_miss.zero += miss.zero;
        let hit_rate = if all.n > 0 {
            hit.n as f64 / all.n as f64
        } else {
            0.0
        };
        let hit_avg = if hit.n > 0 {
            Some(hit.sum / hit.n as f64)
        } else {
            None
        };
        let miss_avg = if miss.n > 0 {
            Some(miss.sum / miss.n as f64)
        } else {
            None
        };
        let all_avg = if all.n > 0 {
            Some(all.sum / all.n as f64)
        } else {
            None
        };
        // Δ 口径：命中均分 − 全部均分（不是命中−未命中）
        let delta = match (hit_avg, all_avg) {
            (Some(h), Some(a)) => Some(h - a),
            _ => None,
        };
        if !first {
            periods.push(',');
        }
        first = false;
        periods.push_str(&format!(
            "{{\"period\":\"{}\",\"n\":{},\"avg\":{},\"keywords\":{{\"{}\":{{\"hit_n\":{},\"hit_avg\":{},\"miss_n\":{},\"miss_avg\":{},\"hit_rate\":{:.4},\"delta_hit\":{}}}}}}}",
            period,
            all.n,
            all_avg.map(|x| format!("{:.4}", x)).unwrap_or("null".into()),
            name,
            hit.n,
            hit_avg.map(|x| format!("{:.4}", x)).unwrap_or("null".into()),
            miss.n,
            miss_avg.map(|x| format!("{:.4}", x)).unwrap_or("null".into()),
            hit_rate,
            delta.map(|x| format!("{:.4}", x)).unwrap_or("null".into())
        ));
    }
    let ov_avg = if ov_all.n > 0 {
        Some(ov_all.sum / ov_all.n as f64)
    } else {
        None
    };
    let ov_hit_avg = if ov_hit.n > 0 {
        Some(ov_hit.sum / ov_hit.n as f64)
    } else {
        None
    };
    let ov_miss_avg = if ov_miss.n > 0 {
        Some(ov_miss.sum / ov_miss.n as f64)
    } else {
        None
    };
    let ov_hit_rate = if ov_all.n > 0 {
        ov_hit.n as f64 / ov_all.n as f64
    } else {
        0.0
    };
    let ov_delta = match (ov_hit_avg, ov_avg) {
        (Some(h), Some(a)) => Some(h - a),
        _ => None,
    };
    let fmt_opt = |x: Option<f64>| x.map(|v| format!("{:.4}", v)).unwrap_or("null".into());
    println!(
        "{{\"names\":[\"{}\"],\"overview\":{{\"n\":{},\"hit_n\":{},\"miss_n\":{},\"avg\":{},\"hit_avg\":{},\"miss_avg\":{},\"hit_rate\":{:.4},\"delta_hit\":{}}},\"periods\":[{}]}}",
        name,
        ov_all.n,
        ov_hit.n,
        ov_miss.n,
        fmt_opt(ov_avg),
        fmt_opt(ov_hit_avg),
        fmt_opt(ov_miss_avg),
        ov_hit_rate,
        fmt_opt(ov_delta),
        periods
    );
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: analyze_rs series|wordfreq|factors|keywords|crossdist ...");
        exit(2);
    }
    match args[1].as_str() {
        "series" => {
            cmd_series(
                args.get(2).map(|s| s.as_str()).unwrap_or(""),
                args.get(3).map(|s| s.as_str()).unwrap_or("month"),
                args.get(4).map(|s| s.as_str()).unwrap_or(""),
                args.get(5).map(|s| s.as_str()).unwrap_or(""),
            );
        }
        "wordfreq" => {
            cmd_wordfreq(
                args.get(2).map(|s| s.as_str()).unwrap_or(""),
                args.get(3).map(|s| s.as_str()).unwrap_or("both"),
                args.get(4).and_then(|s| s.parse().ok()).unwrap_or(300),
            );
        }
        "factors" => {
            cmd_factors(
                args.get(2).map(|s| s.as_str()).unwrap_or(""),
                args.get(3).map(|s| s.as_str()).unwrap_or("month"),
                args.get(4).map(|s| s.as_str()).unwrap_or(""),
                args.get(5).map(|s| s.as_str()).unwrap_or(""),
            );
        }
        "keywords" => {
            cmd_keywords(
                args.get(2).map(|s| s.as_str()).unwrap_or(""),
                args.get(3).map(|s| s.as_str()).unwrap_or(""),
                args.get(4).map(|s| s.as_str()).unwrap_or(""),
                args.get(5).map(|s| s.as_str()).unwrap_or("month"),
                args.get(6).map(|s| s.as_str()).unwrap_or(""),
                args.get(7).map(|s| s.as_str()).unwrap_or(""),
            );
        }
        "crossdist" => {
            cmd_crossdist(
                args.get(2).map(|s| s.as_str()).unwrap_or(""),
                args.get(3).map(|s| s.as_str()).unwrap_or(""),
                args.get(4).map(|s| s.as_str()).unwrap_or("month"),
                args.get(5).map(|s| s.as_str()).unwrap_or(""),
                args.get(6).map(|s| s.as_str()).unwrap_or(""),
            );
        }
        // backward compat: analyze_rs <file> grain from to
        other => {
            cmd_series(
                other,
                args.get(2).map(|s| s.as_str()).unwrap_or("month"),
                args.get(3).map(|s| s.as_str()).unwrap_or(""),
                args.get(4).map(|s| s.as_str()).unwrap_or(""),
            );
        }
    }
}
