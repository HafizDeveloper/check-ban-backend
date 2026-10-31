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
        const client = parsed.protocol === 'http:' ? http : https; 
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

const INFO_LOOKUP_TIMEOUT_MS = 12000;

const DEFAULT_GAMESKINBO_KEY = 'MHTPZ_TWFybEXrBH6X-3GxNtQP62jxgo0rAPsx6CON4';
const SUPREMEFF_URL = 'https://x-api-services.supremeff.online/visit';

// HL Gaming Official — sumber kedua yang cover gap supremeff (dia ada data
// untuk hampir semua UID, termasuk yang supremeff takde). Percuma tapi ada
// had harian, jadi ia hanya dipanggil bila supremeff gagal.
// Boleh ditukar melalui env: HL_USER_UID / HL_API_KEY (matikan: HL_API=off)
const DEFAULT_HL_USER_UID = '1Rppn18RgqaN2qZNyT1etb9eTDh2';
const DEFAULT_HL_API_KEY = 'pET26oZTgxn7O7Ig354wCGjwEzF14t';
const HL_ACCOUNT_URL = 'https://proapis.hlgamingofficial.com/main/games/freefire/account/api';
// Region default (paling lazim untuk audience site ni) kalau caller tak hantar
// region. HL perlukan region yang BETUL — salah region dia balas 404.
const HL_DEFAULT_REGIONS = ['SG', 'ID', 'IND', 'BD'];

// "off" / "0" / "disabled" / "none" mematikan source.
// Nilai kosong TAK mematikan apa-apa — itu risiko bila salin .env.example
// ke Render tanpa isi.
function envDisabled(name) {
    return /^(off|0|disabled|none)$/i.test((process.env[name] || '').trim());
}

// Node tak hantar User-Agent secara default; di belakang Cloudflare kadangkala
// request tanpa UA kena 403.
const BROWSER_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function getInfoTargets(uid, region) {
    const INFO_API_URL = process.env.INFO_API_URL;
    const INFO_API_KEY = process.env.INFO_API_KEY;
    const INFO_API_HEADER = process.env.INFO_API_HEADER || 'x-api-key';
    const targets = [];

    if (INFO_API_URL && INFO_API_KEY) {
        targets.push({
            source: 'info_api_env',
            url: INFO_API_URL
                .replace('{uid}', encodeURIComponent(uid))
                .replace('{region}', encodeURIComponent(region || '')),
            headers: { [INFO_API_HEADER]: INFO_API_KEY },
        });
    }

    // supremeff pulangkan {PlayerName, Region, Level, UID, VisitCount} sahaja
    // — cukup untuk kad nickname, tapi tak cukup untuk paparan Info Player
    // penuh. Jadi ia hanya untuk laluan nickname (nicknameOnly).
    if (!envDisabled('SUPREMEFF_API')) {
        targets.push({
            source: 'supremeff',
            nicknameOnly: true,
            url: `${SUPREMEFF_URL}?uid=${encodeURIComponent(uid)}&server_name=${encodeURIComponent(String(region || '').toUpperCase())}`,
            headers: { Accept: 'application/json', 'User-Agent': BROWSER_UA },
        });
    }

    // HL Gaming — satu target bagi setiap kandidat region (cuba berurutan
    // sampai satu berjaya). Ia dipanggil hanya bila supremeff gagal, jadi
    // kuota harian tak terbazir untuk UID yang supremeff memang dah ada.
    const hlCreds = getEnabledHlCreds();
    if (hlCreds) {
        for (const reg of hlRegions(region)) {
            targets.push({
                source: 'hlgaming',
                url:
                    `${HL_ACCOUNT_URL}?sectionName=AccountInfo` +
                    `&PlayerUid=${encodeURIComponent(uid)}` +
                    `&region=${encodeURIComponent(reg)}` +
                    `&useruid=${encodeURIComponent(hlCreds.useruid)}` +
                    `&api=${encodeURIComponent(hlCreds.apiKey)}`,
                headers: { Accept: 'application/json', 'User-Agent': BROWSER_UA },
            });
        }
    }

    const gameskinboKey = getEnabledGameskinboKey();
    // Bila gameskinbo tengah rosak (pemutus litar terbuka), lompati dia terus
    // supaya kuota bulanan tak dibakar sia-sia — kecuali dia memang satu-satu
    // sumber yang ada.
    if (gameskinboKey && (!gameskinboBreaker.isOpen() || targets.length === 0)) {
        targets.push({
            source: 'gameskinbo',
            onResult: (ok) => gameskinboBreaker.note(ok),
            url: `https://api.gameskinbo.com/ff-info/get?uid=${encodeURIComponent(uid)}&region=${encodeURIComponent(region || '')}`,
            headers: {
                'x-api-key': gameskinboKey,
                'User-Agent': BROWSER_UA,
                'Accept-Language': 'en-US,en;q=0.9',
            },
        });
    }

    return targets;
}

