/**
 * Minimal array-level automatic differentiation engine.
 *
 * Each Tensor holds a whole Float32Array (not one object per scalar), which keeps
 * the computation graph small enough to train a tiny Transformer in the browser.
 * Operations record their inputs and a backward closure; `backward()` performs a
 * topological traversal and accumulates gradients into leaf tensors.
 */

export type Shape = number[];

export function shapeSize(shape: Shape): number {
  return shape.reduce((a, b) => a * b, 1);
}

export function sameShape(a: Shape, b: Shape): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function strides(shape: Shape): number[] {
  const out = new Array(shape.length).fill(1) as number[];
  for (let i = shape.length - 2; i >= 0; i--) out[i] = out[i + 1] * shape[i + 1];
  return out;
}

let NEXT_ID = 1;

export class Tensor {
  readonly id = NEXT_ID++;
  data: Float32Array;
  shape: Shape;
  grad: Float32Array | null = null;
  isLeaf: boolean;
  label: string;

  /** @internal Graph edges are wired up by the op factories below. */
  prev: Tensor[] = [];
  /** @internal Backward closure recorded by the op factories below. */
  backwardFn: (upstream: Float32Array) => void = () => {};

  constructor(data: Float32Array, shape: Shape, opts?: { leaf?: boolean; label?: string }) {
    if (data.length !== shapeSize(shape)) {
      throw new Error(`Tensor: data length ${data.length} does not match shape [${shape}]`);
    }
    this.data = data;
    this.shape = shape;
    this.isLeaf = opts?.leaf ?? false;
    this.label = opts?.label ?? "";
  }

  static zeros(shape: Shape, opts?: { leaf?: boolean; label?: string }): Tensor {
    return new Tensor(new Float32Array(shapeSize(shape)), shape, opts);
  }

  static full(shape: Shape, value: number, opts?: { leaf?: boolean; label?: string }): Tensor {
    const d = new Float32Array(shapeSize(shape));
    d.fill(value);
    return new Tensor(d, shape, opts);
  }

  static fromArray(shape: Shape, values: number[] | Float32Array, opts?: { leaf?: boolean; label?: string }): Tensor {
    const d = values instanceof Float32Array ? new Float32Array(values) : Float32Array.from(values);
    return new Tensor(d, shape, opts);
  }

  zeroGrad(): void {
    this.grad = null;
  }

  get(d: number): number {
    return this.data[d];
  }

  view(shape: Shape): Tensor {
    if (shapeSize(shape) !== shapeSize(this.shape)) {
      throw new Error(`view: incompatible shapes [${this.shape}] -> [${shape}]`);
    }
    const out = new Tensor(this.data, shape);
    out.prev = [this];
    const inShape = this.shape.slice();
    out.backwardFn = (g) => addIntoGrad(this, g, shapeSize(inShape));
    return out;
  }

  /** Swap two dimensions (true data permutation). */
  transpose(dimA: number, dimB: number): Tensor {
    const nd = this.shape.length;
    let i = dimA < 0 ? nd + dimA : dimA;
    let j = dimB < 0 ? nd + dimB : dimB;
    if (i < 0 || j < 0 || i >= nd || j >= nd) throw new Error("transpose: dimension out of range");
    if (i === j) return this;
    const s = this.shape.slice();
    [s[i], s[j]] = [s[j], s[i]];
    const out = new Tensor(permute(this.data, this.shape, i, j), s);
    out.prev = [this];
    const len = this.data.length;
    out.backwardFn = (g) => addIntoGrad(this, permute(g, s, i, j), len);
    return out;
  }

  transposeLast2(): Tensor {
    return this.transpose(this.shape.length - 2, this.shape.length - 1);
  }

  backward(upstream?: Float32Array): void {
    const order: Tensor[] = [];
    const seen = new Set<number>();
    const visit = (t: Tensor) => {
      if (seen.has(t.id)) return;
      seen.add(t.id);
      for (const p of t.prev) visit(p);
      order.push(t);
    };
    visit(this);

    const seed = upstream ?? new Float32Array(this.data.length).fill(1);
    addIntoGrad(this, seed, this.data.length);

    for (let i = order.length - 1; i >= 0; i--) {
      const t = order[i];
      if (!t.grad) continue;
      t.backwardFn(t.grad);
    }
  }
}

