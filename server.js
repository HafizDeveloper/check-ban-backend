const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

function fetchWithHeaders(url, headers, timeoutMs) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const client = parsed.protocol === 'http:' ? http : https; // Info API ada yang hanya http
        const req = client.get(url, {
            headers: { Accept: 'application/json', ...headers },
            hostname: parsed.hostname,
            port: parsed.port || undefined,
            path: parsed.pathname + parsed.search,
            timeout: timeoutMs || 8000,
        }, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('timeout', () => req.destroy(new Error('Request timed out')));
        req.on('error', reject);
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

// Garena's ban API only returns {is_banned, period} — NO nickname/region.
// So we optionally look the account up via the Info API (INFO_API_URL/KEY).
// Returns {nickname, region} or null when not configured / lookup fails.
// The ban result is never blocked by this: it always fails soft within INFO_LOOKUP_TIMEOUT_MS.
const INFO_LOOKUP_TIMEOUT_MS = 4000;

function extractAccountInfo(raw) {
    if (!raw || typeof raw !== 'object') return null;

    let d = raw;
    // Unwrap nested payloads: {data:{...}}, {result:{...}}, {response:{...}}
    if (!d.basicInfo && !d.AccountInfo && !d.accountInfo && (d.data || d.result || d.response)) {
        d = d.data || d.result || d.response;
    }
    if (!d || typeof d !== 'object') return null;

    // free-freefire-main / freefirecommunity shape
    if (d.basicInfo) {
        return {
            nickname: d.basicInfo.nickname || '',
            region: d.basicInfo.region || '',
        };
    }

    // gameskinbo / player-info shape
    const a = d.AccountInfo || d.accountInfo;
    if (a) {
        return {
            nickname: a.AccountName || a.nickname || a.name || '',
            region: a.AccountRegion || a.region || '',
        };
    }

    // Flat shape: {nickname}, {player_name}, {name}, {PlayerNickname}, {uid}
    const nickname = d.nickname || d.player_name || d.PlayerNickname || d.name || d.userName || '';
    const region = d.region || d.server || d.serverRegion || d.GameServerID || '';
    if (nickname || region) return { nickname, region };

    return null;
}

async function lookupAccountInfo(uid, region) {
    const INFO_API_URL = process.env.INFO_API_URL;
    const INFO_API_KEY = process.env.INFO_API_KEY;
    const INFO_API_HEADER = process.env.INFO_API_HEADER || 'x-api-key';

    // Not configured — skip silently (ban status still returned).
    if (!INFO_API_URL || !INFO_API_KEY) return null;

    const target = INFO_API_URL
        .replace('{uid}', encodeURIComponent(uid))
        .replace('{region}', encodeURIComponent(region || ''));

    const response = await fetchWithHeaders(target, { [INFO_API_HEADER]: INFO_API_KEY }, INFO_LOOKUP_TIMEOUT_MS);
    if (!response.body) return null;

    const info = extractAccountInfo(JSON.parse(response.body));
    if (!info) return null;

    return {
        nickname: info.nickname || '',
        region: info.region || region || '',
    };
}

app.get('/api/player/:uid/ban-check', async (req, res) => {
    const uid = String(req.params.uid || '').trim();
    if (!/^[0-9]{1,16}$/.test(uid)) {
        return res.status(400).json({ error: 'Invalid UID' });
    }
    const region = String(req.query.region || '').trim();

    try {
        const banUrl = `https://ff.garena.com/api/antihack/check_banned?lang=en&uid=${encodeURIComponent(uid)}`;
        const response = await fetchWithHeaders(banUrl, {
            'X-Requested-With': 'B6FksShzIgjfrYImLpTsadjS86sddhFH',
            'Referer': 'https://ff.garena.com/en/support/'
        });

        if (!response.body) {
            return res.status(502).json({ error: 'Empty response from upstream API' });
        }

        const parsed = JSON.parse(response.body);

        const result = {
            is_banned: parsed.data ? parsed.data.is_banned : 0,
            ban_period_months: parsed.data ? parsed.data.period : 0,
            nickname: '',
            region: '',
            info_source: 'unconfigured',
        };

        // Best-effort nickname/region lookup — never fails the ban check.
        try {
            const info = await lookupAccountInfo(uid, region);
            if (info && info.nickname) {
                result.nickname = info.nickname;
                result.region = info.region || '';
                result.info_source = 'info_api';
            } else if (info) {
                result.region = info.region || '';
                result.info_source = 'info_api';
            }
        } catch (infoErr) {
            console.warn('[ban-check] nickname lookup skipped:', infoErr.message);
        }

        res.json(result);
    } catch (err) {
        res.status(502).json({ error: 'Unable to fetch upstream API', details: err.message });
    }
});

// Info Player proxy — frontend calls this so the API key stays hidden.
// Configure in .env:
//   INFO_API_URL   = https://example.com/info?uid={uid}&region={region}
//   INFO_API_KEY   = your-key          (leave empty to disable)
//   INFO_API_HEADER = x-api-key        (optional, defaults to x-api-key)
app.get('/api/account', async (req, res) => {
    const uid = String(req.query.uid || '').trim();
    const region = String(req.query.region || '').trim();

    if (!/^[0-9]{1,16}$/.test(uid)) {
        return res.status(400).json({ error: 'Invalid UID' });
    }

    const INFO_API_URL = process.env.INFO_API_URL;
    const INFO_API_KEY = process.env.INFO_API_KEY;
    const INFO_API_HEADER = process.env.INFO_API_HEADER || 'x-api-key';

    if (!INFO_API_URL || !INFO_API_KEY) {
        return res.status(503).json({
            error: 'Info API not configured',
            hint: 'Set INFO_API_URL and INFO_API_KEY in backend .env',
        });
    }

    try {
        const target = INFO_API_URL
            .replace('{uid}', encodeURIComponent(uid))
            .replace('{region}', encodeURIComponent(region));

        const headers = { [INFO_API_HEADER]: INFO_API_KEY };
        const response = await fetchWithHeaders(target, headers);

        if (!response.body) {
            return res.status(502).json({ error: 'Empty response from info API' });
        }

        res.type('json').send(response.body);
    } catch (err) {
        res.status(502).json({ error: 'Unable to fetch info API', details: err.message });
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
