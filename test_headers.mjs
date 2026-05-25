import OpenAI from 'openai';

const KEY = process.env.LLM_API_KEY;

// Test A: keep accept, strip x-stainless only
console.log('=== TEST A: Keep accept, strip x-stainless only ===');
let clientA = new OpenAI({
  baseURL: 'http://localhost:20128/v1',
  apiKey: KEY,
  timeout: 30000,
  fetch: async (url, init) => {
    if (init.headers) {
      const filtered = {};
      for (const [k, v] of Object.entries(init.headers)) {
        if (!k.startsWith('x-stainless') && k !== 'user-agent') {
          filtered[k] = v;
        }
      }
      init.headers = filtered;
    }
    const response = await globalThis.fetch(url, init);
    const rawText = await response.text();
    const raw = JSON.parse(rawText.split('data: [DONE]')[0]);
    console.log('RAW keys:', Object.keys(raw.choices[0].message).join(', '));
    console.log('RAW reasoning:', !!raw.choices[0].message.reasoning_content);
    return new Response(rawText, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
});

const rA = await clientA.chat.completions.create({
  model: 'deepseek-v4-pro-combo',
  messages: [{ role: 'user', content: 'Say OK' }],
  max_tokens: 10,
  temperature: 0,
});
console.log('SDK choices:', rA.choices?.length);
console.log('SDK content:', JSON.stringify(rA.choices?.[0]?.message?.content));
console.log('');

// Test B: strip accept too
console.log('=== TEST B: Strip accept too ===');
let clientB = new OpenAI({
  baseURL: 'http://localhost:20128/v1',
  apiKey: KEY,
  timeout: 30000,
  fetch: async (url, init) => {
    if (init.headers) {
      const filtered = {};
      for (const [k, v] of Object.entries(init.headers)) {
        if (k === 'authorization' || k === 'content-type' || k === 'content-length') {
          filtered[k] = v;
        }
      }
      init.headers = filtered;
    }
    const response = await globalThis.fetch(url, init);
    const rawText = await response.text();
    const raw = JSON.parse(rawText.split('data: [DONE]')[0]);
    console.log('RAW keys:', Object.keys(raw.choices[0].message).join(', '));
    console.log('RAW reasoning:', !!raw.choices[0].message.reasoning_content);
    return new Response(rawText, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
});

const rB = await clientB.chat.completions.create({
  model: 'deepseek-v4-pro-combo',
  messages: [{ role: 'user', content: 'Say OK' }],
  max_tokens: 10,
  temperature: 0,
});
console.log('SDK choices:', rB.choices?.length);
console.log('SDK content:', JSON.stringify(rB.choices?.[0]?.message?.content));
