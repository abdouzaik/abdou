// ─── Downloads ───
import {
    sleep, react, reactWait, reactOk, reactFail,
    normalizeJid, getBotJid,
    readJSON, writeJSON, readJSONSync,
    grpFile, DATA_DIR, BOT_DIR, configObj,
} from './_utils.js';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

async function _ytmp41Poll(progressId, title = '') {
    const headers = {
        'Content-Type':    'application/json',
        'x-rapidapi-host': YTMP41_HOST,
        'x-rapidapi-key':  YTMP41_KEY,
    };
    const MAX_TRIES = 15;
    const INTERVAL  = 2_000; // 2 ثانية بين كل محاولة

    for (let i = 0; i < MAX_TRIES; i++) {
        // أول محاولة بعد ثانية واحدة، الباقي 2 ثانية
        await sleep(i === 0 ? 1_000 : INTERVAL);
        try {
            const resp = await fetch(
                `https://${YTMP41_HOST}/api/v1/progress?id=${progressId}`,
                { headers, signal: AbortSignal.timeout(8_000) }
            );
            if (!resp.ok) { console.error('[ytmp41/poll] HTTP', resp.status); continue; }
            const data = await resp.json();
            console.log(`[ytmp41/poll] #${i+1}:`, JSON.stringify(data).slice(0, 200));

            const dlUrl = _extractDlUrl(data);
            if (dlUrl) return { url: dlUrl, title: data?.title || title };

            // إذا API أعاد error صريح → لا فائدة من الانتظار
            if (data?.success === false || data?.error) {
                console.error('[ytmp41/poll] فشل صريح:', data?.error || data?.msg);
                return null;
            }
        } catch (e) { console.error('[ytmp41/poll] خطأ:', e.message); }
    }
    console.error('[ytmp41/poll] انتهى الوقت بدون رابط.');
    return null;
}

const ytmp41 = {
    // استخراج videoId من الرابط
    getId(url) {
        const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|live\/|embed\/))([a-zA-Z0-9_-]{11})/);
        return m ? m[1] : null;
    },

    // تحميل فيديو mp4
    async video(url, quality = '480') {
        try {
            const id = this.getId(url);
            if (!id) return null;
            const headers = {
                'Content-Type':    'application/json',
                'x-rapidapi-host': YTMP41_HOST,
                'x-rapidapi-key':  YTMP41_KEY,
            };

            const resp = await fetch(
                `https://${YTMP41_HOST}/api/v1/download?format=${quality}&id=${id}&audioQualityy=138&addInfo=false`,
                { headers, signal: AbortSignal.timeout(30_000) }
            );
            if (!resp.ok) { console.error('[ytmp41/video] HTTP', resp.status); return null; }
            const data = await resp.json();
            console.log('[ytmp41/video] response:', JSON.stringify(data).slice(0, 300));

            // ── الحالة 1: الرابط جاهز مباشرة ──
            const dlUrl = _extractDlUrl(data);
            if (dlUrl) return { url: dlUrl, title: data?.title || '' };

            // ── الحالة 2: API طلب polling عبر progressId ──
            if (data?.progressId) {
                console.log('[ytmp41/video] جاري الانتظار على progressId:', data.progressId);
                return await _ytmp41Poll(data.progressId, data?.title || '');
            }

            console.error('[ytmp41/video] لا رابط ولا progressId في:', JSON.stringify(data).slice(0, 200));
            return null;
        } catch (e) { console.error('[ytmp41/video]', e.message); return null; }
    },

    // تحميل صوت mp3
    async audio(url) {
        try {
            const id = this.getId(url);
            if (!id) return null;
            const headers = {
                'Content-Type':    'application/json',
                'x-rapidapi-host': YTMP41_HOST,
                'x-rapidapi-key':  YTMP41_KEY,
            };

            const resp = await fetch(
                `https://${YTMP41_HOST}/api/v1/download?format=mp3&id=${id}&audioQualityy=128&addInfo=false`,
                { headers, signal: AbortSignal.timeout(30_000) }
            );
            if (!resp.ok) { console.error('[ytmp41/audio] HTTP', resp.status); return null; }
            const data = await resp.json();
            console.log('[ytmp41/audio] response:', JSON.stringify(data).slice(0, 300));

            // ── الحالة 1: الرابط جاهز مباشرة ──
            const dlUrl = _extractDlUrl(data);
            if (dlUrl) return { url: dlUrl, title: data?.title || '' };

            // ── الحالة 2: API طلب polling عبر progressId ──
            if (data?.progressId) {
                console.log('[ytmp41/audio] جاري الانتظار على progressId:', data.progressId);
                return await _ytmp41Poll(data.progressId, data?.title || '');
            }

            console.error('[ytmp41/audio] لا رابط ولا progressId في:', JSON.stringify(data).slice(0, 200));
            return null;
        } catch (e) { console.error('[ytmp41/audio]', e.message); return null; }
    },
};


