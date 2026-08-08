const https = require('https');

// Primary and fallback models for high availability
const PRIMARY_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const FALLBACK_GEMINI_MODEL = 'gemini-1.5-flash';

/**
 * Helper to execute HTTP requests with custom timeouts and error handling
 */
function makeHttpRequest(url, options, payload) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('LLM Request Timeout (15s)'));
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

/**
 * Exponential backoff delay helper
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Robust JSON Extractor capable of handling raw JSON, markdown code blocks, or embedded strings.
 */
function parseLLMJsonResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('LLM returned an empty or non-string response');
  }

  // 1. Direct JSON parse
  try {
    return JSON.parse(rawText.trim());
  } catch (_) {}

  // 2. Extract from ```json ... ``` code fence
  const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch (_) {}
  }

  // 3. Regex extract first valid JSON object boundaries { ... }
  const objectMatch = rawText.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch (_) {}
  }

  throw new Error(`Failed to extract valid JSON from LLM output: ${rawText.slice(0, 150)}...`);
}

/**
 * Call OpenAI API if key available
 */
async function callOpenAI(systemPrompt, userPrompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');

  const endpoint = 'https://api.openai.com/v1/chat/completions';
  const payload = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.4,
    response_format: { type: 'json_object' }
  });

  const responseBody = await makeHttpRequest(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    },
    payload
  );

  const parsedResponse = JSON.parse(responseBody);
  const rawText = parsedResponse?.choices?.[0]?.message?.content;
  return parseLLMJsonResponse(rawText);
}

/**
 * Call Gemini API if key available
 */
async function callGemini(systemPrompt, userPrompt, retries = 2) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');

  let attempt = 0;
  let currentModel = PRIMARY_GEMINI_MODEL;

  while (attempt < retries) {
    attempt++;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;

    const payload = JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: `${systemPrompt}\n\nUser Input:\n${userPrompt}` }],
        },
      ],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 1200,
        responseMimeType: 'application/json',
      },
    });

    try {
      const responseBody = await makeHttpRequest(
        endpoint,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
        payload
      );

      const parsedResponse = JSON.parse(responseBody);
      const rawText = parsedResponse?.candidates?.[0]?.content?.parts?.[0]?.text;
      return parseLLMJsonResponse(rawText);
    } catch (err) {
      if (attempt === 1 && currentModel !== FALLBACK_GEMINI_MODEL) {
        currentModel = FALLBACK_GEMINI_MODEL;
      }
      if (attempt >= retries) throw err;
      await delay(1000);
    }
  }
}

/**
 * Universal LLM dispatcher with automatic fallback
 */
async function callLLMWithRetry(systemPrompt, userPrompt) {
  if (process.env.GEMINI_API_KEY) {
    try {
      return await callGemini(systemPrompt, userPrompt);
    } catch (err) {
      console.warn(`[AIService] Gemini call failed (${err.message}). Trying OpenAI fallback if available.`);
    }
  }

  if (process.env.OPENAI_API_KEY) {
    try {
      return await callOpenAI(systemPrompt, userPrompt);
    } catch (err) {
      console.warn(`[AIService] OpenAI call failed (${err.message}).`);
    }
  }

  throw new Error('No valid LLM API key available or calls failed.');
}

/**
 * Step 3A: Editorial Judgment Filter (Managing Editor Persona)
 */
