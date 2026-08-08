const { query } = require('../db/client');
const { discoverTopics } = require('./discoveryService');
const { evaluateAndSelectTopic, generatePostContent } = require('./aiService');
const { v4: uuidv4 } = require('uuid');

// Active background cron timers mapped by agentId
const activeAgentTimers = new Map();

/**
 * Executes a single autonomous posting cycle for an agent.
 * @param {string} agentId - UUID of the target agent
 */
async function runAgentCycle(agentId) {
  console.log(`\n[AgentEngine] --- Starting Autonomous Cycle for Agent: ${agentId} ---`);

  let logId = null;

  try {
    // 1. Fetch Agent Persona Profile
    const agentRes = await query('SELECT id, name, domain, is_active FROM agents WHERE id = $1', [agentId]);
    if (agentRes.rows.length === 0) {
      console.warn(`[AgentEngine] Agent ${agentId} not found in database. Skipping cycle.`);
      return;
    }

    const agent = agentRes.rows[0];
    if (!agent.is_active) {
      console.log(`[AgentEngine] Agent ${agentId} is inactive. Skipping cycle.`);
      return;
    }

    // 2. Concurrency Control & Lock Acquisition via Stored Procedure
    const lockRes = await query(
      `CALL sp_start_cron_cycle($1, NULL, NULL)`,
      [agent.id]
    );

    // Stored procedure output parameters mapping
    const lockCheck = await query(
      `SELECT id, is_running FROM cron_logs WHERE agent_id = $1 ORDER BY started_at DESC LIMIT 1`,
      [agent.id]
    );

    if (lockCheck.rows.length > 0) {
      logId = lockCheck.rows[0].id;
    }

    // 3. Spacing Guard: Ensure minimum 30 minutes between posts
    const timingCheck = await query(
      'SELECT fn_too_soon_since_last_post($1, 30) AS too_soon',
      [agent.id]
    );
    if (timingCheck.rows[0]?.too_soon) {
      console.log(`[AgentEngine] Post published too recently for agent ${agent.id}. Cooldown active.`);
      await finishCycle(logId, 'skipped', 'Cooldown period active (min 30m spacing)');
      return;
    }

    // 4. Live Topic Discovery
    const rawCandidates = await discoverTopics(agent.domain);
    if (!rawCandidates || rawCandidates.length === 0) {
      console.log(`[AgentEngine] No candidate topics discovered for domain: "${agent.domain}".`);
      await finishCycle(logId, 'completed', 'No live candidates found');
      return;
    }

    // 5. Memory Check & Deduplication Filter against DB
    const freshCandidates = [];
    for (const candidate of rawCandidates) {
      const dupCheck = await query(
        'SELECT fn_is_duplicate_topic($1, $2) AS is_duplicate',
        [agent.id, candidate.title]
      );

      if (!dupCheck.rows[0]?.is_duplicate) {
        freshCandidates.push(candidate);
      } else {
        console.log(`[AgentEngine] Memory Guard: Skipped previously published topic: "${candidate.title}"`);
      }
    }

    if (freshCandidates.length === 0) {
      console.log(`[AgentEngine] All discovered candidates exist in memory for agent ${agent.id}.`);
      await finishCycle(logId, 'completed', 'All candidate topics were duplicates in memory');
      return;
    }

    // 6. Editorial Judgment Evaluation (LLM Filter)
    const editorialResult = await evaluateAndSelectTopic(
      { name: agent.name, domain: agent.domain },
      freshCandidates
    );

    if (!editorialResult.selectedTopic) {
      console.log(`[AgentEngine] Editorial Judgment: Rejection triggered. Reason: ${editorialResult.rejectionReason}`);
      await finishCycle(logId, 'rejected', editorialResult.rejectionReason || 'Rejection threshold triggered');
      return;
    }

    const winningTopic = editorialResult.selectedTopic;

    // 7. Generate Persona Post & Rationale
    const generatedPost = await generatePostContent(
      { name: agent.name, domain: agent.domain },
      winningTopic
    );

    // 8. Transactional Persistence to PostgreSQL
    const postId = `post-${uuidv4().slice(0, 8)}`;
    await query(
      `CALL sp_save_post($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        postId,
        agent.id,
        generatedPost.text,
        generatedPost.rationale,
        JSON.stringify(generatedPost.sources),
        'none',
        null,
        JSON.stringify({ score: winningTopic.score || 8.0 }),
      ]
    );

    console.log(`[AgentEngine] SUCCESS: Published new post [${postId}] for Agent "${agent.name}" (${agent.id})`);
    await finishCycle(logId, 'success', `Successfully created post ${postId}`);

  } catch (err) {
    console.error(`[AgentEngine Error] Cycle failed for agent ${agentId}:`, err);
    if (logId) {
      await finishCycle(logId, 'failed', err.message);
    }
  }
}

/**
 * Safely updates cron execution log state upon completion or exit
 */
async function finishCycle(logId, status, message) {
  if (!logId) return;
  try {
    await query('CALL sp_finish_cron_cycle($1, $2, $3)', [logId, status, message]);
  } catch (err) {
    console.error('[AgentEngine Error] Failed to update cron finish state:', err.message);
  }
}

/**
 * Registers an agent into the background execution loop.
 * Runs one cycle immediately upon initialization, then sets recurring interval.
 * 
 * @param {string} agentId - UUID of the agent
 * @param {number} intervalMs - Recurrence interval in ms (default: 1 hour)
 */
function startAutonomousLoop(agentId, intervalMs = 60 * 60 * 1000) {
  // Prevent duplicate background loops for the same agent
  if (activeAgentTimers.has(agentId)) {
    console.log(`[AgentEngine] Agent ${agentId} is already running in background loop.`);
    return;
  }

  console.log(`[AgentEngine] Registering autonomous loop for Agent ${agentId} (Interval: ${intervalMs / 1000 / 60}m)`);

  // Run initial cycle immediately in background (non-blocking)
  setImmediate(() => {
    runAgentCycle(agentId).catch((err) => {
      console.error(`[AgentEngine] Immediate execution failed for ${agentId}:`, err.message);
    });
  });

  // Schedule recurring loop
  const timer = setInterval(() => {
    runAgentCycle(agentId).catch((err) => {
      console.error(`[AgentEngine] Scheduled execution failed for ${agentId}:`, err.message);
    });
  }, intervalMs);

  activeAgentTimers.set(agentId, timer);
}

/**
 * Stops an active agent loop if needed
 */
function stopAutonomousLoop(agentId) {
  if (activeAgentTimers.has(agentId)) {
    clearInterval(activeAgentTimers.get(agentId));
    activeAgentTimers.delete(agentId);
    console.log(`[AgentEngine] Stopped autonomous loop for Agent ${agentId}`);
  }
}

module.exports = {
  runAgentCycle,
  startAutonomousLoop,
  stopAutonomousLoop,
};