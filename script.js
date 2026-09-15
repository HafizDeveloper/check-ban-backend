const BACKEND_URL = 'https://check-ban-backend.onrender.com';
const API_BASE = `${BACKEND_URL}/api/player/`;
const INFO_API_BASE = 'https://info-ob49.onrender.com/api/account/';

// Telegram logging is now handled by the Render backend so the bot token is hidden.

// CORS proxy fallbacks — tried in order if direct fetch fails
const CORS_PROXIES = [
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

// Region flag + name map
const REGION_MAP = {
    'SG': { flag: '🇸🇬', name: 'Singapore' },
    'ID': { flag: '🇮🇩', name: 'Indonesia' },
    'BR': { flag: '🇧🇷', name: 'Brazil' },
    'US': { flag: '🇺🇸', name: 'United States' },
    'IND': { flag: '🇮🇳', name: 'India' },
    'BD': { flag: '🇧🇩', name: 'Bangladesh' },
    'TH': { flag: '🇹🇭', name: 'Thailand' },
    'VN': { flag: '🇻🇳', name: 'Vietnam' },
    'TW': { flag: '🇹🇼', name: 'Taiwan' },
    'RU': { flag: '🇷🇺', name: 'Russia' },
    'ME': { flag: '🌍', name: 'Middle East' },
    'PK': { flag: '🇵🇰', name: 'Pakistan' },
    'SAC': { flag: '🌎', name: 'South America' },
    'NA': { flag: '🇺🇸', name: 'North America' },
    'EU': { flag: '🇪🇺', name: 'Europe' },
    'CIS': { flag: '🌍', name: 'CIS' },
    'MENA': { flag: '🌍', name: 'MENA' },
};

function getRegionDisplay(regionCode) {
    const code = (regionCode || '').toUpperCase();
    const info = REGION_MAP[code];
    if (info) return `${info.flag} ${info.name}`;
    return code || 'Unknown';
}

let searchHistory = [];
let stats = { total: 0, banned: 0, clean: 0, today: 0, todayDate: '' };

try {
    searchHistory = JSON.parse(localStorage.getItem('infoplayer_history') || '[]');
} catch (e) { searchHistory = []; }

try {
    stats = JSON.parse(localStorage.getItem('infoplayer_stats') || '{}');
    if (!stats.total) stats = { total: 0, banned: 0, clean: 0, today: 0, todayDate: '' };
} catch (e) { stats = { total: 0, banned: 0, clean: 0, today: 0, todayDate: '' }; }

const today = new Date().toDateString();
if (stats.todayDate !== today) {
    stats.today = 0;
    stats.todayDate = today;
    saveStats();
}

document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initMobileToggle();
    updateClock();
    setInterval(updateClock, 1000);
    updateStats();
    renderRecentList();
    renderHistoryList();

    document.getElementById('dashUidInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performCheck('dash');
    });
    document.getElementById('uidInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performCheck('main');
    });
    document.getElementById('infoUidInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performInfoCheck();
    });

    ['dashUidInput', 'uidInput', 'infoUidInput'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/[^0-9]/g, '');
            });
        }
    });
});

function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view');

    const viewMap = {
        'nav-dashboard': { view: 'view-dashboard', title: 'Dashboard', subtitle: 'Welcome to InfoPlayer Dashboard' },
        'nav-checker': { view: 'view-checker', title: 'Ban Checker', subtitle: 'Check player ban status' },
        'nav-info': { view: 'view-info', title: 'Info Player', subtitle: 'Detailed account information' },
        'nav-history': { view: 'view-history', title: 'Search History', subtitle: 'Your previous searches' }
    };

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const config = viewMap[item.id];
            if (!config) return;
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            views.forEach(v => v.classList.remove('active'));
            document.getElementById(config.view).classList.add('active');
            document.getElementById('pageTitle').textContent = config.title;
            document.getElementById('pageSubtitle').textContent = config.subtitle;
            document.getElementById('sidebar').classList.remove('open');
        });
    });
}

function initMobileToggle() {
    const toggle = document.getElementById('mobileToggle');
    const sidebar = document.getElementById('sidebar');
    toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && !sidebar.contains(e.target) && !toggle.contains(e.target)) {
            sidebar.classList.remove('open');
        }
    });
}

