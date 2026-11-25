import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Writable data root for server-side files.
 *
 * Local development keeps the original `data/` directory. Vercel's function
 * filesystem is read-only except for temp storage, so deployments fall back
 * to a writable temp directory unless DAVIDAI_DATA_DIR is configured.
 */
export function dataRoot(): string {
  const configured = process.env.DAVIDAI_DATA_DIR?.trim();
  if (configured) return resolve(configured);
  if (process.env.VERCEL) return join(tmpdir(), "davidai-data");
  return join(process.cwd(), "data");
}