/** Swap two axes of a flat row-major array. */
function permute(data: Float32Array, shape: Shape, i: number, j: number): Float32Array {
  const out = new Float32Array(data.length);
  const outShape = shape.slice();
  [outShape[i], outShape[j]] = [outShape[j], outShape[i]];
  const outStr = strides(outShape);
  const nd = shape.length;
  const coords = new Array<number>(nd);
  for (let flat = 0; flat < data.length; flat++) {
    let rem = flat;
    for (let d = nd - 1; d >= 0; d--) {
      coords[d] = rem % shape[d];
      rem = Math.floor(rem / shape[d]);
    }
    [coords[i], coords[j]] = [coords[j], coords[i]];
    let oi = 0;
    for (let d = 0; d < nd; d++) oi += coords[d] * outStr[d];
    out[oi] = data[flat];
  }
  return out;
}

function addIntoGrad(t: Tensor, grad: Float32Array, expectedLength: number): void {
  if (grad.length !== expectedLength) {
    throw new Error(`gradient length ${grad.length} != ${expectedLength} for tensor [${t.shape}]`);
  }
  if (!t.grad) t.grad = new Float32Array(t.data.length);
  const g = t.grad;
  for (let i = 0; i < grad.length; i++) g[i] += grad[i];
}

/* ------------------------------- broadcasting ------------------------------- */

function broadcastShape(a: Shape, b: Shape): Shape {
  const n = Math.max(a.length, b.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const ai = i + a.length - n;
    const bi = i + b.length - n;
    const av = ai >= 0 ? a[ai] : 1;
    const bv = bi >= 0 ? b[bi] : 1;
    if (av !== bv && av !== 1 && bv !== 1) throw new Error(`broadcast: incompatible shapes [${a}] and [${b}]`);
    out.push(Math.max(av, bv));
  }
  return out;
}

// Reused scratch buffers: these helpers are called once per element in hot loops.
const indexCoords: number[] = [];
const indexStrides: number[] = [];

function inputIndex(flatOut: number, inShape: Shape, outShape: Shape): number {
  const offset = outShape.length - inShape.length;
  let rem = flatOut;
  if (indexCoords.length < outShape.length) indexCoords.length = outShape.length;
  for (let d = outShape.length - 1; d >= 0; d--) {
    indexCoords[d] = rem % outShape[d];
    rem = Math.floor(rem / outShape[d]);
  }
  if (indexStrides.length < inShape.length) indexStrides.length = inShape.length;
  indexStrides[inShape.length - 1] = 1;
  for (let i = inShape.length - 2; i >= 0; i--) indexStrides[i] = indexStrides[i + 1] * inShape[i + 1];
  let idx = 0;
  for (let d = 0; d < inShape.length; d++) {
    const c = inShape[d] === 1 ? 0 : indexCoords[d + offset];
    idx += c * indexStrides[d];
  }
  return idx;
}

function unbroadcast(grad: Float32Array, outShape: Shape, inShape: Shape, inLength: number): Float32Array {
  if (sameShape(outShape, inShape)) return grad;
  const out = new Float32Array(inLength);
  const n = shapeSize(outShape);
  for (let i = 0; i < n; i++) out[inputIndex(i, inShape, outShape)] += grad[i];
  return out;
}

/* ---------------------------------- ops ------------------------------------ */

export function add(a: Tensor, b: Tensor): Tensor {
  const s = broadcastShape(a.shape, b.shape);
  const out = new Tensor(new Float32Array(shapeSize(s)), s);
  const ad = a.data, bd = b.data, od = out.data;
  for (let i = 0; i < od.length; i++) {
    od[i] = ad[inputIndex(i, a.shape, s)] + bd[inputIndex(i, b.shape, s)];
  }
  out.prev = [a, b];
  const aShape = a.shape.slice(), bShape = b.shape.slice(), aLen = a.data.length, bLen = b.data.length;
  out.backwardFn = (g) => {
    addIntoGrad(a, unbroadcast(g, s, aShape, aLen), aLen);
    addIntoGrad(b, unbroadcast(g, s, bShape, bLen), bLen);
  };
  return out;
}

export function sub(a: Tensor, b: Tensor): Tensor {
  const s = broadcastShape(a.shape, b.shape);
  const out = new Tensor(new Float32Array(shapeSize(s)), s);
  const ad = a.data, bd = b.data, od = out.data;
  for (let i = 0; i < od.length; i++) od[i] = ad[inputIndex(i, a.shape, s)] - bd[inputIndex(i, b.shape, s)];
  out.prev = [a, b];
  const aShape = a.shape.slice(), bShape = b.shape.slice(), aLen = a.data.length, bLen = b.data.length;
  out.backwardFn = (g) => {
    addIntoGrad(a, unbroadcast(g, s, aShape, aLen), aLen);
    const neg = new Float32Array(g.length);
    for (let i = 0; i < g.length; i++) neg[i] = -g[i];
    addIntoGrad(b, unbroadcast(neg, s, bShape, bLen), bLen);
  };
  return out;
}