// Nilai key gameskinbo yang aktif.
// Nilai kosong ("") TAK bermakna matikan — itu risiko bila salin .env.example
// ke Render tanpa isi. Nak matikan betul-betul guna: GAMESKINBO_API_KEY=off
function getEnabledGameskinboKey() {
    const envKey = (process.env.GAMESKINBO_API_KEY || '').trim();
    if (/^(off|0|disabled|none)$/i.test(envKey)) return '';
    return envKey || DEFAULT_GAMESKINBO_KEY;
}

// Kredensial HL Gaming. Env mengatasi nilai sedia dalam kod; "" atau "off"
// mematikan source ni (senang kalau kuota harian habis dan tak mahu ia dipanggil).
function getEnabledHlCreds() {
    if (envDisabled('HL_API')) return null;
    const useruid = (process.env.HL_USER_UID || DEFAULT_HL_USER_UID).trim();
    const apiKey = (process.env.HL_API_KEY || DEFAULT_HL_API_KEY).trim();
    if (!useruid || !apiKey) return null;
    if (/^(off|0|disabled|none)$/i.test(apiKey)) return null;
    return { useruid, apiKey };
}

// Senarai region yang akan dicuba untuk HL Gaming — kunci kerana endpoint dia
// wajibkan region yang betul (salah = 404). Caller dahulu, kemudian default.
function hlRegions(region) {
    const wanted = String(region || '').trim().toUpperCase();
    const list = [];
    const add = (r) => {
        if (r && !list.includes(r) && list.length < 4) list.push(r);
    };
    add(wanted);
    for (const r of HL_DEFAULT_REGIONS) add(r);
    return list;
}

// Pemutus litar (circuit breaker) untuk gameskinbo.
// Kuota dia cuma 50 panggilan/bulan, dan dia PERNAH pulangkan 402 untuk semua
// UID berminggu-minggu. Tanpa pemutus ni, setiap UID yang gagal masih bakar
// 1 kredit kuota setiap 60 saat. Lepas 3 kegagalan berturut, dia berehat 30
// minit — supremeff terus dipakai, gameskinbo tunggu sihat.
const GAMESKINBO_BREAKER_FAILS = 3;
const GAMESKINBO_BREAKER_MS = 30 * 60 * 1000;
const gameskinboBreaker = {
    fails: 0,
    openUntil: 0,
    isOpen() {
        return Date.now() < this.openUntil;
    },
    note(ok) {
        if (ok) {
            this.fails = 0;
            this.openUntil = 0;
            return;
        }
        this.fails += 1;
        if (this.fails >= GAMESKINBO_BREAKER_FAILS) {
            this.fails = 0;
            this.openUntil = Date.now() + GAMESKINBO_BREAKER_MS;
        }
    },
};

const INFO_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const INFO_FAIL_TTL_MS = 60 * 1000;
const infoCache = new Map(); // `${uid}|${region}` -> { body, error, expiresAt }

