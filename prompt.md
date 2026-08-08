# Autonomous AI Creator — AI Log (Overview)

Date: 2026-08-07  
Author: Autonomous AI Creator (conversion log)

Purpose
- Capture the full design and 36-hour execution plan as a set of Markdown AI logs for implementation, review, and handoff.
- Provide clear, timestamped entries that document architecture, implementation steps, API spec, DB schema, software requirements, and security considerations.

What this collection contains
- System architecture diagram and component responsibilities
- 36-hour execution roadmap broken into hour blocks
- Database schema and future-proofing notes (JSONB)
- Software and package installation checklist
- Autonomous workflow (fetch → evaluate → publish) and scheduler details
- API spec for the required endpoints and sample responses
- Security, rate-limiting, vulnerability and extensibility notes
- Sample feed response and formatting rules

How to use
- Read 01_system_architecture.md and 02_execution_plan_36h.md to begin implementation.
- Provision a PostgreSQL (Supabase) instance and create the DB schema in 03_database_schema.md.
- Install the tools in 04_technical_stack_and_installation.md and run the sample server described in 07_api_spec.md.
- Use 06_security_and_futureproofing.md to harden and extend the system.


# System Architecture — AI Log

Date: 2026-08-07

Goal
- Build an autonomous agent that discovers topics, exercises editorial judgment, remembers published items, and publishes over time without human input.

High-level diagram (ASCII)
                ┌──────────────────────────────────────────────┐
                │          Evaluator / API Client              │
                └──────┬────────────────────────────────┬──────┘
                       │                                │
       POST /api/agent/init                    GET /api/agent/feed
                       │                                │
                       ▼                                ▼
           ┌──────────────────────┐          ┌────────────────────┐
           │   FastAPI / Express  │          │   PostgreSQL DB    │
           │     API Gateway      │          │   (Feed & Memory)  │
           └───────────┬──────────┘          └────────────────────┘
                       │                                ▲
                       ▼                                │
           ┌──────────────────────┐                     │
           │  APScheduler / Cron  ├─────────────────────┘
           │  Background Worker   │  Saves New Posts
           └───────────┬──────────┘
                       │
    ┌──────────────────┼───────────────────┐
    ▼                  ▼                   ▼
┌──────────────┐ ┌──────────────┐ ┌───────────────────┐
│ Live RSS /   │ │ LLM Engine   │ │ Vector DB /       │
│ HackerNews   │ │ (Gemini/LLM) │ │ Memory Registry   │
│ Scraper      │ │              │ │ (Deduplication)   │
└──────────────┘ └──────────────┘ └───────────────────┘

Components and responsibilities
- API Gateway (FastAPI or Express)
  - Endpoints: POST /api/agent/init, GET /api/agent/feed
  - Starts/stops agent scheduler per agent
- Background Worker (APScheduler or node-cron)
  - Periodically runs discovery → editorial evaluation → generation → persist
- Topic Discovery Layer
  - Scrapers and RSS readers: Hacker News, TechCrunch AI RSS, arXiv, VentureBeat, other RSS/APIs
  - Normalizes candidate list with title, link, short summary, timestamp
- Editorial Judgment Engine (LLM)
  - Input: persona + candidate list + recent memory
  - Output: structured JSON (should_publish, selected_topic, text, rationale, sources, rejection_reasons)
- Memory & Deduplication
  - Vector DB or hashing table to detect repeats/similarity (topic_memory)
- Storage
  - PostgreSQL (Supabase) with JSONB platform_metadata
- Publisher Adapters
  - MockFeedAdapter (for the hackathon feed)
  - Adapter pattern for future LinkedIn, Instagram, YouTube, etc.

Design principles
- Fail-safe: external failures are contained; do not crash the core service.
- Future-proof DB: JSONB column for flexible metadata.
- Modular: core AI logic separated from publishing adapters.
- Autonomous: scheduler runs independently from evaluator calls.


# 36-Hour Execution Roadmap — AI Log

Date: 2026-08-07

Objective
- Build and deploy a working Autonomous AI Creator in 36 hours that meets the submission requirements.

Summary timeline
Hours 0 – 6: Database & API Setup
- Initialize project repo (FastAPI or Express)
- Create database schemas (agents, posts, topic_memory)
- Implement endpoints:
  - POST /api/agent/init → create agent, start scheduler
  - GET /api/agent/feed?agentId=... → return posts DESC
- Add minimal logging and health check

Hours 6 – 18: Topic Discovery & Editorial LLM Pipeline
- Implement discovery fetchers:
  - HackerNews TopStories, TechCrunch AI RSS, arXiv feed, other RSS endpoints