function updateClock() {
    const now = new Date();
    const opts = { weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true };
    document.getElementById('currentTime').textContent = now.toLocaleString('en-US', opts);
}

async function smartFetch(url) {
    // 1) Try direct fetch first
    try {
        console.log('[InfoPlayer] Trying direct fetch:', url);
        const res = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
        if (res.ok) {
            console.log('[InfoPlayer] Direct fetch succeeded!');
            return await res.text();
        }
        // If we get a non-CORS HTTP error, throw it
        throw new Error(`HTTP ${res.status}`);
    } catch (directErr) {
        console.warn('[InfoPlayer] Direct fetch failed:', directErr.message);
    }

    // 2) Try each CORS proxy as fallback
    for (let i = 0; i < CORS_PROXIES.length; i++) {
        const proxyUrl = CORS_PROXIES[i](url);
        try {
            console.log(`[InfoPlayer] Trying proxy ${i + 1}:`, proxyUrl);
            const res = await fetch(proxyUrl, { method: 'GET' });
            if (res.ok) {
                const text = await res.text();
                // Validate it's JSON
                JSON.parse(text);
                console.log(`[InfoPlayer] Proxy ${i + 1} succeeded!`);
                return text;
            }
        } catch (proxyErr) {
            console.warn(`[InfoPlayer] Proxy ${i + 1} failed:`, proxyErr.message);
        }
    }

    // All methods failed
    throw new Error('Cannot connect to API. All connection methods failed. Please check your internet connection and try again.');
}