// Rekod beberapa panggilan terakhir — dipaparkan oleh /api/info-config supaya
// bila nickname tak keluar kat live, kita boleh nampak status sebenar yang
// diterima dari IP server (403? 429? 500?).
const recentInfoCalls = [];
function noteInfoCall(entry) {
    recentInfoCalls.push(Object.assign({ at: new Date().toISOString() }, entry));
    while (recentInfoCalls.length > 8) recentInfoCalls.shift();
}

// Kuota harian HL Gaming (had 25/hari) — dikemas kini setiap respons berjaya.
let hlUsage = null;

// Sembunyikan identifier sensitif bila papar URL sumber dalam /api/info-config
// (endpoint debug ni terbuka kepada sesiapa — tak boleh bocorkan API key).
function maskDebugUrl(url) {
    return String(url)
        .replace(/([?&](?:uid|PlayerUid|playeruid|login_id)=)[^&]*/gi, '$1<uid>')
        .replace(/([?&](?:api|apikey|api_key|key|token)=)[^&]*/gi, '$1***');
}

async function fetchInfo(uid, region, opts) {
    const forNickname = !!(opts && opts.forNickname);
    // Source "nicknameOnly" (supremeff) hanya ada nama + level + region —
    // tak cukup untuk paparan Info Player penuh. Skip bila caller mahukan
    // respons mentah penuh.
    const targets = getInfoTargets(uid, region)
        .filter((t) => forNickname || !t.nicknameOnly);

    if (!targets.length) {
        const err = new Error('Info API not configured');
        err.notConfigured = true;
        throw err;
    }

    // Keputusan berjaya disimpan 12 jam (nickname jarang berubah, dan kuota
    // source percuma/berbayar sangat kecil). Kegagalan 60 saat sahaja —
    // supaya bila source pulih, cubaan seterusnya terus jalan.
    const cacheKey = `${uid}|${region || ''}|${forNickname ? 'nick' : 'full'}`;
    const cached = infoCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        if (cached.value) return cached.value;
        throw cached.error;
    }

    const remember = (value, error, ttl) => {
        if (infoCache.size > 500) infoCache.clear();
        infoCache.set(cacheKey, { value, error, expiresAt: Date.now() + ttl });
    };

    // Kumpulkan semua kegagalan (bukan yang terakhir je) supaya info_error
    // tunjukkan punca setiap source, bukan satu source terakhir sahaja.
    const errors = [];

    for (const target of targets) {
        const started = Date.now();
        let response;
        try {
            response = await fetchWithHeaders(target.url, target.headers, INFO_LOOKUP_TIMEOUT_MS);
        } catch (err) {
            if (target.onResult) target.onResult(false);
            noteInfoCall({ source: target.source, status: 0, ms: Date.now() - started, body: err.message });
            errors.push(`[${target.source}] ${err.message}`);
            continue;
        }

        // Simpan sedikit body bila gagal — "Info API HTTP 403" sahaja tak
        // beritahu sama ada server kita kena block, key salah, atau kuota habis.
        const snippet = String(response.body || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        const httpOk = response.status === 200 && !!response.body;
        let note = 'ok';

        if (target.onResult) target.onResult(httpOk);

        if (!httpOk) {
            note = snippet || '(empty response)';
            errors.push(`[${target.source}] HTTP ${response.status}${snippet ? ` — ${snippet.slice(0, 100)}` : ''}`);
            noteInfoCall({ source: target.source, status: response.status, ms: Date.now() - started, body: note });
            continue;
        }

        let parsed = null;
        let info = null;
        try {
            parsed = JSON.parse(response.body);
            info = extractAccountInfo(parsed);
        } catch (parseErr) {
            note = `JSON tak sah: ${parseErr.message}`;
        }

        // HL Gaming lapor kuota harian dalam setiap respons (had 25/hari).
        // Simpan untuk /api/info-config supaya mudah nampak bila nak habis.
        if (target.source === 'hlgaming' && parsed && parsed.usage) {
            hlUsage = Object.assign({ at: new Date().toISOString() }, parsed.usage);
        }
        const useful = !!(info && (info.nickname || info.region));

        // Bila cari nickname, jawapan 200 yang kosong tetap dianggap gagal —
        // biar source seterusnya cuba.
        if (forNickname && !useful) {
            if (note === 'ok') note = 'tiada nickname/region dalam respons';
            errors.push(`[${target.source}] ${note}`);
            noteInfoCall({ source: target.source, status: response.status, ms: Date.now() - started, body: note });
            continue;
        }

        noteInfoCall({ source: target.source, status: response.status, ms: Date.now() - started, body: note });

        const value = {
            raw: response.body,
            nickname: info ? info.nickname || '' : '',
            region: info ? info.region || region || '' : (region || ''),
            source: target.source,
        };
        remember(value, null, INFO_CACHE_TTL_MS);
        return value;
    }

    const err = new Error(errors.join(' · ') || 'Info API gagal');
    remember(null, err, INFO_FAIL_TTL_MS);
    throw err;
}