- Normalize candidate topics (title, url, summary, published_at)
- Implement prompt templates and LLM call (Gemini/other) for editorial judgment:
  - Provide persona, last N posts, 8–12 candidates
  - Enforce structured JSON output from LLM
- Implement generator for full post text + rationale + sources

Hours 18 – 28: Memory, Deduplication, Scheduler
- Implement topic similarity checks:
  - Option A: fingerprinting / title hash + fuzzy matching
  - Option B: embedding similarity via vector DB (optional)
- Integrate APScheduler/node-cron to run the loop every 1–2 hours
- Add format enforcer: ISO 8601 UTC timestamps, unique post IDs

Hours 28 – 36: Testing, Resilience & Deploy
- Run accelerated simulation test (jobs every 5 minutes) for 6 hours
- Edge cases:
  - Empty candidate lists
  - LLM timeouts / failures
  - DB outages
- Deploy to free host (Render / Vercel / Cloud Run)
- Configure cron-job.org (if using free external scheduler) as a safety net

Deliverables after 36 hours
- Working API with persistent posts
- Background autonomous runner generating posts over time
- Documentation (this log set) and DB schema
- Deployment scripts (Dockerfile or cloud configuration)


# Technical Stack & Installation — AI Log

Date: 2026-08-07

Recommended stack
- Backend: Python (FastAPI) OR Node.js (Express)
  - Python pros: feedparser, APScheduler, robust typing
  - Node pros: quick deploys on Vercel/Render, npm ecosystem
- Database: Supabase (PostgreSQL) or managed Postgres
- LLM: Google Gemini via @google/genai OR other LLM provider (OpenAI, Anthropic)
- Scheduler: APScheduler (Python) or node-cron (Node.js)
- Vector DB (optional): Pinecone, Milvus, or Supabase vector extension
- Hosting: Render, Vercel, Railway, or Cloud Run

Software to install locally
- Node.js v20+ (if Node route)
- Python 3.10+ (if Python route)
- Git
- Docker Desktop (optional for local Postgres)
- VS Code
- Postman/Insomnia

Example Node.js install commands (project setup)
npm init -y
npm install express rss-parser axios node-cron @supabase/supabase-js dotenv cors
npm install --save-dev nodemon

Example Python install commands (project setup)
python -m venv venv
source venv/bin/activate
pip install fastapi uvicorn feedparser requests apscheduler psycopg[binary] python-dotenv

Environment variables (required)
- DATABASE_URL (postgres)
- SUPABASE_URL / SUPABASE_KEY (if using Supabase)
- LLM_API_KEY (Gemini/OpenAI)
- CRON_SCHEDULE (optional)
- LOG_LEVEL

Dev tips
- Use Docker Compose to run a local Postgres for integration tests.
- Keep secrets out of the repo; use .env or cloud secret stores.




Key data stores:
- agents(id, name, domain, created_at)
- posts(id, agent_id, created_at, text, rationale, sources JSONB, platform_metadata JSONB)
- topic_memory(topic_title, topic_hash/embedding, created_at)

Timestamps: store and return ISO 8601 UTC.

---

## Execution priorities (what to do first — condensed 36-hour priorities)
Top priorities (do these first):
1. Implement POST /api/agent/init (idempotent) and GET /api/agent/feed (reverse-chronological).
2. Stand up DB schema (Supabase/Postgres) with JSONB platform_metadata and topic_memory.
3. Implement discovery fetchers (HackerNews, TechCrunch RSS, arXiv).
4. Integrate editorial LLM pipeline that returns structured JSON (should_publish, selected_topic, text, rationale, sources, rejection_reasons).
5. Implement semantic deduplication (Breeth or embeddings) — critical: must work.
6. Add background scheduler (node-cron or APScheduler) and redundant external trigger (cron-job.org + GitHub Actions).
7. Run accelerated simulation (jobs every 5 minutes) to validate autonomy, memory, and persistence.

Lower priority (only if time allows or post-hackathon):
- Full multi-platform OAuth posting + media generation (image/gif/video).
- Extensive adapter testing and platform approval flows.

---

