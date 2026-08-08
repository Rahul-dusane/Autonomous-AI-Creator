const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db/client');
const { startAutonomousLoop } = require('../services/agentEngine');

/**
 * 1. Initialize Agent Endpoint
 * POST /api/agent/init
 * 
 * Request:
 * {
 *   "persona": {
 *     "name": "Ada",
 *     "domain": "AI Security"
 *   }
 * }
 * 
 * Response:
 * {
 *   "agentId": "abc-123"
 * }
 */
router.post('/init', async (req, res) => {
  try {
    const { persona } = req.body;

    // Strict Request Validation
    if (!persona || !persona.name || !persona.domain) {
      return res.status(400).json({
        error: 'Invalid payload. "persona.name" and "persona.domain" are required fields.',
      });
    }

    const name = persona.name.trim();
    const domain = persona.domain.trim();

    // Check if an agent with this name and domain already exists
    const existingRes = await query(
      'SELECT id FROM agents WHERE name = $1 AND domain = $2 LIMIT 1',
      [name, domain]
    );

    let agentId;

    if (existingRes.rows.length > 0) {
      agentId = existingRes.rows[0].id;
      // Re-activate agent if necessary
      await query('UPDATE agents SET is_active = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [agentId]);
      console.log(`[API Init] Re-initialized existing Agent "${name}" (${agentId})`);
    } else {
      agentId = `agent-${uuidv4().slice(0, 8)}`;
      // Save agent to database using stored procedure
      await query(
        'CALL sp_init_agent($1, $2, $3, $4)',
        [agentId, name, domain, JSON.stringify(persona)]
      );
      console.log(`[API Init] Created new Agent "${name}" (${agentId})`);
    }

    // Spawn autonomous background loop (runs immediately + every 1 hour)
    startAutonomousLoop(agentId, 60 * 60 * 1000);

    // Return response adhering strictly to API spec
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
 * 
 * Response:
 * {
 *   "posts": [
 *     {
 *       "id": "p7",
 *       "createdAt": "2026-08-07T10:30:00Z",
 *       "text": "...",
 *       "rationale": "...",
 *       "sources": ["https://..."]
 *     }
 *   ]
 * }
 */
router.get('/feed', async (req, res) => {
  try {
    const { agentId } = req.query;

    if (!agentId) {
      return res.status(400).json({
        error: 'Missing required query parameter: "agentId"',
      });
    }

    // Retrieve posts from DB using fn_get_feed(p_agent_id)
    const dbRes = await query('SELECT * FROM fn_get_feed($1)', [agentId]);

    // Format feed adhering strictly to the ISO 8601 UTC and required API spec
    const formattedPosts = dbRes.rows.map((row) => {
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

      return {
        id: row.id,
        createdAt: new Date(row.createdat || row.created_at).toISOString(),
        text: row.text,
        rationale: row.rationale,
        sources: parsedSources,
      };
    });

    return res.status(200).json({
      posts: formattedPosts,
    });
  } catch (err) {
    console.error('[API Feed Error] Failed to retrieve feed:', err);
    return res.status(500).json({
      error: 'Internal server error retrieving feed.',
    });
  }
});

module.exports = router;