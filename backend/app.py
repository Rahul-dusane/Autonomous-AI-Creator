import os
from fastapi import FastAPI

app = FastAPI(title="Autonomous AI Creator API")


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "database_configured": bool(os.getenv("DATABASE_URL")),
    }


@app.get("/api/agent/feed")
def get_feed():
    return {"agentId": "demo-agent", "posts": []}


@app.post("/api/agent/init")
def init_agent():
    return {"status": "initialized", "agentId": "demo-agent"}
