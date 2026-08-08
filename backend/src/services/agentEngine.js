const { query } = require('../db/client');
const { discoverTopics } = require('./discoveryService');
const { evaluateAndSelectTopic, generatePostContent } = require('./aiServices');
const { recordMemory, recallMemories } = require('./breethService');
const { v4: uuidv4 } = require('uuid');

const activeAgentTimers = new Map();

/**
 * Executes a single autonomous posting cycle for an agent.
 */
async function runAgentCycle(agentId) {
  console.log(`\n[AgentEngine] --- Starting Autonomous Cycle for Agent: ${agentId} ---`);

  let logId = null;

  try {
    // 1. Fetch Agent Profile
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

    // 2. Lock Acquisition via Stored Procedure
    await query(`CALL sp_start_cron_cycle($1, NULL, NULL)`, [agent.id]);

    const lockCheck = await query(
      `SELECT id, is_running FROM cron_logs WHERE agent_id = $1 ORDER BY started_at DESC LIMIT 1`,
      [agent.id]
    );

    if (lockCheck.rows.length > 0) {
      logId = lockCheck.rows[0].id;
    }

    // 3. Spacing Guard (Minimum 30 mins)
    const timingCheck = await query(
      'SELECT fn_too_soon_since_last_post($1, 30) AS too_soon',
      [agent.id]
    );
    if (timingCheck.rows[0]?.too_soon) {
      console.log(`[AgentEngine] Post published too recently for agent ${agent.id}. Cooldown active.`);
      await finishCycle(logId, 'skipped', 'Cooldown period active (min 30m spacing)');
      return;
    }

    // 4. Topic Discovery
    const rawCandidates = await discoverTopics(agent.domain);
    if (!rawCandidates || rawCandidates.length === 0) {
      console.log(`[AgentEngine] No candidate topics discovered for domain: "${agent.domain}".`);
      await finishCycle(logId, 'completed', 'No live candidates found');
      return;
    }

    // 5. Memory Verification: Postgres + Breeth AI Context Search
    const freshCandidates = [];
    for (const candidate of rawCandidates) {
      // Step A: Postgres DB duplicate check
      const dupCheck = await query(
        'SELECT fn_is_duplicate_topic($1, $2) AS is_duplicate',
        [agent.id, candidate.title]
      );

      if (dupCheck.rows[0]?.is_duplicate) {
        console.log(`[AgentEngine DB Guard] Skipped Postgres duplicate: "${candidate.title}"`);
        continue;
      }

      // Step B: Breeth AI Cognitive Graph recall
      const breethMemories = await recallMemories(agent.id, candidate.title);
      const isBreethDuplicate = Array.isArray(breethMemories) && breethMemories.some((mem) => {
        const memoryContent = typeof mem === 'string' ? mem : (mem.content || mem.text || '');
        return memoryContent.toLowerCase().includes(candidate.title.toLowerCase().slice(0, 20));
      });

      if (isBreethDuplicate) {
        console.log(`[AgentEngine Breeth Guard] Skipped Breeth memory match: "${candidate.title}"`);
        continue;
      }

      freshCandidates.push(candidate);
    }

    if (freshCandidates.length === 0) {
      console.log(`[AgentEngine Memory Guard] All candidate topics were rejected by past memory records.`);
      await finishCycle(logId, 'completed', 'All candidate topics were duplicates in memory');
      return;
    }

    // 6. Editorial Judgment Selection
    const editorialResult = await evaluateAndSelectTopic(
      { name: agent.name, domain: agent.domain },
      freshCandidates
    );

    if (!editorialResult.selectedTopic) {
      console.log(`[AgentEngine Editorial] Rejection triggered. Reason: ${editorialResult.rejectionReason}`);
      await finishCycle(logId, 'rejected', editorialResult.rejectionReason || 'Rejection threshold triggered');
      return;
    }

    const winningTopic = editorialResult.selectedTopic;

    // 7. Post & Editorial Rationale Generation
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

    // 9. Register Memory Episode in Breeth AI
    await recordMemory(agent.id, `Published post on "${winningTopic.title}": ${generatedPost.text}`);

    console.log(`[AgentEngine] SUCCESS: Published post [${postId}] for Agent "${agent.name}" (${agent.id})`);
    await finishCycle(logId, 'success', `Successfully created post ${postId}`);

  } catch (err) {
    console.error(`[AgentEngine Error] Cycle failed for agent ${agentId}:`, err);
    if (logId) {
      await finishCycle(logId, 'failed', err.message);
    }
  }
}

async function finishCycle(logId, status, message) {
  if (!logId) return;
  try {
    await query('CALL sp_finish_cron_cycle($1, $2, $3)', [logId, status, message]);
  } catch (err) {
    console.error('[AgentEngine Error] Failed to update cron finish state:', err.message);
  }
}

function startAutonomousLoop(agentId, intervalMs = 60 * 60 * 1000) {
  if (activeAgentTimers.has(agentId)) {
    console.log(`[AgentEngine] Agent ${agentId} is already running in background loop.`);
    return;
  }

  console.log(`[AgentEngine] Registering autonomous loop for Agent ${agentId} (Interval: ${intervalMs / 1000 / 60}m)`);

  setImmediate(() => {
    runAgentCycle(agentId).catch((err) => {
      console.error(`[AgentEngine] Immediate execution failed for ${agentId}:`, err.message);
    });
  });

  const timer = setInterval(() => {
    runAgentCycle(agentId).catch((err) => {
      console.error(`[AgentEngine] Scheduled execution failed for ${agentId}:`, err.message);
    });
  }, intervalMs);

  activeAgentTimers.set(agentId, timer);
}

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