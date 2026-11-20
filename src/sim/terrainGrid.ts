/**
 * Cached, bilinearly interpolated version of a height field. Terrain noise
 * is expensive and the contact model samples it ~50 times per force
 * evaluation; a lazily filled grid makes each lookup a few array reads.
 * Deterministic: tile contents depend only on the source function.
 */
import type { GroundDepth } from './contact';

export class TerrainGrid {
  private tiles = new Map<string, Float32Array>();
  /** Shallowest depth in each tile (smallest node value; bilinear interpolation never goes below it). */
  private tileMin = new Map<string, number>();
  private readonly n: number;

  /**
   * @param source   exact depth function
   * @param cell     grid spacing [m]
   * @param tileSize cells per tile side
   * @param maxTiles tiles kept before the cache is cleared
   */
  constructor(
    private readonly source: GroundDepth,
    readonly cell = 4,
    private readonly tileSize = 64,
    private readonly maxTiles = 400,
  ) {
    this.n = tileSize + 1;
  }

  private tile(tx: number, ty: number): Float32Array {
    const key = `${tx},${ty}`;
    let t = this.tiles.get(key);
    if (!t) {
      if (this.tiles.size >= this.maxTiles) {
        this.tiles.clear();
        this.tileMin.clear();
      }
      t = new Float32Array(this.n * this.n);
      const x0 = tx * this.tileSize * this.cell;
      const y0 = ty * this.tileSize * this.cell;
      for (let j = 0; j < this.n; j++) {
        for (let i = 0; i < this.n; i++) t[j * this.n + i] = this.source(x0 + i * this.cell, y0 + j * this.cell);
      }
      this.tiles.set(key, t);
      let min = Infinity;
      for (let k = 0; k < t.length; k++) min = Math.min(min, t[k]!);
      this.tileMin.set(key, min);
    }
    return t;
  }

  /** Shallowest sea bed depth in the tiles covering a north/east box. */
  shallowestIn(n0: number, n1: number, e0: number, e1: number): number {
    const span = this.tileSize * this.cell;
    let min = Infinity;
    for (let tx = Math.floor(n0 / span); tx <= Math.floor(n1 / span); tx++) {
      for (let ty = Math.floor(e0 / span); ty <= Math.floor(e1 / span); ty++) {
        this.tile(tx, ty);
        min = Math.min(min, this.tileMin.get(`${tx},${ty}`)!);
      }
    }
    return min;
  }

  /** Interpolated depth at (north, east), with `shallowestIn` for the contact model. */
  readonly depth: GroundDepth = Object.assign((north: number, east: number) => this.interpolate(north, east), {
    shallowestIn: (n0: number, n1: number, e0: number, e1: number) => this.shallowestIn(n0, n1, e0, e1),
  });

  private interpolate(north: number, east: number): number {
    const gx = north / this.cell;
    const gy = east / this.cell;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const tx = Math.floor(ix / this.tileSize);
    const ty = Math.floor(iy / this.tileSize);
    const t = this.tile(tx, ty);
    const lx = ix - tx * this.tileSize;
    const ly = iy - ty * this.tileSize;
    const fx = gx - ix;
    const fy = gy - iy;
    const n = this.n;
    const a = t[ly * n + lx]!;
    const b = t[ly * n + lx + 1]!;
    const c = t[(ly + 1) * n + lx]!;
    const d = t[(ly + 1) * n + lx + 1]!;
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
}