function extractAccountInfo(raw) {
    if (!raw || typeof raw !== 'object') return null;

    let d = raw;
    if (!d.basicInfo && !d.AccountInfo && !d.accountInfo && (d.data || d.result || d.response)) {
        d = d.data || d.result || d.response;
    }
    if (!d || typeof d !== 'object') return null;

    if (d.basicInfo) {
        return {
            nickname: d.basicInfo.nickname || '',
            region: d.basicInfo.region || '',
        };
    }

    const a = d.AccountInfo || d.accountInfo;
    if (a) {
        return {
            nickname: a.AccountName || a.nickname || a.name || '',
            region: a.AccountRegion || a.region || '',
        };
    }

    // Flat shape: {nickname}, {player_name}, {name}, {PlayerNickname}, {uid}
    // Termasuk bentuk rasmi Garena / HL Gaming: {AccountName, AccountRegion},
    // dan bentuk supremeff: {PlayerName, Region, Level, UID, VisitCount}.
    const nickname =
        d.nickname || d.AccountName || d.accountName || d.PlayerName ||
        d.player_name || d.PlayerNickname || d.playerName || d.name ||
        d.userName || '';
    const region =
        d.region || d.Region || d.AccountRegion || d.accountRegion ||
        d.server || d.serverRegion || d.server_name || d.GameServerID || '';
    if (nickname || region) return { nickname, region };

    return null;
}

async function lookupAccountInfo(uid, region) {
    const result = await fetchInfo(uid, region, { forNickname: true });

    return {
        nickname: result.nickname || '',
        region: result.region || region || '',
        source: result.source || 'info_api',
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

        // Jalankan SERENTAK: ban check (Garena) dan nickname lookup (info API).
        // Kalau berurutan, masa = kedua-dua tambah-tambah (4-10 saat); serentak,
        // masa ikut yang paling lambat sahaja.
        const banPromise = (async () => {
            const response = await fetchWithHeaders(banUrl, {
                'X-Requested-With': 'B6FksShzIgjfrYImLpTsadjS86sddhFH',
                'Referer': 'https://ff.garena.com/en/support/'
            });

            if (!response.body) {
                throw new Error('Empty response from upstream API');
            }

            const parsed = JSON.parse(response.body);
            return {
                is_banned: parsed.data ? parsed.data.is_banned : 0,
                ban_period_months: parsed.data ? parsed.data.period : 0,
            };
        })();

        // Best-effort nickname/region lookup — never fails the ban check.
        const infoPromise = lookupAccountInfo(uid, region)
            .then((info) => ({ info }))
            .catch((error) => ({ error }));

        const [ban, infoRes] = await Promise.all([banPromise, infoPromise]);

        const result = Object.assign({
            nickname: '',
            region: '',
            info_source: 'unconfigured',
        }, ban);

        if (infoRes.info && infoRes.info.nickname) {
            result.nickname = infoRes.info.nickname;
            result.region = infoRes.info.region || '';
            result.info_source = infoRes.info.source || 'info_api';
        } else if (infoRes.info) {
            result.region = infoRes.info.region || '';
            result.info_source = infoRes.info.source || 'info_api';
        } else if (infoRes.error) {
            // 'unconfigured' hanya untuk "memang takde sumber diset". Kalau
            // sumber ada tapi panggilan gagal, sebut 'error' + sebabnya —
            // front-end dan /api/info-config boleh tunjuk sebab sebenar.
            result.info_source = infoRes.error.notConfigured ? 'unconfigured' : 'error';
            result.info_error = String(infoRes.error.message || '').slice(0, 400);
            console.warn('[ban-check] nickname lookup skipped:', infoRes.error.message);
        } else {
            result.info_source = 'no_data';
        }

        res.json(result);
    } catch (err) {
        res.status(502).json({ error: 'Unable to fetch upstream API', details: err.message });
    }
});

