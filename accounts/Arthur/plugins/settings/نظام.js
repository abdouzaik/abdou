// ══════════════════════════════════════════════════════════════
//  نظام.js — النسخة المصححة النهائية
//  نخبة | بلاجنز | تنزيلات | إحصاءات | حماية | اوامر | إدارة
//  + slash handler /امر مباشر
//
//  الإصلاحات:
//  ✅ antiPrivate  — حظر صحيح بـ JID مُنظَّف + cooldown محكم
//  ✅ فيديو >70MB  — يُبعَث مستنداً بدل رفضه
//  ✅ antiLink     — يرصد الروابط في النصوص والكابشنات كلها
//  ✅ antiDelete   — يعرض النوع + المحتوى + منشن من حذف
// ══════════════════════════════════════════════════════════════
import fs            from 'fs-extra';
import path          from 'path';
import os            from 'os';
import crypto        from 'crypto';
import { fileURLToPath } from 'url';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { createRequire } from 'module';
import { loadPlugins, getPlugins } from '../../handlers/plugins.js';
const _require = createRequire(import.meta.url);
let axios; try { axios = (await import('axios')).default; } catch { axios = null; }
import {
    downloadMediaMessage,
    jidDecode,
} from '@whiskeysockets/baileys';

const execAsync   = promisify(exec);
const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const BOT_DIR     = path.resolve(__dirname, '../../');
const ROOT_DIR    = path.resolve(__dirname, '../../../../');
const DATA_DIR    = path.join(BOT_DIR, 'nova', 'data');
const PLUGINS_DIR = path.join(BOT_DIR, 'plugins');
const PROT_FILE   = path.join(DATA_DIR, 'protection.json');
const STATS_FILE  = path.join(DATA_DIR, 'sys_stats.json');

fs.ensureDirSync(DATA_DIR);

// ══════════════════════════════════════════════════════════════
//  helpers
// ══════════════════════════════════════════════════════════════
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── pinMessage — wrapper يجرب كل طرق Baileys للتثبيت ──
// بعض الإصدارات: groupMessagePin()، إصدارات أحدث: sendMessage({ pin: ... })
async function pinMessage(sock, chatId, stanzaId, participant, pin = true) {
    const msgKey = { remoteJid: chatId, id: stanzaId, fromMe: false, participant };
    const errors = [];
    // طريقة 1: groupMessagePin الكلاسيكية
    if (typeof sock.groupMessagePin === 'function') {
        try { await sock.groupMessagePin(chatId, msgKey, pin ? 1 : 2, pin ? 86400 : undefined); return; } catch (e) { errors.push(e.message); }
    }
    // طريقة 2: pinMessage مباشرة (إصدارات أحدث)
    if (typeof sock.pinMessage === 'function') {
        try { await sock.pinMessage(chatId, msgKey, pin ? 1 : 2); return; } catch (e) { errors.push(e.message); }
    }
    // طريقة 3: sendMessage مع نوع pin
    try {
        await sock.sendMessage(chatId, {
            pin: { key: msgKey, type: pin ? 1 : 2, time: pin ? 86400 : 0 },
        });
        return;
    } catch (e) { errors.push(e.message); }
    throw new Error(errors.join(' | ') || 'فشل التثبيت');
}


const react = (sock, msg, e) =>
    sock.sendMessage(msg.key.remoteJid, { react: { text: e, key: msg.key } }).catch(() => {});

const INPUT_REACT_MAP = {
    'رجوع':         '🔙', 'نعم':          '✅', 'لا':           '❌',
    'نخبة':         '👑', 'بلاجنز':       '🧩', 'تنزيلات':      '⬇️',
    'إحصاءات':      '📊', 'احصاءات':      '📊', 'حماية':        '🛡️',
    'اوامر':        '🔧', 'إدارة':        '🛠️', 'اضافة':        '➕',
    'حذف':          '🗑️', 'عرض':          '👀', 'مسح الكل':     '🧹',
    'مسح':          '🗑️', 'تثبيت':        '📌', 'الغاء تثبيت':  '📌',
    'قفل':          '🔒', 'فتح':          '🔓', 'رفع مشرف':     '👑',
    'تنزيل مشرف':   '⬇️', 'طرد':          '🚪', 'حظر':          '🔨',
    'كتم':          '🔇', 'الغاء كتم':    '🔊', 'الغاء حظر':    '✅',
    'رابط':         '🔗', 'تحديث':        '🔄', 'فيديو':        '🎬',
    'صوت':          '🎵', 'معلومات':      'ℹ️', 'اذاعة':        '📢',
    'انضم':         '✅', 'خروج':         '🚪', 'ضبط':          '⚙️',
    'تغيير الاسم':  '✏️', 'كود':          '💻', 'الرئيسية':     '🏠',
};

const reactInput = (sock, m, text) => {
    const key = Object.keys(INPUT_REACT_MAP).find(k => text.trim() === k);
    if (key) return sock.sendMessage(m.key.remoteJid, { react: { text: INPUT_REACT_MAP[key], key: m.key } }).catch(() => {});
};

// normalizeJid — يستخرج الجزء قبل @ وقبل : فقط
// إذا كان رقم هاتف نقيه بدون أحرف — وإلا نُعيده كما هو (LID)
const normalizeJid = jid => {
    if (!jid) return '';
    const part = jid.split('@')[0].split(':')[0];
    const digits = part.replace(/\D/g, '');
    return digits || part;
};

const getBotJid = sock =>
    (jidDecode(sock.user?.id)?.user ||
     sock.user?.id?.split(':')[0]?.split('@')[0] || '') + '@s.whatsapp.net';

// ══════════════════════════════════════════════════════════════
//  resolveTarget — يحل LID → phone JID للعمليات على الأعضاء
// ══════════════════════════════════════════════════════════════
async function resolveTarget(sock, chatId, m) {
    const ctx = m.message?.extendedTextMessage?.contextInfo;
    if (!ctx) return null;
    const raw = ctx.mentionedJid?.[0] || ctx.participant;
    if (!raw) return null;
    if (raw.endsWith('@s.whatsapp.net')) return raw;
    try {
        const meta   = await sock.groupMetadata(chatId);
        const rawNum = normalizeJid(raw);
        const found  = meta.participants.find(p =>
            normalizeJid(p.id) === rawNum ||
            normalizeJid(p.lid || '') === rawNum
        );
        if (found?.id?.endsWith('@s.whatsapp.net')) return found.id;
        if (found?.id) return found.id;
    } catch {}
    return normalizeJid(raw) + '@s.whatsapp.net';
}

