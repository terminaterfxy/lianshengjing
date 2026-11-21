#!/bin/zsh
# one condition: render, extract features, delete the audio (skipped if done or under way)
D="/private/tmp/claude-501/-Users-tr-Desktop---/6ba3e439-c6b0-43ec-8e37-6eb8bc533809/scratchpad"
cd /Users/tr/Desktop/视唱/chimera
b=$1; r=$2; v=$3; out="$D/d/${b}_r${r}_v${v}"
[ -f "$out/features.json" ] && exit 0
mkdir "$out.lock" 2>/dev/null || exit 0
./target/release/examples/glottis_sweep "$out" $b $r $v >/dev/null && node "$D/feat2.ts" "$out" && rm -f "$out/sweep.f32"