## Risks, unresolved gaps, and mitigations
1. Single-trigger dependency (cron-job.org): add GitHub Actions scheduled workflow as a backup.
2. Breeth integration unverified: verify Breeth endpoints now — this is the single biggest risk to "memory" scoring.
3. Dedup method unclear: ensure semantic similarity (not only exact title match). Use embeddings or Breeth semantic check.
4. Hosting sleep-asleep problem: free hosts that sleep break autonomy. Use persistent runner (Cloud Run, Render with background worker) or rely on external pings plus health checks.
5. LLM hallucination / invalid JSON: enforce strict JSON schema in prompts and validate outputs before saving.
6. Real-platform posting approvals: OAuth + platform review can delay or block real posting. Use DRY_RUN flag per platform to avoid blocking autonomy.

---

## Tech stack (real posting + media — full option)
Choose the stack that matches your priorities. The minimal viable hackathon stack focuses on judged items; the full stack below supports real posting and media generation.

Recommended core:
- Backend: Node.js + Express (fast to wire OAuth + SDKs) or Python + FastAPI
- DB: Postgres (Supabase) — JSONB for platform metadata
- Scheduler: node-cron (Node) or APScheduler (Python)
- LLM: Google Gemini (@google/genai) or OpenAI
- Memory/dedup: Breeth MCP OR embeddings stored in vector DB (Pinecone / Supabase vector)
- Storage: Supabase Storage or Cloudflare R2
- Containerization: Docker (optional)
- Hosting: Cloud Run / Render / Railway (ensure background worker stays awake)

Media generation (real):
- Images: Gemini Image / Imagen / Stability
- GIFs: generate image sequence + gif encoder (gif-encoder-2 / sharp)
- Video: Veo API or assemble images + audio via ffmpeg / Remotion

Platform posting & OAuth:
- LinkedIn: LinkedIn REST API + OAuth 2.0 (Share API)
- Instagram: Meta Graph API (instagram_content_publish, requires business account + review)
- YouTube: YouTube Data API v3 (Google OAuth, verification may be required)
- X/Twitter: twitter-api-v2 (developer account & appropriate access)

---

## Libraries to install (Node example)
Install the minimal + real-posting/media packages:
npm init -y
npm install express dotenv cors zod uuid axios rss-parser node-cron
npm install @supabase/supabase-js pg
npm install @google/genai             # Gemini text & image
npm install gif-encoder-2 sharp fluent-ffmpeg
npm install passport passport-oauth2 express-session
npm install googleapis twitter-api-v2
# Optional:
npm install replicate                 # alternative image/video models
npm install --save-dev nodemon

Docker tips: ensure ffmpeg is installed in the image (apt-get install ffmpeg).

Environment variables to set:
- DATABASE_URL / SUPABASE_URL / SUPABASE_KEY
- LLM_API_KEY
- OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET for each platform
- CRON_SCHEDULE
- DRY_RUN per platform flag
- LOG_LEVEL

---

## OAuth & real-platform posting caveats (plainly stated)
- Each platform requires developer app registration and may require app review/verification before real posting is allowed. This is often outside your control and can take days.
- Do not let OAuth approval delays block your autonomous feed during evaluation. Implement a DRY_RUN mode so adapters are ready but safely log "would post" until the platform is approved.
- Storing tokens: use secure secret storage (do not commit tokens). Prefer encrypted DB columns or secret managers.
- Rate limits & account risk: automated posting can trigger platform defenses. Add throttling, per-account quotas, and retry/backoff.

Practical approach: Build real adapters + OAuth flow so the system is ready; protect with DRY_RUN until each platform is certified.

---

## Things to keep in mind (from our discussion)
- Focus on what's judged: autonomy, editorial judgment, persona, memory, rationale, and feed quality.
- Do not add human checkpoints that block publishing — agent must operate without human prompts after init.
- Add redundancy for triggers to avoid single points of failure.
- Validate memory/dedup now — it's central to scoring.
- Keep post schema flexible (platform_metadata JSONB) so adding platforms later requires no table rewrites.
- If you insist on real media posting, accept the external approval risk and use DRY_RUN until approvals arrive.

---

## Next steps — choose one to start now
I can begin scaffolding either of these two urgent subsystems. Pick one and I will start immediately and provide code scaffolding and integration steps:

1) OAuth adapter + real-posting scaffold (recommendation: LinkedIn first — usually fastest to get an app approved).  
   - I will scaffold: OAuth routes, token storage, adapter interface, DRY_RUN behavior, and a test "post" flow.

2) Media generation layer (images / GIFs / short video)  
   - I will scaffold: image generation calls to Gemini/other provider, gif pipeline (image sequence → gif), ffmpeg-based short video assembly, and storage/upload hooks.

Which do you want me to scaffold first: OAuth adapter (LinkedIn) or Media generation layer?  
(If you want both, tell me priority and I’ll start with the highest-priority scaffold and follow with the second.)

---