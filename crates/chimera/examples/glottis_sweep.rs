//! Sustained vowels over a grid of pitch, breathiness, tension and lung pressure, each with the glottis's true
//! open quotient and leak read from the engine's own glottal-area scope: the reference a
//! microphone's estimate of fold closure is checked against (src/mic/glottis.ts).
//! `cargo run --release -p chimera --example glottis_sweep -- <outdir> [female|male] [roughness] [vibrato cents] [mini]` writes
//! `sweep.f32` (mono 48 kHz float clips, end to end) and `sweep.json` (one record per clip).
use chimera::anatomy::human::{BODY_FEMALE, BODY_MALE};
use chimera::phonetics::planner::vowel_table;
use chimera::voice::human_voice::{HumanVoice, SourcePatch, VoiceTelemetry};
use std::io::Write;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let out = args.get(1).cloned().unwrap_or_else(|| "out".into());
    let body_name = args.get(2).map(|s| s.as_str()).unwrap_or("female");
    let body = if body_name == "male" { BODY_MALE } else { BODY_FEMALE };
    // how irregular the voice is and how deep its vibrato (cents): a real singer has both
    let rough: f64 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let vib: f64 = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(0.0);
    // "mini": a few dozen clips, for the self-test (tools/mic-selftest.ts)
    let mini = args.get(5).map(|s| s == "mini").unwrap_or(false);
    let fs = 48000.0;
    let table = &vowel_table()[body_name];
    let f0s: &[f64] = match (body_name == "male", mini) {
        (true, false) => &[98.0, 131.0, 175.0, 233.0, 311.0],
        (true, true) => &[131.0, 233.0],
        (false, false) => &[175.0, 220.0, 277.0, 349.0, 440.0, 554.0],
        (false, true) => &[220.0, 349.0],
    };
    let vowels: &[&str] = if mini { &["ɑ", "i"] } else { &["ɑ", "i", "u", "ɛ", "o"] };
    let breaths: &[f64] = if mini { &[0.2, 0.75] } else { &[0.0, 0.2, 0.45, 0.75, 1.0] };
    let tensions: &[f64] = if mini { &[0.1, 0.5, 0.9] } else { &[0.1, 0.3, 0.5, 0.7, 0.9] };
    let pressures: &[f64] = if mini { &[4.0, 11.0] } else { &[4.0, 7.2, 11.0] };
    let mut audio: Vec<f32> = Vec::new();
    let mut recs = Vec::new();
    let n = (fs * 0.55) as usize;
    for &ipa in vowels {
        for &f0 in f0s {
            for &breath in breaths {
                for &tension in tensions {
                  // soft, comfortable and loud singing (lung pressure, cmH₂O)
                  for &pressure in pressures {
                    let mut v = HumanVoice::new(fs, body, 2);
                    v.set_source(&SourcePatch { f0: Some(f0), breathiness: Some(breath), tension: Some(tension), pressure: Some(pressure), roughness: Some(rough), drift: Some(if rough > 0.0 { 5.0 } else { 0.0 }), vibrato_depth: Some(vib), ..Default::default() });
                    v.set_articulation(&table[ipa].artic, Some(true));
                    v.set_gate(1.0);
                    let mut clip = vec![0f32; n];
                    let mut tele = VoiceTelemetry::default();
                    let (mut oq, mut leak, mut peak, mut k) = (0.0f64, 0.0f64, 0.0f64, 0usize);
                    let mut pos = 0;
                    while pos < n {
                        let end = (pos + 768).min(n);
                        v.render(&mut clip[pos..end]);
                        pos = end;
                        v.telemetry(&mut tele);
                        // the settled half of the clip
                        if pos > n / 2 && !tele.glottal_area.is_empty() {
                            let a = &tele.glottal_area;
                            let mn = a.iter().cloned().fold(f32::INFINITY, f32::min) as f64;
                            let mx = a.iter().cloned().fold(0f32, f32::max) as f64;
                            // open: above the leak by 3 % of the pulse's height
                            let open = a.iter().filter(|x| (**x as f64) > mn + 0.03 * (mx - mn)).count() as f64 / a.len() as f64;
                            oq += open;
                            leak += mn;
                            peak += mx;
                            k += 1;
                        }
                    }
                    let kk = k.max(1) as f64;
                    recs.push(serde_json::json!({"vowel": ipa, "f0": f0, "breath": breath, "tension": tension, "pressure": pressure, "oq": oq / kk, "leak": leak / kk, "peak": peak / kk, "rough": rough, "vib": vib, "offset": audio.len(), "len": n}));
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