export function scale(t: Tensor, factor: number): Tensor {
  const out = new Tensor(new Float32Array(t.data.length), t.shape);
  for (let i = 0; i < t.data.length; i++) out.data[i] = t.data[i] * factor;
  out.prev = [t];
  const len = t.data.length;
  out.backwardFn = (g) => {
    const s = new Float32Array(len);
    for (let i = 0; i < len; i++) s[i] = g[i] * factor;
    addIntoGrad(t, s, len);
  };
  return out;
}

export function neg(t: Tensor): Tensor {
  return scale(t, -1);
}

/**
 * Inverted dropout with a recorded mask, so the same mask is used in backward.
 * When `training` is false (inference, validation, scoring) this is a no-op and
 * returns the input unchanged, keeping evaluation deterministic.
 */
export function dropout(t: Tensor, probability: number, rng: () => number, training: boolean): Tensor {
  if (!training || !(probability > 0) || probability >= 1) return t;
  const keep = 1 - probability;
  const factor = 1 / keep;
  const len = t.data.length;
  const mask = new Float32Array(len);
  const out = new Tensor(new Float32Array(len), t.shape);
  for (let i = 0; i < len; i++) {
    const active = rng() < keep ? factor : 0;
    mask[i] = active;
    out.data[i] = t.data[i] * active;
  }
  out.prev = [t];
  out.backwardFn = (g) => {
    const s = new Float32Array(len);
    for (let i = 0; i < len; i++) s[i] = g[i] * mask[i];
    addIntoGrad(t, s, len);
  };
  return out;
}

/** 2D matrix multiply, or batched 3D matrix multiply with equal batch size. */
export function matmul(a: Tensor, b: Tensor): Tensor {
  const as = a.shape, bs = b.shape;
  if (as.length !== bs.length || (as.length !== 2 && as.length !== 3)) {
    throw new Error(`matmul: unsupported shapes [${as}] @ [${bs}]`);
  }
  const batched = as.length === 3;
  const B = batched ? as[0] : 1;
  const M = as[as.length - 2];
  const K = as[as.length - 1];
  const K2 = bs[bs.length - 2];
  const N = bs[bs.length - 1];
  if (K !== K2) throw new Error(`matmul: inner dimensions ${K} and ${K2} do not match`);
  if (batched && bs[0] !== B) throw new Error("matmul: batch sizes do not match");

  const outShape = batched ? [B, M, N] : [M, N];
  const out = new Tensor(new Float32Array(shapeSize(outShape)), outShape);
  const ad = a.data, bd = b.data, od = out.data;
  const astr = strides(as), bstr = strides(bs), ostr = strides(outShape);

  for (let bi = 0; bi < B; bi++) {
    const aOff = batched ? bi * astr[0] : 0;
    const bOff = batched ? bi * bstr[0] : 0;
    const oOff = batched ? bi * ostr[0] : 0;
    for (let m = 0; m < M; m++) {
      for (let k = 0; k < K; k++) {
        const av = ad[aOff + m * astr[as.length - 2] + k * astr[as.length - 1]];
        if (av === 0) continue;
        for (let n = 0; n < N; n++) {
          od[oOff + m * ostr[outShape.length - 2] + n * ostr[outShape.length - 1]] +=
            av * bd[bOff + k * bstr[bs.length - 2] + n * bstr[bs.length - 1]];
        }
      }
    }
  }

  out.prev = [a, b];
  const aShape = as.slice(), bShape = bs.slice();
  const aLen = a.data.length, bLen = b.data.length;
  const ast = strides(aShape), bst = strides(bShape);
  out.backwardFn = (g) => {
    const dA = new Float32Array(aLen);
    const dB = new Float32Array(bLen);
    for (let bi = 0; bi < B; bi++) {
      const aOff = batched ? bi * ast[0] : 0;
      const bOff = batched ? bi * bst[0] : 0;
      const oOff = batched ? bi * ostr[0] : 0;
      for (let m = 0; m < M; m++) {
        for (let k = 0; k < K; k++) {
          let sum = 0;
          for (let n = 0; n < N; n++) {
            sum += g[oOff + m * ostr[outShape.length - 2] + n * ostr[outShape.length - 1]] *
              bd[bOff + k * bst[bShape.length - 2] + n * bst[bShape.length - 1]];
          }
          dA[aOff + m * ast[aShape.length - 2] + k * ast[aShape.length - 1]] += sum;
        }
      }
      for (let k = 0; k < K; k++) {
        for (let n = 0; n < N; n++) {
          let sum = 0;
          for (let m = 0; m < M; m++) {
            sum += g[oOff + m * ostr[outShape.length - 2] + n * ostr[outShape.length - 1]] *
              ad[aOff + m * ast[aShape.length - 2] + k * ast[aShape.length - 1]];
          }
          dB[bOff + k * bst[bShape.length - 2] + n * bst[bShape.length - 1]] += sum;
        }
      }
    }
    addIntoGrad(a, dA, aLen);
    addIntoGrad(b, dB, bLen);
  };
  return out;
}