//  ytapi — يوتيوب عبر global.api الخاص
//  صوت: /dl/youtubeplay  |  فيديو: /dl/ytmp4
// ══════════════════════════════════════════════════════════════
const ytapi = {
    // صوت — يرجع { title, author, duration, views, url, image, dl }
    async audio(query) {
        try {
            const endpoint = `${global.api?.url}/dl/youtubeplay?query=${encodeURIComponent(query)}&key=${global.api?.key}`;
            const res = await fetch(endpoint, { signal: AbortSignal.timeout(20_000) }).then(r => r.json());
            if (!res?.status || !res.data) return null;
            return res.data;
        } catch { return null; }
    },

    // فيديو — يرجع { title, quality, size, downloadUrl }
    async video(url) {
        try {
            const endpoint = `${global.api?.url}/dl/ytmp4?url=${encodeURIComponent(url)}&key=${global.api?.key}`;
            const res = await fetch(endpoint, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36',
                    'Accept':     'application/json',
                },
                signal: AbortSignal.timeout(30_000),
            }).then(r => r.json());
            if (!res?.status || !res.result?.downloadUrl) return null;
            return res.result;
        } catch { return null; }
    },
};


//  savefrom API — انستقرام فقط
// ══════════════════════════════════════════════════════════════
//  Instagram RapidAPI — instagram120 (أسرع من savefrom)
// ══════════════════════════════════════════════════════════════
const IG_RAPID_KEY  = '172bbf881fmsh261cc0bdbbbf065p1c32e9jsn68068d5e45a5';
const IG_RAPID_HOST = 'instagram120.p.rapidapi.com';

const instaRapid = {
    async reels(username) {
        try {
            const resp = await fetch(`https://${IG_RAPID_HOST}/api/instagram/reels`, {
                method:  'POST',
                headers: {
                    'Content-Type':   'application/json',
                    'x-rapidapi-host': IG_RAPID_HOST,
                    'x-rapidapi-key':  IG_RAPID_KEY,
                },
                body:   JSON.stringify({ username, maxId: '' }),
                signal: AbortSignal.timeout(20_000),
            });
            if (!resp.ok) return null;
            const json = await resp.json();
            // يرجع قائمة reels — نأخذ أول واحد
            const items = json?.data?.items || json?.items || [];
            if (!items.length) return null;
            const item = items[0];
            const videoUrl = item?.video_versions?.[0]?.url
                          || item?.carousel_media?.[0]?.video_versions?.[0]?.url
                          || null;
            return videoUrl ? { url: videoUrl, isVideo: true } : null;
        } catch { return null; }
    },
};