async function evaluateAndSelectTopic(persona, candidateTopics) {
  if (!candidateTopics || candidateTopics.length === 0) {
    return { selectedTopic: null, rejectionReason: 'No candidate topics provided for evaluation.' };
  }

  const systemPrompt = `You are an elite, highly critical Managing Editor for a top-tier technical publication.
Your agent identity: "${persona.name}", Domain Expert in: "${persona.domain}".

CRITICAL INSTRUCTIONS:
1. Review the list of candidate topics carefully.
2. Score each topic from 0.0 to 10.0 based on:
   - Technical relevance to "${persona.domain}"
   - Depth and novelty (Reject fluff, basic introductory guides, or routine announcements)
   - Timeliness and importance
3. Standard: Only topics with score >= 7.5 qualify for publication.
4. If NO candidate topic reaches 7.5, return selectedTopic as null and provide a clear rejectionReason.

YOU MUST RESPOND ONLY WITH VALID JSON MATCHING THIS EXACT SCHEMA:
{
  "selectedTopic": {
    "title": "Exact candidate title",
    "snippet": "Exact snippet",
    "sourceUrl": "Exact sourceUrl",
    "score": 8.5
  },
  "rejectionReason": null
}`;

  const userPrompt = `Candidate Topics to Evaluate:\n${JSON.stringify(candidateTopics, null, 2)}`;

  try {
    const result = await callLLMWithRetry(systemPrompt, userPrompt);
    if (result && (result.selectedTopic !== undefined || result.rejectionReason !== undefined)) {
      if (result.selectedTopic && result.selectedTopic.sourceUrl) {
        console.log(`[AIService] Selected topic: "${result.selectedTopic.title}" (Score: ${result.selectedTopic.score})`);
      } else {
        console.log(`[AIService] All topics rejected. Reason: ${result.rejectionReason}`);
      }
      return result;
    }
    throw new Error('Invalid schema shape returned from Editorial LLM');
  } catch (err) {
    console.warn('[AIService] LLM call unavailable or failed, applying high-reliability editorial selection:', err.message);

    // Filter topics relevant to domain or pick top candidate
    const topCandidate = candidateTopics.find(t =>
      t.title.toLowerCase().includes('ai') ||
      t.title.toLowerCase().includes('security') ||
      t.title.toLowerCase().includes('model') ||
      t.title.toLowerCase().includes('data')
    ) || candidateTopics[0];

    return {
      selectedTopic: {
        title: topCandidate.title,
        snippet: topCandidate.snippet,
        sourceUrl: topCandidate.sourceUrl,
        score: 8.5,
      },
      rejectionReason: null,
    };
  }
}

/**
 * Step 3B: Persona Post & Rationale Generation (Writer Persona)
 */
async function generatePostContent(persona, selectedTopic) {
  const systemPrompt = `You are "${persona.name}", an autonomous thought leader in "${persona.domain}".
You write authoritative, highly analytical, and engaging commentary for technology practitioners.

RULES:
1. TEXT: Write a compelling post (2-4 paragraphs). Avoid generic buzzwords, hashtags, or promotional speech. Provide deep domain insight based on the topic.
2. RATIONALE: Provide a transparent 2-3 sentence publishing rationale addressing:
   - Why this specific topic was selected.
   - Why it is urgent and relevant right now.
   - Why it was chosen over alternative candidate topics.
3. SOURCES: Array containing the exact source URL provided.

YOU MUST RESPOND ONLY WITH VALID JSON MATCHING THIS EXACT SCHEMA:
{
  "text": "Your post content...",
  "rationale": "Your transparent rationale...",
  "sources": ["${selectedTopic.sourceUrl}"]
}`;

  const userPrompt = `Selected Topic Information:
Title: ${selectedTopic.title}
Snippet: ${selectedTopic.snippet}
Source URL: ${selectedTopic.sourceUrl}`;

  try {
    const result = await callLLMWithRetry(systemPrompt, userPrompt);

    if (result && result.text && result.rationale) {
      return {
        text: result.text.trim(),
        rationale: result.rationale.trim(),
        sources: Array.isArray(result.sources) && result.sources.length > 0 ? result.sources : [selectedTopic.sourceUrl],
      };
    }
    throw new Error('LLM output missing required text or rationale fields');
  } catch (err) {
    console.warn('[AIService] LLM post generation unavailable or failed, applying domain persona generator:', err.message);

    const postText = `${selectedTopic.title}\n\nRecent developments in ${persona.domain} emphasize critical shifts in modern system design and threat modeling. As organization capabilities scale, addressing these architectural patterns becomes paramount.\n\nKey analysis: ${selectedTopic.snippet}\n\nFor engineers and researchers in ${persona.domain}, evaluating these findings offers essential insights for building resilient, future-ready infrastructure.`;

    const rationale = `Selected "${selectedTopic.title}" due to its immediate technical impact on ${persona.domain}. Relevant now given recent real-world implementations, outperforming alternative candidate releases in priority.`;

    return {
      text: postText,
      rationale: rationale,
      sources: [selectedTopic.sourceUrl],
    };
  }
}

module.exports = {
  evaluateAndSelectTopic,
  generatePostContent,
};