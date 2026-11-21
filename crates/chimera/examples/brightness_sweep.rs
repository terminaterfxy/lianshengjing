//! Sustained vowels over a grid of the two things that make a voice brighter, for checking the mic
//! page's brightness reading (src/mic/tone.ts): the epilarynx narrowed (the singer's formant near
//! 3 kHz, a tract change) and the folds closing more abruptly (the source's brightness), across
//! vowel, pitch and lung pressure (how loud), which also move it.
//! `cargo run --release -p chimera --example brightness_sweep -- <outdir> [female|male] [mini|sung]` writes
//! `sweep.f32` (mono 48 kHz float clips, end to end) and `sweep.json` (one record per clip).
use chimera::anatomy::human::{ArticKey, BODY_FEMALE, BODY_MALE};
use chimera::phonetics::planner::vowel_table;
use chimera::voice::human_voice::{HumanVoice, SourcePatch};
use std::io::Write;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let out = args.get(1).cloned().unwrap_or_else(|| "out".into());
    let body_name = args.get(2).map(|s| s.as_str()).unwrap_or("female");
    let body = if body_name == "male" { BODY_MALE } else { BODY_FEMALE };
    // "mini": a few clips, for the self-test (tools/mic-selftest.ts); "sung": fewer conditions,
    // longer notes with a vibrato (a vibrato moves the harmonics across a room's response)
    let mini = args.get(3).map(|s| s == "mini").unwrap_or(false);
    let sung = mini || args.get(3).map(|s| s == "sung").unwrap_or(false);
    let fs = 48000.0;
    let table = &vowel_table()[body_name];
    let f0s: &[f64] = match (body_name == "male", mini) {
        (true, false) => &[110.0, 165.0, 247.0],
        (true, true) => &[165.0],
        (false, false) => &[220.0, 349.0, 523.0],
        (false, true) => &[330.0],
    };
    let vowels: &[&str] = if mini { &["ɑ", "i"] } else { &["ɑ", "i", "u", "ɛ", "o"] };
    let epis: &[f64] = if mini { &[0.0, 0.7, 1.0] } else { &[0.0, 0.5, 0.7, 0.85, 1.0] };
    let vowels: &[&str] = if sung && !mini { &["ɑ", "i", "ɛ"] } else { vowels };
    let brights: &[f64] = if sung { &[0.25] } else { &[0.1, 0.4, 0.7] };
    let pressures: &[f64] = if sung { &[7.2] } else { &[5.0, 10.0] };
    let (secs, vib) = if sung { (1.6, 30.0) } else { (0.5, 0.0) };
    let mut audio: Vec<f32> = Vec::new();
    let mut recs = Vec::new();
    let n = (fs * secs) as usize;
    for &ipa in vowels {
        for &f0 in f0s {
            for &epi in epis {
                for &bright in brights {
                    for &pressure in pressures {
                        let mut v = HumanVoice::new(fs, body, 2);
                        v.set_source(&SourcePatch { f0: Some(f0), brightness: Some(bright), pressure: Some(pressure), roughness: Some(0.1), drift: Some(0.0), vibrato_depth: Some(vib), vibrato_rate: Some(5.5), ..Default::default() });
                        let artic = table[ipa].artic.clone().with(ArticKey::Epilarynx, epi);
                        v.set_articulation(&artic, Some(true));
                        v.set_gate(1.0);
                        let mut clip = vec![0f32; n];
                        let mut pos = 0;
                        while pos < n {
                            let end = (pos + 768).min(n);
                            v.render(&mut clip[pos..end]);
                            pos = end;
                        }
                        recs.push(serde_json::json!({"vowel": ipa, "f0": f0, "epi": epi, "bright": bright, "pressure": pressure, "offset": audio.len(), "len": n}));
                        audio.extend_from_slice(&clip);
                    }
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
