# DavidAI — Personal AI Laboratory

DavidAI is a local-first personal AI lab built on Next.js 16. The server exposes **17 page routes** and local API routes; chat, retrieval, image generation and local keyframe video generation run against files on this machine. There are **no paid APIs, accounts, or subscriptions**. Web research is **off by default** and makes real external HTTP requests only after you enable Web Search, Research Mode, the Research assistant mode, or start Internet Study.

No `.env.local` or API key is needed for the normal local experience. The legacy `/api/chat` provider path is unwired and is not used by the app.

## Requirements

- **Node.js >=22.13.0** (`node:sqlite` is used without an experimental flag; this project has also been run with Node 24).
- Local chat assets: `models/llm/qwen2.5-1.5b-instruct-q4_k_m.gguf` (Qwen2.5 1.5B Instruct Q4_K_M), `models/llm/all-MiniLM-L6-v2-Q4_K_M.gguf` (MiniLM embeddings), and the llama.cpp binaries in `bin/llama-cpp/`.
- Local image assets: the CPU stable-diffusion.cpp binaries in `bin/sd-cpp/` and free local GGUF weights in `models/`. Run `npm run setup:image` once if they are missing; that setup step downloads open-source assets from GitHub/Hugging Face and is not part of normal app use.

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. For a production build:

```bash
npm run build
npm start
```

## Architecture

| Layer | Location | Purpose |
| --- | --- | --- |
| Next.js server | `src/app/`, `src/app/api/` | 17 page routes plus local API routes for brain, image, research, system and network status |
| SQLite brain | `data/brain/brain.sqlite` | File-backed memory via `node:sqlite`, with FTS5 indexes for messages, knowledge, documents and research |
| Browser layer | `localStorage` (`davidai:` keys) | UI settings, datasets, checkpoints, training and learning records |
| Local chat | `models/llm/`, `bin/llama-cpp/` | FTS5 and optional MiniLM embedding retrieval, then Qwen2.5 1.5B Q4_K_M inference through llama.cpp on CPU |
| Local images | `bin/sd-cpp/`, `models/*.gguf` | CPU stable-diffusion.cpp generation and upscaling with free local GGUF weights |
| Local video | `src/lib/video/`, `data/videos/` | Real AI keyframes, deterministic CPU motion frames and VP8 WebM muxing through the bundled stable-diffusion.cpp DGL encoder; no video diffusion model is installed |

Normal chat retrieves from the SQLite brain, optionally reranks with local MiniLM embeddings, and asks the installed local Qwen model. In strict mode it refuses when there is no relevant local context instead of inventing an answer. A small from-scratch word-level model and retrieval fallback remain available as local training experiments; they are not an external provider.

## Pages

| Route | Purpose |
| --- | --- |
| `/` | Dashboard: status, counts and activity |
| `/chat` | AI Chat with local retrieval, Qwen answers and opt-in web research |
| `/image` | Local image generation, local keyframe WebM animation, upscaling and visual knowledge |
| `/datasets` | Upload or paste local training text |
| `/architecture` | Configure the from-scratch model |
| `/training` | Train the local word-level model |
| `/internet-study` | Opt-in web study saved into local knowledge |
| `/monitor` | Activity traces, timings and statuses |
| `/evaluation` | Deterministic local component and language-model evaluation |
| `/dictionary` | Bundled and user dictionary entries |
| `/memory` | Persisted memory categories and recall |
| `/learning` | Review feedback, corrections and retraining |
| `/sandbox` | Isolated local experiments and labelled hypotheses |
| `/checkpoints` | Save, validate and restore snapshots |
| `/experiments` | Record and compare runs |
| `/knowledge` | Local knowledge base |
| `/settings` | Toggles, model status, export/import and reset |

## Network behavior

- With Web Search and Research mode off, chat, image generation and video generation use local files, binaries and databases; no external AI request is made.
- Enabling **Web Search** or **Research mode** in chat, or using **Internet Study**, calls the local `/api/research/search` and `/api/research/read` routes. Those routes perform real HTTP requests to external sources and save useful findings locally.
- Image reference lookup is opt-in and uses **Wikimedia Commons only**, including source/license metadata. It is not a general web image search.
- `npm run setup:image` is the explicit download step for image models; it runs only when invoked.
- No external LLM provider is used at runtime. The legacy `/api/chat` provider variables in `.env.example` are inactive.

## Local video capability

The Image page can create a playable `.webm` while it creates images. Each run renders two to four **real local diffusion keyframes** from the same prompt, interpolates deterministic pan/zoom crossfades on the CPU, and muxes the frames with the `video::encode` / `media::save` functions in the bundled stable-diffusion.cpp binary. Video and image generation share the single local render slot, support cancellation, and save prompt, model, seed, keyframe IDs, settings and encoder provenance.

This is **AI-image animation, not text-to-video**: there is no local video diffusion checkpoint installed. The UI and exported records say so explicitly. No external video service, ffmpeg installation, account, or API key is used.

## Training and learning

The from-scratch word-level Transformer is trained only from local datasets, knowledge, dictionary entries and approved corrections. Feedback and corrections are reviewable in **Learning System**; explicit retrain buttons update weights, while approval alone only changes retrieval metadata.

For longer runs, `scripts/run-trainer.mjs` can train the same engine in Node without a browser tab:

```bash
npm run train:word
npm run eval:word
```

See those script flags for corpus paths, steps, resume files and output checkpoints. Brain/data and model binaries are runtime assets, not source code.

## Storage, export and privacy

- Datasets, settings, image history, video history, training/learning records and checkpoints live in browser `localStorage`; generated WebMs and their metadata live in `data/videos/`; conversations, extracted knowledge, documents, corrections and research live in `data/brain/brain.sqlite`.
- **AI Settings** provides JSON export/import and a full local reset; brain-specific export/import/backup routes also exist.
- No data is sent to an external AI provider, and there are no keys to expose. When web research is explicitly enabled, search queries and fetched URLs necessarily reach the selected external sources.

## Validation

```bash
npm test -- --run
npx tsc --noEmit
npm run build
```

The suite covers database persistence, retrieval, chat flows, image generation, settings and the local research helpers. Run `npm test` for the current count.

## Limits

- The from-scratch word model is small and not fluent; the installed local Qwen GGUF is the primary chat engine.
- Strict offline memory can return a refusal when no local evidence matches.
- Local video is keyframe animation capped at four AI renders, 96 output frames and 384 px on this CPU; it is not true text-to-video.
- `data/`, `models/` and `bin/` are ignored local runtime directories. Restoring a clone requires recreating or copying those assets before chat/image features are ready.
- The bundled llama.cpp and stable-diffusion.cpp executables are platform-specific; the current bundle in `bin/` is the Windows `.exe`/`.dll` build.