async function performCheck(source) {
    let uid, btn;

    if (source === 'dash') {
        uid = document.getElementById('dashUidInput').value.trim();
        btn = document.getElementById('dashCheckBtn');
    } else {
        uid = document.getElementById('uidInput').value.trim();
        btn = document.getElementById('checkBtn');
    }

    if (!uid) {
        showError('⚠️ Please enter a Player UID to check.');
        shakeInput(source === 'dash' ? 'dashUidInput' : 'uidInput');
        return;
    }

    // Loading
    btn.classList.add('loading');
    btn.disabled = true;
    hideResults();

    try {
        const apiUrl = `${API_BASE}${encodeURIComponent(uid)}/ban-check`;
        const text = await smartFetch(apiUrl);

        console.log('[InfoPlayer] Raw response:', text);

        let data;
        try {
            data = JSON.parse(text);
        } catch (parseErr) {
            throw new Error('Invalid response from API. Please try again.');
        }

        console.log('[InfoPlayer] Parsed data:', data);

        // Normalize: unwrap nested data property if present
        if (data && typeof data === 'object' && !data.isBanned && !data.banned && !data.nickname && !data.playerName) {
            if (data.data) {
                console.log('[InfoPlayer] Unwrapping nested .data:', data.data);
                data = data.data;
            } else if (data.result) {
                console.log('[InfoPlayer] Unwrapping nested .result:', data.result);
                data = data.result;
            } else if (data.response) {
                console.log('[InfoPlayer] Unwrapping nested .response:', data.response);
                data = data.response;
            }
        }

        // Normalize field names from various API formats
        if (data.isBanned === undefined && data.banned === undefined) {
            if (data.is_banned !== undefined) data.isBanned = !!data.is_banned;
            else if (data.banStatus !== undefined) data.isBanned = data.banStatus === true || data.banStatus === 'banned';
            else if (data.BanStatus !== undefined) data.isBanned = data.BanStatus === true || data.BanStatus === 'banned' || data.BanStatus === 1;
            else if (data.status === 'banned' || data.status === 'BANNED') data.isBanned = true;
            else if (data.ban !== undefined) data.isBanned = !!data.ban;
            else if (data.isBan !== undefined) data.isBanned = !!data.isBan;
        }
        if (data.nickname === undefined && data.playerName === undefined) {
            if (data.name !== undefined) data.nickname = data.name;
            else if (data.player_name !== undefined) data.nickname = data.player_name;
            else if (data.PlayerNickname !== undefined) data.nickname = data.PlayerNickname;
            else if (data.userName !== undefined) data.nickname = data.userName;
            else if (data.basicInfo && data.basicInfo.nickname) data.nickname = data.basicInfo.nickname;
            else if (data.accountInfo && data.accountInfo.nickname) data.nickname = data.accountInfo.nickname;
        }
        if (data.region === undefined) {
            if (data.server !== undefined) data.region = data.server;
            else if (data.serverRegion !== undefined) data.region = data.serverRegion;
            else if (data.GameServerID !== undefined) data.region = data.GameServerID;
            else if (data.basicInfo && data.basicInfo.region) data.region = data.basicInfo.region;
            else if (data.accountInfo && data.accountInfo.region) data.region = data.accountInfo.region;
        }
        if (data.ban_message === undefined) {
            if (data.reason !== undefined) data.ban_message = data.reason;
            else if (data.banReason !== undefined) data.ban_message = data.banReason;
            else if (data.BanReason !== undefined) data.ban_message = data.BanReason;
            else if (data.message !== undefined) data.ban_message = data.message;
            else if (data.banMessage !== undefined) data.ban_message = data.banMessage;
        }
        if (data.ban_period_months === undefined) {
            if (data.banMonths !== undefined) data.ban_period_months = data.banMonths;
            else if (data.ban_months !== undefined) data.ban_period_months = data.ban_months;
            else if (data.BanPeriod !== undefined) data.ban_period_months = data.BanPeriod;
            else if (data.banPeriod !== undefined) data.ban_period_months = data.banPeriod;
        }

        console.log('[InfoPlayer] Normalized data:', data);

        // Display result
        displayResult(data, uid);

        // Save history
        addToHistory(data, uid);

        // Log to Telegram
        const isBanned = data.isBanned === true || data.banned === true || data.isBanned === 1 || data.banned === 1;
        const logReason = isBanned ? 'This Account We Have Confirm Using Cheat And Use ilegal Softwer' : (data.ban_message || 'N/A');
        sendLogToTelegram(`🚫 *Ban Check Request*\n\nUID: \`${uid}\`\nNickname: *${data.nickname || 'Unknown'}*\nStatus: ${isBanned ? '❌ BANNED' : '✅ CLEAN'}\nRegion: ${data.region || 'Unknown'}\nReason: ${logReason}`);

    } catch (error) {
        console.error('[InfoPlayer] Error:', error);
        showError('❌ ' + (error.message || 'Failed to connect to the API. Please try again later.'));
    } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

async function sendLogToTelegram(message) {
    try {
        await fetch(`${BACKEND_URL}/api/telegram-log`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });
    } catch (err) {
        console.error('[TelegramLog] Failed to send log:', err);
    }
}

async function performInfoCheck() {
    const uid = document.getElementById('infoUidInput').value.trim();
    const region = document.getElementById('infoRegionSelect').value;
    const btn = document.getElementById('infoCheckBtn');
    const resultCard = document.getElementById('infoResultCard');
    const errorCard = document.getElementById('infoErrorCard');

    if (!uid || !region) {
        showInfoError('⚠️ Please enter UID and select a region.');
        if (!uid) shakeInput('infoUidInput');
        return;
    }

    // Loading
    btn.classList.add('loading');
    btn.querySelector('.btn-content').style.display = 'none';
    btn.querySelector('.btn-loader').style.display = 'flex';
    btn.disabled = true;
    resultCard.style.display = 'none';
    errorCard.style.display = 'none';

    try {
        const url = `${INFO_API_BASE}?uid=${uid}&region=${region.toUpperCase()}`;
        const text = await smartFetch(url);
        const data = JSON.parse(text);

        if (!data.basicInfo || !data.basicInfo.nickname) {
            throw new Error('Player data not found. Please check UID and region.');
        }

        displayInfoResult(data);

        // Log to Telegram
        sendLogToTelegram(`👤 *Info Player Request*\n\nUID: \`${uid}\`\nNickname: *${data.basicInfo.nickname}*\nRegion: ${data.basicInfo.region}\nLevel: ${data.basicInfo.level}\nClan: ${data.clanBasicInfo?.clanName || 'None'}`);

    } catch (error) {
        showInfoError('❌ ' + (error.message || 'Failed to fetch player info.'));
    } finally {
        btn.classList.remove('loading');
        btn.querySelector('.btn-content').style.display = 'flex';
        btn.querySelector('.btn-loader').style.display = 'none';
        btn.disabled = false;
    }
}

