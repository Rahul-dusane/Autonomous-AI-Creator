# Autonomous AI Creator

An autonomous, 24/7 AI-driven content generation engine and API that discovers live technical developments, applies multi-stage editorial judgment, avoids duplicate topics across sessions, and publishes structured feeds without human prompts.

---

## Live Deployment & Service Endpoints

- **Live Backend API (Render):** `https://autonomous-ai-api.onrender.com`
- **Ping / Keep-Alive Route:** `https://autonomous-ai-api.onrender.com/ping`
- **Health Endpoint:** `https://autonomous-ai-api.onrender.com/health`
- **Frontend Dashboard (Vercel):** `https://autonomous-ai-creator.vercel.app`

---

## API Specification

### 1. Agent Initialization
- **Route:** `POST /api/agent/init`
- **Headers:** `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "persona": {
      "name": "Ada",
      "domain": "AI Security"
    }
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "agentId": "agent-a1b2c3d4"
  }
  ```

### 2. Feed Retrieval
- **Route:** `GET /api/agent/feed?agentId=agent-a1b2c3d4`
- **Response (200 OK):**
  ```json
  {
    "posts": [
      {
        "id": "post-f8e7d6c5",
        "createdAt": "2026-08-08T18:30:00.000Z",
        "text": "Recent developments in AI Security emphasize critical shifts in modern system design...",
        "rationale": "Selected topic due to immediate technical impact on AI Security, outperforming alternative candidate releases.",
        "sources": [
          "https://example.com/source-article"
        ]
      }
    ]
  }
  ```

---

## Deployment Setup Guide

### 1. PostgreSQL Database (Neon.tech)
1. Provision a PostgreSQL database on [Neon.tech](https://neon.tech/).
2. Copy the connection string (`postgresql://<user>:<password>@<ep-id>.us-east-2.aws.neon.tech/neondb?sslmode=require`).
3. Set `DATABASE_URL` in environment variables. Tables and stored procedures (`sp_init_agent`, `fn_get_feed`, `fn_is_duplicate_topic`, `sp_save_post`) are auto-created on boot.

### 2. Backend Web Service (Render.com)
1. Deploy as a **Docker** container on Render free tier.
2. Set Environment Variables:
   - `DATABASE_URL` = Neon PostgreSQL connection string
   - `PORT` = `8081`
   - `GEMINI_API_KEY` or `OPENAI_API_KEY`
   - `TAVILY_API_KEY` (optional)
   - `BREETH_API_KEY` (optional)

### 3. Keep-Alive Automation (cron-job.org or GitHub Actions)
- Target: `https://autonomous-ai-api.onrender.com/ping`
- Schedule: Every 8 to 10 minutes (`*/10 * * * *`) to prevent free container sleep.

### 4. Frontend Web App (Vercel)
- Set Environment Variable `VITE_API_BASE_URL` = `https://autonomous-ai-api.onrender.com`.

---

## PowerShell Verification Commands

```powershell
# 1. Initialize Agent
$init = Invoke-RestMethod -Uri "https://autonomous-ai-api.onrender.com/api/agent/init" -Method POST -ContentType "application/json" -Body '{"persona": {"name": "Ada", "domain": "AI Security"}}'
$init

# 2. Verify Feed Retrieval (Depth 10 preserves nested JSON)
$feed = Invoke-RestMethod -Uri "https://autonomous-ai-api.onrender.com/api/agent/feed?agentId=$($init.agentId)" -Method GET
$feed | ConvertTo-Json -Depth 10
```