const savefrom = {
    _headers: {
        'User-Agent':  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':      'application/json, text/javascript, */*; q=0.01',
        'Referer':     'https://en.savefrom.net/',
        'Origin':      'https://en.savefrom.net',
        'Accept-Language': 'en-US,en;q=0.9',
    },
    async getInfo(url) {
        try {
            const encoded = encodeURIComponent(url);
            const resp    = await fetch('https://worker.sf-tools.com/savefrom?url=' + encoded, {
                headers: this._headers,
                signal:  AbortSignal.timeout(15_000),
            });
            if (!resp.ok) return null;
            return await resp.json();
        } catch { return null; }
    },
    async instagram(url) {
        const data = await this.getInfo(url);
        if (!data?.url?.length) return null;
        const video = data.url
            .filter(u => u.url && (u.ext === 'mp4' || (u.type || '').includes('video')))
            .sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0))[0];
        return video?.url ? { url: video.url, title: data.meta?.title || 'instagram', ext: 'mp4' } : null;
    },
};

// ══════════════════════════════════════════════════════════════
//  tikwm API — تيك توك بدون yt-dlp (URL مباشر = أسرع)
// ══════════════════════════════════════════════════════════════
const tikwm = {
    async download(url) {
        try {
            const cleanUrl = url.split('?')[0];
            // hd=1 + play_addr لجودة أعلى
            const resp = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(cleanUrl)}&hd=1`, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 12; SM-G991B)' },
                signal:  AbortSignal.timeout(15_000),
            });
            if (!resp.ok) return null;
            const json = await resp.json();
            if (!json?.data) return null;
            const d = json.data;
            return {
                videoHD: d.hdplay || d.play || null,
                video:   d.play   || null,
                audio:   d.music  || null,
                title:   d.title  || '',
                author:  d.author?.nickname || d.author?.unique_id || '',
                duration: d.duration || 0,
                images:  d.images || null,   // Slideshow
            };
        } catch { return null; }
    },

    // بحث — يرجع أفضل نتيجتين فقط
    async search(query, count = 2) {
        try {
            const resp = await fetch('https://tikwm.com/api/feed/search', {
                method:  'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'Cookie':       'current_language=en',
                    'User-Agent':   'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 Chrome/116.0.0.0',
                },
                body:   new URLSearchParams({ keywords: query, count: String(count * 3), cursor: '0', HD: '1' }),
                signal: AbortSignal.timeout(15_000),
            });
            if (!resp.ok) return [];
            const json = await resp.json();
            const videos = (json?.data?.videos || []).filter(v => v.hdplay || v.play);
            return videos.slice(0, count).map(v => ({
                videoHD: v.hdplay || v.play,
                title:   v.title  || '',
                author:  v.author?.nickname || v.author?.unique_id || '',
                duration: v.duration || 0,
            }));
        } catch { return []; }
    },
};

const DL_PLATFORMS = {
    'يوتيوب':   ['youtube.com', 'youtu.be'],
    'انستقرام': ['instagram.com', 'instagr.am'],
    'تيك توك':  ['tiktok.com', 'vm.tiktok', 'vt.tiktok'],
    'فيسبوك':   ['facebook.com', 'fb.com', 'fb.watch'],
    'بنترست':   ['pinterest.com', 'pin.it', 'pinterest.'],
    'تويتر':    ['twitter.com', 'x.com', 't.co'],
    'ساوند':    ['soundcloud.com'],
};

function detectPlatform(url) {
    const lower = url.toLowerCase();
    for (const [name, domains] of Object.entries(DL_PLATFORMS)) {
        if (domains.some(d => lower.includes(d))) return name;
    }
    return null;
}

function extractUrl(text) {
    return text.match(/https?:\/\/[^\s]+/i)?.[0] || null;
}

// ── Pinterest — getCookies + API الرسمي الداخلي (من pinterest.js) ──
const PIN_BASE    = 'https://www.pinterest.com';
const PIN_SEARCH  = '/resource/BaseSearchResource/get/';
const PIN_HEADERS = {
    'accept':                  'application/json, text/javascript, /, q=0.01',
    'referer':                 'https://www.pinterest.com/',
    'user-agent':              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
    'x-app-version':           'a9522f',
    'x-pinterest-appstate':    'active',
    'x-pinterest-pws-handler': 'www/[username]/[slug].js',
    'x-requested-with':        'XMLHttpRequest',
};

async function getPinCookies() {
    try {
        const resp = await fetch(PIN_BASE, { headers: { 'user-agent': PIN_HEADERS['user-agent'] } });
        // Set-Cookie: كل cookie في header منفصل، getAll يرجع مصفوفة
        // في Node fetch (undici) نستخدم getSetCookie() أو نجمع manually
        let cookieParts = [];
        try {
            // Node 18+: Headers.getSetCookie()
            const all = typeof resp.headers.getSetCookie === 'function'
                ? resp.headers.getSetCookie()
                : (resp.headers.get('set-cookie') || '').split(/,(?=[^;]+=[^;])/).map(s => s.trim());
            cookieParts = all.map(c => c.split(';')[0].trim()).filter(Boolean);
        } catch {
            const raw = resp.headers.get('set-cookie') || '';
            // Fallback آمن: نأخذ كل ما قبل ';' ونتجاهل فواصل قيم الـ date
            cookieParts = raw.split(/\n|(?<=\w);\s*(?=\w+=)/)
                .map(c => c.split(';')[0].trim())
                .filter(c => c.includes('='));
        }
        return cookieParts.length ? cookieParts.join('; ') : null;
    } catch { return null; }
}

async function searchPinterest(query, count = 10) {
    if (!query) return [];
    try {
        const cookies = await getPinCookies();
        const params = new URLSearchParams({
            source_url: `/search/pins/?q=${query}`,
            data: JSON.stringify({
                options: { isPrefetch: false, query, scope: 'pins', bookmarks: [''], page_size: count },
                context: {},
            }),
            _: Date.now(),
        });
        const url = `${PIN_BASE}${PIN_SEARCH}?${params}`;
        const headers = { ...PIN_HEADERS };
        if (cookies) headers['cookie'] = cookies;
        const resp = await fetch(url, { headers });
        if (!resp.ok) return [];
        const json = await resp.json();
        const results = (json?.resource_response?.data?.results || [])
            .filter(v => v.images?.orig);
        return results.map(r => ({
            url:   r.images.orig.url,
            title: r.title || '',
        }));
    } catch { return []; }
}

// تنزيل صورة Pinterest بـ URL مباشر
const PIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';

async function downloadImageBuffer(imgUrl) {
    const resp = await fetch(imgUrl, {
        headers: { 'User-Agent': PIN_UA, 'Referer': 'https://www.pinterest.com/' },
    });
    if (!resp.ok) throw new Error(`فشل HTTP ${resp.status}`);
    return Buffer.from(await resp.arrayBuffer());
}

// تنزيل صورة من رابط pin مفرد
async function downloadPinterestImage(url) {
    try {
        // حوّل pin.it → pinterest.com
        let finalUrl = url;
        if (url.includes('pin.it/')) {
            try { const r = await fetch(url, { redirect: 'follow' }); finalUrl = r.url || url; } catch (e) { if (e?.message) console.error('[catch]', e.message); }
        }
        const resp = await fetch(finalUrl, { headers: { 'User-Agent': PIN_UA } });
        if (!resp.ok) return null;
        const html = await resp.text();
        // og:image
        const og = html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1]
                || html.match(/content="([^"]+)"\s+property="og:image"/i)?.[1];
        if (og && og.includes('pinimg')) return og;
        // json في الصفحة
        const jm = [...html.matchAll(/"url":"(https:\/\/i\.pinimg\.com\/[^"]+)"/g)];
        if (jm.length) return jm[0][1].replace(/\\u002F/g, '/').replace(/\\/g, '');
        return null;
    } catch { return null; }
}

let _ytdlpBin = null;
async function getYtdlpBin() {
    if (_ytdlpBin) return _ytdlpBin;
    for (const bin of ['yt-dlp', 'yt_dlp', 'python3 -m yt_dlp']) {
        try { await execAsync(`${bin} --version`, { timeout: 5000 }); _ytdlpBin = bin; return bin; } catch (e) { if (e?.message) console.error('[catch]', e.message); }
    }
    throw new Error('yt-dlp غير مثبت — شغّل: pip install yt-dlp');
}

// ── YouTube: formats بحسب نوع الرابط ──────────────────
function isYouTube(url) {
    return /youtube\.com|youtu\.be/i.test(url);
}
function isFacebook(url) {
    return /facebook\.com|fb\.com|fb\.watch/i.test(url);
}
function isInstagram(url) {
    return /instagram\.com|instagr\.am/i.test(url);
}

// Formats خاصة بكل منصة
function getVideoFormats(url) {
    if (isFacebook(url)) {
        return [
            'best[ext=mp4]/bestvideo[ext=mp4]+bestaudio/best',
            'best',
        ];
    }
    if (isInstagram(url)) {
        // Instagram: لا نستخدم merge — الفيديو مدمج أصلاً
        return [
            'best[ext=mp4]/best[ext=mp4]/best',
        ];
    }
    if (isYouTube(url)) {
        // YouTube: أبسط format يعمل بدون merge معقد
        return [
            'bestvideo[ext=mp4][height<=480]+bestaudio[ext=m4a]/best[ext=mp4][height<=480]/best[ext=mp4]/best',
            'best[height<=480]/best',
            'best',
        ];
    }
    // بقية المنصات (تيك توك، تويتر، ساوند..)
    return [
        'best[ext=mp4]/best',
        'best',
    ];
}

// ── SSRF guard ──────────────────────────────────────
function validateUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') throw new Error('رابط غير صالح.');
    if (!/^https?:\/\//i.test(rawUrl)) throw new Error('الرابط يجب أن يبدأ بـ http أو https.');
    let u;
    try { u = new URL(rawUrl); } catch { throw new Error('صيغة الرابط غير صحيحة.'); }
    const h = u.hostname.toLowerCase();
    const blocked = ['localhost','0.0.0.0','metadata.google.internal'];
    if (blocked.includes(h)) throw new Error('رابط محظور.');
    if (/^(127\.|10\.|169\.254\.|::1$|fe80:)/.test(h)) throw new Error('رابط محظور.');
    if (/^192\.168\./.test(h)) throw new Error('رابط محظور.');
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) throw new Error('رابط محظور.');
    if (h.endsWith('.internal') || h.endsWith('.local')) throw new Error('رابط محظور.');
}

async function ytdlpDownload(url, opts = {}) {
    // ☑️ تنظيف الـ URL لمنع shell injection
    validateUrl(url);
    const safeUrl = url.replace(/[`$\\]/g, ''); // أزل أحرف shell الخطرة

    const bin    = await getYtdlpBin();
    const outDir = path.join(os.tmpdir(), `dl_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    fs.ensureDirSync(outDir);

    const cookieArg = global._botConfig?.ytdlpCookies
        ? ['--cookies', global._botConfig.ytdlpCookies]
        : [];

    const userAgentArgs = isFacebook(safeUrl)
        ? ['--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36']
        : [];

    // ☑️ baseArgs كـ array — لا string concatenation — آمن من injection
    const baseArgs = [
        '--no-playlist',
        '--no-warnings',
        '--socket-timeout', '12',
        '--retries', '2',
        '--fragment-retries', '2',
        '--concurrent-fragments', '5',
        ...cookieArg,
        ...userAgentArgs,
        '--output', path.join(outDir, 'media.%(ext)s'),
    ];

    const igArgs = isInstagram(safeUrl)
        ? ['--extractor-args', 'instagram:skip_dash_manifest']
        : [];

    const cleanup = () => { try { fs.removeSync(outDir); } catch (e) { if (e?.message) console.error('[catch]', e.message); } };

    // ☑️ دالة تشغيل آمنة بـ spawn بدل execAsync
    const runYtdlp = (extraArgs) => {
        return new Promise((resolve, reject) => {
            const allArgs = [...baseArgs, ...igArgs, ...extraArgs, safeUrl];
            const parts   = bin.split(' ');
            const binCmd  = parts[0];
            const binPre  = parts.slice(1);
            const proc = spawn(binCmd, [...binPre, ...allArgs], {
                env: process.env,
            });
            let stderr = '';
            proc.stderr?.on('data', d => { stderr += d.toString(); });
            proc.on('close', code => {
                if (code === 0) resolve();
                else reject(new Error(stderr.slice(0, 300) || `exit code ${code}`));
            });
            proc.on('error', reject);
            // timeout يدوي
            const t = setTimeout(() => { try { proc.kill(); } catch (e) { if (e?.message) console.error('[catch]', e.message); } reject(new Error('timeout')); }, 90_000);
            proc.on('close', () => clearTimeout(t));
        });
    };

    if (opts.audio) {
        for (const audioFmt of ['mp3', 'm4a', 'best']) {
            try {
                const fmtArgs = audioFmt === 'best'
                    ? ['-x']
                    : ['-x', '--audio-format', audioFmt, '--audio-quality', '0'];
                await runYtdlp(fmtArgs);
                break;
            } catch (e) {
                if (audioFmt === 'best') { cleanup(); throw new Error((e.message || 'فشل الصوت').slice(0, 200)); }
            }
        }
    } else {
        const formats = getVideoFormats(safeUrl);
        let lastErr = null;
        for (const fmt of formats) {
            try {
                await runYtdlp(['-f', fmt, '--merge-output-format', 'mp4']);
                lastErr = null; break;
            } catch (e) { lastErr = e; }
        }
        if (lastErr) {
            cleanup();
            const errMsg = lastErr.message || 'فشل الفيديو';
            if (/login.required|This video is private|requires authentication/i.test(errMsg))
                throw new Error('المحتوى خاص أو يتطلب تسجيل دخول.');
            if (/429|rate.limit|too many requests/i.test(errMsg))
                throw new Error('معدل الطلبات مرتفع — حاول لاحقاً.');
            if (/video unavailable|has been removed|not available/i.test(errMsg))
                throw new Error('الفيديو غير متاح أو محذوف.');
            throw new Error(errMsg.slice(0, 200));
        }
    }
    // ─── اختيار الملف المحمّل ───────────────────────────────
    const files = (fs.readdirSync(outDir) || []).filter(f => !f.endsWith('.part') && !f.endsWith('.ytdl'));
    if (!files.length) { cleanup(); throw new Error('لم يُحمَّل أي ملف.'); }
    const chosen = files.map(f => ({ f, size: fs.statSync(path.join(outDir, f)).size })).sort((a,b) => b.size - a.size)[0].f;
    return {
        filePath: path.join(outDir, chosen),
        ext:      path.extname(chosen).slice(1).toLowerCase(),
        cleanup,
    };
}

// ══════════════════════════════════════════════════════════════
//  main menu
// ══════════════════════════════════════════════════════════════

export { ytmp41, ytapi, savefrom, tikwm, getYtdlpBin, ytdlpDownload, getPinCookies, searchPinterest, downloadImageBuffer, downloadPinterestImage };
