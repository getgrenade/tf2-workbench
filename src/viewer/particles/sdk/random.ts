/**
 * Valve's `CUniformRandomStream` (vstdlib/random.cpp): the generator the particle system draws its random numbers from. It is the "ran1" of
 * Numerical Recipes (a Park-Miller generator with a shuffle table), seeded the way the engine seeds it, so a collection with the same seed gives
 * the same numbers in the same order as in the game.
 */
const NTAB = 32, IA = 16807, IM = 2147483647, IQ = 127773, IR = 2836;
const NDIV = 1 + Math.floor((IM - 1) / NTAB);
const AM = 1 / IM, EPS = 1.2e-7, RNMX = 1 - EPS;
const MAX_RANDOM_RANGE = 0x7fffffff;

export class UniformRandomStream {
  private idum = 0;
  private iy = 0;
  private readonly iv = new Int32Array(NTAB);

  constructor(seed = 0) { this.setSeed(seed); }

  setSeed(seed: number) {
    seed |= 0;
    this.idum = seed < 0 ? seed : -seed;
    this.iy = 0;
  }

  /** The next number of the sequence, 1 .. 2^31 - 2. */
  generate(): number {
    let j: number, k: number;
    if (this.idum <= 0 || !this.iy) {
      this.idum = -this.idum < 1 ? 1 : -this.idum;
      for (j = NTAB + 7; j >= 0; j--) {
        k = Math.trunc(this.idum / IQ);
        this.idum = IA * (this.idum - k * IQ) - IR * k;
        if (this.idum < 0) this.idum += IM;
        if (j < NTAB) this.iv[j] = this.idum;
      }
      this.iy = this.iv[0];
    }
    k = Math.trunc(this.idum / IQ);
    this.idum = IA * (this.idum - k * IQ) - IR * k;
    if (this.idum < 0) this.idum += IM;
    j = Math.trunc(this.iy / NDIV);
    if (j >= NTAB || j < 0) j = (j % NTAB) & 0x7fffffff;
    this.iy = this.iv[j];
    this.iv[j] = this.idum;
    return this.iy;
  }

  /** A float in [low, high). */
  float(low = 0, high = 1): number {
    let fl = AM * this.generate();
    if (fl > RNMX) fl = RNMX;
    return fl * (high - low) + low;
  }

  /** `float`, with the 0..1 number raised to `exponent` first. */
  floatExp(low: number, high: number, exponent: number): number {
    let fl = AM * this.generate();
    if (fl > RNMX) fl = RNMX;
    if (exponent !== 1) fl = Math.pow(fl, exponent);
    return fl * (high - low) + low;
  }

  /** An integer in [low, high]. */
  int(low: number, high: number): number {
    const x = (high - low + 1) >>> 0;
    if (x <= 1 || MAX_RANDOM_RANGE < x - 1) return low;
    const maxAcceptable = MAX_RANDOM_RANGE - ((MAX_RANDOM_RANGE + 1) % x);
    let n: number;
    do { n = this.generate(); } while (n > maxAcceptable);
    return low + (n % x);
  }
}