export function relu(t: Tensor): Tensor {
  const out = new Tensor(new Float32Array(t.data.length), t.shape);
  for (let i = 0; i < t.data.length; i++) out.data[i] = Math.max(0, t.data[i]);
  out.prev = [t];
  const len = t.data.length, td = t.data;
  out.backwardFn = (g) => {
    const d = new Float32Array(len);
    for (let i = 0; i < len; i++) d[i] = td[i] > 0 ? g[i] : 0;
    addIntoGrad(t, d, len);
  };
  return out;
}

export function softmax(t: Tensor, dim = -1): Tensor {
  const nd = t.shape.length;
  const d = dim < 0 ? nd + dim : dim;
  const outer = shapeSize(t.shape.slice(0, d));
  const inner = t.shape[d];
  const tail = shapeSize(t.shape.slice(d + 1));
  const out = new Tensor(new Float32Array(t.data.length), t.shape);
  for (let o = 0; o < outer; o++) {
    for (let x = 0; x < tail; x++) {
      const base = o * inner * tail + x;
      let max = -Infinity;
      for (let i = 0; i < inner; i++) max = Math.max(max, t.data[base + i * tail]);
      let sum = 0;
      for (let i = 0; i < inner; i++) {
        const e = Math.exp(t.data[base + i * tail] - max);
        out.data[base + i * tail] = e;
        sum += e;
      }
      for (let i = 0; i < inner; i++) out.data[base + i * tail] /= sum || 1;
    }
  }
  out.prev = [t];
  const p = new Float32Array(out.data);
  out.backwardFn = (g) => {
    const dt = new Float32Array(t.data.length);
    for (let o = 0; o < outer; o++) {
      for (let x = 0; x < tail; x++) {
        const base = o * inner * tail + x;
        let dot = 0;
        for (let i = 0; i < inner; i++) dot += g[base + i * tail] * p[base + i * tail];
        for (let i = 0; i < inner; i++) {
          const pi = p[base + i * tail];
          dt[base + i * tail] = pi * (g[base + i * tail] - dot);
        }
      }
    }
    addIntoGrad(t, dt, t.data.length);
  };
  return out;
}

export function layernorm(x: Tensor, gamma: Tensor, beta: Tensor, eps = 1e-5): Tensor {
  const C = x.shape[x.shape.length - 1];
  const N = shapeSize(x.shape) / C;
  const out = new Tensor(new Float32Array(x.data.length), x.shape);
  const inv = new Float32Array(N);
  const xhat = new Float32Array(x.data.length);
  for (let n = 0; n < N; n++) {
    const off = n * C;
    let mean = 0;
    for (let c = 0; c < C; c++) mean += x.data[off + c];
    mean /= C;
    let varSum = 0;
    for (let c = 0; c < C; c++) {
      const v = x.data[off + c] - mean;
      xhat[off + c] = v;
      varSum += v * v;
    }
    const v = varSum / C;
    inv[n] = 1 / Math.sqrt(v + eps);
    for (let c = 0; c < C; c++) out.data[off + c] = xhat[off + c] * inv[n] * gamma.data[c] + beta.data[c];
  }
  out.prev = [x, gamma, beta];
  const gammaLen = gamma.data.length, betaLen = beta.data.length, xLen = x.data.length;
  out.backwardFn = (g) => {
    const dGamma = new Float32Array(gammaLen);
    const dBeta = new Float32Array(betaLen);
    const dX = new Float32Array(xLen);
    for (let n = 0; n < N; n++) {
      const off = n * C;
      let dxhSum = 0;
      let dxhXhatSum = 0;
      for (let c = 0; c < C; c++) {
        const gc = g[off + c];
        dBeta[c] += gc;
        dGamma[c] += gc * xhat[off + c] * inv[n];
        const dxh = gc * gamma.data[c] * inv[n];
        dX[off + c] = dxh;
        dxhSum += dxh;
        dxhXhatSum += dxh * xhat[off + c];
      }
      for (let c = 0; c < C; c++) {
        dX[off + c] = dX[off + c] - dxhSum / C - (xhat[off + c] * dxhXhatSum * inv[n] * inv[n]) / C;
      }
    }
    addIntoGrad(x, dX, xLen);
    addIntoGrad(gamma, dGamma, gammaLen);
    addIntoGrad(beta, dBeta, betaLen);
  };
  return out;
}