// Debug: konfigurasi sumber info + panggilan terakhir + kuota bulanan.
// Bila nickname tak keluar kat live, buka endpoint ni untuk nampak sebab
// sebenar (403? key matikan? kuota habis?). Key dipaparkan 4 huruf sahaja.
app.get('/api/info-config', async (req, res) => {
    const targets = getInfoTargets('0', '');
    const envKeyRaw = process.env.GAMESKINBO_API_KEY;
    const key = getEnabledGameskinboKey();

    const out = {
        sources: targets.map((t) => ({
            source: t.source,
            nicknameOnly: !!t.nicknameOnly,
            url: maskDebugUrl(t.url),
        })),
        keyLast4: key ? key.slice(-4) : null,
        env: {
            INFO_API_URL: process.env.INFO_API_URL ? 'set' : 'unset',
            INFO_API_KEY: process.env.INFO_API_KEY
                ? `set (${process.env.INFO_API_KEY.length} char)`
                : 'unset',
            GAMESKINBO_API_KEY:
                envKeyRaw === undefined
                    ? 'unset -> pakai key dalam kod'
                    : envKeyRaw.trim() === ''
                        ? 'set tapi KOSONG -> kini pakai key dalam kod'
                        : /^(off|0|disabled|none)$/i.test(envKeyRaw.trim())
                            ? 'off -> source dimatikan'
                            : 'set (custom key)',
            HL_API: envDisabled('HL_API')
                ? 'off -> source dimatikan'
                : getEnabledHlCreds()
                    ? 'aktif (key dalam kod / env)'
                    : 'tiada kredensial',
        },
        cacheEntries: infoCache.size,
        hlgamingUsage: hlUsage,
        gameskinboBreaker: {
            open: gameskinboBreaker.isOpen(),
            openUntil: gameskinboBreaker.openUntil
                ? new Date(gameskinboBreaker.openUntil).toISOString()
                : null,
            consecutiveFails: gameskinboBreaker.fails,
        },
        recentCalls: recentInfoCalls.slice(-8),
    };

    // Kuota bulanan free plan. Panggilan ni untuk semakan usage sahaja.
    if (key) {
        try {
            const usage = await fetchWithHeaders(
                'https://api.gameskinbo.com/api/usage',
                { 'x-api-key': key },
                6000
            );
            out.usage = {
                status: usage.status,
                body: String(usage.body || '').replace(/\s+/g, ' ').trim().slice(0, 200),
            };
        } catch (err) {
            out.usage = { status: 0, body: err.message };
        }
    }

    res.json(out);
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

    try {
        // Laluan ini untuk paparan Info Player penuh — source yang hanya
        // ada nickname (supremeff) memang dikecualikan dalam fetchInfo().
        const result = await fetchInfo(uid, region, { forNickname: false });
        res.type('json').send(result.raw);
    } catch (err) {
        if (err.notConfigured) {
            return res.status(503).json({
                error: 'Info API not configured',
                hint: 'Set INFO_API_URL and INFO_API_KEY, or leave GAMESKINBO_API_KEY enabled',
            });
        }
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
