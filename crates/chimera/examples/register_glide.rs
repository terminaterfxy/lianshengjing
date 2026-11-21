//! Glides from low to high, some with a change of register at a known pitch, for checking the mic
//! page's register-break finder (src/mic/register.ts). The engine has no registers, so a change is
//! drawn the way it can be: the folds thinning (less tension, a little breathier and softer)
//! within 40 ms ("break"), and with the pitch leaping 3 semitones up as well ("crack"). "smooth"
//! keeps the source as it is; "blend" thins it as much, but gradually over the whole glide (what
//! a singer who blends her registers does), which must not read as a break.
//! `cargo run --release -p chimera --example register_glide -- <outdir> [female|male] [mini]` writes
//! `sweep.f32` (mono 48 kHz float clips, end to end) and `sweep.json` (one record per clip).
use chimera::anatomy::human::{BODY_FEMALE, BODY_MALE};
use chimera::phonetics::planner::vowel_table;
use chimera::voice::human_voice::{HumanVoice, SourcePatch};
use std::io::Write;

/// the source at either end of a thinning: (tension, breathiness, pressure)
const FULL: (f64, f64, f64) = (0.65, 0.1, 9.0);
const THIN: (f64, f64, f64) = (0.2, 0.4, 7.0);
/// a crack's leap, semitones
const JUMP: f64 = 3.0;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let out = args.get(1).cloned().unwrap_or_else(|| "out".into());
    let body_name = args.get(2).map(|s| s.as_str()).unwrap_or("female");
    let body = if body_name == "male" { BODY_MALE } else { BODY_FEMALE };
    // "mini": a few clips, for the self-test (tools/mic-selftest.ts)
    let mini = args.get(3).map(|s| s == "mini").unwrap_or(false);
    let fs = 48000.0;
    let table = &vowel_table()[body_name];
    // two octaves; the break where women's and men's first passaggio usually is (F4, D4), and a
    // woman's second (C5)
    let (lo, hi): (f64, f64) = if body_name == "male" { (110.0, 440.0) } else { (196.0, 784.0) };
    let breaks: &[f64] = match (body_name == "male", mini) {
        (true, _) => &[294.0],
        (false, true) => &[349.0],
        (false, false) => &[349.0, 523.0],
    };
    let vowels: &[&str] = if mini { &["ɑ"] } else { &["ɑ", "i", "u", "o"] };
    // the glide's length, s: a siren of 2 octaves in 4 s (6 semitones a second) or 2.5 s (~10)
    let speeds: &[f64] = if mini { &[4.0, 2.5] } else { &[5.0, 4.0, 2.5] };
    let hold = 0.4;
    let mut audio: Vec<f32> = Vec::new();
    let mut recs = Vec::new();
    let span = 12.0 * (hi / lo).log2();
    for &ipa in vowels {
        for &secs in speeds {
            for scenario in ["smooth", "blend", "break", "crack"] {
                let bks: &[Option<f64>] = &if scenario == "smooth" || scenario == "blend" { vec![None] } else { breaks.iter().map(|b| Some(*b)).collect::<Vec<_>>() };
                for &brk in bks {
                    let mut v = HumanVoice::new(fs, body, 2);
                    // the pitch follows the target within 10 ms: a crack is fast
                    let src = |f0: f64, (tension, breathiness, pressure): (f64, f64, f64)| SourcePatch { f0: Some(f0), glide: Some(0.01), tension: Some(tension), breathiness: Some(breathiness), pressure: Some(pressure), roughness: Some(0.1), drift: Some(0.0), vibrato_depth: Some(0.0), ..Default::default() };
                    let start = if scenario == "smooth" { (0.5, 0.15, 8.0) } else { FULL };
                    v.set_source(&src(lo, start));
                    v.set_articulation(&table[ipa].artic, Some(true));
                    v.set_gate(1.0);
                    let n = (fs * (secs + 2.0 * hold)) as usize;
                    let mut clip = vec![0f32; n];
                    // when the break comes, s into the clip
                    let at = brk.map(|b| hold + secs * 12.0 * (b / lo).log2() / span);
                    let mix = |a: (f64, f64, f64), b: (f64, f64, f64), u: f64| (a.0 + (b.0 - a.0) * u, a.1 + (b.1 - a.1) * u, a.2 + (b.2 - a.2) * u);
                    let mut pos = 0;
                    while pos < n {
                        let end = (pos + 240).min(n);
                        let t = pos as f64 / fs;
                        // semitones above the bottom: held, glided, held
                        let mut s = (((t - hold) / secs).clamp(0.0, 1.0)) * span;
                        let thin = match (scenario, at) {
                            ("blend", _) => mix(FULL, THIN, ((t - hold) / secs).clamp(0.0, 1.0)),
                            (_, Some(a)) => mix(FULL, THIN, ((t - a) / 0.04).clamp(0.0, 1.0)),
                            _ => start,
                        };
                        if let (true, Some(a)) = (scenario == "crack", at) {
                            if t >= a {
                                s = (s + JUMP).min(span);
                            }
                        }
                        v.set_source(&src(lo * (2f64).powf(s / 12.0), thin));
                        v.render(&mut clip[pos..end]);
                        pos = end;
                    }
                    recs.push(serde_json::json!({"vowel": ipa, "secs": secs, "scenario": scenario, "lo": lo, "hi": hi, "brk": brk, "at": at, "jump": if scenario == "crack" { JUMP } else { 0.0 }, "offset": audio.len(), "len": n}));
                    audio.extend_from_slice(&clip);
                }
            }
        }
    }
    std::fs::create_dir_all(&out).unwrap();
    let mut f = std::io::BufWriter::new(std::fs::File::create(format!("{out}/sweep.f32")).unwrap());
    for s in &audio {
        f.write_all(&s.to_le_bytes()).unwrap();
    }
    std::fs::write(format!("{out}/sweep.json"), serde_json::to_string(&recs).unwrap()).unwrap();
    println!("{} clips, {:.0} s of audio", recs.len(), audio.len() as f64 / fs);
}