/** Mean cross-entropy over N samples. logits [N, V], targets length N. */
export function crossEntropy(logits: Tensor, targets: Int32Array): Tensor {
  const [N, V] = logits.shape;
  if (targets.length !== N) throw new Error("crossEntropy: target count mismatch");
  const probs = new Float32Array(logits.data.length);
  let loss = 0;
  const invN = 1 / N;
  for (let n = 0; n < N; n++) {
    const off = n * V;
    let max = -Infinity;
    for (let v = 0; v < V; v++) max = Math.max(max, logits.data[off + v]);
    let sum = 0;
    for (let v = 0; v < V; v++) {
      const e = Math.exp(logits.data[off + v] - max);
      probs[off + v] = e;
      sum += e;
    }
    for (let v = 0; v < V; v++) probs[off + v] /= sum || 1;
    const t = targets[n];
    if (t < 0 || t >= V) throw new Error(`crossEntropy: target id ${t} out of range`);
    loss += -Math.log(Math.max(probs[off + t], 1e-12));
  }
  const out = new Tensor(new Float32Array([loss * invN]), []);
  out.prev = [logits];
  out.backwardFn = (g) => {
    const d = new Float32Array(logits.data.length);
    const factor = g[0] * invN;
    for (let n = 0; n < N; n++) {
      const off = n * V;
      for (let v = 0; v < V; v++) d[off + v] = probs[off + v] * factor;
      d[off + targets[n]] -= factor;
    }
    addIntoGrad(logits, d, logits.data.length);
  };
  return out;
}

/** Embedding lookup: table [V, C], ids [N] -> [N, C]. */
export function embedding(table: Tensor, ids: Int32Array): Tensor {
  const C = table.shape[1];
  const N = ids.length;
  const out = new Tensor(new Float32Array(N * C), [N, C]);
  for (let n = 0; n < N; n++) {
    const id = ids[n];
    if (id < 0 || id >= table.shape[0]) throw new Error(`embedding: id ${id} out of range`);
    for (let c = 0; c < C; c++) out.data[n * C + c] = table.data[id * C + c];
  }
  out.prev = [table];
  const len = table.data.length;
  out.backwardFn = (g) => {
    const d = new Float32Array(len);
    for (let n = 0; n < N; n++) {
      const off = ids[n] * C;
      for (let c = 0; c < C; c++) d[off + c] += g[n * C + c];
    }
    addIntoGrad(table, d, len);
  };
  return out;
}

/** Causal mask applied to attention logits [BH, T, T] before softmax. */
export function applyCausalMask(logits: Tensor): Tensor {
  const [BH, T] = [logits.shape[0], logits.shape[1]];
  const out = new Tensor(new Float32Array(logits.data), logits.shape);
  for (let b = 0; b < BH; b++) {
    for (let i = 0; i < T; i++) {
      const row = b * T * T + i * T;
      let min = Infinity;
      for (let j = 0; j <= i; j++) if (logits.data[row + j] < min) min = logits.data[row + j];
      const maskedValue = Number.isFinite(min) ? min - 1e4 : -1e30;
      for (let j = i + 1; j < T; j++) out.data[row + j] = maskedValue;
    }
  }
  out.prev = [logits];
  const len = logits.data.length;
  out.backwardFn = (g) => {
    const maskedGrad = new Float32Array(len);
    for (let b = 0; b < BH; b++) {
      for (let i = 0; i < T; i++) {
        const row = b * T * T + i * T;
        for (let j = 0; j <= i; j++) maskedGrad[row + j] = g[row + j];
      }
    }
    addIntoGrad(logits, maskedGrad, len);
  };
  return out;
}
