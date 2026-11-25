/** Character-level tokenizer with explicit, serializable special tokens. */

export const BASE_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 " +
  "\n\r\t.,!?;:'\"-_()[]{}/\\+*=<>%&#@$~^`|";

export const SPECIAL_TOKENS = ["<pad>", "<unk>", "</s>"] as const;

export type TokenizerMode = "char" | "word";

export class Tokenizer {
  readonly vocab: string[];
  readonly charToId: Map<string, number>;
  readonly hasSpecialTokens: boolean;
  /** char = one character per token (legacy model); word = one word per token. */
  readonly mode: TokenizerMode;

  constructor(vocab: string[], mode: TokenizerMode = "char") {
    this.vocab = vocab.slice();
    this.charToId = new Map();
    vocab.forEach((c, i) => this.charToId.set(c, i));
    this.hasSpecialTokens = SPECIAL_TOKENS.every((t, i) => this.vocab[i] === t);
    this.mode = mode;
  }

  static build(texts: string[]): Tokenizer {
    const set = new Set<string>();
    for (const c of BASE_CHARS) set.add(c);
    for (const text of texts) for (const ch of text) set.add(ch);
    const chars = Array.from(set)
      .filter((c) => !SPECIAL_TOKENS.includes(c as typeof SPECIAL_TOKENS[number]))
      .sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!);
    return new Tokenizer([...SPECIAL_TOKENS, ...chars], "char");
  }

  /**
   * Word-level tokenizer for the generative language model. Words carry meaning
   * directly, so a small network can learn real word relationships and produce
   * readable sentences instead of character soup.
   */
  static buildWords(texts: string[], maxVocab = 12000): Tokenizer {
    const counts = new Map<string, number>();
    for (const text of texts) {
      if (!text) continue;
      for (const match of text.toLowerCase().match(/[a-z0-9']+/g) ?? []) {
        counts.set(match, (counts.get(match) ?? 0) + 1);
      }
    }
    const words = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, Math.max(2, maxVocab))
      .map(([word]) => word)
      .filter((word) => !SPECIAL_TOKENS.includes(word as typeof SPECIAL_TOKENS[number]));
    return new Tokenizer([...SPECIAL_TOKENS, ...words], "word");
  }

  get size(): number { return this.vocab.length; }
  get padId(): number { return this.hasSpecialTokens ? 0 : 0; }
  get unkId(): number { return this.hasSpecialTokens ? 1 : -1; }
  get eosId(): number { return this.hasSpecialTokens ? 2 : -1; }

  /** Encode text. Unknown units map to <unk> instead of silently shifting the sequence. */
  encode(text: string): Int32Array {
    const out: number[] = [];
    const unk = this.unkId >= 0 ? this.unkId : 0;
    if (this.mode === "word") {
      for (const word of text.toLowerCase().match(/[a-z0-9']+/g) ?? []) {
        out.push(this.charToId.get(word) ?? unk);
      }
      return Int32Array.from(out);
    }
    for (const ch of text) out.push(this.charToId.get(ch) ?? unk);
    return Int32Array.from(out);
  }

  encodeWithUnknown(text: string): Int32Array { return this.encode(text); }

  decode(ids: ArrayLike<number>): string {
    const parts: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const token = this.vocab[id];
      if (!token || (this.hasSpecialTokens && id < SPECIAL_TOKENS.length)) continue;
      parts.push(token);
    }
    return this.mode === "word" ? parts.join(" ") : parts.join("");
  }

  toJSON(): string[] { return this.vocab.slice(); }

  static fromJSON(vocab: unknown, mode?: TokenizerMode): Tokenizer {
    if (!Array.isArray(vocab) || vocab.length < 2) throw new Error("Invalid tokenizer vocabulary.");
    if (!vocab.every((v) => typeof v === "string" && v.length > 0)) throw new Error("Tokenizer vocabulary contains invalid entries.");
    if (new Set(vocab).size !== vocab.length) throw new Error("Tokenizer vocabulary contains duplicates.");
    const hasSpecial = SPECIAL_TOKENS.every((t, i) => vocab[i] === t);
    if (hasSpecial && SPECIAL_TOKENS.some((t) => vocab.indexOf(t) >= SPECIAL_TOKENS.length)) {
      throw new Error("Tokenizer vocabulary has duplicate special tokens.");
    }
    const detected: TokenizerMode = mode ?? (vocab.some((v) => !SPECIAL_TOKENS.includes(v as typeof SPECIAL_TOKENS[number]) && v.length > 1) ? "word" : "char");
    return new Tokenizer(vocab as string[], detected);
  }
}
