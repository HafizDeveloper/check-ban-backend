<<<<<<< HEAD
const express = require('express');
const cors = require('cors');
const https = require('https');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

function fetchText(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { Accept: 'application/json' } }, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body }));
        }).on('error', reject);
    });
}

function postJson(url, payload) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(payload);
        const parsed = new URL(url);

        const req = https.request(
            {
                hostname: parsed.hostname,
                path: parsed.pathname + parsed.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data)
                }
            },
            (res) => {
                let body = '';
                res.on('data', (chunk) => body += chunk);
                res.on('end', () => resolve({ status: res.statusCode, body }));
            }
        );

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

app.get('/api/player/:uid/ban-check', async (req, res) => {
    const uid = String(req.params.uid || '').trim();
    if (!/^[0-9]{1,16}$/.test(uid)) {
        return res.status(400).json({ error: 'Invalid UID' });
    }

    try {
        const targetUrl = `https://freefirehub.com/api/player/${encodeURIComponent(uid)}/ban-check`;
        const response = await fetchText(targetUrl);

        if (!response.body) {
            return res.status(502).json({ error: 'Empty response from upstream API' });
        }

        const parsed = JSON.parse(response.body);
        res.status(response.status === 200 ? 200 : 502).json(parsed);
    } catch (err) {
        res.status(502).json({ error: 'Unable to fetch upstream API', details: err.message });
    }
});

app.post('/api/telegram-log', async (req, res) => {
    const { message } = req.body || {};
    if (!message) {
        return res.status(400).json({ error: 'Missing message body' });
    }

    if (!TG_TOKEN || !TG_CHAT_ID) {
        return res.status(500).json({ error: 'Telegram bot not configured' });
    }

    try {
        const telegramUrl = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
        const response = await postJson(telegramUrl, {
            chat_id: TG_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });

        const parsed = JSON.parse(response.body || '{}');
        return res.status(response.status === 200 ? 200 : 502).json(parsed);
    } catch (err) {
        return res.status(502).json({ error: 'Telegram request failed', details: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
=======
const express = require('express');
const cors = require('cors');
const https = require('https');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

function fetchText(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { Accept: 'application/json' } }, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body }));
        }).on('error', reject);
    });
}

function postJson(url, payload) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(payload);
        const parsed = new URL(url);

        const req = https.request(
            {
                hostname: parsed.hostname,
                path: parsed.pathname + parsed.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data)
                }
            },
            (res) => {
                let body = '';
                res.on('data', (chunk) => body += chunk);
                res.on('end', () => resolve({ status: res.statusCode, body }));
            }
        );

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

app.get('/api/player/:uid/ban-check', async (req, res) => {
    const uid = String(req.params.uid || '').trim();
    if (!/^[0-9]{1,16}$/.test(uid)) {
        return res.status(400).json({ error: 'Invalid UID' });
    }

    try {
        const targetUrl = `https://freefirehub.com/api/player/${encodeURIComponent(uid)}/ban-check`;
        const response = await fetchText(targetUrl);

        if (!response.body) {
            return res.status(502).json({ error: 'Empty response from upstream API' });
        }

        const parsed = JSON.parse(response.body);
        res.status(response.status === 200 ? 200 : 502).json(parsed);
    } catch (err) {
        res.status(502).json({ error: 'Unable to fetch upstream API', details: err.message });
    }
});

app.post('/api/telegram-log', async (req, res) => {
    const { message } = req.body || {};
    if (!message) {
        return res.status(400).json({ error: 'Missing message body' });
    }

    if (!TG_TOKEN || !TG_CHAT_ID) {
        return res.status(500).json({ error: 'Telegram bot not configured' });
    }

    try {
        const telegramUrl = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
        const response = await postJson(telegramUrl, {
            chat_id: TG_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });

        const parsed = JSON.parse(response.body || '{}');
        return res.status(response.status === 200 ? 200 : 502).json(parsed);
    } catch (err) {
        return res.status(502).json({ error: 'Telegram request failed', details: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
>>>>>>> c101006 (Fix ban checker parsing - support multiple API response formats)
