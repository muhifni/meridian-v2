#!/usr/bin/env node
// Quick test: does fetch wrapper work for preserving reasoning_content?
const OpenAI = require('openai');

// Custom fetch that captures raw response
const client = new OpenAI({
  baseURL: 'http://localhost:20128/v1',
  apiKey: process.env.LLM_API_KEY,
  timeout: 30000,
  fetch: async (url, init) => {
    const response = await globalThis.fetch(url, init);
    const cloned = response.clone();
    const rawText = await cloned.text();
    try {
      response._rawJson = JSON.parse(rawText);
    } catch(e) {}
    return response;
  }
});

(async () => {
  const response = await client.chat.completions.create({
    model: 'deepseek-v4-pro-combo',
    messages: [{ role: 'user', content: 'Say exactly: OK' }],
    max_tokens: 50,
    temperature: 0,
  });
  
  const msg = response.choices[0].message;
  console.log('SDK msg keys:', Object.keys(msg).join(', '));
  console.log('SDK reasoning_content:', msg.reasoning_content);
  
  // Recover reasoning_content from raw
  if (response._rawJson) {
    const rawMsg = response._rawJson?.choices?.[0]?.message;
    console.log('RAW msg keys:', Object.keys(rawMsg).join(', '));
    console.log('RAW reasoning_content:', rawMsg?.reasoning_content?.substring(0, 80));
    console.log('RAW content:', rawMsg?.content);
  }
})();
