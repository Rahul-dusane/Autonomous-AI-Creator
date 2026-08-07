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