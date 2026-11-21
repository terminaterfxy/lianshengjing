# How the fold-closure fit in `src/mic/glottis.ts` was made and checked

Kept as they were run, for the record: the paths inside point at a scratch folder and at this
checkout, and need changing before a rerun.

1. `batch.sh <female|male> <roughness> <vibrato cents>`: renders one sweep
   (`crates/chimera/examples/glottis_sweep.rs`), extracts features, deletes the audio (a sweep is
   ~240 MB; never keep more than a few on disk).
2. `features.ts <sweep dir>`: each clip heard through a random room, microphone tilt, noise and
   sample rate, then the features the page computes (`glottalFeatures`).
3. `fit.ts <scratch dir> <female|male>`: the fit, scored on vowels it never saw, by lung pressure,
   reverberation, noise, sample rate, pitch and roughness, against the fit the page has now.

The everyday check is `node tools/mic-selftest.ts`; this is only for redoing the fit.
