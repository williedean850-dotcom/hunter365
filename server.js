const express = require('express');
const cors = require('cors');
const app = express();

// Allow larger JSON bodies for images
app.use(cors());
app.use(express.json({ limit: '15mb' }));

const K = process.env.ANTHROPIC_API_KEY;
if (!K) console.warn('Warning: ANTHROPIC_API_KEY is not set. Server will fail forwarding requests without it.');

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/api/ask', async (req, res) => {
  try {
    const payload = req.body || {};

    // Forward request to Anthropic
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // include both header forms to be compatible with different setups
        ...(K ? { Authorization: `Bearer ${K}`, 'x-api-key': K } : {})
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    // Proxy status and content-type back to client
    res.status(response.status);
    const ct = response.headers.get('content-type');
    if (ct) res.set('Content-Type', ct);
    return res.send(text);
  } catch (err) {
    console.error('Error forwarding to Anthropic:', err);
    return res.status(500).json({ error: String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy server listening on port ${PORT}`));
