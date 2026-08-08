import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

app = FastAPI(title="Autonomous AI Creator API")


def get_database_url():
    return os.getenv("DATABASE_URL") or os.getenv("DB_URL")


@app.get("/health")
def health_check():
    db_url = get_database_url()
    return {
        "status": "ok",
        "database_configured": bool(db_url),
    }


@app.get("/api/agent/feed")
def get_feed():
    return {"agentId": "demo-agent", "posts": []}


@app.post("/api/agent/init")
def init_agent():
    return {"status": "initialized", "agentId": "demo-agent"}
