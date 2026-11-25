# DavidAI — GitHub / Vercel deployment

## Project root

`package.json`, `package-lock.json`, `next.config.mjs`, `tsconfig.json`, `vercel.json`, and `src/` must all sit at the repository root. In Vercel, set **Root Directory** to the repository root, not a parent folder.

Required Node.js version: `>=22.13.0` (declared in `package.json`).

Commands:

```bash
npm install
npm run build
npm start
```

`npm run build` uses `next build --webpack`, which is the verified build command for this project.

## Environment variables

No API key or provider credential is required by the wired application.

Optional:

- `DAVIDAI_DATA_DIR` — writable data directory for server-side SQLite, generated images, videos, and upload staging. On Vercel, DavidAI automatically uses a temp directory when this is unset. For persistent data outside Vercel, point this at persistent writable storage.

The legacy `DAVIDAI_LLM_*` variables in `.env.example` are commented and inactive. `/api/chat` is not used by the application.

If your build environment prints `npm warn Unknown env config "cache-dir"`, remove the environment variable `npm_config_cache-dir`. npm's valid config key is `cache`, for example `npm install --cache <path>`.

## What works on Vercel

- All 17 pages and navigation.
- Settings and other browser `localStorage` state.
- Dictionary and static assets under `public/`.
- API routes that do not require the local native engines.
- Brain API routes can start from the committed SQLite snapshot in a writable temp directory, but writes are ephemeral per serverless instance.

## What cannot run on managed Vercel functions

DavidAI's AI engines are local-first Windows binaries and GGUF weights:

- `bin/llama-cpp/*.exe` for Qwen chat and MiniLM embeddings.
- `bin/sd-cpp/*.exe` for image generation, upscaling, and video encoding.
- `models/*.gguf` weights totaling roughly 7.7 GiB.

These are intentionally excluded from the GitHub/Vercel source bundle. Status endpoints report them as unavailable rather than faking results. To keep real AI generation, run a separate self-hosted Windows worker with the models/binaries and connect it to the deployed site, or self-host the complete DavidAI backup instead of using managed Vercel functions.

Other Vercel platform limits:

- Default function duration is 300 seconds; long image/video renders need an external worker.
- Default request/response body limit is 4.5 MB; large document/image uploads or generated media need a storage service or a higher plan.
- The in-memory generation queue is per-instance; durable queue/cancellation needs shared state for multi-instance deployments.
