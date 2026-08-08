const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db/client');
const { startAutonomousLoop } = require('../services/agentEngine');

/**
 * 1. Initialize Agent Endpoint
 * POST /api/agent/init
 */
router.post('/init', async (req, res) => {
  try {
    const { persona } = req.body || {};

    if (!persona || !persona.name || !persona.domain) {
      return res.status(400).json({
        error: 'Invalid payload. "persona.name" and "persona.domain" are required fields.',
      });
    }

    const name = String(persona.name).trim();
    const domain = String(persona.domain).trim();

    // Check if agent already exists
    const existingRes = await query(
      'SELECT id FROM agents WHERE name = $1 AND domain = $2 LIMIT 1',
      [name, domain]
    );

    let agentId;

    if (existingRes.rows.length > 0) {
      agentId = existingRes.rows[0].id;
      await query(
        'UPDATE agents SET is_active = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [agentId]
      );
      console.log(`[API Init] Re-initialized existing Agent "${name}" (${agentId})`);
    } else {
      agentId = `agent-${uuidv4().slice(0, 8)}`;

      // Attempt stored procedure first, fallback to standard direct INSERT if procedure/columns differ
      try {
        await query(
          'CALL sp_init_agent($1::text, $2::text, $3::text, $4::jsonb)',
          [agentId, name, domain, JSON.stringify(persona)]
        );
      } catch (spErr) {
        console.warn('[API Init] Stored procedure sp_init_agent failed, executing fallback INSERT:', spErr.message);
        await query(
          'INSERT INTO agents (id, name, domain, persona, is_active) VALUES ($1, $2, $3, $4::jsonb, TRUE)',
          [agentId, name, domain, JSON.stringify(persona)]
        );
      }

      console.log(`[API Init] Created new Agent "${name}" (${agentId})`);
    }

    // Start background autonomous cycle
    startAutonomousLoop(agentId, 60 * 60 * 1000);

    return res.status(200).json({
      agentId: agentId,
    });
  } catch (err) {
    console.error('[API Init Error] Failed to initialize agent:', err);
    return res.status(500).json({
      error: 'Internal server error initializing agent.',
    });
  }
});

/**
 * 2. Retrieve Feed Endpoint
 * GET /api/agent/feed?agentId=abc-123
 */
router.get('/feed', async (req, res) => {
  try {
    const { agentId } = req.query;

    if (!agentId) {
      return res.status(400).json({
        error: 'Missing required query parameter: "agentId"',
      });
    }

    let dbRows = [];

    // Attempt stored function call with explicit type cast $1::text
    try {
      const dbRes = await query('SELECT * FROM fn_get_feed($1::text)', [agentId]);
      dbRows = dbRes.rows;
    } catch (fnErr) {
      console.warn('[API Feed] fn_get_feed failed, falling back to direct posts query:', fnErr.message);
      const fallbackRes = await query(
        'SELECT id, text, rationale, sources, created_at FROM posts WHERE agent_id = $1 ORDER BY created_at DESC',
        [agentId]
      );
      dbRows = fallbackRes.rows;
    }

    const formattedPosts = dbRows.map((row) => {
      let parsedSources = [];
      if (Array.isArray(row.sources)) {
        parsedSources = row.sources;
      } else if (typeof row.sources === 'string') {
        try {
          parsedSources = JSON.parse(row.sources);
        } catch (_) {
          parsedSources = [row.sources];
        }
      }

      const rawDate = row.created_at || row.createdat || row.createdAt || new Date();

      return {
        id: row.id,
        createdAt: new Date(rawDate).toISOString(),
        text: row.text,
        rationale: row.rationale,
        sources: parsedSources,
      };
    });

    return res.status(200).json({
      posts: formattedPosts,
    });
  } catch (err) {
    console.error('[API Feed Error] Failed to retrieve feed:', err.message);
    return res.status(500).json({
      posts: [],
    });
  }
});

module.exports = router;