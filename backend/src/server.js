require('dotenv').config();
const express = require('express');
const cors = require('cors');
const agentRoutes = require('./routes/agentRoutes');
const { query, ensureDbSchema } = require('./db/client');
const { startAutonomousLoop } = require('./services/agentEngine');

const app = express();
const PORT = process.env.PORT || 8081;

// Bulletproof Global CORS Header Middleware (guarantees CORS headers on 200, 400, 500 & OPTIONS responses)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Access-Control-Allow-Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

const corsOptions = {
  origin: true, // Dynamically echo request origin (127.0.0.1:5500, localhost:5173, etc.)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'Access-Control-Allow-Origin'],
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(express.json());

// Mount Agent API Routes
app.use('/api/agent', agentRoutes);

// Ping endpoint for keep-alive automation
app.get('/ping', (req, res) => res.status(200).send('pong'));

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const dbRes = await query('SELECT NOW()');
    res.status(200).json({
      status: 'ok',
      database_configured: true,
      database_time: dbRes.rows[0].now,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      database_configured: false,
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
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
  try {
    await ensureDbSchema();
    await bootActiveAgents();
  } catch (err) {
    console.error('[Server Boot Warning] DB schema initialization deferred:', err.message);
  }
});