function showInfoError(msg) {
    document.getElementById('infoResultCard').style.display = 'none';
    document.getElementById('infoErrorMessage').textContent = msg;
    document.getElementById('infoErrorCard').style.display = 'block';
}

function displayInfoResult(data) {
    const body = document.getElementById('infoResultBody');
    const b = data.basicInfo;
    const c = data.clanBasicInfo;
    const s = data.socialInfo;
    const p = data.petInfo;
    const prof = data.profileInfo;
    const leader = data.captainBasicInfo;
    const credit = data.creditScoreInfo;

    const formatTimestamp = (ts) => {
        if (!ts || ts === "0") return "Never";
        const date = new Date(parseInt(ts) * 1000);
        return date.getFullYear() + "-" +
            String(date.getMonth() + 1).padStart(2, '0') + "-" +
            String(date.getDate()).padStart(2, '0') + " " +
            String(date.getHours()).padStart(2, '0') + ":" +
            String(date.getMinutes()).padStart(2, '0') + ":" +
            String(date.getSeconds()).padStart(2, '0');
    };

    const regionDisplay = getRegionDisplay(b.region);

    let textRes = `Player Information
┌ ACCOUNT BASIC INFO
├─ Name: ${escapeHTML(b.nickname)}
├─ UID: ${b.accountId}
├─ Level: ${b.level} (Exp: ${b.exp})
├─ Region: ${regionDisplay}
├─ Likes: ${b.liked.toLocaleString()}
├─ Honor Score: ${credit ? credit.creditScore : '100'}
└─ Signature: ${escapeHTML(s?.signature || 'No signature set')}

┌ ACCOUNT ACTIVITY
├─ Most Recent OB: ${b.releaseVersion || 'Unknown'}
├─ Current BP Badges: ${b.badgeCnt || 0}
├─ BR Rank: ${b.rankingPoints || 0}
├─ CS Rank: ${b.csRankingPoints || 0}
├─ Created At: ${formatTimestamp(b.createAt)}
└─ Last Login: ${formatTimestamp(b.lastLoginAt)}

┌ ACCOUNT OVERVIEW
├─ Avatar ID: ${b.headPic || prof?.avatarId || 'N/A'}
├─ Banner ID: ${b.bannerId || 'N/A'}
├─ Pin ID: ${b.pinId || 'N/A'}
└─ Equipped Skills: [${prof?.equipedSkills ? prof.equipedSkills.join(', ') : 'None'}]

┌ PET DETAILS
├─ Equipped?: ${p ? 'Yes' : 'No'}
├─ Pet Name: ${p ? escapeHTML(p.name) : 'Not Found'}
├─ Pet Exp: ${p ? p.exp : '0'}
└─ Pet Level: ${p ? p.level : '0'}
`;

    if (c) {
        textRes += `
┌ GUILD INFO
├─ Guild Name: ${escapeHTML(c.clanName)}
├─ Guild ID: ${c.clanId}
├─ Guild Level: ${c.clanLevel}
├─ Live Members: ${c.memberNum}/${c.capacity}
└─ Leader Info:
    ├─ Leader Name: ${escapeHTML(leader?.nickname || 'Unknown')}
    ├─ Leader UID: ${leader?.accountId || 'N/A'}
    ├─ Leader Level: ${leader?.level || 'N/A'} (Exp: ${leader?.exp || 'N/A'})
    ├─ Last Login: ${formatTimestamp(leader?.lastLoginAt)}
    ├─ Title: ${leader?.title || 'None'}
    ├─ BP Badges: ${leader?.badgeCnt || 0}
    ├─ BR Rank: ${leader?.rankingPoints || 0}
    └─ CS Rank: ${leader?.csRankingPoints || 0}`;
    }

    body.innerHTML = `
        <div class="terminal-info-card">
            <div class="terminal-header">
                <div class="terminal-dot red"></div>
                <div class="terminal-dot yellow"></div>
                <div class="terminal-dot green"></div>
                <span class="terminal-title">PLAYER_DATA_v1.0</span>
            </div>
            <pre class="terminal-content">${textRes}</pre>
        </div>
    `;

    document.getElementById('infoResultCard').style.display = 'block';
    document.getElementById('infoResultCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function displayResult(data, uid) {
    // Switch to checker view if needed
    const checkerView = document.getElementById('view-checker');
    if (!checkerView.classList.contains('active')) {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.getElementById('nav-checker').classList.add('active');
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        checkerView.classList.add('active');
        document.getElementById('pageTitle').textContent = 'Ban Checker';
        document.getElementById('pageSubtitle').textContent = 'Check player ban status';
        document.getElementById('uidInput').value = uid;
    }

    const resultCard = document.getElementById('resultCard');
    const resultBody = document.getElementById('resultBody');
    document.getElementById('errorCard').style.display = 'none';

    // Parse data
    const isBanned = data.isBanned === true || data.banned === true || data.isBanned === 1 || data.isBanned === 'true' || data.banned === 1 || data.banned === 'true';
    const nickname = data.nickname || data.playerName || 'Unknown';
    const region = (data.region || '').toUpperCase();
    const banMessage = isBanned ? 'This Account We Have Confirm Using Cheat And Using ilegal Softwer' : (data.ban_message || 'No reason provided');
    const banMonths = data.ban_period_months;
    const checkedAt = formatDateNice(new Date());
    const regionDisplay = getRegionDisplay(region);

    // Determine ban type
    let isPermanent = false;
    let banDurationText = '';

    if (isBanned) {
        if (!banMonths || banMonths <= 0 || banMonths >= 120) {
            // 0 months or 10+ years = permanent
            isPermanent = true;
            banDurationText = 'Permanent (Kekal)';
        } else {
            isPermanent = false;
            banDurationText = `${banMonths} Month${banMonths > 1 ? 's' : ''} (Sementara)`;
        }
    }

    let html = '';

    if (isBanned) {
        // =====================
        // BANNED CARD
        // =====================
        html = `
            <div class="ban-result-card banned-card">
                <div class="ban-status-header banned-header">
                    <div class="ban-status-icon banned-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="36" height="36">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                        </svg>
                    </div>
                    <div class="ban-status-text">
                        <h2>🔴 Permanently Banned !</h2>
                        <p class="ban-subtitle">This account has been permanently suspended</p>
                    </div>
                </div>

                <div class="ban-details">
                    <div class="ban-detail-row">
                        <div class="ban-detail-icon">📝</div>
                        <div class="ban-detail-content">
                            <span class="ban-detail-label">Reason</span>
                            <span class="ban-detail-value ban-reason-text">${escapeHTML(banMessage)}</span>
                        </div>
                    </div>
                    <div class="ban-detail-row">
                        <div class="ban-detail-icon">👤</div>
                        <div class="ban-detail-content">
                            <span class="ban-detail-label">Nickname</span>
                            <span class="ban-detail-value">${escapeHTML(nickname)}</span>
                        </div>
                    </div>
                    <div class="ban-detail-row">
                        <div class="ban-detail-icon">🆔</div>
                        <div class="ban-detail-content">
                            <span class="ban-detail-label">Player UID</span>
                            <span class="ban-detail-value uid-text">${escapeHTML(String(uid))}</span>
                        </div>
                    </div>

                    <div class="ban-detail-row">
                        <div class="ban-detail-icon">📅</div>
                        <div class="ban-detail-content">
                            <span class="ban-detail-label">Checked At</span>
                            <span class="ban-detail-value">${checkedAt}</span>
                        </div>
                    </div>
                    <div class="ban-detail-row">
                        <div class="ban-detail-icon">🌐</div>
                        <div class="ban-detail-content">
                            <span class="ban-detail-label">Region</span>
                            <span class="ban-detail-value">${regionDisplay}</span>
                        </div>
                    </div>
                </div>

                <div class="ban-footer permanent-footer">
                    🔒 This ban is <strong>permanent</strong> and cannot be appealed through normal channels.
                </div>
            </div>
        `;
    } else {
        // =====================
        // CLEAN CARD
        // =====================
        html = `
            <div class="ban-result-card clean-card">
                <div class="ban-status-header clean-header">
                    <div class="ban-status-icon clean-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="36" height="36">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                            <polyline points="22,4 12,14.01 9,11.01"/>
                        </svg>
                    </div>
                    <div class="ban-status-text">
                        <h2>🟢 Account is Clean !</h2>
                        <p class="ban-subtitle">This account has no active bans</p>
                    </div>
                </div>

                <div class="ban-details">
                    <div class="ban-detail-row">
                        <div class="ban-detail-icon">📝</div>
                        <div class="ban-detail-content">
                            <span class="ban-detail-label">Status</span>
                            <span class="ban-detail-value clean-text">${escapeHTML(banMessage)}</span>
                        </div>
                    </div>
                    <div class="ban-detail-row">
                        <div class="ban-detail-icon">👤</div>
                        <div class="ban-detail-content">
                            <span class="ban-detail-label">Nickname</span>
                            <span class="ban-detail-value">${escapeHTML(nickname)}</span>
                        </div>
                    </div>
                    <div class="ban-detail-row">
                        <div class="ban-detail-icon">🆔</div>
                        <div class="ban-detail-content">
                            <span class="ban-detail-label">Player UID</span>
                            <span class="ban-detail-value uid-text">${escapeHTML(String(uid))}</span>
                        </div>
                    </div>
                    <div class="ban-detail-row">
                        <div class="ban-detail-icon">📅</div>
                        <div class="ban-detail-content">
                            <span class="ban-detail-label">Checked At</span>
                            <span class="ban-detail-value">${checkedAt}</span>
                        </div>
                    </div>
                    <div class="ban-detail-row">
                        <div class="ban-detail-icon">🌐</div>
                        <div class="ban-detail-content">
                            <span class="ban-detail-label">Region</span>
                            <span class="ban-detail-value">${regionDisplay}</span>
                        </div>
                    </div>
                </div>

                <div class="ban-footer clean-footer">
                    ✅ This account is in <strong>good standing</strong>. No violations detected.
                </div>
            </div>
        `;
    }

    resultBody.innerHTML = html;
    resultCard.style.display = 'block';
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// =========================================
// HELPERS
// =========================================

function hideResults() {
    document.getElementById('resultCard').style.display = 'none';
    document.getElementById('errorCard').style.display = 'none';
}

function showError(message) {
    document.getElementById('resultCard').style.display = 'none';
    document.getElementById('errorMessage').innerHTML = message;
    document.getElementById('errorCard').style.display = 'block';
}

function shakeInput(id) {
    const el = document.getElementById(id);
    el.style.animation = 'shake 0.4s ease';
    setTimeout(() => el.style.animation = '', 400);
}

function formatDateNice(date) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    if (hours === 0) hours = 12;
    return `${day} ${month}, ${year} ${hours}:${minutes} ${ampm}`;
}

// =========================================
// INJECT EXTRA STYLES
// =========================================

const extraStyles = document.createElement('style');
extraStyles.textContent = `
    @keyframes shake {
        0%, 100% { transform: translateX(0); }
        20% { transform: translateX(-6px); }
        40% { transform: translateX(6px); }
        60% { transform: translateX(-4px); }
        80% { transform: translateX(4px); }
    }

    /* Ban Result Card */
    .ban-result-card {
        border-radius: 16px;
        overflow: hidden;
        animation: slideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes slideUp {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
    }

    /* Status Header */
    .ban-status-header {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 28px;
    }

    .banned-header {
        background: linear-gradient(135deg, rgba(239,68,68,0.12), rgba(239,68,68,0.04));
        border-bottom: 1px solid rgba(239,68,68,0.15);
    }

    .clean-header {
        background: linear-gradient(135deg, rgba(16,185,129,0.12), rgba(16,185,129,0.04));
        border-bottom: 1px solid rgba(16,185,129,0.15);
    }

    .ban-status-icon {
        width: 60px; height: 60px;
        border-radius: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }

    .banned-icon {
        background: rgba(239,68,68,0.15);
        color: #ef4444;
        box-shadow: 0 0 20px rgba(239,68,68,0.2);
    }

    .clean-icon {
        background: rgba(16,185,129,0.15);
        color: #10b981;
        box-shadow: 0 0 20px rgba(16,185,129,0.2);
    }

    .ban-status-text h2 {
        font-size: 1.3rem;
        font-weight: 800;
        letter-spacing: -0.3px;
        margin-bottom: 4px;
    }

    .ban-subtitle {
        font-size: 0.85rem;
        color: var(--text-secondary);
    }

    /* Detail Rows */
    .ban-details {
        padding: 8px 28px;
    }

    .ban-detail-row {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 14px 0;
        border-bottom: 1px solid rgba(99,102,241,0.06);
    }

    .ban-detail-row:last-child {
        border-bottom: none;
    }

    .ban-detail-icon {
        font-size: 1.2rem;
        width: 36px; height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(99,102,241,0.06);
        border-radius: 10px;
        flex-shrink: 0;
    }

    .ban-detail-content {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
        min-width: 0;
    }

    .ban-detail-label {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .ban-detail-value {
        font-size: 0.95rem;
        font-weight: 600;
        color: var(--text-primary);
        word-break: break-word;
    }

    .ban-reason-text {
        color: #f59e0b;
        font-style: italic;
    }

    .uid-text {
        font-family: 'Courier New', monospace;
        letter-spacing: 1px;
        color: var(--accent-blue);
    }

    .permanent-text {
        color: #ef4444;
        font-weight: 700;
    }

    .trial-text {
        color: #f59e0b;
        font-weight: 700;
    }

    .clean-text {
        color: #10b981;
        font-weight: 600;
    }

    /* Footer */
    .ban-footer {
        padding: 16px 28px;
        font-size: 0.82rem;
        line-height: 1.5;
    }

    .permanent-footer {
        background: rgba(239,68,68,0.06);
        color: rgba(239,68,68,0.8);
        border-top: 1px solid rgba(239,68,68,0.1);
    }

    .trial-footer {
        background: rgba(245,158,11,0.06);
        color: rgba(245,158,11,0.8);
        border-top: 1px solid rgba(245,158,11,0.1);
    }

    .clean-footer {
        background: rgba(16,185,129,0.06);
        color: rgba(16,185,129,0.8);
        border-top: 1px solid rgba(16,185,129,0.1);
    }

    .ban-footer strong {
        color: inherit;
        font-weight: 700;
    }

    /* Badge extras */
    .badge-permanent {
        background: rgba(239,68,68,0.15);
        color: #ef4444;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 10px;
        border-radius: 50px;
        font-size: 0.75rem;
        font-weight: 600;
    }

    .badge-trial {
        background: rgba(245,158,11,0.15);
        color: #f59e0b;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 10px;
        border-radius: 50px;
        font-size: 0.75rem;
        font-weight: 600;
    }

    /* Responsive */
    @media (max-width: 480px) {
        .ban-status-header {
            flex-direction: column;
            text-align: center;
            padding: 24px 20px;
        }
        .ban-details {
            padding: 8px 20px;
        }
        .ban-footer {
            padding: 14px 20px;
            text-align: center;
        }
        .ban-status-text h2 {
            font-size: 1.1rem;
        }
    }
`;
document.head.appendChild(extraStyles);

// =========================================
// HISTORY
// =========================================

function addToHistory(data, uid) {
    const isBanned = data.isBanned === true || data.banned === true || data.isBanned === 1 || data.banned === 1;
    const nickname = data.nickname || data.playerName || 'Unknown';
    const region = (data.region || '').toUpperCase();
    const banMessage = isBanned ? 'This Account We Have Confirm Using Cheat And Using ilegal Softwer' : (data.ban_message || '-');
    const banMonths = data.ban_period_months;

    let banType = 'none';
    if (isBanned) {
        banType = (!banMonths || banMonths <= 0 || banMonths >= 120) ? 'permanent' : 'trial';
    }

    const entry = {
        uid,
        region,
        nickname,
        isBanned,
        banMessage,
        banMonths,
        banType,
        timestamp: Date.now()
    };

    searchHistory.unshift(entry);
    if (searchHistory.length > 50) searchHistory.pop();
    localStorage.setItem('infoplayer_history', JSON.stringify(searchHistory));

    stats.total++;
    stats.today++;
    if (isBanned) stats.banned++;
    else stats.clean++;
    saveStats();

    updateStats();
    renderRecentList();
    renderHistoryList();
}

function clearHistory() {
    if (!confirm('Clear all search history?')) return;
    searchHistory = [];
    localStorage.setItem('infoplayer_history', '[]');
    stats = { total: 0, banned: 0, clean: 0, today: 0, todayDate: today };
    saveStats();
    updateStats();
    renderRecentList();
    renderHistoryList();
}

function saveStats() {
    localStorage.setItem('infoplayer_stats', JSON.stringify(stats));
}

function updateStats() {
    animateCounter('totalSearches', stats.total);
    animateCounter('bannedFound', stats.banned);
    animateCounter('cleanPlayers', stats.clean);
    animateCounter('todayChecks', stats.today);
}

function animateCounter(id, target) {
    const el = document.getElementById(id);
    const current = parseInt(el.textContent) || 0;
    if (current === target) return;
    const duration = 500;
    const startTime = performance.now();
    function update(t) {
        const p = Math.min((t - startTime) / duration, 1);
        el.textContent = Math.round(current + (target - current) * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
}

function renderRecentList() {
    const container = document.getElementById('recentList');
    const recent = searchHistory.slice(0, 5);
    if (recent.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14,2 14,8 20,8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
                <p>No searches yet. Try checking a player above!</p>
            </div>`;
        return;
    }
    container.innerHTML = recent.map(e => createHistoryItemHTML(e)).join('');
}

function renderHistoryList() {
    const container = document.getElementById('historyList');
    if (searchHistory.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12,6 12,12 16,14"/>
                </svg>
                <p>No history yet. Start checking players!</p>
            </div>`;
        return;
    }
    container.innerHTML = searchHistory.map(e => createHistoryItemHTML(e)).join('');
}

function createHistoryItemHTML(entry) {
    const statusClass = entry.isBanned ? 'banned' : 'clean';
    const statusIcon = entry.isBanned ? '🚫' : '✅';
    const timeAgo = getTimeAgo(entry.timestamp);

    let statusBadge = '<span class="badge badge-clean">✅ Clean</span>';
    if (entry.isBanned) {
        if (entry.banType === 'permanent') {
            statusBadge = '<span class="badge badge-permanent">🔒 Permanent</span>';
        } else if (entry.banType === 'trial') {
            statusBadge = `<span class="badge badge-trial">⏳ ${entry.banMonths}m Ban</span>`;
        } else {
            statusBadge = '<span class="badge badge-banned">🚫 Banned</span>';
        }
    }

    const regionDisplay = getRegionDisplay(entry.region);

    return `
        <div class="history-item" onclick="quickRecheck('${escapeHTML(entry.uid)}')" style="cursor:pointer;" title="Click to re-check this player">
            <div class="history-item-left">
                <div class="history-item-avatar ${statusClass}">${statusIcon}</div>
                <div class="history-item-info">
                    <h4>${escapeHTML(entry.nickname)}</h4>
                    <span>UID: ${escapeHTML(entry.uid)} · ${regionDisplay}</span>
                </div>
            </div>
            <div class="history-item-right">
                ${statusBadge}
                <div class="history-item-time">${timeAgo}</div>
            </div>
        </div>
    `;
}

function quickRecheck(uid) {
    document.getElementById('uidInput').value = uid;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('nav-checker').classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-checker').classList.add('active');
    document.getElementById('pageTitle').textContent = 'Ban Checker';
    document.getElementById('pageSubtitle').textContent = 'Check player ban status';
    performCheck('main');
}

// =========================================
// UTILITIES
// =========================================

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function getTimeAgo(timestamp) {
    const s = Math.floor((Date.now() - timestamp) / 1000);
    if (s < 60) return 'Just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
    return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
