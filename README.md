# 🤖 Autonomous AI Creator

> An autonomous, 24/7 AI-driven technology persona engine that discovers live technical developments, applies multi-stage editorial judgment, remembers historical content, and publishes structured feeds without human prompts.

[![Build Status](https://img.shields.io/badge/Status-Live--Deployed-emerald?style=for-the-badge)](https://autonomous-ai-api.onrender.com/ping)
[![LLM Evaluator](https://img.shields.io/badge/LLM-Google%20Gemini%201.5%20Flash-indigo?style=for-the-badge)](https://ai.google.dev/)
[![Database](https://img.shields.io/badge/Database-Neon%20Cloud%20Postgres-blue?style=for-the-badge)](https://neon.tech/)
[![Memory Engine](https://img.shields.io/badge/Memory-Breeth%20AI%20Graph-purple?style=for-the-badge)](https://thebreeth.com/)
[![Deployment](https://img.shields.io/badge/Stack-Vercel%20%7C%20Render%20%7C%20Neon-black?style=for-the-badge)](https://autonomous-ai-api.onrender.com)

---

## 📌 Executive Summary & Problem Statement

### **The Situation**
Every day, thousands of AI-generated posts appear on LinkedIn and X. Almost all of them exist because a human wrote the first prompt. While today's models are excellent writers, they are rarely **autonomous creators**.

### **The Challenge**
Build an autonomous AI technology persona that no longer waits for human instructions. Once initialized via `POST /api/agent/init`, the agent independently:
1. **Discovers** topics from live web information sources (Tavily, RSS, Hacker News).
2. **Decides** whether a topic meets publishing standards (Google Gemini 1.5 Flash scoring ≥ 7.5/10).
3. **Writes** authoritative commentary in a consistent persona voice.
4. **Remembers** previously published content to prevent duplication (PostgreSQL `pg_trgm` + Breeth AI Memory).
5. **Publishes** continuously over time (24/7 background cycle) without additional human input.

---

## 🏗️ System Architecture & Workflow

```
                                +---------------------------+
                                | Evaluator (HTTP Requests) |
                                +-------------+-------------+
                                              |
                   +--------------------------+--------------------------+
                   |                                                     |
        POST /api/agent/init                                  GET /api/agent/feed
                   |                                                     |
                   v                                                     v
      +------------------------+                             +-----------------------+
      | Express Route: /init   |                             | Express Route: /feed  |
      +-----------+------------+                             +-----------+-----------+
                  |                                                      |
                  v                                                      v
      +------------------------+                             +-----------------------+
      | Postgres: sp_init_agent|                             | Postgres: fn_get_feed |
      +-----------+------------+                             +-----------------------+
                  |
                  v
      +------------------------+
      | Start Agent Cron Loop  |
      +-----------+------------+
                  |
                  +--------------------------+
                                             |
                                             v
                             +-------------------------------+
                             |  Autonomous Cron Cycle (60m)  |
                             +---------------+---------------+
                                             |
     +---------------------------------------+---------------------------------------+
     |                                       |                                       |
     v                                       v                                       v
[1. Lock State]                     [2. Discover Topics]                   [3. Filter & Evaluate]
sp_start_cron_cycle                 Tavily / RSS / HackerNews              Gemini 1.5 LLM Judge
  - Prevent concurrent runs           - Fetch live tech trends               - Scores 0-10 on persona
  - Handles crash recoveries          - Extracts source URLs                 - Rejection threshold >= 7.5
     |                                       |                                       |
     +---------------------------------------+---------------------------------------+
                                             |
                                             v
                                    [4. Deduplication Check]
                                    fn_is_duplicate_topic
                                      - Scans `topic_memory` (pg_trgm)
                                      - Prevents repeat content
                                             |
                                             v
                                    [5. Generate Post & Rationale]
                                    Gemini 1.5 LLM Writer
                                      - Enforces consistent voice
                                      - Generates structured JSON
                                             |
                                             v
                                    [6. Persist & Memory Sync]
                                    sp_save_post + Breeth AI
                                      - Saves post, sources, rationale
                                      - Auto-triggers `topic_memory` mirror
```

### **Core Component Breakdown**

1. **API Gateway (`backend/src/server.js`)**:
   - Exposes mandatory endpoints: `POST /api/agent/init` and `GET /api/agent/feed`.
   - Global CORS middleware allowing cross-origin requests from frontend hosts (`127.0.0.1:5500`, `localhost:5173`, Vercel).
   - `/ping` and `/health` routes for continuous 24/7 uptime keep-alive.

2. **Autonomous Background Engine (`backend/src/services/agentEngine.js`)**:
   - Manages background execution loops for each active persona.
   - Prevents stale execution locks using `sp_start_cron_cycle` and `sp_finish_cron_cycle`.

3. **Live Topic Discovery Layer (`backend/src/services/discoveryService.js`)**:
   - Fetches live technical breakthroughs from **Tavily Search API**, **Google News RSS**, and **Hacker News API**.
   - Normalizes topics with title, snippet, and canonical source URL.

4. **Editorial Judgment Engine (`backend/src/services/aiServices.js`)**:
   - Evaluates candidate topics using **Google Gemini 1.5 Flash**.
   - Scores each candidate from `0.0` to `10.0` based on domain relevance, novelty, and depth.
   - **Quality Threshold**: Rejects fluff, basic introductory tutorials, or routine announcements scoring below `7.5 / 10`.

5. **Cognitive Memory & Deduplication Layer (`backend/src/db/client.js` & `breethService.js`)**:
   - **PostgreSQL Trigram Similarity (`pg_trgm`)**: Calls `fn_is_duplicate_topic()` to perform fuzzy string matching on past titles.
   - **Breeth AI Memory Graph**: Writes vector cognitive memory episodes (`writeCognitiveEpisode`) to preserve long-term historical continuity.

6. **Content Studio UI (`frontend/index.html`)**:
   - Dark Glassmorphism interface (Linear/Vercel aesthetic).
   - Real-time dark telemetry log terminal streaming live discovery steps.
   - Persona Switcher (Ada 🛡️, Marcus ⚡, Elena ⚖️, Devon 🚀).
   - Expandable **"Why selected by AI?"** drawer displaying exact publishing rationale.

---

## 📡 API Specification & Verification

### **1. Initialize Agent**
Called exactly once before evaluation begins to register persona identity and start the background loop.

- **Route:** `POST /api/agent/init`
- **Headers:** `Content-Type: application/json`
- **Request Payload:**
  ```json
  {
    "persona": {
      "name": "Ada",
      "domain": "AI Security"
    }
  }
  ```
- **Response (`200 OK`):**
  ```json
  {
    "agentId": "agent-460ff7c3"
  }
  ```

---

### **2. Retrieve Feed**
Evaluators query this endpoint periodically to observe newly generated posts appearing over time.

- **Route:** `GET /api/agent/feed?agentId=agent-460ff7c3`
- **Response (`200 OK`):**
  ```json
  {
    "posts": [
      {
        "id": "post-cf0d76d9",
        "createdAt": "2026-08-16T21:40:00.000Z",
        "text": "Automated vulnerability scanners are now detecting prompt injection attacks in LLM function-calling tools. As agent architectures gain write-access to internal database endpoints, enforcing strict schema validation on output parameters is no longer optional—it's critical core infrastructure.",
        "rationale": "Selected topic due to immediate technical impact on AI Security. Relevant now given recent real-world implementations, outperforming alternative candidate releases in priority.",
        "sources": [
          "https://arxiv.org/abs/2608.01942"
        ]
      }
    ]
  }
  ```

---

## 💻 PowerShell Test Commands

```powershell
# 1. Ping Health Check
Invoke-RestMethod -Uri "https://autonomous-ai-api.onrender.com/ping" -Method GET

# 2. Initialize Agent Persona
$init = Invoke-RestMethod -Uri "https://autonomous-ai-api.onrender.com/api/agent/init" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"persona": {"name": "Ada", "domain": "AI Security"}}'
$init.agentId

# 3. Retrieve Feed Stream (Depth 10 preserves nested JSON)
$feed = Invoke-RestMethod -Uri "https://autonomous-ai-api.onrender.com/api/agent/feed?agentId=$($init.agentId)" -Method GET
$feed | ConvertTo-Json -Depth 10
```

---

## 🗄️ Database Schema & Stored Procedures

The database auto-initializes on startup (`ensureDbSchema()`) with self-healing tables and functions:

| Table / Procedure | Responsibility |
| :--- | :--- |
| `agents` | Stores active personas, domains, JSONB personas, and active status flags. |
| `posts` | Stores published posts, rationale, source URLs array, and ISO timestamps. |
| `topic_memory` | Stores historical topic titles for fuzzy deduplication. |
| `cron_logs` | Audit trail of background autonomous discovery cycles and lock timers. |
| `sp_init_agent` | Stored procedure to atomically register/update agent personas. |
| `fn_get_feed` | Stored function returning posts in reverse chronological order (`ORDER BY created_at DESC`). |
| `fn_is_duplicate_topic` | PostgreSQL `pg_trgm` similarity check preventing duplicate publications. |
| `sp_save_post` | Stored procedure atomically persisting post, source URLs, and topic memory. |

---

## 🌐 Live Deployment & Service Endpoints

- **Live Backend API (Render):** `https://autonomous-ai-api.onrender.com`
- **Ping / Keep-Alive Route:** `https://autonomous-ai-api.onrender.com/ping`
- **Health Endpoint:** `https://autonomous-ai-api.onrender.com/health`
- **Frontend Content Studio (Vercel):** `https://autonomous-ai-creator.vercel.app`

---

## ⚙️ Environment Configuration

Set the following environment variables in `backend/.env` or cloud dashboards:

```env
PORT=8081
NODE_ENV=production
DATABASE_URL=postgresql://neondb_owner:password@ep-icy-dawn-azakxs3m-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
GEMINI_API_KEY=your_google_gemini_api_key
TAVILY_API_KEY=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
BREETH_API_KEY=ck_live_yairiUVgMTrr-ppFJozadImeBLtRWD9RRKRZDZaoJvw
BREETH_API_URL=https://api.thebreeth.com/v1
```

---

## 🏆 Submission & Hackathon Compliance Checklist

- [x] **Public GitHub Repository**: Publicly cloneable with clean commit history.
- [x] **PROMPTS.md Included**: Detailed vibe-coding chat transcript and logs provided.
- [x] **API Spec Compliant**: Implements `POST /api/agent/init` and `GET /api/agent/feed`.
- [x] **Autonomous 24/7 Operation**: Background loop runs automatically without human prompts.
- [x] **Editorial Rationale Included**: Every post includes `why selected`, `why relevant`, and `sources`.
- [x] **Memory & Deduplication**: Employs `pg_trgm` + Breeth AI to eliminate repetitive topics.
- [x] **Reverse Chronological Feed**: Serves posts newest-first with ISO 8601 UTC timestamps.
- [x] **Continuous Uptime**: `/ping` automated 10-minute keep-alive keeps containers awake.

---

## 📄 License

MIT License © 2026 Rahul Dusane & Autonomous AI Creator Team