// ══════════════════════════════════════════════════════════════
//  file utils
// ══════════════════════════════════════════════════════════════
const readJSON  = (f, def = {}) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
const writeJSON = (f, d)        => { try { fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf8'); } catch {} };

let _protCache = null;
const readProt = () => {
    if (!_protCache) _protCache = readJSON(PROT_FILE, {
        antiCrash:    'off',
        antiLink:     'off',
        antiDelete:   'off',
        antiInsult:   'off',
        antiViewOnce: 'off',
        antiPrivate:  'off',
        images:       'off',
        videos:       'off',
        bots:         'off',
        linkWarns:    {},
        insultWarns:  {},
    });
    return _protCache;
};
const writeProt = d => { _protCache = d; writeJSON(PROT_FILE, d); };

// ── stats مع in-memory cache — يكتب للـ disk كل 60 ثانية فقط ──
let _statsCache   = null;
let _statsDirty   = false;
const readStats  = () => {
    if (!_statsCache) _statsCache = readJSON(STATS_FILE, { commands:{}, users:{}, total:0 });
    return _statsCache;
};
const writeStats = d => {
    _statsCache = d;
    _statsDirty = true;
    // flush فوري لو كان طلب مسح
};
const flushStats = () => {
    if (_statsDirty && _statsCache) { writeJSON(STATS_FILE, _statsCache); _statsDirty = false; }
};

const grpFile = (prefix, chatId) =>
    path.join(DATA_DIR, prefix + '_' + chatId.replace(/[^\w]/g, '_') + '.json');

// ── cache لـ getPluginInfo — بدل قراءة disk عند كل رسالة ──
const _pluginInfoCache = new Map(); // key: filePath, value: { mtime, info }


// ══════════════════════════════════════════════════════════════
//  plugin utils
// ══════════════════════════════════════════════════════════════

// ── cache لقائمة ملفات الـ plugins (تُعاد البناء بعد loadPlugins) ──
let _fileListCache = null;
let _fileListMtime = 0;

function getAllPluginFiles(dir = PLUGINS_DIR, list = []) {
    if (!fs.existsSync(dir)) return list;
    for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        fs.statSync(full).isDirectory()
            ? getAllPluginFiles(full, list)
            : f.endsWith('.js') && list.push(full);
    }
    return list;
}

// نسخة مع cache — تُستخدم في عمليات القراءة الكثيرة
function getAllPluginFilesCached() {
    try {
        const dirMtime = fs.statSync(PLUGINS_DIR).mtimeMs;
        if (_fileListCache && dirMtime === _fileListMtime) return _fileListCache;
        _fileListCache = getAllPluginFiles();
        _fileListMtime = dirMtime;
        return _fileListCache;
    } catch { return getAllPluginFiles(); }
}
// أبطل الكاش بعد أي loadPlugins
const _origLoadPlugins = loadPlugins;
global._invalidatePluginCache = () => { _fileListCache = null; _pluginInfoCache.clear(); };


function getPluginInfo(filePath) {
    try {
        const mtime = fs.statSync(filePath).mtimeMs;
        const cached = _pluginInfoCache.get(filePath);
        if (cached && cached.mtime === mtime) return cached.info;
        const code = fs.readFileSync(filePath, 'utf8');
        let cmd;
        const arr = code.match(/command:\s*\[([^\]]+)\]/);
        if (arr) {
            const cmds = arr[1].match(/['"`]([^'"`]+)['"`]/g);
            cmd = cmds ? cmds[0].replace(/['"`]/g, '') : path.basename(filePath, '.js');
        } else {
            cmd = code.match(/command:\s*['"`]([^'"`]+)['"`]/)?.[1] || path.basename(filePath, '.js');
        }
        const info = {
            cmd,
            elite: code.match(/elite:\s*['"`](on|off)['"`]/i)?.[1]  || 'off',
            lock:  code.match(/lock:\s*['"`](on|off)['"`]/i)?.[1]   || 'off',
            group: (code.match(/group:\s*(true|false)/i)?.[1]        || 'false') === 'true',
            prv:   (code.match(/prv:\s*(true|false)/i)?.[1]          || 'false') === 'true',
            filePath,
        };
        _pluginInfoCache.set(filePath, { mtime, info });
        return info;
    } catch {
        return { cmd: path.basename(filePath, '.js'), elite:'off', lock:'off', group:false, prv:false, filePath };
    }
}

function updatePluginField(filePath, key, value) {
    // ✅ تعقيم القيمة — يمنع كسر الكود عبر أحرف خاصة
    const safeVal = String(value).replace(/[`\\]/g, '').replace(/'/g, '').trim();
    let code = fs.readFileSync(filePath, 'utf8');
    if (key === 'elite' || key === 'lock') {
        code = code.replace(new RegExp(`(${key}:\\s*['"\`])(on|off)(['"\`])`, 'i'), `$1${safeVal}$3`);
    } else if (key === 'group' || key === 'prv') {
        code = code.replace(new RegExp(`(${key}:\\s*)(true|false)`, 'i'), `$1${safeVal}`);
    } else if (key === 'command') {
        code = code.replace(/command:\s*[`'"][^`'"]+[`'"]/, `command: '${safeVal}'`);
    }
    fs.writeFileSync(filePath, code, 'utf8');
    // أبطل كاش الملف المعدَّل
    _pluginInfoCache.delete(filePath);
    _fileListCache = null;
    _cmdSearchCache.delete(value); // old name
}

// ── findPluginByCmd مع cache ──
const _cmdSearchCache = new Map();

async function findPluginByCmd(cmdName) {
    if (_cmdSearchCache.has(cmdName)) {
        const cached = _cmdSearchCache.get(cmdName);
        if (fs.existsSync(cached)) return cached;
        _cmdSearchCache.delete(cmdName);
    }
    for (const f of getAllPluginFilesCached()) {
        try {
            const code = fs.readFileSync(f, 'utf8');
            if (new RegExp(`command:\\s*['"\`]${cmdName}['"\`]`, 'i').test(code) ||
                new RegExp(`command:\\s*\\[[^\\]]*['"\`]${cmdName}['"\`]`, 'i').test(code)) {
                _cmdSearchCache.set(cmdName, f);
                return f;
            }
        } catch {}
    }
    return null;
}

function quickLint(filePath) {
    const code = fs.readFileSync(filePath, 'utf8');
    const issues  = [];
    const opens   = (code.match(/\{/g) || []).length;
    const closes  = (code.match(/\}/g) || []).length;
    if (opens !== closes) issues.push(`اقواس {} غير متوازنة — مفتوحة:${opens} مغلقة:${closes}`);
    if (!/export default/.test(code)) issues.push('لا يوجد export default');
    if (!/command\s*:/.test(code))    issues.push('لا يوجد حقل command');
    return issues;
}

async function checkPluginSyntax(filePath) {
    const tmpCheck = path.join(os.tmpdir(), `_check_${Date.now()}.mjs`);
    try {
        fs.copyFileSync(filePath, tmpCheck);
        await execAsync(`node --input-type=module --check "${tmpCheck}"`);
        try { fs.unlinkSync(tmpCheck); } catch {}
        return { ok: true };
    } catch (e) {
        try { fs.unlinkSync(tmpCheck); } catch {}
        const errMsg = (e.stderr || e.message || '').trim();
        const lineMatch = errMsg.match(/:(\d+)$/m);
        const line = lineMatch ? parseInt(lineMatch[1]) : null;
        let codeLine = '';
        if (line) { try { codeLine = fs.readFileSync(filePath, 'utf8').split('\n')[line-1]?.trim() || ''; } catch {} }
        return { ok: false, error: errMsg, line, codeLine };
    }
}

// ══════════════════════════════════════════════════════════════
//  ✅ FIX-4: messageCache مُحسَّن — يحفظ النوع + المحتوى لكل رسالة
// ══════════════════════════════════════════════════════════════
const messageCache = new Map();
const _deleteKey   = Symbol('deleteRegistered');
const _welcomeKey  = Symbol('welcomeRegistered');

function getMsgTypeAndText(msg) {
    const m = msg?.message;
    if (!m) return { type: 'رسالة', text: '' };

    if (m.conversation)               return { type: 'نص 💬',      text: m.conversation };
    if (m.extendedTextMessage?.text)   return { type: 'نص 💬',      text: m.extendedTextMessage.text };
    if (m.imageMessage)                return { type: 'صورة 🖼️',    text: m.imageMessage.caption || '' };
    if (m.videoMessage)                return { type: 'فيديو 🎬',   text: m.videoMessage.caption || '' };
    if (m.audioMessage)                return { type: 'صوت 🎵',     text: '' };
    if (m.documentMessage)             return { type: 'ملف 📎',      text: m.documentMessage.fileName || m.documentMessage.caption || '' };
    if (m.stickerMessage)              return { type: 'ملصق 🎭',    text: '' };
    if (m.contactMessage)              return { type: 'جهة اتصال 👤', text: m.contactMessage.displayName || '' };
    if (m.locationMessage)             return { type: 'موقع 📍',     text: '' };
    if (m.viewOnceMessage)             return { type: 'مشاهدة مرة 👁️', text: '' };
    if (m.viewOnceMessageV2)           return { type: 'مشاهدة مرة 👁️', text: '' };
    if (m.buttonsMessage)              return { type: 'أزرار 🔘',   text: m.buttonsMessage.contentText || '' };
    if (m.listMessage)                 return { type: 'قائمة 📋',   text: m.listMessage.description || '' };
    return { type: 'رسالة', text: '' };
}

function cacheMessage(msg) {
    try {
        if (!msg?.key?.id) return;
        // لا نحفظ رسائل البروتوكول أو الحذف
        if (msg.message?.protocolMessage) return;
        const { type, text } = getMsgTypeAndText(msg);
        messageCache.set(msg.key.id, {
            chatId: msg.key.remoteJid,
            sender: msg.key.participant || msg.key.remoteJid,
            fromMe: msg.key.fromMe,
            type,
            text,
        });
        // نبقي آخر 1000 رسالة فقط
        if (messageCache.size > 1000) messageCache.delete(messageCache.keys().next().value);
    } catch {}
}

function registerDeleteListener(sock) {
    const ev = sock.ev;
    if (!ev || ev[_deleteKey]) return;
    ev[_deleteKey] = true;
    try { ev.setMaxListeners(Math.max(ev.getMaxListeners(), 30)); } catch {}
    ev.on('messages.delete', ({ keys }) => antiDeleteHandler(sock, keys));
}

function registerWelcomeListener(sock) {
    const ev = sock.ev;
    if (!ev || ev[_welcomeKey]) return;
    ev[_welcomeKey] = true;
    try { ev.setMaxListeners(Math.max(ev.getMaxListeners(), 30)); } catch {}
    ev.on('group-participants.update', async ({ id, participants, action }) => {
        if (action !== 'add') return;
        try {
            const wf = grpFile('welcome', id);
            if (!fs.existsSync(wf)) return;
            const { text: wt } = readJSON(wf, {});
            if (!wt) return;

            // جلب صورة القروب
            let groupPhoto = null;
            try {
                const ppUrl = await sock.profilePictureUrl(id, 'image');
                if (ppUrl) {
                    const r = await fetch(ppUrl);
                    groupPhoto = Buffer.from(await r.arrayBuffer());
                }
            } catch {}

            for (const jid of participants) {
                const num     = normalizeJid(jid);
                const caption = wt
                    .replace(/\{name\}/g,   `@${num}`)
                    .replace(/\{number\}/g, num);
                try {
                    if (groupPhoto) {
                        await sock.sendMessage(id, {
                            image:    groupPhoto,
                            caption,
                            mentions: [jid],
                        });
                    } else {
                        await sock.sendMessage(id, { text: caption, mentions: [jid] });
                    }
                } catch { await sock.sendMessage(id, { text: caption, mentions: [jid] }).catch(() => {}); }
                await sleep(800);
            }
        } catch {}
    });
}

// ══════════════════════════════════════════════════════════════
//  protection helpers
// ══════════════════════════════════════════════════════════════
const CRASH_PATTERNS = [
    /[\u202E\u200F\u200E]{10,}/,
    /(.)(\1){300,}/,
    /[\uD83D][\uDC00-\uDFFF]{50,}/,
];

const INSULT_WORDS = ['كس','طيز','شرموط','عاهر','زب','كسمك','عرص','منيوك','قحبة'];

// ✅ FIX-3: regex للروابط شامل يغطي جميع أشكالها
const _LINK_RE = /(?:https?:\/\/|www\.)\S+|(?<![a-zA-Z0-9])(?:[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+(?:com|net|org|io|me|app|gg|ly|to|co|tv|ai|dev|xyz|info|online|site|link|live|store|shop|cc|ru|uk|de|fr|sa|ae|eg|iq|sy|jo|kw|bh|qa|om|ye|ma|dz|tn|lb|ps|ws|tk|ml|id|in|pk|ng|gh|ke)\b[^\s]*/i;
const hasLink = text => _LINK_RE.test(text || '');

// ✅ FIX-3: استخراج كل النصوص الممكنة من الرسالة (نص + كابشن)
function getAllMsgText(msg) {
    const m = msg?.message;
    if (!m) return '';
    return (
        m.conversation                        ||
        m.extendedTextMessage?.text           ||
        m.imageMessage?.caption               ||
        m.videoMessage?.caption               ||
        m.documentMessage?.caption            ||
        m.buttonsMessage?.contentText         ||
        m.listMessage?.description            ||
        ''
    );
}

// ✅ دالة موحدة — تجلب groupMetadata مرة واحدة فقط لكل رسالة
// بدل isGroupAdmin() + isBotGroupAdmin() = طلبان منفصلان
const _metaCache = new Map(); // chatId → { meta, ts }
const META_TTL   = 30_000;   // 30 ثانية

async function getGroupAdminInfo(sock, chatId, rawParticipant) {
    try {
        // استخدم الكاش إذا لم تنتهِ صلاحيته
        const now    = Date.now();
        const cached = _metaCache.get(chatId);
        const meta   = (cached && now - cached.ts < META_TTL)
            ? cached.meta
            : await (async () => {
                const m = await sock.groupMetadata(chatId);
                _metaCache.set(chatId, { meta: m, ts: now });
                return m;
              })();

        const senderNum = normalizeJid(rawParticipant || '');
        const botNum    = normalizeJid(getBotJid(sock));
        const admins    = meta.participants.filter(p => p.admin);
        const adminNums = new Set(
            admins.flatMap(p => [normalizeJid(p.id), normalizeJid(p.lid || '')]).filter(Boolean)
        );
        return {
            isAdmin:    !rawParticipant || adminNums.has(senderNum),
            isBotAdmin: adminNums.has(botNum),
            meta,
        };
    } catch { return { isAdmin: false, isBotAdmin: false, meta: null }; }
}

// compat wrappers — لا يجلبان metadata من جديد
async function isGroupAdmin(sock, chatId, rawParticipant) {
    return (await getGroupAdminInfo(sock, chatId, rawParticipant)).isAdmin;
}
async function isBotGroupAdmin(sock, chatId) {
    return (await getGroupAdminInfo(sock, chatId, null)).isBotAdmin;
}

// cooldown section removed (antiPrivate disabled)

// ── cooldown لـ antiPrivate ──
const _pvtCooldown  = new Map();
const activeSessions = new Map(); // ← moved here: يجب أن تكون قبل setInterval

// ── Rate Limiter — الحد: 20 رسالة/دقيقة لكل مستخدم ──
const _rateMap = new Map();
function isRateLimited(jid, max = 20) {
    const now = Date.now();
    const prev = _rateMap.get(jid) || [];
    const recent = prev.filter(t => now - t < 60_000);
    recent.push(now);
    _rateMap.set(jid, recent);
    return recent.length > max;
}

// ── تنظيف دوري كل دقيقة ──
setInterval(() => {
    const now = Date.now();
    // تنظيف _rateMap
    for (const [k, v] of _rateMap) {
        const fresh = v.filter(t => now - t < 60_000);
        if (!fresh.length) _rateMap.delete(k);
        else _rateMap.set(k, fresh);
    }
    // تنظيف _pvtCooldown
    for (const [k, v] of _pvtCooldown) {
        if (v <= now) _pvtCooldown.delete(k);
    }
    // تنظيف _slashPending لو تراكمت
    if (typeof _slashPending !== 'undefined' && _slashPending.size > 500) _slashPending.clear();
    // flush stats للـ disk كل دقيقة بدل كل رسالة
    flushStats();
    // تنظيف activeSessions — حذف جلسات أكثر من 5 دقائق بدون نشاط
    for (const [id, s] of activeSessions) {
        if (s.lastActivity && now - s.lastActivity > 300_000) {
            try { s.cleanupFn?.(); } catch {}
            activeSessions.delete(id);
        }
    }
    // حد أقصى للجلسات 100
    if (activeSessions.size > 100) {
        // احذف أقدم جلسة
        const oldest = [...activeSessions.entries()].sort((a,b) => (a[1].lastActivity||0) - (b[1].lastActivity||0))[0];
        if (oldest) { try { oldest[1].cleanupFn?.(); } catch {} activeSessions.delete(oldest[0]); }
    }
}, 60_000);


// ══════════════════════════════════════════════════════════════
//  protectionHandler — المعالج الرئيسي للحماية
// ══════════════════════════════════════════════════════════════
async function protectionHandler(sock, msg) {
    try {
        registerDeleteListener(sock);
        registerWelcomeListener(sock);
        cacheMessage(msg);

        const prot    = readProt();
        const chatId  = msg.key.remoteJid;
        const isGroup = chatId.endsWith('@g.us');

        // ✅ FIX-4: اكتشاف الحذف عبر protocolMessage أيضاً (belt & suspenders)
        if (msg.message?.protocolMessage?.type === 0) {
            const deletedKey = msg.message.protocolMessage.key;
            if (deletedKey && prot.antiDelete === 'on' && !msg.key.fromMe) {
                await antiDeleteHandler(sock, [deletedKey]);
            }
            return;
        }

        // ✅ FIX-3: استخراج النص من كل أنواع الرسائل
        const text = getAllMsgText(msg);

        // ── ✅ FIX-1: antiPrivate — إرسال رسالة ثم حظر صحيح ──
        if (prot.antiPrivate === 'on' && !isGroup && !msg.key.fromMe) {
            // تنظيف JID للحصول على رقم الهاتف فقط
            const senderNum  = normalizeJid(chatId);
            const cooldownKey = senderNum;
            const now = Date.now();

            // تجاهل إذا كان cooldown نشطاً
            if ((_pvtCooldown.get(cooldownKey) || 0) > now) return;
            _pvtCooldown.set(cooldownKey, now + 60_000); // cooldown دقيقة

            try {
                // أرسل تحذيراً أولاً
                await sock.sendMessage(chatId, {
                    text: `❍━═━═━═━❍\n❍⇇ ممنوع الكلام في الخاص\n❍⇇ تم حظرك تلقائياً\n❍━═━═━═━❍`
                });
                await sleep(800);
                // بناء الـ JID الصحيح للحظر: يجب أن يكون @s.whatsapp.net
                const blockJid = senderNum + '@s.whatsapp.net';
                await sock.updateBlockStatus(blockJid, 'block');
            } catch (e) {
                console.error('[antiPrivate] فشل الحظر:', e.message);
            }
            return;
        }

        // ── antiCrash ──
        if (prot.antiCrash === 'on' && isGroup) {
            for (const p of CRASH_PATTERNS) {
                if (p.test(text)) {
                    try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}
                    return;
                }
            }
        }

        // ── ✅ FIX-3: antiLink — يحذف فوراً لأي رابط ──
        if (prot.antiLink === 'on' && isGroup && hasLink(text)) {
            if (!msg.key.fromMe) {
                const senderRaw = msg.key.participant || '';
                const isAdmin   = await isGroupAdmin(sock, chatId, senderRaw);
                if (!isAdmin) {
                    // حذف الرسالة فوراً دون انتظار فحص الأدمن
                    try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}

                    if (!prot.linkWarns)           prot.linkWarns = {};
                    if (!prot.linkWarns[chatId])   prot.linkWarns[chatId] = {};
                    prot.linkWarns[chatId][senderRaw] = (prot.linkWarns[chatId][senderRaw] || 0) + 1;
                    const w = prot.linkWarns[chatId][senderRaw];

                    if (w >= 3) {
                        prot.linkWarns[chatId][senderRaw] = 0;
                        writeProt(prot);
                        await sock.sendMessage(chatId, {
                            text: `⛔ @${normalizeJid(senderRaw)} تم طرده بسبب نشر الروابط (3/3)`,
                            mentions: [senderRaw],
                        });
                        try { await sock.groupParticipantsUpdate(chatId, [senderRaw], 'remove'); } catch {}
                    } else {
                        writeProt(prot);
                        await sock.sendMessage(chatId, {
                            text: `⚠️ @${normalizeJid(senderRaw)} تحذير ${w}/3 — ممنوع نشر الروابط`,
                            mentions: [senderRaw],
                        });
                    }
                }
            }
        }

        // ── antiInsult ──
        if (prot.antiInsult === 'on') {
            if (INSULT_WORDS.some(w => text.includes(w))) {
                try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}
                if (isGroup && !msg.key.fromMe) {
                    const senderRaw = msg.key.participant || '';
                    const isAdmin   = await isGroupAdmin(sock, chatId, senderRaw);
                    if (!isAdmin) {
                        if (!prot.insultWarns)          prot.insultWarns = {};
                        if (!prot.insultWarns[chatId])  prot.insultWarns[chatId] = {};
                        prot.insultWarns[chatId][senderRaw] = (prot.insultWarns[chatId][senderRaw] || 0) + 1;
                        const w = prot.insultWarns[chatId][senderRaw];
                        if (w >= 3) {
                            prot.insultWarns[chatId][senderRaw] = 0;
                            writeProt(prot);
                            await sock.sendMessage(chatId, {
                                text: `⛔ @${normalizeJid(senderRaw)} تم طرده بسبب الشتائم (3/3)`,
                                mentions: [senderRaw],
                            });
                            try { await sock.groupParticipantsUpdate(chatId, [senderRaw], 'remove'); } catch {}
                        } else {
                            writeProt(prot);
                            await sock.sendMessage(chatId, {
                                text: `⚠️ @${normalizeJid(senderRaw)} تحذير ${w}/3 — ممنوع الشتم`,
                                mentions: [senderRaw],
                            });
                        }
                    }
                }
                return;
            }
        }



        // ── قفل الصور — try delete immediately ──
        if (prot.images === 'on' && isGroup && !msg.key.fromMe && msg.message?.imageMessage) {
            try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}
        }

        // ── قفل الفيديو ──
        if (prot.videos === 'on' && isGroup && !msg.key.fromMe && msg.message?.videoMessage) {
            try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}
        }

        // ── قفل البوتات ──
        if (prot.bots === 'on' && isGroup && !msg.key.fromMe) {
            const m2 = msg.message;
            const botMsg = m2?.buttonsMessage || m2?.listMessage ||
                           m2?.templateMessage || m2?.interactiveMessage;
            if (botMsg) { try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {} }
        }

    } catch {}
}
protectionHandler._src = 'protection_system';

// ══════════════════════════════════════════════════════════════
//  ✅ FIX-4: antiDeleteHandler — يعرض النوع + المحتوى + منشن
// ══════════════════════════════════════════════════════════════
async function antiDeleteHandler(sock, keys) {
    try {
        if (readProt().antiDelete !== 'on') return;
        for (const key of keys) {
            try {
                // تجاهل حذف رسائل البوت نفسه
                if (key.fromMe) continue;

                const cached = messageCache.get(key.id);
                const chatId = key.remoteJid;
                const sender = key.participant || key.remoteJid;

                if (!chatId || !sender) continue;

                // بناء رسالة الإشعار
                const senderMention = sender.includes('@') ? sender : sender + '@s.whatsapp.net';
                let notice = `🗑️ *تم حذف رسالة!*\n`;
                notice += `👤 @${normalizeJid(senderMention)}`;

                if (cached) {
                    notice += `\n📌 *النوع:* ${cached.type}`;
                    if (cached.text && cached.text.trim()) {
                        // اقتصار على 500 حرف
                        const preview = cached.text.trim().slice(0, 500);
                        notice += `\n💬 *المحتوى:*\n${preview}${cached.text.length > 500 ? '...' : ''}`;
                    }
                } else {
                    // إذا لم تكن في الكاش (رسالة قديمة قبل تشغيل البوت)
                    notice += `\n📌 *النوع:* رسالة قديمة`;
                }

                await sock.sendMessage(chatId, {
                    text: notice,
                    mentions: [senderMention],
                });
            } catch {}
        }
    } catch {}
}
antiDeleteHandler._src = 'antiDelete_system';

// ══════════════════════════════════════════════════════════════
//  statsAutoHandler
// ══════════════════════════════════════════════════════════════
async function statsAutoHandler(sock, msg) {
    try {
        const pfx  = global._botConfig?.prefix || '.';
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        if (!text.startsWith(pfx)) return;
        const cmd = text.slice(pfx.length).split(/\s+/)[0]?.toLowerCase();
        if (!cmd) return;

        // ── نستخدم msg.sender.pn (phone JID من messages.js) لو متاح
        // وإلا نحاول نحوّل الـ LID لرقم عبر normalizeJid
        const senderRaw = msg.sender?.pn          // phone JID الصحيح (من messages.js)
                       || msg.key.participant
                       || msg.key.remoteJid;
        if (!senderRaw) return;

        // نضمن أن المفتاح المحفوظ دائماً phone JID وليس LID
        const sender = senderRaw.endsWith('@s.whatsapp.net')
            ? senderRaw
            : normalizeJid(senderRaw) + '@s.whatsapp.net';

        const stats = readStats();
        stats.total = (stats.total || 0) + 1;
        stats.commands[cmd] = (stats.commands[cmd] || 0) + 1;
        stats.users[sender] = (stats.users[sender] || 0) + 1;
        writeStats(stats);
    } catch {}
}
statsAutoHandler._src = 'stats_system';

// ══════════════════════════════════════════════════════════════
//  slash command handler — /امر مباشر
//  يعمل في أي وقت داخل جلسة أو خارجها بأولوية عليا
//
//  الأوامر:
//  /رفع /تنزيل /طرد /حظر /فك حظر /كتم /فك كتم /مشرفين
//  /مسح /تثبيت /فك تثبيت
//  /قفل /فتح /رابط /انضم /خروج /اسم /وصف /معلومات
//  /ترحيب [نص|عرض|حذف]   /قوانين [نص|عرض|حذف]
//  /نخبة [اضف|ازل|عرض|مسح]
//  /انتي كراش  /انتي لينكات  /انتي حذف  /انتي سب  /انتي خاص  /view once
//  /قفل روابط  /قفل صور  /قفل فيديو  /قفل بوتات
//  /تحميل /تحميل صوت /تحديث /مسح كاش /اذاعة /احصاءات /تغيير اسم
//  /؟  /مساعدة
// ══════════════════════════════════════════════════════════════

const SLASH = '/';

const _SLASH_PROT = {
    'انتي كراش':   'antiCrash',
    'انتي لينكات': 'antiLink',
    'انتي حذف':    'antiDelete',
    'انتي سب':     'antiInsult',
    'view once':   'antiViewOnce',
    'انتي خاص':    'antiPrivate',
};

const _SLASH_LOCK = {
    'قفل روابط': 'antiLink',
    'قفل صور':   'images',
    'قفل فيديو': 'videos',
    'قفل بوتات': 'bots',
};

const SLASH_HELP =
`✧━── ❝ 𝐒𝐋𝐀𝐒𝐇 𝐂𝐌𝐃𝐒 ❞ ──━✧

*👥 الأعضاء:*
\`/رفع\` \`/تنزيل\` \`/طرد\` \`/حظر\`
\`/فك حظر\` \`/كتم [دقائق]\` \`/فك كتم\`
\`/مشرفين\`

*💬 الرسائل:*
\`/مسح\` \`/تثبيت\` \`/فك تثبيت\`

*⚙️ المجموعة:*
\`/قفل\` \`/فتح\` \`/رابط\`
\`/انضم [رابط]\` \`/خروج\`
\`/اسم [نص]\` \`/وصف [نص]\` \`/معلومات\`
\`/صورة\` (رد على صورة — يغير صورة المجموعة)

*📋 المحتوى:*
\`/ترحيب [نص]\` \`/ترحيب عرض\` \`/ترحيب حذف\`
\`/قوانين [نص]\` \`/قوانين عرض\` \`/قوانين حذف\`
\`/كلمات عرض\` \`/كلمات اضف [كلمة]\` \`/كلمات حذف [كلمة]\`

*👑 النخبة:*
\`/نخبة اضف\` \`/نخبة ازل\` \`/نخبة عرض\` \`/نخبة مسح\`

*🛡️ الحماية (toggle):*
\`/انتي كراش\` \`/انتي لينكات\` \`/انتي حذف\`
\`/انتي سب\` \`/انتي خاص\` \`/view once\`

*🔒 قفل المحتوى (toggle):*
\`/قفل روابط\` \`/قفل صور\` \`/قفل فيديو\` \`/قفل بوتات\`

*🤖 البوت:*
\`/اسم بوت [اسم]\` \`/وصف بوت [نص]\`
\`/صورة بوت\` (رد على صورة)
\`/بلوك [رقم/منشن]\` \`/فك بلوك [رقم/منشن]\`
\`/مجموعاتي\` \`/خاص\`

*🔧 أدوات:*
\`/تحميل [رابط]\` \`/تحميل صوت [رابط]\`
\`/تحديث\` \`/مسح كاش\`
\`/اذاعة [نص]\` \`/احصاءات\`
\`/تغيير اسم [قديم] [جديد]\`

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`;

// تأكيدات معلقة (خروج / مسح نخبة)
const _slashPending = new Map();

async function slashCommandHandler(sock, msg) {
    try {
        const raw = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const text = raw.trim();
        if (!text.startsWith(SLASH)) return;

        const chatId    = msg.key.remoteJid;
        const isGroup   = chatId.endsWith('@g.us');
        const senderRaw = msg.key.participant || chatId;

        // فحص النخبة
        try {
            const isElite = msg.key.fromMe || await sock.isElite?.({ sock, id: senderRaw });
            if (!isElite) return;
        } catch { return; }

        const body      = text.slice(SLASH.length).trim();
        const parts     = body.split(/\s+/);
        const cmd       = parts[0] || '';
        const twoWord   = parts.slice(0, 2).join(' ');
        const threeWord = parts.slice(0, 3).join(' ');
        const rest      = parts.slice(1).join(' ').trim();
        const rest2     = parts.slice(2).join(' ').trim();

        const reply  = t => sock.sendMessage(chatId, { text: t }, { quoted: msg }).catch(() => {});
        const replyM = (t, mentions) => sock.sendMessage(chatId, { text: t, mentions }, { quoted: msg }).catch(() => {});

        // صلاحيات مجموعة مع LID
        const getPerms = async () => {
            if (!isGroup) return { isGroup: false, isAdmin: false, isBotAdmin: false, meta: null };
            try {
                const meta      = await sock.groupMetadata(chatId);
                const senderNum = normalizeJid(senderRaw);
                const botNum    = normalizeJid(getBotJid(sock));
                const adminNums = new Set(
                    meta.participants
                        .filter(p => p.admin)
                        .flatMap(p => [normalizeJid(p.id), normalizeJid(p.lid || '')])
                        .filter(Boolean)
                );
                return {
                    meta,
                    isGroup:    true,
                    isAdmin:    msg.key.fromMe || adminNums.has(senderNum),
                    isBotAdmin: adminNums.has(botNum),
                };
            } catch { return { isGroup: true, isAdmin: false, isBotAdmin: false, meta: null }; }
        };

        const tryDo = async (fn, emoji = '✅') => {
            try { await fn(); react(sock, msg, emoji); return true; }
            catch (e) {
                const { isGroup: ig, isAdmin, isBotAdmin } = await getPerms();
                if (!ig)         { await reply('❌ هذا الامر للمجموعات فقط.'); return false; }
                if (!isBotAdmin) { await reply('❌ البوت ليس مشرفاً.'); return false; }
                if (!isAdmin)    { await reply('❌ انت لست مشرفاً.'); return false; }
                await reply('❌ فشل: ' + (e?.message || e));
                return false;
            }
        };

        // resolveTarget يدعم منشن/رد/رقم مكتوب
        const resolveSlashTarget = async () => {
            const t = await resolveTarget(sock, chatId, msg);
            if (t) return t;
            const num = rest.replace(/\D/g, '');
            if (num.length >= 9) {
                try {
                    const check = await sock.onWhatsApp(num + '@s.whatsapp.net');
                    if (check?.[0]?.exists) return check[0].jid;
                    return num + '@s.whatsapp.net';
                } catch { return num + '@s.whatsapp.net'; }
            }
            return null;
        };

        // ══════════════════════════════════════════════════
        // /؟  /مساعدة
        // ══════════════════════════════════════════════════
        if (cmd === '؟' || cmd === 'مساعدة') {
            await reply(SLASH_HELP);
            return;
        }

        // ══════════════════════════════════════════════════
        // إدارة الأعضاء
        // ══════════════════════════════════════════════════
        if (cmd === 'رفع') {
            const target = await resolveSlashTarget();
            if (!target) return reply('↩️ منشن العضو أو رد على رسالته أو اكتب رقمه.');
            await tryDo(() => sock.groupParticipantsUpdate(chatId, [target], 'promote'), '👑');
            return;
        }

        if (cmd === 'تنزيل' && !rest.startsWith('http')) {
            const target = await resolveSlashTarget();
            if (!target) return reply('↩️ منشن العضو أو رد على رسالته أو اكتب رقمه.');
            await tryDo(() => sock.groupParticipantsUpdate(chatId, [target], 'demote'), '⬇️');
            return;
        }

        if (cmd === 'طرد') {
            const target = await resolveSlashTarget();
            if (!target) return reply('↩️ منشن العضو أو رد على رسالته أو اكتب رقمه.');
            await tryDo(() => sock.groupParticipantsUpdate(chatId, [target], 'remove'), '🚪');
            return;
        }

        if (cmd === 'حظر') {
            const target = await resolveSlashTarget();
            if (!target) return reply('↩️ منشن العضو أو رد على رسالته أو اكتب رقمه.');
            await tryDo(async () => {
                await sock.groupParticipantsUpdate(chatId, [target], 'remove');
                const bans = readJSON(grpFile('bans', chatId), []);
                if (!bans.includes(target)) { bans.push(target); writeJSON(grpFile('bans', chatId), bans); }
            }, '🔨');
            return;
        }

        if (twoWord === 'فك حظر') {
            const target = await resolveSlashTarget();
            if (!target) return reply('↩️ منشن العضو أو اكتب رقمه.');
            const bf = grpFile('bans', chatId);
            writeJSON(bf, readJSON(bf, []).filter(b => b !== target));
            react(sock, msg, '✅');
            await replyM('✅ تم رفع الحظر عن @' + normalizeJid(target), [target]);
            return;
        }

        if (cmd === 'كتم') {
            const target = await resolveSlashTarget();
            if (!target) return reply('↩️ منشن العضو أو رد على رسالته.\nمثال: /كتم 30 ثم منشن');
            const mins = parseInt(rest.replace(/\D/g, '') || '30') || 30;
            await tryDo(async () => {
                await sock.groupParticipantsUpdate(chatId, [target], 'demote');
                await replyM('🔇 تم كتم @' + normalizeJid(target) + ' لمدة ' + mins + ' دقيقة', [target]);
                setTimeout(async () => {
                    try { await sock.groupParticipantsUpdate(chatId, [target], 'promote'); } catch {}
                }, mins * 60_000);
            }, '🔇');
            return;
        }

        if (twoWord === 'فك كتم') {
            const target = await resolveSlashTarget();
            if (!target) return reply('↩️ منشن العضو أو رد على رسالته.');
            await tryDo(() => sock.groupParticipantsUpdate(chatId, [target], 'promote'), '🔊');
            return;
        }

        if (cmd === 'مشرفين') {
            try {
                const { meta } = await getPerms();
                if (!meta) return reply('❌ تعذر جلب البيانات.');
                const admins = meta.participants.filter(p => p.admin);
                if (!admins.length) return reply('📭 لا يوجد مشرفين.');
                const list = admins.map((a, i) =>
                    (i+1) + '. @' + normalizeJid(a.id) + (a.admin === 'superadmin' ? ' 👑' : '')
                ).join('\n');
                await replyM('👑 *المشرفون (' + admins.length + '):*\n\n' + list, admins.map(a => a.id));
            } catch (e) { await reply('❌ ' + e?.message); }
            return;
        }

        // ══════════════════════════════════════════════════
        // الرسائل
        // ══════════════════════════════════════════════════
        if (cmd === 'مسح' && !rest) {
            const ctx = msg.message?.extendedTextMessage?.contextInfo;
            if (!ctx?.stanzaId) return reply('↩️ رد على الرسالة اللي تبي تمسحها.');
            await tryDo(() => sock.sendMessage(chatId, { delete: {
                remoteJid: chatId, id: ctx.stanzaId,
                participant: ctx.participant, fromMe: false,
            }}), '🗑️');
            return;
        }

        if (cmd === 'تثبيت') {
            const ctx = msg.message?.extendedTextMessage?.contextInfo;
            if (!ctx?.stanzaId) return reply('↩️ رد على الرسالة اللي تبي تثبتها.');
            react(sock, msg, '⏳');
            try {
                await pinMessage(sock, chatId, ctx.stanzaId, ctx.participant, true);
                react(sock, msg, '📌');
            } catch (e) {
                react(sock, msg, '❌');
                await reply('❌ ' + (e?.message?.includes('admin') ? 'البوت يحتاج صلاحيات مشرف.' : (e?.message || 'فشل').slice(0,100)));
            }
            return;
        }

        if (twoWord === 'فك تثبيت') {
            const ctx = msg.message?.extendedTextMessage?.contextInfo;
            if (!ctx?.stanzaId) return reply('↩️ رد على الرسالة المثبتة.');
            react(sock, msg, '⏳');
            try {
                await pinMessage(sock, chatId, ctx.stanzaId, ctx.participant, false);
                react(sock, msg, '📌');
            } catch (e) { react(sock, msg, '❌'); await reply('❌ ' + (e?.message || '').slice(0,100)); }
            return;
        }

        // ══════════════════════════════════════════════════
        // إعدادات المجموعة
        // ══════════════════════════════════════════════════
        if (cmd === 'قفل' && !rest) {
            await tryDo(() => sock.groupSettingUpdate(chatId, 'announcement'), '🔒');
            return;
        }

        if (cmd === 'فتح' && !rest) {
            await tryDo(() => sock.groupSettingUpdate(chatId, 'not_announcement'), '🔓');
            return;
        }

        if (cmd === 'رابط') {
            try {
                const code = await sock.groupInviteCode(chatId);
                await reply('🔗 *رابط المجموعة:*\nhttps://chat.whatsapp.com/' + code);
            } catch (e) { await reply('❌ ' + e?.message); }
            return;
        }

        if (cmd === 'انضم' && rest) {
            const match = rest.match(/chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/i);
            if (!match) return reply('❌ رابط غير صحيح.\nمثال: /انضم https://chat.whatsapp.com/XXX');
            react(sock, msg, '⏳');
            try { await sock.groupAcceptInvite(match[1]); react(sock, msg, '✅'); await reply('✅ تم الانضمام.'); }
            catch (e) { react(sock, msg, '❌'); await reply('❌ ' + e?.message); }
            return;
        }

        // /خروج مع تأكيد
        if (cmd === 'خروج') {
            const pk = 'leave_' + chatId;
            if (_slashPending.get(pk)) {
                _slashPending.delete(pk);
                try { await sock.groupLeave(chatId); react(sock, msg, '✅'); }
                catch (e) { await reply('❌ ' + e?.message); }
            } else {
                _slashPending.set(pk, true);
                setTimeout(() => _slashPending.delete(pk), 15_000);
                await reply('⚠️ تأكيد الخروج؟\nاكتب /خروج مرة ثانية خلال 15 ثانية.');
            }
            return;
        }

        if (cmd === 'اسم' && rest) {
            react(sock, msg, '⏳');
            await tryDo(() => sock.groupUpdateSubject(chatId, rest), '✅');
            return;
        }

        if (cmd === 'وصف' && rest) {
            react(sock, msg, '⏳');
            await tryDo(() => sock.groupUpdateDescription(chatId, rest), '✅');
            return;
        }

        if (cmd === 'معلومات') {
            try {
                const { meta } = await getPerms();
                if (!meta) return reply('❌ تعذر جلب المعلومات.');
                await reply(
                    '📊 *معلومات المجموعة:*\n\n' +
                    '📌 *الاسم:* ' + meta.subject + '\n' +
                    '👥 *الأعضاء:* ' + meta.participants.length + '\n' +
                    '👑 *المشرفون:* ' + meta.participants.filter(p => p.admin).length + '\n' +
                    '🆔 *ID:* ' + chatId.split('@')[0] + '\n' +
                    '📅 *الإنشاء:* ' + new Date(meta.creation * 1000).toLocaleDateString('ar')
                );
            } catch (e) { await reply('❌ ' + e?.message); }
            return;
        }

        // ══════════════════════════════════════════════════
        // المحتوى — ترحيب وقوانين
        // ══════════════════════════════════════════════════
        if (cmd === 'ترحيب') {
            const wf = grpFile('welcome', chatId);
            if (rest === 'عرض') {
                if (!fs.existsSync(wf)) return reply('❌ لم يُضبط ترحيب بعد.');
                const { text: wt } = readJSON(wf, {});
                return reply('📋 *رسالة الترحيب:*\n\n' + wt);
            }
            if (rest === 'حذف') {
                try { fs.removeSync(wf); react(sock, msg, '🗑️'); await reply('✅ تم حذف رسالة الترحيب.'); }
                catch (e) { await reply('❌ ' + e?.message); }
                return;
            }
            if (rest) {
                writeJSON(wf, { text: rest });
                react(sock, msg, '✅');
                await reply('✅ تم حفظ رسالة الترحيب.\nاستخدم {name} للاسم و {number} للرقم.');
                return;
            }
            return reply('📖 الاستخدام:\n/ترحيب [نص]  — ضبط\n/ترحيب عرض  — عرض\n/ترحيب حذف  — حذف');
        }

        if (cmd === 'قوانين') {
            const rf = grpFile('rules', chatId);
            if (rest === 'عرض') {
                if (!fs.existsSync(rf)) return reply('❌ لم تُضبط قوانين بعد.');
                const { text: rt } = readJSON(rf, {});
                return reply('📜 *قوانين المجموعة:*\n\n' + rt);
            }
            if (rest === 'حذف') {
                try { fs.removeSync(rf); react(sock, msg, '🗑️'); await reply('✅ تم حذف القوانين.'); }
                catch (e) { await reply('❌ ' + e?.message); }
                return;
            }
            if (rest) {
                writeJSON(rf, { text: rest });
                react(sock, msg, '✅');
                await reply('✅ تم حفظ القوانين.');
                return;
            }
            return reply('📖 الاستخدام:\n/قوانين [نص]  — ضبط\n/قوانين عرض  — عرض\n/قوانين حذف  — حذف');
        }

        // ══════════════════════════════════════════════════
        // إدارة النخبة
        // ══════════════════════════════════════════════════
        if (cmd === 'نخبة') {
            const ctx = msg.message?.extendedTextMessage?.contextInfo;

            if (rest === 'عرض') {
                try {
                    const elites = sock.getElites?.() || [];
                    if (!elites.length) return reply('📋 قائمة النخبة فارغة.');
                    const list = elites.map((id, i) => (i+1) + '. @' + normalizeJid(id)).join('\n');
                    await replyM('👑 *قائمة النخبة (' + elites.length + '):*\n\n' + list, elites);
                } catch (e) { await reply('❌ ' + e?.message); }
                return;
            }

            if (rest === 'مسح') {
                const pk = 'elite_clear_' + senderRaw;
                if (_slashPending.get(pk)) {
                    _slashPending.delete(pk);
                    try { await sock.eliteReset?.({ sock }); react(sock, msg, '✅'); await reply('✅ تم مسح قائمة النخبة.'); }
                    catch (e) { await reply('❌ ' + e?.message); }
                } else {
                    _slashPending.set(pk, true);
                    setTimeout(() => _slashPending.delete(pk), 15_000);
                    await reply('⚠️ تأكيد مسح قائمة النخبة؟\nاكتب /نخبة مسح مرة ثانية خلال 15 ثانية.');
                }
                return;
            }

            const isAdd = rest.startsWith('اضف');
            const isRem = rest.startsWith('ازل');
            if (isAdd || isRem) {
                let ids = ctx?.mentionedJid?.length ? ctx.mentionedJid
                        : ctx?.participant ? [ctx.participant]
                        : [];
                if (!ids.length) {
                    const num = rest2.replace(/\D/g, '');
                    if (num.length >= 9) {
                        try {
                            const check = await sock.onWhatsApp(num + '@s.whatsapp.net');
                            ids = [check?.[0]?.jid || num + '@s.whatsapp.net'];
                        } catch { ids = [num + '@s.whatsapp.net']; }
                    }
                }
                if (!ids.length) return reply('↩️ منشن الشخص أو رد على رسالته أو اكتب رقمه.');
                try {
                    if (isAdd) {
                        const res = await sock.addElite({ sock, ids });
                        let out = '*إضافة النخبة*\n\n';
                        if (res?.success?.length) out += '✅ ' + res.success.map(u => '@' + normalizeJid(u.id)).join(', ') + ' تمت الإضافة\n';
                        if (res?.fail?.length)    out += '⚠️ ' + res.fail.map(u => '@' + normalizeJid(u.id) + ' (' + (u.error === 'exist_already' ? 'موجود مسبقاً' : u.error) + ')').join(', ');
                        await reply(out.trim());
                    } else {
                        const res = await sock.rmElite({ sock, ids });
                        let out = '*إزالة النخبة*\n\n';
                        if (res?.success?.length) out += '✅ ' + res.success.map(u => '@' + normalizeJid(u.id)).join(', ') + ' تمت الإزالة\n';
                        if (res?.fail?.length)    out += '⚠️ ' + res.fail.map(u => '@' + normalizeJid(u.id) + ' (' + (u.error === 'not_exist' ? 'ليس نخبة أصلاً' : u.error) + ')').join(', ');
                        await reply(out.trim());
                    }
                } catch (e) { await reply('❌ ' + e?.message); }
                return;
            }

            return reply('📖 الاستخدام:\n/نخبة اضف  /نخبة ازل  /نخبة عرض  /نخبة مسح');
        }

        // ══════════════════════════════════════════════════
        // الحماية — toggle
        // ══════════════════════════════════════════════════
        const protKey = _SLASH_PROT[twoWord] || _SLASH_PROT[cmd];
        if (protKey) {
            const p = readProt();
            p[protKey] = p[protKey] === 'on' ? 'off' : 'on';
            writeProt(p);
            react(sock, msg, p[protKey] === 'on' ? '✅' : '⛔');
            await reply((p[protKey] === 'on' ? '✅ شُغِّل' : '⛔ أُوقف') + ': *' + (twoWord || cmd) + '*');
            return;
        }

        // قفل المحتوى — toggle
        const lockKey = _SLASH_LOCK[twoWord];
        if (lockKey) {
            const p = readProt();
            p[lockKey] = p[lockKey] === 'on' ? 'off' : 'on';
            writeProt(p);
            react(sock, msg, p[lockKey] === 'on' ? '🔒' : '🔓');
            await reply((p[lockKey] === 'on' ? '🔒 شُغِّل' : '🔓 أُوقف') + ': *' + twoWord + '*');
            return;
        }

        // ══════════════════════════════════════════════════
        // أدوات
        // ══════════════════════════════════════════════════

        // /تحميل [رابط]  |  /تحميل صوت [رابط]
        if (cmd === 'تحميل') {
            const audioMode = rest.startsWith('صوت');
            const urlRaw    = audioMode ? parts.slice(2).join(' ').trim() : rest;
            const url       = urlRaw.match(/https?:\/\/[^\s]+/i)?.[0] ||
                              (urlRaw.startsWith('http') ? urlRaw : null);
            if (!url) return reply('📖 الاستخدام:\n/تحميل [رابط]\n/تحميل صوت [رابط]');
            const icon     = audioMode ? '🎵' : '🎬';
            const platform = detectPlatform(url) || 'رابط';
            react(sock, msg, '⏳');
            const stMsg = await sock.sendMessage(chatId,
                { text: icon + ' *جاري تحميل ' + platform + '...*' }, { quoted: msg });
            const upd = t => sock.sendMessage(chatId, { text: t, edit: stMsg.key }).catch(() => {});
            try {
                const { filePath, ext, cleanup } = await ytdlpDownload(url, { audio: audioMode });
                const fileSize = fs.statSync(filePath).size;
                const isVideo  = ['mp4','mkv','webm','mov','avi'].includes(ext);
                const isAudio  = ['mp3','m4a','ogg','aac','opus','wav'].includes(ext);
                const isImage  = ['jpg','jpeg','png','webp','gif'].includes(ext);
                if (fileSize > 150 * 1024 * 1024) { cleanup(); return upd('❌ الملف أكبر من 150MB.'); }
                const buffer = fs.readFileSync(filePath); cleanup();
                if (isVideo && fileSize > 70 * 1024 * 1024) {
                    await sock.sendMessage(chatId, {
                        document: buffer, mimetype: 'video/mp4',
                        fileName: platform + '_video.mp4',
                        caption: '📎 ' + platform + ' — مستند (' + (fileSize/1024/1024).toFixed(1) + 'MB)',
                    }, { quoted: msg });
                } else if (isVideo) {
                    await sock.sendMessage(chatId, { video: buffer, caption: icon + ' ' + platform }, { quoted: msg });
                } else if (isAudio) {
                    await sock.sendMessage(chatId, { audio: buffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                } else if (isImage) {
                    await sock.sendMessage(chatId, { image: buffer, caption: icon + ' ' + platform }, { quoted: msg });
                } else {
                    await sock.sendMessage(chatId, {
                        document: buffer, mimetype: 'application/octet-stream',
                        fileName: path.basename(filePath), caption: icon + ' ' + platform,
                    }, { quoted: msg });
                }
                react(sock, msg, '✅'); await upd('✅ *تم التحميل!*');
            } catch (e) {
                react(sock, msg, '❌');
                const em = e?.message || '';
                let hint = '';
                if (em.includes('غير مثبت') || em.includes('yt-dlp'))
                    hint = '\n💡 pip install -U yt-dlp';
                else if (em.includes('معدل الطلبات') || em.includes('429'))
                    hint = '\n⏳ حاول بعد دقيقتين.';
                else if (em.includes('خاص') || em.toLowerCase().includes('private'))
                    hint = '\n🔒 المحتوى خاص.';
                else if (em.includes('Unsupported URL'))
                    hint = '\n🔗 الرابط غير مدعوم.';
                await upd('❌ *فشل:*\n' + em.slice(0, 120) + hint);
            }
            return;
        }

        if (cmd === 'تحديث') {
            react(sock, msg, '⏳');
            try { await loadPlugins(); react(sock, msg, '✅'); await reply('✅ تم تحديث الاوامر.'); }
            catch (e) { react(sock, msg, '❌'); await reply('❌ ' + e?.message); }
            return;
        }

        if (twoWord === 'مسح كاش') {
            react(sock, msg, '⏳');
            try {
                if (global._pluginsCache) global._pluginsCache = {};
                await loadPlugins().catch(() => {});
                react(sock, msg, '✅'); await reply('✅ تم مسح الكاش.');
            } catch (e) { react(sock, msg, '❌'); await reply('❌ ' + e?.message); }
            return;
        }

        if (cmd === 'اذاعة' && rest) {
            react(sock, msg, '⏳');
            try {
                const chats = await sock.groupFetchAllParticipating();
                let sent = 0;
                for (const gid of Object.keys(chats)) {
                    try { await sock.sendMessage(gid, { text: rest }); sent++; } catch {}
                    await sleep(500);
                }
                react(sock, msg, '✅');
                await reply('✅ تم الارسال لـ ' + sent + ' مجموعة.');
            } catch (e) { await reply('❌ ' + e?.message); }
            return;
        }

        if (cmd === 'احصاءات' || cmd === 'إحصاءات') {
            const s       = readStats();
            const topCmds = Object.entries(s.commands || {})
                .sort((a, b) => b[1] - a[1]).slice(0, 5)
                .map(([k, v], i) => (i+1) + '. ' + k + ': *' + v + '*').join('\n') || 'لا يوجد';
            const up = process.uptime();
            const h  = Math.floor(up/3600), mm = Math.floor((up%3600)/60), ss = Math.floor(up%60);
            await reply(
                '✧━── ❝ 𝐒𝐓𝐀𝐓𝐒 ❞ ──━✧\n\n' +
                '📨 الاوامر: *' + (s.total||0) + '*\n' +
                '⏱️ التشغيل: *' + h + 'h ' + mm + 'm ' + ss + 's*\n\n' +
                '🏆 *اكثر الاوامر:*\n' + topCmds + '\n\n' +
                '✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧'
            );
            return;
        }

        if (twoWord === 'تغيير اسم') {
            const oldName = parts[2];
            const newName = parts.slice(3).join(' ').trim();
            if (!oldName || !newName)
                return reply('📖 الاستخدام:\n/تغيير اسم [الامر_الحالي] [الاسم_الجديد]');
            react(sock, msg, '⏳');
            const fp = await findPluginByCmd(oldName);
            if (!fp) return reply('❌ ما وجدت أمر باسم: *' + oldName + '*');
            try {
                updatePluginField(fp, 'command', newName);
                await loadPlugins().catch(() => {});
                react(sock, msg, '✅');
                await reply('✅ تم تغيير: *' + oldName + '* ➔ *' + newName + '*');
            } catch (e) { react(sock, msg, '❌'); await reply('❌ ' + e?.message); }
            return;
        }

        // ══════════════════════════════════════════════════
        // أوامر البوت — تغيير الاسم والصورة والوصف
        // ══════════════════════════════════════════════════

        // /اسم بوت [الاسم الجديد]
        if (twoWord === 'اسم بوت') {
            if (!rest2) return reply('📖 الاستخدام: /اسم بوت [الاسم الجديد]');
            react(sock, msg, '⏳');
            try {
                await sock.updateProfileName(rest2.trim());
                react(sock, msg, '✅');
                await reply('✅ تم تغيير اسم البوت إلى: *' + rest2.trim() + '*');
            } catch (e) { react(sock, msg, '❌'); await reply('❌ ' + e?.message); }
            return;
        }

        // /وصف بوت [النص]
        if (twoWord === 'وصف بوت') {
            if (!rest2) return reply('📖 الاستخدام: /وصف بوت [النص]');
            react(sock, msg, '⏳');
            try {
                await sock.updateProfileStatus(rest2.trim());
                react(sock, msg, '✅');
                await reply('✅ تم تغيير وصف البوت.');
            } catch (e) { react(sock, msg, '❌'); await reply('❌ ' + e?.message); }
            return;
        }

        // /صورة بوت — رد على صورة لتغيير صورة البوت
        if (twoWord === 'صورة بوت') {
            const ctx2   = msg.message?.extendedTextMessage?.contextInfo;
            const imgMsg = msg.message?.imageMessage || ctx2?.quotedMessage?.imageMessage;
            if (!imgMsg) return reply('↩️ رد على صورة مع كتابة /صورة بوت');
            react(sock, msg, '⏳');
            try {
                const target2 = msg.message?.imageMessage
                    ? msg
                    : { message: ctx2.quotedMessage, key: { ...msg.key, id: ctx2.stanzaId, participant: ctx2.participant } };
                const buf = await downloadMediaMessage(target2, 'buffer', {});
                await sock.updateProfilePicture(getBotJid(sock), buf);
                react(sock, msg, '✅');
                await reply('✅ تم تغيير صورة البوت.');
            } catch (e) { react(sock, msg, '❌'); await reply('❌ ' + e?.message); }
            return;
        }

        // /صورة — تغيير صورة المجموعة (رد على صورة)
        if (cmd === 'صورة' && !rest) {
            const ctx2   = msg.message?.extendedTextMessage?.contextInfo;
            const imgMsg = msg.message?.imageMessage || ctx2?.quotedMessage?.imageMessage;
            if (!imgMsg) return reply('↩️ رد على صورة لتغيير صورة المجموعة.\nأو: /صورة بوت لتغيير صورة البوت.');
            react(sock, msg, '⏳');
            try {
                const target2 = msg.message?.imageMessage
                    ? msg
                    : { message: ctx2.quotedMessage, key: { ...msg.key, id: ctx2.stanzaId, participant: ctx2.participant } };
                const buf = await downloadMediaMessage(target2, 'buffer', {});
                await tryDo(() => sock.updateProfilePicture(chatId, buf), '✅');
            } catch (e) { react(sock, msg, '❌'); await reply('❌ ' + e?.message); }
            return;
        }

        // /بلوك [رقم/منشن] — حظر على مستوى البوت
        if (cmd === 'بلوك') {
            const target = await resolveSlashTarget();
            if (!target) return reply('↩️ منشن الشخص أو اكتب رقمه.');
            try {
                await sock.updateBlockStatus(target, 'block');
                react(sock, msg, '🔒');
                await reply('✅ تم حظر @' + normalizeJid(target));
            } catch (e) { await reply('❌ ' + e?.message); }
            return;
        }

        // /فك-بلوك [رقم/منشن]
        if (cmd === 'فك-بلوك' || twoWord === 'فك بلوك') {
            const target = await resolveSlashTarget();
            if (!target) return reply('↩️ منشن الشخص أو اكتب رقمه.');
            try {
                await sock.updateBlockStatus(target, 'unblock');
                react(sock, msg, '🔓');
                await reply('✅ تم فك الحظر عن @' + normalizeJid(target));
            } catch (e) { await reply('❌ ' + e?.message); }
            return;
        }

        // /كلمات عرض | /كلمات اضف [كلمة] | /كلمات حذف [كلمة]
        if (cmd === 'كلمات') {
            if (!isGroup) return reply('❌ هذا الامر للمجموعات فقط.');
            const bf = grpFile('badwords', chatId);
            let words = readJSON(bf, []);
            if (rest === 'عرض' || !rest) {
                const list = words.length ? words.map((w,i) => (i+1) + '. ' + w).join('\n') : 'لا يوجد كلمات ممنوعة.';
                return reply('🚫 *الكلمات الممنوعة:*\n\n' + list);
            }
            if (rest.startsWith('اضف ') || rest.startsWith('اضافة ')) {
                const w = rest.split(' ').slice(1).join(' ').trim().toLowerCase();
                if (!w) return reply('↩️ اكتب الكلمة: /كلمات اضف [كلمة]');
                if (!words.includes(w)) { words.push(w); writeJSON(bf, words); react(sock, msg, '✅'); }
                return reply('✅ تمت الإضافة: ' + w);
            }
            if (rest.startsWith('حذف ') || rest.startsWith('ازل ')) {
                const w = rest.split(' ').slice(1).join(' ').trim().toLowerCase();
                if (!w) return reply('↩️ اكتب الكلمة: /كلمات حذف [كلمة]');
                writeJSON(bf, words.filter(x => x !== w));
                react(sock, msg, '🗑️');
                return reply('✅ تم الحذف: ' + w);
            }
            return reply('📖 الاستخدام:\n/كلمات عرض\n/كلمات اضف [كلمة]\n/كلمات حذف [كلمة]');
        }

        // /مجموعاتي — إحصاءات المجموعات
        if (cmd === 'مجموعاتي') {
            react(sock, msg, '⏳');
            try {
                const allGroups = await sock.groupFetchAllParticipating();
                const groups = Object.values(allGroups);
                if (!groups.length) return reply('📭 البوت ليس في أي مجموعة حالياً.');
                groups.sort((a, b) => (b.participants?.length || 0) - (a.participants?.length || 0));
                const totalMembers = groups.reduce((s, g) => s + (g.participants?.length || 0), 0);
                const top5 = groups.slice(0, 5).map((g, i) =>
                    (i+1) + '. *' + (g.subject || '—') + '* — ' + (g.participants?.length || 0) + ' عضو'
                ).join('\n');
                await reply(
                    '✧━── ❝ 𝐆𝐑𝐎𝐔𝐏𝐒 ❞ ──━✧\n\n' +
                    '📊 المجموعات: *' + groups.length + '*\n' +
                    '👥 إجمالي الأعضاء: *' + totalMembers + '*\n' +
                    '🏆 أكبر مجموعة: *' + (groups[0]?.subject || '—') + '* (' + (groups[0]?.participants?.length || 0) + ' عضو)\n\n' +
                    '*أعلى 5 مجموعات:*\n' + top5
                );
            } catch (e) { await reply('❌ ' + e?.message); }
            return;
        }

        // /خاص — إحصاءات الرسائل الخاصة (الغير مقروءة)
        if (cmd === 'خاص') {
            try {
                const store = sock.store;
                let pvtTotal = 0, pvtUnread = 0;
                if (store?.chats) {
                    const all = typeof store.chats.all === 'function'
                        ? store.chats.all()
                        : Object.values(store.chats);
                    for (const chat of all) {
                        const id = chat.id || '';
                        if (id.endsWith('@g.us') || id.includes('broadcast') || id.includes('status')) continue;
                        pvtTotal++;
                        if ((chat.unreadCount || 0) > 0) pvtUnread++;
                    }
                }
                await reply(
                    '📱 *إحصاءات الخاص:*\n\n' +
                    '💬 المحادثات الخاصة: *' + pvtTotal + '*\n' +
                    '📬 غير مقروءة: *' + pvtUnread + '*\n' +
                    '📖 مقروءة: *' + (pvtTotal - pvtUnread) + '*'
                );
            } catch (e) { await reply('❌ تعذر جلب بيانات المحادثات: ' + e?.message); }
            return;
        }

    } catch {}
}
slashCommandHandler._src = 'slash_system';

// تسجيل الـ handlers
if (!global.featureHandlers) global.featureHandlers = [];
global.featureHandlers = global.featureHandlers.filter(
    h => !['protection_system','stats_system','antiDelete_system','slash_system'].includes(h._src)
);
global.featureHandlers.push(protectionHandler, statsAutoHandler, antiDeleteHandler, slashCommandHandler);

// ══════════════════════════════════════════════════════════════
//  تنزيلات — Download Queue (حد أقصى 3 متزامنة)
// ══════════════════════════════════════════════════════════════
const DL_MAX_CONCURRENT = 3;
let   _dlActive = 0;


// ══════════════════════════════════════════════════════════════
//  savetube API — تحميل يوتيوب بدون yt-dlp (أسرع وأموثق)
// ══════════════════════════════════════════════════════════════
const savetube = {
    base: 'https://media.savetube.me/api',
    headers: {
        'accept': '*/*',
        'content-type': 'application/json',
        'origin': 'https://yt.savetube.me',
        'referer': 'https://yt.savetube.me/',
        'user-agent': 'Postify/1.0.0',
    },
    extractId(url) {
        const p = [
            /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
            /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
            /youtu\.be\/([a-zA-Z0-9_-]{11})/,
        ];
        for (const r of p) { const m = url.match(r); if (m) return m[1]; }
        return null;
    },
    async req(endpoint, data = {}, method = 'post') {
        try {
            const fullUrl = endpoint.startsWith('http') ? endpoint : this.base + endpoint;
            const opts    = { method, headers: this.headers };
            if (method === 'post') opts.body = JSON.stringify(data);
            const resp = await fetch(fullUrl, opts);
            if (!resp.ok) return { ok: false };
            return { ok: true, data: await resp.json() };
        } catch { return { ok: false }; }
    },
    async decrypt(enc) {
        const key      = Buffer.from('C5D58EF67A7584E4A29F6C35BBC4EB12', 'hex');
        const raw      = Buffer.from(enc, 'base64');
        const iv       = raw.slice(0, 16);
        const content  = raw.slice(16);
        const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
        const dec      = Buffer.concat([decipher.update(content), decipher.final()]);
        return JSON.parse(dec.toString());
    },
    async getCDN() {
        const r = await this.req('/random-cdn', {}, 'get');
        return r.ok ? r.data?.cdn : null;
    },
    async download(url, type = 'audio') {
        const id  = this.extractId(url);
        if (!id) return null;
        const cdn = await this.getCDN();
        if (!cdn) return null;
        const info = await this.req(`https://${cdn}/v2/info`, { url: `https://www.youtube.com/watch?v=${id}` });
        if (!info.ok) return null;
        const dec  = await this.decrypt(info.data.data).catch(() => null);
        if (!dec) return null;
        const dl   = await this.req(`https://${cdn}/download`, {
            id,
            downloadType: type,
            quality: type === 'audio' ? 'mp3' : '720',
            key: dec.key,
        });
        const link = dl.data?.data?.downloadUrl;
        if (!link) return null;
        return { url: link, title: dec.title || '' };
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
            try { const r = await fetch(url, { redirect: 'follow' }); finalUrl = r.url || url; } catch {}
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
        try { await execAsync(`${bin} --version`, { timeout: 5000 }); _ytdlpBin = bin; return bin; } catch {}
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
            'bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best[ext=mp4]/best',
            'best[height<=720]/best',
            'best',
        ];
    }
    // بقية المنصات (تيك توك، تويتر، ساوند..)
    return [
        'best[ext=mp4]/best',
        'best',
    ];
}

async function ytdlpDownload(url, opts = {}) {
    // ✅ تنظيف الـ URL لمنع shell injection
    if (!/^https?:\/\//i.test(url)) throw new Error('رابط غير صالح.');
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

    // ✅ baseArgs كـ array — لا string concatenation — آمن من injection
    const baseArgs = [
        '--no-playlist',
        '--no-warnings',
        '--socket-timeout', '30',
        '--retries', '3',
        '--fragment-retries', '3',
        '--concurrent-fragments', '4',
        ...cookieArg,
        ...userAgentArgs,
        '--output', path.join(outDir, 'media.%(ext)s'),
    ];

    const igArgs = isInstagram(safeUrl)
        ? ['--extractor-args', 'instagram:skip_dash_manifest']
        : [];

    const cleanup = () => { try { fs.removeSync(outDir); } catch {} };

    // ✅ دالة تشغيل آمنة بـ spawn بدل execAsync
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
            const t = setTimeout(() => { try { proc.kill(); } catch {} reject(new Error('timeout')); }, 180_000);
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
const MAIN_MENU =
`✧━── ❝ 𝐍𝐎𝐕𝐀 𝐒𝐘𝐒𝐓𝐄𝐌 ❞ ──━✧

✦ *نخبة*
\`👑 ادارة قائمة النخبة\`

✦ *بلاجنز*
\`🧩 ادارة وعرض الاوامر\`

✦ *تنزيلات*
\`⬇️ تنزيل من يوتيوب وانستقرام وغيرها\`

✦ *إحصاءات*
\`📊 تقارير الاستخدام\`

✦ *حماية*
\`🛡️ انظمة الحماية\`

✦ *بوت*
\`🤖 إدارة حساب البوت\`

✦ *إدارة*
\`🛠️ إدارة المجموعات\`

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`;

// activeSessions معرّفة في بداية الملف قبل setInterval

// ══════════════════════════════════════════════════════════════
//  NovaUltra
// ══════════════════════════════════════════════════════════════
const NovaUltra = {
    command:     'نظام',
    description: 'نظام البوت الشامل',
    elite:       'on',
    group:       false,
    prv:         false,
    lock:        'off',
};

// ══════════════════════════════════════════════════════════════
//  execute
// ══════════════════════════════════════════════════════════════
async function execute({ sock, msg }) {
    const chatId = msg.key.remoteJid;
    const sender = msg.key.participant || chatId;

    registerDeleteListener(sock);
    registerWelcomeListener(sock);

    if (activeSessions.has(chatId)) {
        const old = activeSessions.get(chatId);
        sock.ev.off('messages.upsert', old.listener);
        clearTimeout(old.timeout);
        activeSessions.delete(chatId);
    }

    const sentMsg = await sock.sendMessage(chatId, { text: MAIN_MENU }, { quoted: msg });
    let botMsgKey = sentMsg.key;
    let state     = 'MAIN';
    let tmp       = {};
    let msgCount  = 0;          // عداد الرسائل الواردة
    let lastMenuText = MAIN_MENU; // آخر نص قائمة عُرض

    // لما msgCount يصل 10، يُعاد إرسال القائمة الحالية برسالة جديدة
    const RESEND_EVERY = 10;

    // ── تاريخ التنقل للرجوع درجة واحدة بدقة ──
    // كل entry: { state, showFn, label }
    const history = [];
    const SHOW_FN_MAP = {};  // يُملأ لاحقاً بعد تعريف الدوال

    // push: احفظ الوضع الحالي قبل الانتقال
    const pushState = (fromState, fromShowFn) => {
        const last = history[history.length - 1];
        if (last?.state === fromState) return;
        history.push({ state: fromState, showFn: fromShowFn });
        if (history.length > 20) history.shift();
    };

    // goBack: ارجع للحالة السابقة مع تشغيل دالة العرض
    const goBack = async () => {
        const prev = history.pop();
        if (!prev) {
            await update(MAIN_MENU);
            state = 'MAIN';
            return;
        }
        state = prev.state;
        if (typeof prev.showFn === 'function') await prev.showFn();
        else await update(MAIN_MENU);
    };

    const update = async (textOrObj) => {
        const payload = typeof textOrObj === 'string' ? { text: textOrObj } : textOrObj;
        // خزّن آخر نص للإعادة التلقائية
        if (payload.text) lastMenuText = payload.text;
        try { await sock.sendMessage(chatId, { ...payload, edit: botMsgKey }); }
        catch { const s = await sock.sendMessage(chatId, payload); botMsgKey = s.key; }
    };

    // إعادة إرسال القائمة — يمسح القديمة أولاً ثم يرسل جديدة
    const resendMenu = async () => {
        try {
            // احذف الرسالة القديمة
            try { await sock.sendMessage(chatId, { delete: botMsgKey }); } catch {}
            await sleep(300);
            const s = await sock.sendMessage(chatId, { text: lastMenuText });
            botMsgKey = s.key;
            msgCount = 0; // إعادة العد
        } catch {}
    };

    async function getAdminPerms() {
        if (!chatId.endsWith('@g.us')) return { isGroup: false, isAdmin: false, isBotAdmin: false, meta: null };
        try {
            const meta      = await sock.groupMetadata(chatId);
            const senderNum = normalizeJid(sender);
            const botNum    = normalizeJid(getBotJid(sock));
            const adminNums = new Set(
                meta.participants
                    .filter(p => p.admin)
                    .flatMap(p => [normalizeJid(p.id), normalizeJid(p.lid || '')])
                    .filter(Boolean)
            );
            return {
                meta,
                isGroup:    true,
                isAdmin:    msg.key.fromMe || adminNums.has(senderNum),
                isBotAdmin: adminNums.has(botNum),
            };
        } catch { return { isGroup: true, isAdmin: false, isBotAdmin: false, meta: null }; }
    }

    const tryAdminAction = async (fn, okEmoji = '✅') => {
        try { await fn(); react(sock, msg, okEmoji); return true; }
        catch (e) {
            const { isGroup, isAdmin, isBotAdmin } = await getAdminPerms();
            if (!isGroup)    { await update('❌ هذا الامر للمجموعات فقط.');    return false; }
            if (!isBotAdmin) { await update('❌ البوت ليس مشرفا، رقه اولا.'); return false; }
            if (!isAdmin)    { await update('❌ انت لست مشرفا.');              return false; }
            await update(`❌ فشل: ${e?.message || e}`); return false;
        }
    };

    const cleanup = () => {
        sock.ev.off('messages.upsert', listener);
        clearTimeout(timeout);
        activeSessions.delete(chatId);
    };

    // ══════════════════════════════════════════════════
    //  listener
    // ══════════════════════════════════════════════════
    const listener = async ({ messages }) => {
        const m = messages[0];
        if (!m?.message || m.key.remoteJid !== chatId) return;
        const newSender = m.key.participant || m.key.remoteJid;
        if (newSender !== sender) return;

        const text = (m.message.conversation || m.message.extendedTextMessage?.text || '').trim();
        if (!text) return;

        // ── Rate limiting ──
        if (isRateLimited(newSender)) return;

        // ✅ أوامر البريفكس المباشر /امر تتجاوز الجلسة — يعالجها slashCommandHandler
        if (text.startsWith('/')) return;

        // إعادة ضبط timeout عند كل تفاعل + تحديث lastActivity
        clearTimeout(timeout);
        timeout = setTimeout(cleanup, 300_000);
        const sess = activeSessions.get(chatId);
        if (sess) sess.lastActivity = Date.now();

        reactInput(sock, m, text);

        // ── إعادة إرسال القائمة كل RESEND_EVERY رسالة ──
        msgCount++;
        if (msgCount >= RESEND_EVERY) {
            msgCount = 0;
            await resendMenu();
        }

        // 🏠 زر الرئيسية — يعمل من أي مكان في أي فرع
        if (text === 'الرئيسية') {
            await update(MAIN_MENU);
            state = 'MAIN';
            tmp = {};
            return;
        }

        // ══════════════════════════════════════════════════
        // MAIN
        // ══════════════════════════════════════════════════
        if (state === 'MAIN') {
            if (text === 'نخبة')                          { pushState('MAIN', () => update(MAIN_MENU)); await showEliteMenu();   state = 'ELITE';    return; }
            if (text === 'بلاجنز')                        { pushState('MAIN', () => update(MAIN_MENU)); await showPluginsMenu(); state = 'PLUGINS';  return; }
            if (text === 'تنزيلات')                       { pushState('MAIN', () => update(MAIN_MENU)); await showDlMenu();      state = 'DL_MENU';  return; }
            if (text === 'إحصاءات' || text === 'احصاءات') { pushState('MAIN', () => update(MAIN_MENU)); await showStats();       state = 'STATS';    return; }
            if (text === 'حماية')                         { pushState('MAIN', () => update(MAIN_MENU)); await showProtMenu();    state = 'PROT';     return; }
            if (text === 'بوت')                           { pushState('MAIN', () => update(MAIN_MENU)); await showBotMenu();     state = 'BOT';      return; }
            if (text === 'إدارة')                         { pushState('MAIN', () => update(MAIN_MENU)); await showAdminMenu();   state = 'ADMIN';    return; }
            return;
        }

        // ══════════════════════════════════════════════════
        // ELITE
        // ══════════════════════════════════════════════════
        if (state === 'ELITE') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'عرض') {
                try {
                    const elites = sock.getElites?.() || [];
                    if (!elites.length) {
                        pushState('ELITE', showEliteMenu);
                        state = 'ELITE_VIEW';
                        return update(`✧━── ❝ 𝐍𝐗𝐁𝐀 ❞ ──━✧\n\n📋 القائمة فارغة.\n\n🔙 *رجوع*\n\n✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
                    }
                    const list = elites.map((id, i) => `${i+1}. @${normalizeJid(id)}`).join('\n');
                    pushState('ELITE', showEliteMenu);
                    state = 'ELITE_VIEW';
                    return update({
                        text: `✧━── ❝ 𝐍𝐗𝐁𝐀 ❞ ──━✧\n\n👑 *قائمة النخبة (${elites.length}):*\n\n${list}\n\n🔙 *رجوع*\n\n✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`,
                        mentions: elites,
                    });
                } catch { return update('❌ تعذر جلب القائمة.\n\n🔙 *رجوع*'); }
            }
            if (text === 'اضافة')    { pushState('ELITE', showEliteMenu); await update('📱 ارسل الرقم:\nمثال: 966501234567\nاو منشن شخص\n\n🔙 *رجوع*'); state = 'ELITE_ADD'; return; }
            if (text === 'حذف')      { pushState('ELITE', showEliteMenu); await update('📱 ارسل الرقم للحذف:\nاو منشن شخص\n\n🔙 *رجوع*'); state = 'ELITE_DEL'; return; }
            if (text === 'مسح الكل') { pushState('ELITE', showEliteMenu); await update('⚠️ *تاكيد مسح كل النخبة؟*\nاكتب *نعم* او *رجوع*'); state = 'ELITE_CLEAR'; return; }
            return;
        }

        if (state === 'ELITE_VIEW') {
            if (text === 'رجوع') { await goBack(); return; }
            return;
        }

        if (state === 'ELITE_ADD') {
            if (text === 'رجوع') { await goBack(); return; }
            const ctxMentions = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const ctxReply    = m.message?.extendedTextMessage?.contextInfo?.participant;
            let ids = [];
            if (ctxMentions.length) ids = ctxMentions;
            else if (ctxReply)       ids = [ctxReply];
            else {
                const num = text.replace(/\D/g, '');
                if (num.length < 9) return update('❌ رقم غير صحيح.');
                try {
                    const check = await sock.onWhatsApp(num + '@s.whatsapp.net');
                    const resolved = check?.[0]?.jid || '';
                    ids = [resolved.endsWith('@s.whatsapp.net') ? resolved : num + '@s.whatsapp.net'];
                } catch { ids = [num + '@s.whatsapp.net']; }
            }
            try {
                const res = await sock.addElite({ sock, ids });
                let msg2 = '*إضافة النخبة*\n\n';
                if (res?.success?.length) msg2 += '✅ ' + res.success.map(u => `@${normalizeJid(u.id)}`).join(', ') + ' تمت الإضافة\n';
                if (res?.fail?.length)    msg2 += '⚠️ ' + res.fail.map(u => `@${normalizeJid(u.id)} (${u.error==='exist_already'?'موجود مسبقاً':u.error})`).join(', ');
                await update(msg2.trim());
            } catch (e) { await update(`❌ ${e?.message}`); }
            await sleep(1500); await showEliteMenu(); state = 'ELITE'; return;
        }

        if (state === 'ELITE_DEL') {
            if (text === 'رجوع') { await goBack(); return; }
            const ctxMentions = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const ctxReply    = m.message?.extendedTextMessage?.contextInfo?.participant;
            let ids = [];
            if (ctxMentions.length) ids = ctxMentions;
            else if (ctxReply)       ids = [ctxReply];
            else {
                const num = text.replace(/\D/g, '');
                if (num.length < 9) return update('❌ رقم غير صحيح.');
                ids = [num + '@s.whatsapp.net'];
            }
            try {
                const res = await sock.rmElite({ sock, ids });
                let msg2 = '*إزالة النخبة*\n\n';
                if (res?.success?.length) msg2 += '✅ ' + res.success.map(u => `@${normalizeJid(u.id)}`).join(', ') + ' تمت الإزالة\n';
                if (res?.fail?.length)    msg2 += '⚠️ ' + res.fail.map(u => `@${normalizeJid(u.id)} (${u.error==='not_exist'?'ليس نخبة أصلاً':u.error})`).join(', ');
                await update(msg2.trim());
            } catch (e) { await update(`❌ ${e?.message}`); }
            await sleep(1500); await showEliteMenu(); state = 'ELITE'; return;
        }

        if (state === 'ELITE_CLEAR') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'نعم') {
                try { await sock.eliteReset?.({ sock }); await update('✅ تم مسح الكل.'); }
                catch (e) { await update(`❌ ${e?.message}`); }
                await sleep(1200); await showEliteMenu(); state = 'ELITE';
            }
            return;
        }

        // ══════════════════════════════════════════════════
        // PLUGINS
        // ══════════════════════════════════════════════════
        if (state === 'PLUGINS') {
            if (text === 'رجوع')    { await goBack(); return; }
            if (text === 'الاوامر') { pushState('PLUGINS', showPluginsMenu); await showPluginsListMenu(); state = 'PLUGINS_LIST'; return; }
            if (text === 'التعديل') { pushState('PLUGINS', showPluginsMenu); await showPluginsEditMenu(); state = 'PLUGINS_EDIT_MENU'; return; }
            if (text === 'الادوات') { pushState('PLUGINS', showPluginsMenu); await showCmdTools();       state = 'CMDTOOLS';          return; }
            if (text === 'جديد')    { pushState('PLUGINS', showPluginsMenu); await update('📝 اكتب اسم الامر الجديد:\n`بدون .js`\n\n🔙 *رجوع*'); state = 'PLUGIN_NEW_NAME'; return; }
            return;
        }

        if (state === 'PLUGINS_LIST') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'عرض الكل') {
                const files = getAllPluginFiles();
                let chunk = `✧━── ❝ 𝐏𝐋𝐔𝐆𝐈𝐍𝐒 ❞ ──━✧\n\n*الاوامر (${files.length}):*\n\n`, chunks = [];
                for (const f of files) {
                    const { cmd, elite, lock } = getPluginInfo(f);
                    const line = `✦ ${cmd}${elite==='on'?' 👑':''}${lock==='on'?' 🔒':''}\n`;
                    if ((chunk + line).length > 3500) { chunks.push(chunk); chunk = ''; }
                    chunk += line;
                }
                if (chunk) chunks.push(chunk);
                for (const c of chunks) await sock.sendMessage(chatId, { text: c });
                await update('🔙 *رجوع*');
                return;
            }
            if (text.startsWith('بحث ')) {
                const cmdName = text.slice(4).trim();
                const fp = await findPluginByCmd(cmdName);
                if (!fp) return update(`❌ ما وجدت: ${cmdName}\n\n🔙 *رجوع*`);
                tmp.targetFile = fp; tmp.targetCmd = cmdName;
                pushState('PLUGINS_LIST', showPluginsListMenu); await showPluginDetail(fp, cmdName); state = 'PLUGIN_DETAIL'; return;
            }
            if (text.startsWith('كود ')) {
                const cmdName = text.slice(4).trim();
                const fp = await findPluginByCmd(cmdName);
                if (!fp) return update(`❌ ما وجدت: ${cmdName}`);
                try { await sock.sendMessage(chatId, { document: fs.readFileSync(fp), mimetype: 'application/javascript', fileName: path.basename(fp) }); }
                catch (e) { await update(`❌ ${e?.message}`); }
                return;
            }
            return;
        }

        if (state === 'PLUGINS_EDIT_MENU') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text.startsWith('بحث ')) {
                const cmdName = text.slice(4).trim();
                const fp = await findPluginByCmd(cmdName);
                if (!fp) return update(`❌ ما وجدت: ${cmdName}\n\n🔙 *رجوع*`);
                tmp.targetFile = fp; tmp.targetCmd = cmdName;
                pushState('PLUGINS_EDIT_MENU', showPluginsEditMenu); await showPluginDetail(fp, cmdName); state = 'PLUGIN_DETAIL'; return;
            }
            if (text === 'طفي الكل') {
                for (const f of getAllPluginFiles()) { if (f.includes('نظام')) continue; try { updatePluginField(f,'lock','on'); } catch {} }
                await loadPlugins().catch(()=>{});
                await update('🔒 تم قفل الكل.\n\n🔙 *رجوع*'); return;
            }
            if (text === 'شغل الكل') {
                for (const f of getAllPluginFiles()) { if (f.includes('نظام')) continue; try { updatePluginField(f,'lock','off'); } catch {} }
                await loadPlugins().catch(()=>{});
                await update('🔓 تم فتح الكل.\n\n🔙 *رجوع*'); return;
            }
            return;
        }

        if (state === 'PLUGIN_DETAIL') {
            if (text === 'رجوع') { await goBack(); return; }
            const fp = tmp.targetFile, tc = tmp.targetCmd;
            if (!fp) return;
            if (text === 'كود') {
                try { await sock.sendMessage(chatId, { document: fs.readFileSync(fp), mimetype: 'application/javascript', fileName: path.basename(fp) }); }
                catch (e) { await update(`❌ ${e?.message}`); }
                return;
            }
            if (text === 'قفل' || text === 'فتح') {
                try { updatePluginField(fp,'lock',text==='قفل'?'on':'off'); await loadPlugins().catch(()=>{}); } catch {}
                await sleep(800); await showPluginDetail(fp, tc); return;
            }
            if (text === 'نخبة' || text === 'عام') {
                try { updatePluginField(fp,'elite',text==='نخبة'?'on':'off'); await loadPlugins().catch(()=>{}); } catch {}
                await sleep(800); await showPluginDetail(fp, tc); return;
            }
            if (text === 'مجموعات') { try { updatePluginField(fp,'group','true'); updatePluginField(fp,'prv','false'); await loadPlugins().catch(()=>{}); } catch {} await sleep(800); await showPluginDetail(fp, tc); return; }
            if (text === 'خاص')     { try { updatePluginField(fp,'prv','true'); updatePluginField(fp,'group','false'); await loadPlugins().catch(()=>{}); } catch {} await sleep(800); await showPluginDetail(fp, tc); return; }
            if (text === 'للجميع')  { try { updatePluginField(fp,'group','false'); updatePluginField(fp,'prv','false'); await loadPlugins().catch(()=>{}); } catch {} await sleep(800); await showPluginDetail(fp, tc); return; }
            if (text === 'تغيير الاسم') { pushState('PLUGIN_DETAIL', () => showPluginDetail(tmp.targetFile, tmp.targetCmd)); await update('✏️ اكتب الاسم الجديد:\n\n🔙 *رجوع*'); state = 'PLUGIN_RENAME'; return; }
            return;
        }

        if (state === 'PLUGIN_RENAME') {
            if (text === 'رجوع') { await goBack(); return; }
            try { updatePluginField(tmp.targetFile,'command',text.trim()); await loadPlugins().catch(()=>{}); } catch {}
            await update(`✅ ${tmp.targetCmd} ➔ ${text.trim()}`);
            tmp.targetCmd = text.trim(); await sleep(1200); await showPluginDetail(tmp.targetFile, tmp.targetCmd); state = 'PLUGIN_DETAIL'; return;
        }

        if (state === 'PLUGIN_NEW_NAME') {
            if (text === 'رجوع') { await goBack(); return; }
            const name = text.trim().replace(/\.js$/, '').replace(/[^\w\u0600-\u06FF]/g, '');
            if (!name) return update('❌ اسم غير صحيح.\n\n🔙 *رجوع*');
            tmp.newPluginName = name; await update(`📝 ارسل كود الامر [ *${name}* ]:\n\n🔙 *رجوع*`);
            state = 'PLUGIN_NEW_CODE'; return;
        }

        if (state === 'PLUGIN_NEW_CODE') {
            if (text === 'رجوع') { await goBack(); return; }
            const targetPath = path.join(PLUGINS_DIR, 'tools', `${tmp.newPluginName}.js`);
            try {
                fs.ensureDirSync(path.dirname(targetPath));
                fs.writeFileSync(targetPath, text, 'utf8');
                await loadPlugins().catch(()=>{});
                react(sock, m, '✅');
                await update(`✅ تم إنشاء [ ${tmp.newPluginName} ]`);
            } catch (e) { await update(`❌ ${e?.message}`); }
            await sleep(1000); await showPluginsMenu(); state = 'PLUGINS'; return;
        }

        // ══════════════════════════════════════════════════
        // DOWNLOADS
        // ══════════════════════════════════════════════════
        if (state === 'DL_MENU') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'فيديو' || text === 'صوت') {
                tmp.dlMode = text === 'فيديو' ? 'video' : 'audio';
                await update(`${text==='فيديو'?'🎬':'🎵'} ارسل الرابط:\n\n🔙 *رجوع*`);
                pushState('DL_MENU', showDlMenu); state = 'DL_WAIT'; return;
            }
            if (text === 'بنترست') {
                pushState('DL_MENU', showDlMenu);
                await update(
`✧━── ❝ 𝐏𝐈𝐍𝐓𝐄𝐑𝐄𝐒𝐓 ❞ ──━✧

🔍 اكتب كلمة البحث بالإنجليزي:
مثال: \`arthur\`، \`aesthetic\`، \`nature\`

سيتم إرسال *10 صور* مطابقة 📸

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
                state = 'PIN_SEARCH'; return;
            }
            const url = extractUrl(text);
            if (url) { await handleDownload(url, false, m); await sleep(1000); await showDlMenu(); return; }
            return;
        }

        if (state === 'PIN_SEARCH') {
            if (text === 'رجوع') { await goBack(); return; }
            const query = text.trim();
            if (!query || query.length < 1) return update('❌ اكتب كلمة بحث.');
            react(sock, m, '⏳');
            await update(`🔍 *جاري البحث عن "${query}" في Pinterest...*`);
            try {
                const images = await searchPinterest(query, 10);
                if (!images.length) {
                    await update(`❌ ما لقينا صور لـ "${query}"\nجرب كلمة أخرى.\n\n🔙 *رجوع*`);
                    return;
                }
                await update(`📸 *وجدنا ${images.length} صورة — جاري التحميل...*`);

                // حمّل كل الصور أولاً
                const buffers = [];
                for (const pin of images) {
                    try { buffers.push({ buf: await downloadImageBuffer(pin.url), title: pin.title || '' }); }
                    catch { /* تجاهل الصور الفاشلة */ }
                }

                // أرسل كـ media group (ألبوم) — كل 5 صور دفعة
                const BATCH = 5;
                let sent = 0;
                for (let i = 0; i < buffers.length; i += BATCH) {
                    const batch = buffers.slice(i, i + BATCH);
                    // أرسل الأولى في الدفعة كـ image عادية مع كابشن يوضح العدد
                    const first = batch[0];
                    await sock.sendMessage(chatId, {
                        image:   first.buf,
                        caption: `📌 *${query}* — صورة ${i+1}${batch.length > 1 ? `-${i+batch.length}` : ''}/${buffers.length}${first.title ? '\n' + first.title : ''}`,
                    });
                    sent++;
                    await sleep(300);
                    // أرسل الباقي بدون كابشن
                    for (let j = 1; j < batch.length; j++) {
                        try {
                            await sock.sendMessage(chatId, { image: batch[j].buf });
                            sent++;
                            await sleep(200);
                        } catch {}
                    }
                    await sleep(500); // pause between batches
                }

                react(sock, m, '✅');
                await update(
`✅ *تم إرسال ${sent}/${buffers.length} صورة*

🔍 ابحث مجدداً أو:
🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
            } catch (e) {
                react(sock, m, '❌');
                await update(`❌ فشل البحث: ${(e?.message || '').slice(0,100)}\n\n🔙 *رجوع*`);
            }
            return;
        }

        if (state === 'DL_WAIT') {
            if (text === 'رجوع') { await goBack(); return; }
            const url = extractUrl(text) || (text.startsWith('http') ? text : null);
            if (!url) return update('❌ الرابط غير صحيح.\n\n🔙 *رجوع*');
            await handleDownload(url, tmp.dlMode === 'audio', m);
            await sleep(1500); await showDlMenu(); state = 'DL_MENU'; return;
        }

        // ══════════════════════════════════════════════════
        // STATS
        // ══════════════════════════════════════════════════
        if (state === 'STATS') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'مسح') { writeStats({ commands:{}, users:{}, total:0 }); _statsCache = null; await update('✅ تم المسح.'); await sleep(800); await showStats(); }
            return;
        }

        // ══════════════════════════════════════════════════
        // PROT
        // ══════════════════════════════════════════════════
        if (state === 'PROT') {
            if (text === 'رجوع') { await goBack(); return; }
            const protMap = {
                'انتي كراش':'antiCrash',
                'انتي حذف':'antiDelete',
                'انتي سب':'antiInsult',
            };
            const key = protMap[text];
            if (key) {
                const p = readProt(); p[key] = p[key]==='on'?'off':'on'; writeProt(p);
                react(sock, m, p[key]==='on'?'✅':'⛔');
                await sleep(800); await showProtMenu();
            }
            return;
        }

        // ══════════════════════════════════════════════════
        // CMDTOOLS
        // ══════════════════════════════════════════════════
        if (state === 'CMDTOOLS') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'تغيير اسم')  { pushState('CMDTOOLS', showCmdTools); await update('✏️ اكتب اسم الامر الحالي:\n\n🔙 *رجوع*'); state = 'RENAME_WAIT'; return; }
            if (text === 'فاحص الكود') { pushState('CMDTOOLS', showCmdTools); await update('🔍 اكتب اسم الامر:\n\n🔙 *رجوع*'); state = 'CODE_CHECK_WAIT'; return; }
            if (text === 'مسح كاش') {
                react(sock, m, '⏳');
                try { if (global._pluginsCache) global._pluginsCache = {}; await loadPlugins().catch(()=>{}); react(sock, m, '✅'); await update('✅ تم المسح.'); }
                catch (e) { react(sock, m, '❌'); await update(`❌ ${e?.message}`); }
                await sleep(800); await showCmdTools(); return;
            }
            return;
        }

        if (state === 'RENAME_WAIT') {
            if (text === 'رجوع') { await goBack(); return; }
            const fp = await findPluginByCmd(text);
            if (!fp) return update(`❌ ما وجدت: ${text}`);
            tmp.targetFile = fp; tmp.targetCmd = text;
            await update(`✅ [ ${text} ] — اكتب الاسم الجديد:\n\n🔙 *رجوع*`);
            pushState('RENAME_WAIT', showCmdTools); state = 'RENAME_NEW'; return;
        }

        if (state === 'RENAME_NEW') {
            if (text === 'رجوع') { await goBack(); return; }
            try { updatePluginField(tmp.targetFile,'command',text.trim()); await loadPlugins().catch(()=>{}); } catch {}
            await update(`✅ ${tmp.targetCmd} ➔ ${text.trim()}`);
            await sleep(1200); await showCmdTools(); state = 'CMDTOOLS'; return;
        }

        if (state === 'CODE_CHECK_WAIT') {
            if (text === 'رجوع') { await goBack(); return; }
            const fp = await findPluginByCmd(text);
            if (!fp) return update(`❌ ما وجدت: ${text}`);
            react(sock, m, '⏳');
            const lintIssues = quickLint(fp);
            const checkRes   = await checkPluginSyntax(fp);
            let report = `✧━── ❝ 𝐂𝐇𝐄𝐂𝐊 ❞ ──━✧\n\n*فحص [ ${text} ]*\n\n`;
            if (checkRes.ok && !lintIssues.length) {
                report += '✅ *الكود سليم*\n';
            } else {
                report += '⚠️ *مشاكل:*\n';
                if (!checkRes.ok) {
                    report += `🔴 Syntax Error\n`;
                    if (checkRes.line)     report += `السطر: ${checkRes.line}\n`;
                    if (checkRes.codeLine) report += `\`${checkRes.codeLine}\`\n`;
                    report += `\`${checkRes.error?.slice(0, 200)}\`\n`;
                }
                lintIssues.forEach(i => { report += `🟡 ${i}\n`; });
            }
            report += '\n🔙 *رجوع*\n\n✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧';
            react(sock, m, checkRes.ok && !lintIssues.length ? '✅' : '❌');
            await update(report);
            state = 'CMDTOOLS'; return;
        }

        // ══════════════════════════════════════════════════
        // ADMIN
        // ══════════════════════════════════════════════════
        if (state === 'ADMIN') {
            if (text === 'رجوع')         { await goBack(); return; }
            if (text === 'الاعضاء')      { pushState('ADMIN', showAdminMenu); await showAdminMembersMenu();  state = 'ADMIN_MEMBERS';   return; }
            if (text === 'الرسائل')      { pushState('ADMIN', showAdminMenu); await showAdminMessagesMenu(); state = 'ADMIN_MESSAGES';  return; }
            if (text === 'المجموعة')     { pushState('ADMIN', showAdminMenu); await showAdminGroupMenu();    state = 'ADMIN_GROUP_SET'; return; }
            if (text === 'المحتوى')      { pushState('ADMIN', showAdminMenu); await showAdminContentMenu();  state = 'ADMIN_CONTENT';   return; }
            if (text === 'قفل المحتوى') { pushState('ADMIN', showAdminMenu); await showAdminLocksMenu();    state = 'ADMIN_LOCKS';     return; }
            if (text === 'الادوات')      { pushState('ADMIN', showAdminMenu); await showAdminToolsMenu();    state = 'ADMIN_TOOLS';     return; }
            return;
        }

        // ADMIN_MEMBERS
        if (state === 'ADMIN_MEMBERS') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'المشرفين') {
                try {
                    const { meta } = await getAdminPerms();
                    const admins = (meta?.participants || []).filter(p => p.admin);
                    if (!admins.length) return update('📭 لا يوجد مشرفين.\n\n🔙 *رجوع*');
                    const list = admins.map((a,i)=>`${i+1}. @${normalizeJid(a.id)} ${a.admin==='superadmin'?'👑':''}`).join('\n');
                    await sock.sendMessage(chatId, { text: `👑 *المشرفون (${admins.length}):*\n\n${list}`, mentions: admins.map(a=>a.id) }, { quoted: m });
                } catch (e) { await update(`❌ ${e?.message}`); }
                return;
            }
            const memberActions = {
                'رفع مشرف':'promote', 'تنزيل مشرف':'demote',
                'طرد':'remove', 'حظر':'ban', 'الغاء حظر':'unban',
                'كتم':'mute', 'الغاء كتم':'unmute',
            };
            if (memberActions[text]) {
                tmp.adminAction = memberActions[text];
                const hint = text === 'كتم' ? '⏱️ كم دقيقة؟ (مثال: 30)\nثم منشن او رد' : '↩️ منشن العضو او رد على رسالته';
                await update(`${hint}\n\n🔙 *رجوع*`);
                pushState('ADMIN_MEMBERS', showAdminMembersMenu); state = 'ADMIN_TARGET'; return;
            }
            return;
        }

        // ADMIN_TARGET
        if (state === 'ADMIN_TARGET') {
            if (text === 'رجوع') { await goBack(); return; }
            const target = await resolveTarget(sock, chatId, m);
            if (!target) return update('❌ منشن العضو او رد على رسالته.');
            const action = tmp.adminAction;
            react(sock, m, '⏳');
            if (action === 'promote') {
                await tryAdminAction(() => sock.groupParticipantsUpdate(chatId, [target], 'promote'), '👑');
            } else if (action === 'demote') {
                await tryAdminAction(() => sock.groupParticipantsUpdate(chatId, [target], 'demote'), '⬇️');
            } else if (action === 'remove') {
                await tryAdminAction(() => sock.groupParticipantsUpdate(chatId, [target], 'remove'), '🚪');
            } else if (action === 'ban') {
                await tryAdminAction(async () => {
                    await sock.groupParticipantsUpdate(chatId, [target], 'remove');
                    const bans = readJSON(grpFile('bans', chatId), []);
                    if (!bans.includes(target)) { bans.push(target); writeJSON(grpFile('bans', chatId), bans); }
                    // حظر على مستوى الحساب أيضاً
                    if (target.endsWith('@s.whatsapp.net')) {
                        try { await sock.updateBlockStatus(target, 'block'); } catch {}
                    }
                }, '🔨');
            } else if (action === 'unban') {
                const bans = readJSON(grpFile('bans', chatId), []);
                writeJSON(grpFile('bans', chatId), bans.filter(b => b !== target));
                // فك الحظر
                if (target.endsWith('@s.whatsapp.net')) {
                    try { await sock.updateBlockStatus(target, 'unblock'); } catch {}
                }
                react(sock, m, '✅');
            } else if (action === 'mute') {
                const mins = parseInt((text.match(/\d+/) || ['30'])[0]);
                await tryAdminAction(async () => {
                    await sock.groupParticipantsUpdate(chatId, [target], 'demote');
                    await sock.sendMessage(chatId, { text: `🔇 تم كتم @${normalizeJid(target)} لمدة ${mins} دقيقة`, mentions: [target] });
                    setTimeout(async () => { try { await sock.groupParticipantsUpdate(chatId, [target], 'promote'); } catch {} }, mins * 60_000);
                }, '🔇');
            } else if (action === 'unmute') {
                await tryAdminAction(() => sock.groupParticipantsUpdate(chatId, [target], 'promote'), '🔊');
            }
            await sleep(600); await showAdminMembersMenu(); state = 'ADMIN_MEMBERS'; return;
        }

        // ADMIN_MESSAGES
        if (state === 'ADMIN_MESSAGES') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'تثبيت' || text === 'الغاء التثبيت') {
                const ctx2 = m.message?.extendedTextMessage?.contextInfo;
                if (!ctx2?.stanzaId) return update('↩️ رد على الرسالة اللي تبيها.');
                react(sock, m, '⏳');
                try {
                    const msgKey = { id: ctx2.stanzaId, participant: ctx2.participant, remoteJid: chatId };
                    if (text === 'تثبيت') {
                        await pinMessage(sock, chatId, msgKey.id, msgKey.participant, true);
                    } else {
                        await pinMessage(sock, chatId, msgKey.id, msgKey.participant, false);
                    }
                    react(sock, m, '📌');
                } catch (e) {
                    react(sock, m, '❌');
                    const em = e?.message || '';
                    await update(`❌ فشل: ${em.includes('admin') || em.includes('403') ? 'البوت يحتاج صلاحيات مشرف.' : em.slice(0, 100)}\n\n🔙 *رجوع*`);
                }
                return;
            }
            if (text === 'مسح') {
                const ctx2 = m.message?.extendedTextMessage?.contextInfo;
                if (!ctx2?.stanzaId) return update('↩️ رد على الرسالة اللي تبيها.');
                react(sock, m, '⏳');
                try {
                    await sock.sendMessage(chatId, { delete: { remoteJid: chatId, fromMe: false, id: ctx2.stanzaId, participant: ctx2.participant } });
                    react(sock, m, '🗑️');
                } catch (e) {
                    react(sock, m, '❌');
                    await update(`❌ فشل: ${(e?.message || '').slice(0, 100)}\n\n🔙 *رجوع*`);
                }
                return;
            }
            return;
        }

        // ADMIN_GROUP_SET
        if (state === 'ADMIN_GROUP_SET') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'وضع اسم')      { pushState('ADMIN_GROUP_SET', showAdminGroupMenu); await update('✏️ ارسل الاسم الجديد:\n\n🔙 *رجوع*'); state = 'ADMIN_SETNAME'; return; }
            if (text === 'وضع وصف')      { pushState('ADMIN_GROUP_SET', showAdminGroupMenu); await update('📝 ارسل الوصف الجديد:\n\n🔙 *رجوع*'); state = 'ADMIN_SETDESC'; return; }
            if (text === 'وضع صورة')     { pushState('ADMIN_GROUP_SET', showAdminGroupMenu); await update('🖼️ ارسل او اقتبس صورة:\n\n🔙 *رجوع*'); state = 'ADMIN_SETIMG'; return; }
            if (text === 'قفل المحادثة') { await tryAdminAction(() => sock.groupSettingUpdate(chatId, 'announcement'), '🔒'); return; }
            if (text === 'فتح المحادثة') { await tryAdminAction(() => sock.groupSettingUpdate(chatId, 'not_announcement'), '🔓'); return; }
            if (text === 'رابط') {
                try { const code = await sock.groupInviteCode(chatId); await update(`🔗 *رابط المجموعة:*\nhttps://chat.whatsapp.com/${code}\n\n🔙 *رجوع*`); }
                catch (e) { await update(`❌ ${e?.message}`); }
                return;
            }
            if (text === 'انضم') { pushState('ADMIN_GROUP_SET', showAdminGroupMenu); await update('🔗 ارسل رابط المجموعة:\n\n🔙 *رجوع*'); state = 'ADMIN_JOIN'; return; }
            if (text === 'خروج') { pushState('ADMIN_GROUP_SET', showAdminGroupMenu); await update('⚠️ تاكيد الخروج؟\nاكتب *نعم* او *رجوع*'); state = 'ADMIN_LEAVE'; return; }
            return;
        }

        if (state === 'ADMIN_SETNAME') {
            if (text === 'رجوع') { await goBack(); return; }
            react(sock, m, '⏳'); await tryAdminAction(() => sock.groupUpdateSubject(chatId, text), '✅');
            await sleep(800); await showAdminGroupMenu(); state = 'ADMIN_GROUP_SET'; return;
        }

        if (state === 'ADMIN_SETDESC') {
            if (text === 'رجوع') { await goBack(); return; }
            react(sock, m, '⏳'); await tryAdminAction(() => sock.groupUpdateDescription(chatId, text), '✅');
            await sleep(800); await showAdminGroupMenu(); state = 'ADMIN_GROUP_SET'; return;
        }

        if (state === 'ADMIN_SETIMG') {
            if (text === 'رجوع') { await goBack(); return; }
            const ctx2   = m.message?.extendedTextMessage?.contextInfo;
            const imgMsg = m.message?.imageMessage || ctx2?.quotedMessage?.imageMessage;
            if (!imgMsg) return update('🖼️ ارسل او اقتبس صورة فقط.\n\n🔙 *رجوع*');
            react(sock, m, '⏳');
            try {
                const target2 = m.message?.imageMessage
                    ? m
                    : { message: ctx2.quotedMessage, key: { ...m.key, id: ctx2.stanzaId, participant: ctx2.participant } };
                const buf = await downloadMediaMessage(target2, 'buffer', {});
                await tryAdminAction(() => sock.updateProfilePicture(chatId, buf), '✅');
            } catch (e) { react(sock, m, '❌'); await update(`❌ ${e?.message}`); }
            await sleep(800); await showAdminGroupMenu(); state = 'ADMIN_GROUP_SET'; return;
        }

        if (state === 'ADMIN_JOIN') {
            if (text === 'رجوع') { await goBack(); return; }
            const match = text.match(/chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/i);
            if (!match) return update('❌ رابط غير صحيح.\n\n🔙 *رجوع*');
            react(sock, m, '⏳');
            try { await sock.groupAcceptInvite(match[1]); react(sock, m, '✅'); await update('✅ تم الانضمام.'); }
            catch (e) { react(sock, m, '❌'); await update(`❌ ${e?.message}`); }
            await sleep(800); await showAdminGroupMenu(); state = 'ADMIN_GROUP_SET'; return;
        }

        if (state === 'ADMIN_LEAVE') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'نعم') { try { await sock.groupLeave(chatId); } catch (e) { await update(`❌ ${e?.message}`); } }
            state = 'ADMIN_GROUP_SET'; return;
        }

        // ADMIN_CONTENT
        if (state === 'ADMIN_CONTENT') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'وضع ترحيب') { pushState('ADMIN_CONTENT', showAdminContentMenu); await update('👋 اكتب رسالة الترحيب:\nاستخدم {name} للاسم و {number} للرقم\n\n🔙 *رجوع*'); state = 'ADMIN_SETWELCOME'; return; }
            if (text === 'ترحيب') {
                const wf = grpFile('welcome', chatId);
                if (!fs.existsSync(wf)) return update('❌ لم يُضبط ترحيب بعد.\n\nاكتب *وضع ترحيب* لضبطه.\n\n🔙 *رجوع*');
                const { text: wt } = readJSON(wf, {});
                await update(`📋 *رسالة الترحيب:*\n\n${wt}\n\nاكتب *حذف* لحذفه\n🔙 *رجوع*`);
                pushState('ADMIN_CONTENT', showAdminContentMenu); state = 'ADMIN_WELCOME_VIEW'; return;
            }
            if (text === 'وضع قوانين') { pushState('ADMIN_CONTENT', showAdminContentMenu); await update('📜 اكتب القوانين:\n\n🔙 *رجوع*'); state = 'ADMIN_SETRULES'; return; }
            if (text === 'قوانين') {
                const rf = grpFile('rules', chatId);
                if (!fs.existsSync(rf)) return update('❌ لم تُضبط قوانين بعد.\n\n🔙 *رجوع*');
                const { text: rt } = readJSON(rf, {});
                await update(`📜 *القوانين:*\n\n${rt}\n\nاكتب *حذف* لحذفها\n🔙 *رجوع*`);
                pushState('ADMIN_CONTENT', showAdminContentMenu); state = 'ADMIN_RULES_VIEW'; return;
            }
            if (text === 'كلمات ممنوعة') { pushState('ADMIN_CONTENT', showAdminContentMenu); await showBadwords(); state = 'ADMIN_BADWORDS'; return; }
            return;
        }

        if (state === 'ADMIN_SETWELCOME') {
            if (text === 'رجوع') { await goBack(); return; }
            writeJSON(grpFile('welcome', chatId), { text });
            react(sock, m, '✅');
            await update(`✅ تم حفظ رسالة الترحيب.\n\n🔙 *رجوع*`);
            await sleep(800); await showAdminContentMenu(); state = 'ADMIN_CONTENT'; return;
        }

        if (state === 'ADMIN_SETRULES') {
            if (text === 'رجوع') { await goBack(); return; }
            writeJSON(grpFile('rules', chatId), { text });
            react(sock, m, '✅');
            await sleep(800); await showAdminContentMenu(); state = 'ADMIN_CONTENT'; return;
        }

        if (state === 'ADMIN_WELCOME_VIEW') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'حذف') { try { fs.removeSync(grpFile('welcome', chatId)); react(sock, m, '🗑️'); } catch {} await sleep(400); await showAdminContentMenu(); state = 'ADMIN_CONTENT'; }
            return;
        }

        if (state === 'ADMIN_RULES_VIEW') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'حذف') { try { fs.removeSync(grpFile('rules', chatId)); react(sock, m, '🗑️'); } catch {} await sleep(400); await showAdminContentMenu(); state = 'ADMIN_CONTENT'; }
            return;
        }

        if (state === 'ADMIN_BADWORDS') {
            if (text === 'رجوع') { await goBack(); return; }
            const bf = grpFile('badwords', chatId); let words = readJSON(bf, []);
            if (text.startsWith('اضافة ')) { const w = text.slice(6).trim(); if (w) { words.push(w.toLowerCase()); writeJSON(bf, words); react(sock, m, '✅'); } await sleep(400); await showBadwords(); return; }
            if (text.startsWith('حذف '))   { writeJSON(bf, words.filter(x => x !== text.slice(4).trim())); react(sock, m, '🗑️'); await sleep(400); await showBadwords(); return; }
            return;
        }

        // ADMIN_LOCKS
        if (state === 'ADMIN_LOCKS') {
            if (text === 'رجوع') { await goBack(); return; }
            const LOCK_MAP = {
                'قفل الروابط': 'antiLink',
                'قفل الصور':   'images',
                'قفل الفيديو': 'videos',
                'قفل البوتات': 'bots',
            };
            if (LOCK_MAP[text]) {
                const p = readProt();
                p[LOCK_MAP[text]] = p[LOCK_MAP[text]] === 'on' ? 'off' : 'on';
                writeProt(p);
                react(sock, m, p[LOCK_MAP[text]] === 'on' ? '🔒' : '🔓');
                await sleep(500); await showAdminLocksMenu(); return;
            }
            return;
        }

        // ADMIN_TOOLS
        if (state === 'ADMIN_TOOLS') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'معلومات') {
                try {
                    const { meta } = await getAdminPerms();
                    if (!meta) return update('❌ تعذر جلب المعلومات.\n\n🔙 *رجوع*');
                    await update(
`📊 *معلومات المجموعة:*

📌 *الاسم:* ${meta.subject}
👥 *الاعضاء:* ${meta.participants.length}
🆔 *الID:* ${chatId.split('@')[0]}
📅 *تاريخ الانشاء:* ${new Date(meta.creation * 1000).toLocaleDateString('ar')}

🔙 *رجوع*`);
                } catch (e) { await update(`❌ ${e?.message}`); }
                return;
            }
            if (text === 'اذاعة') { pushState('ADMIN_TOOLS', showAdminToolsMenu); await update('📢 اكتب رسالة الإذاعة:\n\n🔙 *رجوع*'); state = 'ADMIN_BROADCAST'; return; }
            if (text === 'تحديث') {
                react(sock, m, '⏳');
                try { await loadPlugins(); react(sock, m, '✅'); await update('✅ تم تحديث الاوامر.\n\n🔙 *رجوع*'); }
                catch (e) { react(sock, m, '❌'); await update(`❌ ${e?.message}`); }
                return;
            }
            return;
        }

        if (state === 'ADMIN_BROADCAST') {
            if (text === 'رجوع') { await goBack(); return; }
            react(sock, m, '⏳');
            try {
                const chats = await sock.groupFetchAllParticipating();
                let sent = 0;
                for (const gid of Object.keys(chats)) { try { await sock.sendMessage(gid, { text }); sent++; } catch {} await sleep(500); }
                react(sock, m, '✅'); await update(`✅ الإرسال لـ ${sent} مجموعة.`);
            } catch (e) { await update(`❌ ${e?.message}`); }
            await sleep(1000); await showAdminToolsMenu(); state = 'ADMIN_TOOLS'; return;
        }


        // ══════════════════════════════════════════════════
        // BOT — إدارة حساب البوت
        // ══════════════════════════════════════════════════
        if (state === 'BOT') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'الاسم')      { pushState('BOT', showBotMenu); await update('✏️ اكتب الاسم الجديد للبوت:\n\n🔙 *رجوع*'); state = 'BOT_NAME'; return; }
            if (text === 'الصورة')     { pushState('BOT', showBotMenu); await update('🖼️ ارسل الصورة الجديدة للبوت:\n\n🔙 *رجوع*'); state = 'BOT_PHOTO'; return; }
            if (text === 'الوصف')      { pushState('BOT', showBotMenu); await update('📝 اكتب البايو الجديد للبوت:\n\n🔙 *رجوع*'); state = 'BOT_STATUS'; return; }
            if (text === 'حظر')        { pushState('BOT', showBotMenu); await update('📱 منشن الشخص او اكتب رقمه للحظر:\n\n🔙 *رجوع*'); state = 'BOT_BLOCK'; return; }
            if (text === 'فك الحظر')   { pushState('BOT', showBotMenu); await update('📱 منشن الشخص او اكتب رقمه لفك الحظر:\n\n🔙 *رجوع*'); state = 'BOT_UNBLOCK'; return; }
            if (text === 'المجموعات') {
                pushState('BOT', showBotMenu);
                try {
                    const allGroups = await sock.groupFetchAllParticipating();
                    const groups = Object.values(allGroups);
                    if (!groups.length) return update('📭 البوت ليس في أي مجموعة.\n\n🔙 *رجوع*');
                    groups.sort((a, b) => (b.participants?.length || 0) - (a.participants?.length || 0));
                    const top = groups.slice(0, 10);
                    const lines = top.map((g, i) => `${i+1}. *${g.subject || '—'}*\n   👥 ${g.participants?.length || 0} عضو`).join('\n\n');
                    state = 'BOT_GROUPS';
                    await update(
`✧━── ❝ 𝐆𝐑𝐎𝐔𝐏𝐒 ❞ ──━✧

📊 إجمالي المجموعات: *${groups.length}*
👥 أعلى مجموعة: *${groups[0]?.subject}* (${groups[0]?.participants?.length} عضو)

${lines}

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
                } catch (e) { await update(`❌ ${e?.message}\n\n🔙 *رجوع*`); }
                return;
            }
            return;
        }

        if (state === 'BOT_GROUPS') {
            if (text === 'رجوع') { await goBack(); return; }
            return;
        }

        if (state === 'BOT_NAME') {
            if (text === 'رجوع') { await goBack(); return; }
            try {
                await sock.updateProfileName(text.trim());
                react(sock, m, '✅');
                await update(`✅ تم تغيير اسم البوت الى:\n*${text.trim()}*\n\n🔙 *رجوع*`);
            } catch (e) { await update(`❌ ${e?.message}\n\n🔙 *رجوع*`); }
            await sleep(800); await showBotMenu(); state = 'BOT'; return;
        }

        if (state === 'BOT_STATUS') {
            if (text === 'رجوع') { await goBack(); return; }
            try {
                await sock.updateProfileStatus(text.trim());
                react(sock, m, '✅');
                await update(`✅ تم تغيير وصف البوت.\n\n🔙 *رجوع*`);
            } catch (e) { await update(`❌ ${e?.message}\n\n🔙 *رجوع*`); }
            await sleep(800); await showBotMenu(); state = 'BOT'; return;
        }

        if (state === 'BOT_PHOTO') {
            if (text === 'رجوع') { await goBack(); return; }
            const ctx2   = m.message?.extendedTextMessage?.contextInfo;
            const imgMsg = m.message?.imageMessage || ctx2?.quotedMessage?.imageMessage;
            if (!imgMsg) return update('🖼️ ارسل صورة فقط (لا نص).\n\n🔙 *رجوع*');
            react(sock, m, '⏳');
            try {
                const target2 = m.message?.imageMessage
                    ? m
                    : { message: ctx2.quotedMessage, key: { ...m.key, id: ctx2.stanzaId, participant: ctx2.participant } };
                const buf = await downloadMediaMessage(target2, 'buffer', {});
                const botJid = getBotJid(sock);
                await sock.updateProfilePicture(botJid, buf);
                react(sock, m, '✅');
                await update('✅ تم تغيير صورة البوت.\n\n🔙 *رجوع*');
            } catch (e) { react(sock, m, '❌'); await update(`❌ ${e?.message}\n\n🔙 *رجوع*`); }
            await sleep(800); await showBotMenu(); state = 'BOT'; return;
        }

        if (state === 'BOT_BLOCK') {
            if (text === 'رجوع') { await goBack(); return; }
            const ctxM = m.message?.extendedTextMessage?.contextInfo;
            let target = ctxM?.mentionedJid?.[0] || ctxM?.participant;
            if (!target) {
                const num = text.replace(/\D/g, '');
                if (num.length >= 9) target = num + '@s.whatsapp.net';
            }
            if (!target) return update('❌ منشن الشخص او اكتب رقمه.\n\n🔙 *رجوع*');
            try {
                await sock.updateBlockStatus(target, 'block');
                react(sock, m, '🔒');
                await update(`✅ تم حظر @${normalizeJid(target)}\n\n🔙 *رجوع*`);
            } catch (e) { await update(`❌ ${e?.message}\n\n🔙 *رجوع*`); }
            await sleep(800); await showBotMenu(); state = 'BOT'; return;
        }

        if (state === 'BOT_UNBLOCK') {
            if (text === 'رجوع') { await goBack(); return; }
            const ctxM = m.message?.extendedTextMessage?.contextInfo;
            let target = ctxM?.mentionedJid?.[0] || ctxM?.participant;
            if (!target) {
                const num = text.replace(/\D/g, '');
                if (num.length >= 9) target = num + '@s.whatsapp.net';
            }
            if (!target) return update('❌ منشن الشخص او اكتب رقمه.\n\n🔙 *رجوع*');
            try {
                await sock.updateBlockStatus(target, 'unblock');
                react(sock, m, '🔓');
                await update(`✅ تم فك الحظر عن @${normalizeJid(target)}\n\n🔙 *رجوع*`);
            } catch (e) { await update(`❌ ${e?.message}\n\n🔙 *رجوع*`); }
            await sleep(800); await showBotMenu(); state = 'BOT'; return;
        }

    }; // نهاية listener

    // ══════════════════════════════════════════════════════
    //  ✅ FIX-2: download handler — فيديو >70MB → مستند
    // ══════════════════════════════════════════════════════
    async function handleDownload(url, audioOnly, m) {
        const platform = detectPlatform(url) || 'رابط';
        const icon     = audioOnly ? '🎵' : '🎬';

        // ── حد 3 تنزيلات متزامنة ──
        if (_dlActive >= DL_MAX_CONCURRENT) {
            react(sock, m, '⏳');
            await update(`⏳ *البوت مشغول بـ ${_dlActive} تنزيل*\nانتظر قليلاً وأعد المحاولة.\n\n🔙 *رجوع*`);
            return;
        }

        react(sock, m, '⏳');
        await update(`${icon} *جاري تحميل ${platform}...*\nقد يأخذ بضع ثوانٍ.`);

        // ── Pinterest: scraper مباشر ──
        if (!audioOnly && (url.includes('pinterest.com') || url.includes('pin.it'))) {
            try {
                const imgUrl = await downloadPinterestImage(url);
                if (imgUrl) {
                    const imgBuf = await downloadImageBuffer(imgUrl);
                    await sock.sendMessage(chatId, { image: imgBuf, caption: '📌 Pinterest' }, { quoted: m });
                    react(sock, m, '✅');
                    await update('✅ *تم!*\n\n🔙 *رجوع*');
                    return;
                }
            } catch (e) { console.error('[Pinterest]', e.message); }
            await update('❌ فشل جلب الصورة من Pinterest.\n\n🔙 *رجوع*');
            return;
        }

        _dlActive++;
        try {
            // ── يوتيوب: جرب savetube أولاً (أسرع) ثم yt-dlp ──
            const isYT = url.includes('youtube.com') || url.includes('youtu.be');
            if (isYT) {
                react(sock, m, '⏳');
                const stResult = await savetube.download(url, audioOnly ? 'audio' : 'video').catch(() => null);
                if (stResult?.url) {
                    try {
                        const buf = await downloadImageBuffer(stResult.url); // reuse: downloads any URL to buffer
                        if (audioOnly) {
                            await sock.sendMessage(chatId, {
                                audio: buf, mimetype: 'audio/mpeg', ptt: false,
                                fileName: `${stResult.title || 'audio'}.mp3`,
                            }, { quoted: m });
                        } else {
                            await sock.sendMessage(chatId, {
                                video: buf,
                                caption: `🎬 ${stResult.title || platform}`,
                            }, { quoted: m });
                        }
                        react(sock, m, '✅');
                        await update(`✅ *تم التحميل!*\n\n🔙 *رجوع*`);
                        return;
                    } catch { /* fallthrough to yt-dlp */ }
                }
            }

            // ── yt-dlp للبقية أو كـ fallback ──
            const { filePath, ext, cleanup } = await ytdlpDownload(url, { audio: audioOnly });
            const fileSize = fs.statSync(filePath).size;
            const isVideo  = ['mp4','mkv','webm','mov','avi'].includes(ext);
            const isAudio  = ['mp3','m4a','ogg','aac','opus','wav'].includes(ext);
            const isImage  = ['jpg','jpeg','png','webp','gif'].includes(ext);

            if (fileSize > 150 * 1024 * 1024) {
                cleanup();
                return update('❌ الملف أكبر من 150MB.\n\n🔙 *رجوع*');
            }

            const buffer = fs.readFileSync(filePath); cleanup();

            if (isVideo && fileSize > 70 * 1024 * 1024) {
                await sock.sendMessage(chatId, {
                    document: buffer, mimetype: 'video/mp4',
                    fileName: `${platform}_video.mp4`,
                    caption: `📎 ${platform} — ${(fileSize/1024/1024).toFixed(1)}MB`,
                }, { quoted: m });
            } else if (isVideo) {
                await sock.sendMessage(chatId, { video: buffer, caption: `${icon} ${platform}` }, { quoted: m });
            } else if (isAudio) {
                await sock.sendMessage(chatId, { audio: buffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: m });
            } else if (isImage) {
                await sock.sendMessage(chatId, { image: buffer, caption: `${icon} ${platform}` }, { quoted: m });
            } else {
                await sock.sendMessage(chatId, {
                    document: buffer, mimetype: 'application/octet-stream',
                    fileName: path.basename(filePath), caption: `${icon} ${platform}`,
                }, { quoted: m });
            }
            react(sock, m, '✅');
            await update(`✅ *تم التحميل!*\n\n🔙 *رجوع*`);
        } catch (e) {
            react(sock, m, '❌');
            const errText = e?.message || '';
            let hint = '';
            if (errText.includes('غير مثبت') || errText.includes('yt-dlp'))
                hint = '\n💡 شغّل: `pip install -U yt-dlp`';
            else if (errText.includes('معدل الطلبات') || errText.includes('429'))
                hint = '\n⏳ حاول بعد دقيقتين.';
            else if (errText.includes('خاص') || errText.toLowerCase().includes('private') || errText.includes('login'))
                hint = '\n🔒 المحتوى خاص.';
            else if (errText.includes('Unsupported URL') || errText.includes('not supported'))
                hint = '\n🔗 الرابط غير مدعوم.';
            else if (errText.includes('محذوف') || errText.includes('unavailable'))
                hint = '\n🗑️ المحتوى غير متاح.';
            await update(`❌ *فشل التحميل*\n${errText.slice(0, 120)}${hint}\n\n🔙 *رجوع*`);
        } finally {
            _dlActive--;
        }
    }

    // ══════════════════════════════════════════════════════
    //  قوائم العرض
    // ══════════════════════════════════════════════════════
    async function showEliteMenu() {
        await update(
`✧━── ❝ 𝐍𝐗𝐁𝐀 ❞ ──━✧

✦ *اضافة*
\`➕ إضافة رقم للنخبة\`

✦ *حذف*
\`🗑️ حذف رقم\`

✦ *عرض*
\`📋 عرض القائمة\`

✦ *مسح الكل*
\`🧹 مسح الكل\`

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showPluginsMenu() {
        const count = getAllPluginFiles().length;
        await update(
`✧━── ❝ 𝐏𝐋𝐔𝐆𝐈𝐍𝐒 ❞ ──━✧

📦 الاوامر المحملة: *${count}*

✦ *الاوامر*
\`📋 عرض وبحث الاوامر\`

✦ *التعديل*
\`⚙️ تعديل وضبط الاوامر\`

✦ *الادوات*
\`🔧 تغيير اسم · فاحص · مسح كاش\`

✦ *جديد*
\`➕ إضافة امر جديد\`

🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showPluginsListMenu() {
        await update(
`✧━── ❝ 𝐋𝐈𝐒𝐓 ❞ ──━✧

✦ *عرض الكل*
\`📋 قائمة كل الاوامر\`

✦ *بحث [اسم]*
\`🔍 تفاصيل امر معين\`

✦ *كود [اسم]*
\`💻 تحميل ملف الامر\`

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showPluginsEditMenu() {
        await update(
`✧━── ❝ 𝐄𝐃𝐈𝐓 ❞ ──━✧

✦ *بحث [اسم]*
\`✏️ تعديل امر معين\`

✦ *طفي الكل*
\`🔒 قفل جميع الاوامر\`

✦ *شغل الكل*
\`🔓 فتح جميع الاوامر\`

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showPluginDetail(fp, cmd) {
        const { elite, lock, group, prv } = getPluginInfo(fp);
        await update(
`✧━── ❝ 𝐏𝐋𝐔𝐆𝐈𝐍 ❞ ──━✧

*[ ${cmd} ]*

✦ نخبة:     ${elite==='on'?'✅':'❌'}
✦ قفل:      ${lock==='on'?'✅':'❌'}
✦ مجموعات:  ${group?'✅':'❌'}
✦ خاص:      ${prv?'✅':'❌'}

✦ *نخبة*    — تعيين للنخبة
✦ *عام*     — تعيين للعموم
✦ *قفل*     — تعطيل الامر
✦ *فتح*     — تفعيل الامر
✦ *مجموعات* — تخصيص للمجموعات
✦ *خاص*     — تخصيص للخاص
✦ *للجميع*  — متاح للكل
✦ *تغيير الاسم* — تغيير اسم الامر
✦ *كود*     — تحميل الملف

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showDlMenu() {
        await update(
`✧━── ❝ 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃 ❞ ──━✧

✦ *فيديو*
\`🎬 تنزيل كفيديو MP4\`

✦ *صوت*
\`🎵 تنزيل كصوت MP3\`

✦ *بنترست*
\`📌 بحث وإرسال 10 صور\`

*او ارسل رابط مباشرة*

المصادر:
يوتيوب | انستقرام | تيك توك
فيسبوك | تويتر | ساوند

💡 *يوتيوب:* جودة ≤720p
💡 *فيسبوك:* Reels & Videos
📌 *بنترست:* بحث بالكلمة مباشر

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showStats() {
        const s = readStats();
        const topCmds = Object.entries(s.commands||{})
            .sort((a,b) => b[1]-a[1]).slice(0,5)
            .map(([k,v],i) => `${i+1}. ${k}: *${v}*`).join('\n') || 'لا يوجد';

        // ── تحويل LID إلى phone JID قبل العرض ──
        const userEntries = Object.entries(s.users||{}).sort((a,b) => b[1]-a[1]).slice(0,5);
        const resolvedUsers = [];
        for (const [raw, count] of userEntries) {
            let phoneJid = raw;
            // لو مش phone JID (يعني LID أو مجهول) — حاول تحوّله
            if (!raw.endsWith('@s.whatsapp.net')) {
                try {
                    // نبحث في آخر meta مخزّن
                    const num = raw.split('@')[0].split(':')[0];
                    phoneJid  = num + '@s.whatsapp.net';
                } catch { phoneJid = raw; }
            }
            resolvedUsers.push({ jid: phoneJid, count });
        }

        const topUsers = resolvedUsers
            .map((u, i) => `${i+1}. @${normalizeJid(u.jid)}: *${u.count}*`)
            .join('\n') || 'لا يوجد';
        const mentions = resolvedUsers
            .map(u => u.jid)
            .filter(j => j.endsWith('@s.whatsapp.net'));

        const up = process.uptime();
        const h = Math.floor(up/3600), mm = Math.floor((up%3600)/60), ss = Math.floor(up%60);
        await update({
            text:
`✧━── ❝ 𝐒𝐓𝐀𝐓𝐒 ❞ ──━✧

📨 الاوامر: *${s.total||0}*
⏱️ التشغيل: *${h}h ${mm}m ${ss}s*

🏆 *اكثر الاوامر:*
${topCmds}

👤 *اكثر المستخدمين:*
${topUsers}

✦ *مسح* — تصفير الإحصاءات
🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`,
            mentions,
        });
    }

    async function showProtMenu() {
        const p = readProt(), s = k => p[k]==='on'?'✅':'⛔';
        await update(
`✧━── ❝ 𝐏𝐑𝐎𝐓𝐄𝐂𝐓𝐈𝐎𝐍 ❞ ──━✧

✦ *انتي كراش* ${s('antiCrash')}
\`💥 حماية من رسائل التجميد\`

✦ *انتي حذف* ${s('antiDelete')}
\`🗑️ إظهار الرسائل المحذوفة\`

✦ *انتي سب* ${s('antiInsult')}
\`🤬 حذف الكلمات البذيئة\`

اكتب اسم الميزة لتشغيلها او إيقافها
🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    
    async function showCmdTools() {
        await update(
`✧━── ❝ 𝐓𝐎𝐎𝐋𝐒 ❞ ──━✧

✦ *تغيير اسم*
\`✏️ تغيير اسم امر موجود\`

✦ *فاحص الكود*
\`🔍 فحص syntax البلاجن\`

✦ *مسح كاش*
\`🗑️ مسح الكاش وإعادة التحميل\`

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showAdminMenu() {
        await update(
`✧━── ❝ 𝐀𝐃𝐌𝐈𝐍 ❞ ──━✧

✦ *الاعضاء*
\`👥 رفع وطرد وحظر وكتم\`

✦ *الرسائل*
\`📌 تثبيت ومسح الرسائل\`

✦ *المجموعة*
\`⚙️ اسم ووصف وصورة وإعدادات\`

✦ *المحتوى*
\`👋 ترحيب وقوانين وكلمات ممنوعة\`

✦ *قفل المحتوى*
\`🔒 منع انواع معينة من المحتوى\`

✦ *الادوات*
\`🤖 اذاعة ومعلومات وتحديث\`

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showAdminMembersMenu() {
        await update(
`✧━── ❝ 𝐌𝐄𝐌𝐁𝐄𝐑𝐒 ❞ ──━✧

✦ *رفع مشرف*    ✦ *تنزيل مشرف*
✦ *المشرفين*     ✦ *طرد*
✦ *حظر*          ✦ *الغاء حظر*
✦ *كتم*          ✦ *الغاء كتم*

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showAdminMessagesMenu() {
        await update(
`✧━── ❝ 𝐌𝐄𝐒𝐒𝐀𝐆𝐄𝐒 ❞ ──━✧

✦ *تثبيت*         \`📌 رد على الرسالة\`
✦ *الغاء التثبيت* \`📌 رد على الرسالة\`
✦ *مسح*           \`🗑️ رد على الرسالة\`

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showAdminGroupMenu() {
        await update(
`✧━── ❝ 𝐆𝐑𝐎𝐔𝐏 ❞ ──━✧

✦ *وضع اسم*      ✦ *وضع وصف*
✦ *وضع صورة*      ✦ *قفل المحادثة*
✦ *فتح المحادثة*  ✦ *رابط*
✦ *انضم*          ✦ *خروج*

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showAdminContentMenu() {
        await update(
`✧━── ❝ 𝐂𝐎𝐍𝐓𝐄𝐍𝐓 ❞ ──━✧

✦ *وضع ترحيب*   ✦ *ترحيب*
✦ *وضع قوانين*  ✦ *قوانين*
✦ *كلمات ممنوعة*

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showAdminLocksMenu() {
        const p = readProt(), s = k => p[k]==='on'?'🔒':'🔓';
        await update(
`✧━── ❝ 𝐋𝐎𝐂𝐊𝐒 ❞ ──━✧

✦ *قفل الروابط* ${s('antiLink')}
✦ *قفل الصور*   ${s('images')}
✦ *قفل الفيديو* ${s('videos')}
✦ *قفل البوتات* ${s('bots')}

اكتب اسم القفل لتشغيله او إيقافه
🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showAdminToolsMenu() {
        await update(
`✧━── ❝ 𝐓𝐎𝐎𝐋𝐒 ❞ ──━✧

✦ *معلومات*   \`ℹ️ معلومات المجموعة\`
✦ *اذاعة*     \`📢 إرسال لكل المجموعات\`
✦ *تحديث*     \`🔄 إعادة تحميل الاوامر\`

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showBadwords() {
        const bf = grpFile('badwords', chatId);
        const words = readJSON(bf, []);
        const list  = words.length ? words.map((w,i)=>`${i+1}. ${w}`).join('\n') : 'لا يوجد كلمات';
        await update(
`✧━── ❝ 𝐁𝐀𝐃𝐖𝐎𝐑𝐃𝐒 ❞ ──━✧

*الكلمات الممنوعة 🚫:*
${list}

✦ *اضافة [كلمة]*
✦ *حذف [كلمة]*

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }


    async function showBotMenu() {
        const botJid = getBotJid(sock);
        let name = sock.user?.name || '—';
        await update(
`✧━── ❝ 𝐁𝐎𝐓 ❞ ──━✧

🤖 *${name}*

✦ *الاسم*
\`✏️ تغيير اسم البوت\`

✦ *الصورة*
\`🖼️ تغيير صورة البوت\`

✦ *الوصف*
\`📝 تغيير بايو البوت\`

✦ *حظر*
\`🔒 حظر شخص (block)\`

✦ *فك الحظر*
\`🔓 فك الحظر عن شخص\`

✦ *المجموعات*
\`📊 عرض المجموعات واحصاءاتها\`

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    // تسجيل الجلسة
    sock.ev.on('messages.upsert', listener);
    // let بدل const حتى يُعاد ضبطه عند كل تفاعل
    let timeout = setTimeout(cleanup, 300_000);
    activeSessions.set(chatId, { listener, timeout, cleanupFn: cleanup, lastActivity: Date.now() });
}

export default { NovaUltra, execute };

