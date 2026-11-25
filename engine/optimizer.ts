import type { Tensor } from "./tensor";

/** Adam optimizer operating directly on the engine's leaf Tensors. */
export class Adam {
  learningRate: number;
  readonly beta1: number;
  readonly beta2: number;
  readonly eps: number;
  t = 0;
  private m = new Map<Tensor, Float32Array>();
  private v = new Map<Tensor, Float32Array>();

  /** Decoupled weight decay (0 disables it, making this plain Adam). */
  weightDecay: number;

  constructor(params: Tensor[], learningRate = 0.001, beta1 = 0.9, beta2 = 0.999, eps = 1e-8, weightDecay = 0) {
    this.learningRate = learningRate;
    this.beta1 = beta1;
    this.beta2 = beta2;
    this.eps = eps;
    this.weightDecay = weightDecay;
    for (const p of params) {
      this.m.set(p, new Float32Array(p.data.length));
      this.v.set(p, new Float32Array(p.data.length));
    }
  }

  /** Current global gradient norm, before clipping. */
  gradientNorm(): number {
    let sumSq = 0;
    for (const [p] of this.m) {
      const g = p.grad;
      if (!g) continue;
      for (let i = 0; i < g.length; i++) {
        const v = g[i];
        if (Number.isFinite(v)) sumSq += v * v;
      }
    }
    return Math.sqrt(sumSq);
  }

  /** Clip the global gradient norm to `maxNorm`; returns the pre-clip norm. */
  clipGradNorm(maxNorm: number): number {
    const norm = this.gradientNorm();
    if (norm > maxNorm && norm > 0) {
      const factor = maxNorm / norm;
      for (const [p] of this.m) {
        const g = p.grad;
        if (!g) continue;
        for (let i = 0; i < g.length; i++) g[i] *= factor;
      }
    }
    return norm;
  }

  step(): void {
    this.t += 1;
    const bc1 = 1 - Math.pow(this.beta1, this.t);
    const bc2 = 1 - Math.pow(this.beta2, this.t);
    const lr = this.learningRate;
    for (const [p, m] of this.m) {
      const g = p.grad;
      if (!g) continue;
      const v = this.v.get(p)!;
      const d = p.data;
      for (let i = 0; i < d.length; i++) {
        m[i] = this.beta1 * m[i] + (1 - this.beta1) * g[i];
        v[i] = this.beta2 * v[i] + (1 - this.beta2) * g[i] * g[i];
        const mHat = m[i] / bc1;
        const vHat = v[i] / bc2;
        // AdamW decouples weight decay from the adaptive gradient update.
        d[i] -= lr * (mHat / (Math.sqrt(vHat) + this.eps) + this.weightDecay * d[i]);
      }
    }
  }

  /** Export Adam moments keyed by stable parameter names for serialization. */
  exportState(names: Map<Tensor, string>): { t: number; m: Record<string, Float32Array>; v: Record<string, Float32Array> } {
    const m: Record<string, Float32Array> = {};
    const v: Record<string, Float32Array> = {};
    for (const [p, moments] of this.m) {
      const name = names.get(p);
      if (!name) continue;
      m[name] = new Float32Array(moments);
      v[name] = new Float32Array(this.v.get(p)!);
    }
    return { t: this.t, m, v };
  }

  /** Restore moments into the tensors of a freshly loaded model. */
  importState(
    t: number,
    m: Map<string, Float32Array>,
    v: Map<string, Float32Array>,
    tensors: Map<string, Tensor>,
  ): void {
    this.t = Number.isFinite(t) ? Math.max(0, Math.floor(t)) : 0;
    for (const [name, values] of m) {
      const p = tensors.get(name);
      if (p && this.m.has(p) && values.length === p.data.length) this.m.set(p, new Float32Array(values));
    }
    for (const [name, values] of v) {
      const p = tensors.get(name);
      if (p && this.v.has(p) && values.length === p.data.length) this.v.set(p, new Float32Array(values));
    }
  }
}
