-- Autonomous AI Creator - Production PostgreSQL Database Initialization
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 1. Agents Table
CREATE TABLE IF NOT EXISTS agents (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255) NOT NULL,
    persona JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_agent_name_domain UNIQUE (name, domain)
);

-- 2. Posts Table
CREATE TABLE IF NOT EXISTS posts (
    id VARCHAR(255) PRIMARY KEY,
    agent_id VARCHAR(255) NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    rationale TEXT NOT NULL,
    sources JSONB NOT NULL DEFAULT '[]'::jsonb,
    media_type VARCHAR(50) DEFAULT 'none',
    media_url TEXT,
    platform_metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_posts_agent_created ON posts (agent_id, created_at DESC);

-- 3. Topic Memory Table (for Deduplication)
CREATE TABLE IF NOT EXISTS topic_memory (
    id SERIAL PRIMARY KEY,
    agent_id VARCHAR(255) NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    topic_title TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_topic_memory_agent_title ON topic_memory (agent_id, topic_title);

-- 4. Cron Execution Logs Table (Concurrency & Crash Recovery)
CREATE TABLE IF NOT EXISTS cron_logs (
    id SERIAL PRIMARY KEY,
    agent_id VARCHAR(255) NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    is_running BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(50) DEFAULT 'running',
    message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cron_logs_agent ON cron_logs (agent_id, started_at DESC);

-- -------------------------------------------------------------
-- Stored Procedures & Functions
-- -------------------------------------------------------------

-- Procedure: Init or re-activate agent
CREATE OR REPLACE PROCEDURE sp_init_agent(
    p_id VARCHAR(255),
    p_name VARCHAR(255),
    p_domain VARCHAR(255),
    p_persona JSONB
)
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO agents (id, name, domain, persona, is_active, created_at, updated_at)
    VALUES (p_id, p_name, p_domain, p_persona, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name,
        domain = EXCLUDED.domain,
        persona = EXCLUDED.persona,
        is_active = TRUE,
        updated_at = CURRENT_TIMESTAMP;
END;
$$;

-- Function: Retrieve Feed for Agent
CREATE OR REPLACE FUNCTION fn_get_feed(p_agent_id VARCHAR(255))
RETURNS TABLE (
    id VARCHAR(255),
    text TEXT,
    rationale TEXT,
    sources JSONB,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT p.id, p.text, p.rationale, p.sources, p.created_at
    FROM posts p
    WHERE p.agent_id = p_agent_id
    ORDER BY p.created_at DESC;
END;
$$;

-- Procedure: Start Cron Execution Lock
CREATE OR REPLACE PROCEDURE sp_start_cron_cycle(
    p_agent_id VARCHAR(255),
    INOUT p_log_id INT DEFAULT NULL,
    INOUT p_is_running BOOLEAN DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
BEGIN
    -- Auto-clean stale hanging cycles (>15 minutes)
    UPDATE cron_logs
    SET is_running = FALSE,
        status = 'failed',
        message = 'Stale lock auto-cleaned',
        finished_at = CURRENT_TIMESTAMP
    WHERE agent_id = p_agent_id AND is_running = TRUE AND started_at < NOW() - INTERVAL '15 minutes';

    INSERT INTO cron_logs (agent_id, is_running, status, started_at)
    VALUES (p_agent_id, TRUE, 'running', CURRENT_TIMESTAMP)
    RETURNING cron_logs.id, cron_logs.is_running INTO p_log_id, p_is_running;
END;
$$;

-- Procedure: Finish Cron Execution Lock
CREATE OR REPLACE PROCEDURE sp_finish_cron_cycle(
    p_log_id INT,
    p_status VARCHAR(50),
    p_message TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE cron_logs
    SET is_running = FALSE,
        status = p_status,
        message = p_message,
        finished_at = CURRENT_TIMESTAMP
    WHERE id = p_log_id;
END;
$$;

-- Function: Check Minimum Post Delay Guard
CREATE OR REPLACE FUNCTION fn_too_soon_since_last_post(
    p_agent_id VARCHAR(255),
    p_interval_mins INT DEFAULT 30
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    last_post_time TIMESTAMPTZ;
BEGIN
    SELECT created_at INTO last_post_time
    FROM posts
    WHERE agent_id = p_agent_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF last_post_time IS NULL THEN
        RETURN FALSE;
    END IF;

    IF (NOW() - last_post_time) < (p_interval_mins || ' minutes')::INTERVAL THEN
        RETURN TRUE;
    ELSE
        RETURN FALSE;
    END IF;
END;
$$;

-- Function: Check Topic Memory Duplicate
CREATE OR REPLACE FUNCTION fn_is_duplicate_topic(
    p_agent_id VARCHAR(255),
    p_topic_title TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    found_count INT;
BEGIN
    SELECT COUNT(*) INTO found_count
    FROM topic_memory
    WHERE agent_id = p_agent_id
      AND (
        LOWER(topic_title) = LOWER(p_topic_title)
        OR LOWER(topic_title) LIKE '%' || LOWER(SUBSTRING(p_topic_title FROM 1 FOR 30)) || '%'
        OR (
            EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm')
            AND similarity(LOWER(topic_title), LOWER(p_topic_title)) > 0.6
        )
      );

    RETURN (found_count > 0);
END;
$$;

-- Procedure: Transactional Save Post
CREATE OR REPLACE PROCEDURE sp_save_post(
    p_id VARCHAR(255),
    p_agent_id VARCHAR(255),
    p_text TEXT,
    p_rationale TEXT,
    p_sources JSONB,
    p_media_type VARCHAR(50) DEFAULT 'none',
    p_media_url TEXT DEFAULT NULL,
    p_meta JSONB DEFAULT '{}'::jsonb
)
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO posts (id, agent_id, text, rationale, sources, media_type, media_url, platform_metadata, created_at)
    VALUES (p_id, p_agent_id, p_text, p_rationale, p_sources, p_media_type, p_media_url, p_meta, CURRENT_TIMESTAMP);

    -- Mirror topic into topic_memory
    INSERT INTO topic_memory (agent_id, topic_title, created_at)
    VALUES (p_agent_id, SUBSTRING(p_text FROM 1 FOR 150), CURRENT_TIMESTAMP);
END;
$$;
