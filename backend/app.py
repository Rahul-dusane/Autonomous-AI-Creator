import os
import uuid
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from psycopg.types.json import Json

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

app = FastAPI(title="Autonomous AI Creator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_database_url():
    return os.getenv("DATABASE_URL") or os.getenv("DB_URL")


def get_db_connection():
    db_url = get_database_url()
    if not db_url:
        raise RuntimeError("DATABASE_URL is not configured")
    return psycopg.connect(db_url, autocommit=True)


def ensure_schema():
    connection = get_db_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS agents (
                    id VARCHAR(255) PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    domain VARCHAR(255) NOT NULL,
                    persona_profile JSONB DEFAULT '{}'::jsonb,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    CONSTRAINT unique_agent_name_domain UNIQUE (name, domain)
                );
                """
            )
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS posts (
                    id VARCHAR(255) PRIMARY KEY,
                    agent_id VARCHAR(255) NOT NULL,
                    text TEXT NOT NULL,
                    rationale TEXT NOT NULL,
                    sources JSONB NOT NULL DEFAULT '[]'::jsonb,
                    media_type VARCHAR(50) DEFAULT 'none',
                    media_url TEXT,
                    platform_metadata JSONB DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    CONSTRAINT fk_posts_agent
                        FOREIGN KEY (agent_id)
                        REFERENCES agents(id)
                        ON DELETE CASCADE
                );
                """
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_posts_agent_created ON posts (agent_id, created_at DESC);"
            )
    finally:
        connection.close()


@app.on_event("startup")
def startup_event():
    try:
        ensure_schema()
    except Exception as exc:
        print(f"[DB] Schema initialization failed: {exc}")


@app.get("/ping")
def ping():
    return "pong"


@app.get("/health")
def health_check():
    db_url = get_database_url()
    is_configured = bool(db_url)
    db_ok = False

    if is_configured:
        try:
            with get_db_connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT 1")
                    db_ok = True
        except Exception as exc:
            print(f"[DB] Health check failed: {exc}")
            db_ok = False

    return {
        "status": "ok",
        "database_configured": is_configured,
        "database_connected": db_ok,
    }


@app.get("/api/agent/feed")
def get_feed(agentId: str):
    try:
        with get_db_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT id, text, rationale, sources, media_type, media_url, platform_metadata, created_at
                    FROM posts
                    WHERE agent_id = %s
                    ORDER BY created_at DESC
                    """,
                    (agentId,),
                )
                rows = cursor.fetchall()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Database error while fetching feed: {exc}") from exc

    posts = []
    for row in rows:
        posts.append(
            {
                "id": row[0],
                "text": row[1],
                "rationale": row[2],
                "sources": row[3] or [],
                "mediaType": row[4] or "none",
                "mediaUrl": row[5],
                "platformMetadata": row[6] or {},
                "createdAt": row[7].isoformat() if row[7] else None,
            }
        )

    return {"agentId": agentId, "posts": posts}


@app.post("/api/agent/init")
def init_agent(payload: dict):
    try:
        persona = payload.get("persona") or {}
        name = str(persona.get("name", "")).strip()
        domain = str(persona.get("domain", "")).strip()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid request payload: {exc}") from exc

    if not name or not domain:
        raise HTTPException(status_code=400, detail='"persona.name" and "persona.domain" are required')

    try:
        persona_profile = dict(payload.get("persona") or {})
        persona_profile.setdefault("name", name)
        persona_profile.setdefault("domain", domain)

        with get_db_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT id FROM agents WHERE name = %s AND domain = %s LIMIT 1",
                    (name, domain),
                )
                existing = cursor.fetchone()

                if existing:
                    agent_id = existing[0]
                else:
                    agent_id = f"agent-{uuid.uuid4().hex[:8]}"
                    cursor.execute(
                        "INSERT INTO agents (id, name, domain, persona_profile, is_active, created_at, updated_at) VALUES (%s, %s, %s, %s, TRUE, NOW(), NOW())",
                        (agent_id, name, domain, Json(persona_profile)),
                    )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Database error while creating agent: {exc}") from exc

    return {"status": "initialized", "agentId": agent_id}
