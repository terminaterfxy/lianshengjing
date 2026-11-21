/**
 * A singer's range, heard as she sings from her lowest note to her highest, sliding or stepping.
 * A pitch counts only as part of a run: frames that follow one another without a leap, for 0.3 s
 * or more. So one frame misread by an octave, a cough or a consonant never becomes her top note,
 * and a slow slide counts as well as held notes. Pure, for tests.
 */
export class RangeRecorder {
  lo = Infinity;
  hi = 0;
  private run: { t: number; f0: number }[] = [];

  /** `now` in ms; `f0` in Hz, or 0 when no clear pitch sounds. */
  feed(now: number, f0: number): void {
    const last = this.run[this.run.length - 1];
    // a voice moves at most about two octaves a second
    const leap = last && f0 > 0 ? Math.abs(Math.log2(f0 / last.f0)) > 0.06 + 2 * ((now - last.t) / 1000) : false;
    if (!(f0 > 0) || leap || (last && now - last.t > 250)) this.run = [];
    if (!(f0 > 0)) return;
    this.run.push({ t: now, f0 });
    if (now - this.run[0].t < 300 || this.run.length < 4) return;
    // the run is real: its notes count, each as the middle of itself and its neighbours
    for (let i = 1; i < this.run.length - 1; i++) {
      const m = [this.run[i - 1].f0, this.run[i].f0, this.run[i + 1].f0].sort((a, b) => a - b)[1];
      if (m < this.lo) this.lo = m;
      if (m > this.hi) this.hi = m;
    }
    // keep the end of it to carry on from
    if (this.run.length > 12) this.run.splice(0, this.run.length - 12);
  }

  /** The range, once it spans at least a fifth. */
  get range(): [number, number] | null {
    return this.hi > this.lo * 1.5 ? [this.lo, this.hi] : null;
  }
}
