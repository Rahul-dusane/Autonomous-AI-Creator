const BASE_URL = process.env.API_BASE_URL || 'http://localhost:8080';

async function runEndToEndTest() {
  console.log('--- STARTING E2E TEST: Autonomous AI Creator API ---\n');

  try {
    // Step 1: Health Check
    console.log('1. Checking Server Health...');
    const healthRes = await fetch(`${BASE_URL}/health`);
    const contentType = healthRes.headers.get('content-type') || '';
    const responseText = await healthRes.text();

    if (!healthRes.ok) {
      throw new Error(`Health check failed with HTTP ${healthRes.status}: ${responseText}`);
    }

    const healthData = contentType.includes('application/json')
      ? JSON.parse(responseText)
      : JSON.parse(responseText || '{}');
    console.log('   Health Status:', healthData);

    // Step 2: Initialize Agent (POST /api/agent/init)
    console.log('\n2. Initializing Agent (POST /api/agent/init)...');
    const initPayload = {
      persona: {
        name: 'Ada',
        domain: 'AI Security'
      }
    };

    const initRes = await fetch(`${BASE_URL}/api/agent/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(initPayload)
    });

    if (!initRes.ok) {
      throw new Error(`Init failed with HTTP ${initRes.status}: ${await initRes.text()}`);
    }

    const initData = await initRes.json();
    console.log('   Init Response:', initData);
    const agentId = initData.agentId;

    if (!agentId) {
      throw new Error('agentId was not returned in the initialization response.');
    }

    // Step 3: Wait for Background Cycle Completion
    console.log('\n3. Waiting 10 seconds for initial autonomous execution cycle to complete...');
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // Step 4: Retrieve Feed (GET /api/agent/feed)
    console.log(`\n4. Fetching Feed (GET /api/agent/feed?agentId=${agentId})...`);
    const feedRes = await fetch(`${BASE_URL}/api/agent/feed?agentId=${agentId}`);

    if (!feedRes.ok) {
      throw new Error(`Feed fetch failed with HTTP ${feedRes.status}: ${await feedRes.text()}`);
    }

    const feedData = await feedRes.json();
    console.log('   Feed Output:\n', JSON.stringify(feedData, null, 2));

    // Validation Check
    if (feedData.posts && Array.isArray(feedData.posts)) {
      console.log(`\nSUCCESS: Feed returned ${feedData.posts.length} post(s).`);
    } else {
      console.warn('\nWARNING: Feed output schema invalid or missing "posts" array.');
    }

  } catch (error) {
    console.error('\nE2E TEST FAILED:', error.message);
  }
}

runEndToEndTest();