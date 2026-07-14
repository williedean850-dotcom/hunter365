const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();

// Accept larger JSON bodies (for base64 images)
app.use(cors());
app.use(express.json({ limit: '25mb' }));

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const IMAGE_MODEL = 'imagen-4.0-generate-001';
const MONTHLY_IMAGE_LIMIT = 250;
const USAGE_FILE = path.join(__dirname, 'image-usage.json');

if (!GEMINI_KEY) console.warn('Warning: GEMINI_API_KEY not set. Set it in your Render environment variables.');

app.get('/health', (req, res) => res.json({ ok: true }));

// ---------- Text chat (unchanged) ----------
app.post('/api/ask', async (req, res) => {
  try {
    if (!GEMINI_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not set on server.' });

    const payload = req.body || {};
    const model = payload.model || DEFAULT_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;

    const parts = [];
    if (payload.user) parts.push({ text: payload.user });

    if (payload.photo_b64) {
      parts.push({
        inline_data: {
          mime_type: payload.mime_type || 'image/jpeg',
          data: payload.photo_b64
        }
      });
    }

    const body = {
      contents: [{ role: 'user', parts }]
    };

    if (payload.system) {
      body.system_instruction = { parts: [{ text: payload.system }] };
    }

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await r.json();
    if (!r.ok) {
      console.error('Gemini error:', data);
      return res.status(r.status).json(data);
    }

    const assistantText = (data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text) || '';

    return res.json({ content: [{ type: 'text', text: assistantText }], raw: data });
  } catch (err) {
    console.error('Server error in /api/ask:', err);
    return res.status(500).json({ error: String(err) });
  }
});

// ---------- Usage counter helpers ----------
function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function readUsage() {
  try {
    const raw = fs.readFileSync(USAGE_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (data.month !== currentMonthKey()) {
      return { month: currentMonthKey(), count: 0 };
    }
    return data;
  } catch (e) {
    return { month: currentMonthKey(), count: 0 };
  }
}

function writeUsage(usage) {
  try {
    fs.writeFileSync(USAGE_FILE, JSON.stringify(usage));
  } catch (e) {
    console.error('Could not save usage file:', e);
  }
}

// ---------- Real image generation ----------
app.post('/api/generate-image', async (req, res) => {
  try {
    if (!GEMINI_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not set on server.' });

    const usage = readUsage();
    if (usage.count >= MONTHLY_IMAGE_LIMIT) {
      return res.status(429).json({ error: `Monthly image limit of ${MONTHLY_IMAGE_LIMIT} reached. Limit resets next month.` });
    }

    const payload = req.body || {};
    const prompt = (payload.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'No prompt provided.' });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:predict?key=${GEMINI_KEY}`;
    const body = {
      instances: [{ prompt }],
      parameters: { sampleCount: 1 }
    };

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await r.json();
    if (!r.ok) {
      console.error('Imagen error:', data);
      return res.status(r.status).json(data);
    }

    const imageB64 = data.predictions &&
      data.predictions[0] &&
      data.predictions[0].bytesBase64Encoded;

    if (!imageB64) {
      return res.status(500).json({ error: 'No image returned. Try a different description.' });
    }

    usage.count += 1;
    writeUsage(usage);

    return res.json({
      image_b64: imageB64,
      remaining: MONTHLY_IMAGE_LIMIT - usage.count
    });
  } catch (err) {
    console.error('Server error in /api/generate-image:', err);
    return res.status(500).json({ error: String(err) });
  }
});

app.get('/api/image-usage', (req, res) => {
  const usage = readUsage();
  res.json({ used: usage.count, limit: MONTHLY_IMAGE_LIMIT, remaining: MONTHLY_IMAGE_LIMIT - usage.count });
});

// ---------- Photo helper (unchanged, uses /api/ask) ----------

// Serve static files from the repo root so the same Render service can host frontend + proxy
app.use(express.static(path.join(__dirname)));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
