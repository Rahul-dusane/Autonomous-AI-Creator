require('dotenv').config();
const express = require('express');
const cors = require('cors');
const agentRoutes = require('./routes/agentRoutes');
const { query } = require('./db/client');
const { startAutonomousLoop } = require('./services/agentEngine');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Mount Agent API Routes
app.use('/api/agent', agentRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Boot active agents on restart (re-activates running loops if server reboots)
async function bootActiveAgents() {
  try {
    const res = await query('SELECT id FROM agents WHERE is_active = TRUE');
    console.log(`[Server Boot] Found ${res.rows.length} active agent(s) in DB.`);
    for (const row of res.rows) {
      startAutonomousLoop(row.id);
    }
  } catch (err) {
    console.error('[Server Boot Error] Could not restore active agent loops:', err.message);
  }
}

app.listen(PORT, async () => {
  console.log(`[Server] Autonomous AI Creator API running on port ${PORT}`);
  await bootActiveAgents();
});