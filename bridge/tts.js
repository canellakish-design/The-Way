// ============================================================
// tts.js — the coach's own voice (Harry, 14 Nov 2026: "Build the voice"). The phone's built-in voice is the
// fallback; with a key in Netlify (OPENAI_API_KEY) every spoken reply and the face's briefing is read by a
// natural voice instead, and the face's mouth follows the sound itself (pwa/app.js CoachVoice, pwa/face.js).
//   GET  /voice/speak            { on, voice }           whether the natural voice is set up
//   POST /voice/speak { text }   { audio_b64, mime }     the words as speech (mp3); 503 { off: true } with no key
// COACH_VOICE picks the voice (default onyx: low, calm). Text is capped at 1,200 characters a call.
// ============================================================
const MAX = 1200;
const key = () => String(process.env.OPENAI_API_KEY || '').trim();
const voice = () => String(process.env.COACH_VOICE || 'onyx').trim().toLowerCase();
const STYLE = 'A calm, direct cycling coach who knows this athlete well: warm, confident, unhurried. Numbers said clearly.';

// what is read aloud: no markdown, no links, times and units as a person says them
function clean(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#`>]+/g, '')
    .replace(/\b(\d{1,2}):(\d{2})\s*([ap])\b(?!\.?m)/gi, (m, h, mi, ap) => `${h}${mi === '00' ? '' : ':' + mi} ${ap.toLowerCase()}.m.`)
    .replace(/(\d)\s*g\b/g, '$1 grams').replace(/(\d)\s*kcal\b/gi, '$1 calories').replace(/(\d)\s*min\b/g, '$1 minutes').replace(/(\d)\s*h\b/g, '$1 hours')
    .replace(/\bZ([1-5])\b/g, 'Zone $1').replace(/\bVO2\b/g, 'V O 2').replace(/°F/g, ' degrees')
    .replace(/\s+/g, ' ').trim().slice(0, MAX);
}
async function speech(text) {
  const k = key(); if (!k) return null;
  const input = clean(text); if (!input) return null;
  const call = body => fetch('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let r = await call({ model: 'gpt-4o-mini-tts', voice: voice(), input, instructions: STYLE, response_format: 'mp3' });
  if (!r.ok && r.status !== 401 && r.status !== 429) r = await call({ model: 'tts-1', voice: voice(), input, response_format: 'mp3' });   // the older model, where the new one is not offered
  if (!r.ok) { const e = new Error(r.status === 401 ? 'the voice key was refused (OPENAI_API_KEY)' : 'the voice service answered ' + r.status); e.status = 502; throw e; }
  return { audio_b64: Buffer.from(await r.arrayBuffer()).toString('base64'), mime: 'audio/mpeg', voice: voice(), chars: input.length };
}
function attach(app) {
  const { auth } = require('./fuel-log');
  app.get('/voice/speak', (req, res) => { if (!auth(req, res)) return; res.json({ on: !!key(), voice: voice() }); });
  app.post('/voice/speak', async (req, res) => { if (!auth(req, res)) return;
    try {
      if (!key()) return res.status(503).json({ off: true, error: 'no voice key set (OPENAI_API_KEY in Netlify): the phone voice is used' });
      const out = await speech((req.body || {}).text);
      if (!out) return res.status(400).json({ error: 'nothing to say' });
      res.json(out);
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
}
module.exports = { attach, clean, speech, MAX };
