// backend/src/services/breethService.js

const BREETH_API_KEY = process.env.BREETH_API_KEY;
const BREETH_API_URL = process.env.BREETH_API_URL || 'https://api.thebreeth.com/v1';

/**
 * Saves a memory episode to Breeth AI (POST /v1/episodes)
 */
async function recordMemory(agentId, content) {
  if (!BREETH_API_KEY) {
    console.warn('[Breeth AI] BREETH_API_KEY is not set. Skipping write.');
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
        content: content,
        group_id: agentId || 'default',
        extract_intent: true, // Enables cognitive pattern extraction in Breeth
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[Breeth AI Error] Write failed:', data);
      return null;
    }

    console.log(`[Breeth AI] Successfully wrote episode! Entities/edges extracted.`);
    return data;
  } catch (err) {
    console.error('[Breeth AI Error] Network error during recordMemory:', err.message);
    return null;
  }
}

/**
 * Searches past memories in Breeth AI (POST /v1/search)
 */
async function recallMemories(agentId, queryText) {
  if (!BREETH_API_KEY) return [];

  try {
    const response = await fetch(`${BREETH_API_URL}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BREETH_API_KEY}`,
      },
      body: JSON.stringify({
        query: queryText,
        limit: 5,
      }),
    });

    if (!response.ok) {
      const errData = await response.json();
      console.error('[Breeth AI Error] Search failed:', errData);
      return [];
    }

    const data = await response.json();
    return data.edges || [];
  } catch (err) {
    console.error('[Breeth AI Error] Network error during recallMemories:', err.message);
    return [];
  }
}

module.exports = {
  recordMemory,
  recallMemories,
};