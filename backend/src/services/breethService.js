// backend/src/services/breethService.js

const BREETH_API_KEY = process.env.BREETH_API_KEY;
const BREETH_API_URL = process.env.BREETH_API_URL || 'https://api.thebreeth.com/v1';

/**
 * Saves an execution episode/memory to Breeth AI
 * @param {string} agentId - ID of the agent
 * @param {string} content - Post text or topic summary
 * @param {object} metadata - Intent, topic, or rationale details
 */
async function recordMemory(agentId, content, metadata = {}) {
  if (!BREETH_API_KEY) {
    console.warn('[Breeth AI] BREETH_API_KEY is not set. Skipping memory record.');
    return null;
  }

  try {
    const response = await fetch(`${BREETH_API_URL}/episodes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BREETH_API_KEY}`,
      },
      body: JSON.stringify({
        agent_id: agentId,
        content: content,
        metadata: metadata,
      }),
    });

    if (!response.ok) {
      throw new Error(`Breeth API Error: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`[Breeth AI] Recorded memory episode for Agent ${agentId}`);
    return data;
  } catch (err) {
    console.error('[Breeth AI Error] Failed to record memory:', err.message);
    return null;
  }
}

/**
 * Recalls relevant memories for topic deduplication and style context
 * @param {string} agentId - ID of the agent
 * @param {string} queryText - Topic or search query
 */
async function recallMemories(agentId, queryText) {
  if (!BREETH_API_KEY) return [];

  try {
    const response = await fetch(
      `${BREETH_API_URL}/search?agent_id=${agentId}&q=${encodeURIComponent(queryText)}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${BREETH_API_KEY}`,
        },
      }
    );

    if (!response.ok) return [];

    const data = await response.json();
    return data.results || [];
  } catch (err) {
    console.error('[Breeth AI Error] Search failed:', err.message);
    return [];
  }
}

module.exports = {
  recordMemory,
  recallMemories,
};