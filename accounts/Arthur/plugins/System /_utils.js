// ══════════════════════════════════════════════════════════════
//  نظام.js — النسخة المصححة النهائية
//  نخبة | بلاجنز | تنزيلات | إحصاءات | حماية | اوامر | إدارة
//  + slash handler /امر مباشر
//
//  الإصلاحات:
//  ☑️ antiPrivate  — حظر صحيح بـ JID مُنظَّف + cooldown محكم
//  ☑️ فيديو >70MB  — يُبعَث مستنداً بدل رفضه
//  ☑️ antiLink     — يرصد الروابط في النصوص والكابشنات كلها
//  ☑️ antiDelete   — يعرض النوع + المحتوى + منشن من حذف
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
import configObj from '../../nova/config.js';
// ── global.api fallback من config.js لو لم يُعرَّف مسبقاً ──
if (!global.api && configObj?.api) global.api = configObj.api;
let yts; try { yts = (await import('yt-search')).default; } catch { yts = null; }
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
const DATA_DIR          = path.join(BOT_DIR, 'nova', 'data');
const PLUGINS_DIR       = path.join(BOT_DIR, 'plugins');
const PROT_FILE         = path.join(DATA_DIR, 'protection.json');
const STATS_FILE        = path.join(DATA_DIR, 'sys_stats.json');
const PLUGINS_CFG_FILE  = path.join(DATA_DIR, 'plugins_config.json');
const BAN_FILE          = path.join(DATA_DIR, 'banned_users.json');

// ── Ban cache + helpers ──────────────────────────────
let _banCache = null;

function readBanned() {
    if (!_banCache) {
        // أول قراءة sync (عند startup فقط، خارج event loop)
        try { _banCache = JSON.parse(fs.readFileSync(BAN_FILE, 'utf8')); }
        catch { _banCache = []; }
    }
    return _banCache; // بعد ذلك: in-memory cache فقط
}

// تحديث async للـ cache من disk (تُستدعى عند الحاجة)
async function reloadBanCache() {
    try {
        const raw = await fs.promises.readFile(BAN_FILE, 'utf8');
        _banCache = JSON.parse(raw);
    } catch { _banCache = _banCache || []; }
}

function isBanned(jid) {
    const num = normalizeJid(jid);
    return readBanned().some(b => normalizeJid(b) === num);
}

function addBan(jid) {
    const list = readBanned();
    const num  = normalizeJid(jid);
    if (!list.some(b => normalizeJid(b) === num)) {
        list.push(jid);
        _banCache = list;
        try { fs.writeFileSync(BAN_FILE, JSON.stringify(list, null, 2), 'utf8'); } catch (e) { if (e?.message) console.error('[catch]', e.message); }
    }
}

function removeBan(jid) {
    const num  = normalizeJid(jid);
    _banCache  = readBanned().filter(b => normalizeJid(b) !== num);
    try { fs.writeFileSync(BAN_FILE, JSON.stringify(_banCache, null, 2), 'utf8'); } catch (e) { if (e?.message) console.error('[catch]', e.message); }
}

fs.ensureDirSync(DATA_DIR);

// ══════════════════════════════════════════════════════════════
//  إصلاح 4: مسح مجلدات dl_ المؤقتة عند بدء التشغيل
//  يضمن عدم تراكم الملفات لو أُغلق البوت أثناء التحميل
// ══════════════════════════════════════════════════════════════
(async () => {
    try {
        const tmpDir = os.tmpdir();
        const entries = await fs.promises.readdir(tmpDir);
        await Promise.all(
            entries
                .filter(e => e.startsWith('dl_'))
                .map(e => fs.remove(path.join(tmpDir, e)).catch(() => {}))
        );
    } catch (e) { if (e?.message) console.error('[catch]', e.message); }
})();

// ══════════════════════════════════════════════════════════════
//  helpers
// ══════════════════════════════════════════════════════════════
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── pinMessage — مبني على grupo-pin.js (الطريقة الشغالة فعلاً) ──
async function pinMessage(sock, chatId, stanzaId, participant, pin = true) {
    const msgKey = {
        remoteJid:   chatId,
        fromMe:      false,
        id:          stanzaId,
        participant: participant,
    };
    const errors = [];

    // طريقة 1 (grupo-pin.js): sendMessage مع { pin: key, type, time }
    // هذه الطريقة الشغالة في الإصدارات الحديثة من Baileys
    try {
        await sock.sendMessage(chatId, {
            pin:  msgKey,
            type: pin ? 1 : 2,
            time: pin ? 604800 : 86400,
        });
        return;
    } catch (e) { errors.push('sendMessage/pin: ' + e.message); }

    // طريقة 2: { pin: { key, type, time } } (هيكل بديل)
    try {
        await sock.sendMessage(chatId, {
            pin: { key: msgKey, type: pin ? 1 : 2, time: pin ? 604800 : 86400 },
        });
        return;
    } catch (e) { errors.push('sendMessage/pinObj: ' + e.message); }

    // طريقة 3: groupMessagePin الكلاسيكية كـ fallback أخير
    if (typeof sock.groupMessagePin === 'function') {
        try {
            await sock.groupMessagePin(chatId, msgKey, pin ? 1 : 2, pin ? 604800 : undefined);
            return;
        } catch (e) { errors.push('groupMessagePin: ' + e.message); }
    }

    throw new Error(errors.join(' | ') || 'فشل التثبيت');
}


const react = (sock, msg, e) =>
    sock.sendMessage(msg.key.remoteJid, { react: { text: e, key: msg.key } }).catch(() => {});

// ── تفاعلات موحّدة: 🕒 انتظار | ☑️ نجاح | ✖️ فشل ──
const reactWait    = (sock, msg) => react(sock, msg, '🕒');
const reactOk      = (sock, msg) => react(sock, msg, '☑️');
const reactFail    = (sock, msg) => react(sock, msg, '✖️');

const INPUT_REACT_MAP = {
    'رجوع':         '🔙', 'نعم':          '☑️', 'لا':           '❌',
    'نخبة':         '👑', 'بلاجنز':       '🧩', 'تنزيلات':      '⬇️',
    'إحصاءات':      '📊', 'احصاءات':      '📊', 'حماية':        '🛡️',
    'اوامر':        '🔧', 'إدارة':        '🛠️', 'اضافة':        '➕',
    'حذف':          '🗑️', 'عرض':          '👀', 'مسح الكل':     '🧹',
    'مسح':          '🗑️', 'تثبيت':        '📌', 'الغاء تثبيت':  '📌',
    'قفل':          '🔒', 'فتح':          '🔓', 'رفع مشرف':     '⬆️',
    'تنزيل مشرف':   '⬇️', 'طرد':          '🚪', 'حظر':          '🔨',
    'كتم':          '🔇', 'الغاء كتم':    '🔊', 'الغاء حظر':    '☑️',
    'رابط':         '🔗', 'تحديث':        '🔄', 'فيديو':        '🎬',
    'صوت':          '🎵', 'معلومات':      'ℹ️', 'اذاعة':        '📢',
    'انضم':         '☑️', 'خروج':         '🚪', 'ضبط':          '⚙️',
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
//  checkElite — دالة مشتركة للتحقق من النخبة (phone + LID + file)
//  تُستخدم في slashCommandHandler و listener و كل مكان يحتاج فحص
// ══════════════════════════════════════════════════════════════
const _eliteProPath = path.join(BOT_DIR, '../../handlers/elite-pro.json');

async function checkElite(sock, msg) {
    // fromMe دائماً نخبة
    if (msg.key.fromMe) return true;

    // فحص الأونر
    const ownerNum = (configObj?.owner || '213540419314').toString().replace(/\D/g, '');
    const rawId    = msg.key.participant || msg.key.remoteJid || '';
    if (ownerNum && normalizeJid(rawId) === ownerNum) return true;

    // phone JID من participantAlt (الأدق في واتساب الجديد)
    const phoneCand = msg.key.participantAlt?.endsWith('@s.whatsapp.net')
        ? msg.key.participantAlt : null;
    const lidCand = rawId.endsWith('@lid') ? rawId : null;

    // 1. sock.isElite بـ phone
    if (phoneCand) {
        try { if (await sock.isElite?.({ sock, id: phoneCand })) return true; } catch {}
    }
    // 2. sock.isElite بـ LID
    if (lidCand) {
        try { if (await sock.isElite?.({ sock, id: lidCand })) return true; } catch {}
    }
    // 3. sock.isElite بـ rawId كما هو
    if (rawId && rawId !== phoneCand && rawId !== lidCand) {
        try { if (await sock.isElite?.({ sock, id: rawId })) return true; } catch {}
    }
    // 4. قراءة elite-pro.json مباشرة (أوثق fallback)
    try {
        const ep     = readJSONSync(_eliteProPath, {});
        const jids   = ep.jids  || [];
        const lids   = ep.lids  || [];
        const twice  = ep.twice || {};
        const pNum   = normalizeJid(phoneCand || rawId);
        const lNum   = normalizeJid(lidCand   || rawId);

        if (pNum && jids.some(j => normalizeJid(j) === pNum)) return true;
        if (lNum && lids.some(l => normalizeJid(l) === lNum)) return true;

        // twice map: LID ↔ phone
        const via = twice[lidCand] || twice[phoneCand] || twice[rawId];
        if (via) {
            const vNum = normalizeJid(via);
            if (jids.some(j => normalizeJid(j) === vNum)) return true;
            if (lids.some(l => normalizeJid(l) === vNum)) return true;
        }
    } catch {}

    return false;
}

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
    } catch (e) { if (e?.message) console.error('[catch]', e.message); }
    return normalizeJid(raw) + '@s.whatsapp.net';
}

// ══════════════════════════════════════════════════════════════
//  file utils
// ══════════════════════════════════════════════════════════════
// ── I/O helpers — async لتجنب إيقاف الـ Event Loop ──
const readJSON  = async (f, def = {}) => {
    try { return JSON.parse(await fs.promises.readFile(f, 'utf8')); }
    catch { return def; }
};
const writeJSON = async (f, d) => {
    try { await fs.promises.writeFile(f, JSON.stringify(d, null, 2), 'utf8'); }
    catch {}
};
// sync فقط حيث يُستدعى خارج async context (مثل setInterval init)
const readJSONSync  = (f, def = {}) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
const writeJSONSync = (f, d)        => { try { fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf8'); } catch (e) { if (e?.message) console.error('[catch]', e.message); } };


// ── protection cache — sync للقراءة الأولى فقط (in-memory بعدها) ──
let _protCache = null;
const readProt = () => {
    if (!_protCache) _protCache = readJSONSync(PROT_FILE, {
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
// ← كتابة async لتجنب إيقاف Event Loop
const writeProt = async d => { _protCache = d; await writeJSON(PROT_FILE, d); };

// ── stats cache — كتابة للـ disk كل 60 ثانية فقط ──
let _statsCache   = null;
let _statsDirty   = false;
const readStats  = () => {
    if (!_statsCache) _statsCache = readJSONSync(STATS_FILE, { commands:{}, users:{}, total:0 });
    return _statsCache;
};
const writeStats = d => { _statsCache = d; _statsDirty = true; };
// flush async كل دقيقة من setInterval
const flushStats = () => {
    if (_statsDirty && _statsCache) { writeJSON(STATS_FILE, _statsCache); _statsDirty = false; }
};


const grpFile = (prefix, chatId) =>
    path.join(DATA_DIR, prefix + '_' + chatId.replace(/[^\w]/g, '_') + '.json');

// ── cache لـ getPluginInfo — بدل قراءة disk عند كل رسالة ──
const _pluginInfoCache = new Map(); // key: filePath, value: { mtime, info }

// ══════════════════════════════════════════════════════════════
//  إصلاح 1: plugins_config.json — فصل الإعدادات عن الكود
//  البنية: { "cmdName": { elite, lock, group, prv } }
//  البوت يقرأ الإعدادات من الملف ويطبقها، لا يعدّل الكود المصدري
// ══════════════════════════════════════════════════════════════
let _pluginsCfg = null;

function loadPluginsCfg() {
    if (!_pluginsCfg) _pluginsCfg = readJSONSync(PLUGINS_CFG_FILE, {});
    return _pluginsCfg;
}

function savePluginsCfg() {
    writeJSON(PLUGINS_CFG_FILE, _pluginsCfg || {});
}

// ── atomic file write: كتابة آمنة عبر tmp + rename ──
async function atomicWrite(filePath, data) {
    const tmp = filePath + '.tmp_' + Date.now();
    try {
        await fs.promises.writeFile(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 2), 'utf8');
        await fs.move(tmp, filePath, { overwrite: true }); // fs-extra: atomic
    } catch (e) {
        try { await fs.promises.unlink(tmp).catch(() => {}); } catch (_e) {}
        throw e;
    }
}

// قراءة إعداد مُدمج: الـ config file يُقدَّم على قيمة الكود
function getPluginCfgField(cmd, key, codeDefault) {
    const cfg = loadPluginsCfg();
    const entry = cfg[cmd];
    if (!entry || !(key in entry)) return codeDefault;
    return entry[key];
}

// حفظ إعداد في plugins_config.json بدل تعديل الكود
function setPluginCfgField(cmd, key, value) {
    const cfg = loadPluginsCfg();
    if (!cfg[cmd]) cfg[cmd] = {};
    cfg[cmd][key] = value;
    savePluginsCfg();
}


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
function getDeepMtime(dir) {
    // يحسب أحدث mtime لكل subfolders — يكتشف ملفات جديدة داخلها
    let latest = 0;
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
            try {
                const full = path.join(dir, e.name);
                const mt   = fs.statSync(full).mtimeMs;
                if (mt > latest) latest = mt;
                if (e.isDirectory()) {
                    const sub = getDeepMtime(full);
                    if (sub > latest) latest = sub;
                }
            } catch (e) { if (e?.message) console.error('[catch]', e.message); }
        }
    } catch (e) { if (e?.message) console.error('[catch]', e.message); }
    return latest;
}

function getAllPluginFilesCached() {
    try {
        const dirMtime = getDeepMtime(PLUGINS_DIR);
        if (_fileListCache && dirMtime === _fileListMtime) return _fileListCache;
        _fileListCache = getAllPluginFiles();
        _fileListMtime = dirMtime;
        return _fileListCache;
    } catch (e) { if (e?.message) console.error('[catch]', e.message); return getAllPluginFiles(); }
}
// أبطل الكاش بعد أي loadPlugins
const _origLoadPlugins = loadPlugins;
global._invalidatePluginCache = () => { _fileListCache = null; _pluginInfoCache.clear(); };


// ── safeParsePluginField: استخراج قيم آمن بدون eval/new Function ──
function safeParsePluginField(source, key, fallback) {
    const r1 = new RegExp(key + String.raw`\s*:\s*["\`'](on|off|true|false)["\`']`, 'i');
    const r2 = new RegExp(key + String.raw`\s*:\s*(true|false)`, 'i');
    const m1 = source.match(r1);
    if (m1?.[1]) return m1[1];
    const m2 = source.match(r2);
    if (m2?.[1]) return m2[1];
    return fallback;
}

async function getPluginInfo(filePath) {
    try {
        const mtime = fs.statSync(filePath).mtimeMs;
        const cached = _pluginInfoCache.get(filePath);
        if (cached && cached.mtime === mtime) return cached.info;
        const code = await fs.promises.readFile(filePath, 'utf8');
        // ── guard: لا نسمح بكود يحتوي eval/new Function ──
        if (/\bnew\s+Function\b|\beval\s*\(/.test(code)) {
            console.warn('[getPluginInfo] ملف محظور (eval/new Function):', filePath);
            return { cmd: path.basename(filePath, '.js'), elite:'off', lock:'on', group:false, prv:false, filePath };
        }
        let cmd;
        const arr = code.match(/command:\s*\[([^\]]+)\]/);
        if (arr) {
            const cmds = arr[1].match(/[`'"]([^`'"]+)[`'"]/g);
            cmd = cmds ? cmds[0].replace(/[`'"]/g, '') : path.basename(filePath, '.js');
        } else {
            cmd = code.match(/command:\s*[`'"]([^`'"]+)[`'"]/)?.[1] || path.basename(filePath, '.js');
        }
        // قيم الكود الأصلية
        const codeElite = code.match(/elite:\s*[`'"](on|off)[`'"]/i)?.[1]  || 'off';
        const codeLock  = code.match(/lock:\s*[`'"](on|off)[`'"]/i)?.[1]   || 'off';
        const codeGroup = (code.match(/group:\s*(true|false)/i)?.[1]        || 'false') === 'true';
        const codePrv   = (code.match(/prv:\s*(true|false)/i)?.[1]          || 'false') === 'true';
        // ← plugins_config.json تُقدَّم على قيم الكود
        const info = {
            cmd,
            elite:    getPluginCfgField(cmd, 'elite', codeElite),
            lock:     getPluginCfgField(cmd, 'lock',  codeLock),
            group:    getPluginCfgField(cmd, 'group', codeGroup),
            prv:      getPluginCfgField(cmd, 'prv',   codePrv),
            filePath,
        };
        _pluginInfoCache.set(filePath, { mtime, info });
        return info;
    } catch {
        return { cmd: path.basename(filePath, '.js'), elite:'off', lock:'off', group:false, prv:false, filePath };
    }
}

async function updatePluginField(filePath, key, value) {
    // جميع الإعدادات تُحفظ في plugins_config.json — الكود المصدري لا يُمسّ أبداً
    const cfg = loadPluginsCfg();
    const rel = path.relative(PLUGINS_DIR, filePath).replace(/\\/g, '/');
    if (!cfg[rel]) cfg[rel] = {};
    cfg[rel][key === 'command' ? 'alias' : key] = value;
    savePluginsCfg();
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
            const code = await fs.promises.readFile(f, 'utf8');
            if (new RegExp(`command:\\s*['"\`]${cmdName}['"\`]`, 'i').test(code) ||
                new RegExp(`command:\\s*\\[[^\\]]*['"\`]${cmdName}['"\`]`, 'i').test(code)) {
                _cmdSearchCache.set(cmdName, f);
                return f;
            }
        } catch (e) { if (e?.message) console.error('[catch]', e.message); }
    }
    return null;
}

async function quickLint(filePath) {
    const code    = await fs.promises.readFile(filePath, 'utf8');
    const issues  = [];
    const opens   = (code.match(/\{/g) || []).length;
    const closes  = (code.match(/\}/g) || []).length;
    if (opens !== closes) issues.push(`اقواس {} غير متوازنة — مفتوحة:${opens} مغلقة:${closes}`);
    if (!/export default/.test(code)) issues.push('لا يوجد export default');
    if (!/command\s*:/.test(code))    issues.push('لا يوجد حقل command');
    return issues;
}

async function checkPluginSyntax(filePath) {
    // ── Command Injection guard ──────────────────────
    // path.resolve يُطبّع المسار ويمنع traversal
    const safe = path.resolve(filePath);
    // يجب أن يكون داخل PLUGINS_DIR
    if (!safe.startsWith(path.resolve(PLUGINS_DIR))) {
        return { ok: false, error: 'مسار خارج مجلد البلاجنز.', line: null, codeLine: '' };
    }
    // لا رموز خطرة في اسم الملف
    const base = path.basename(safe);
    if (/[;&|`$<>'"\s]/.test(base)) {
        return { ok: false, error: 'اسم ملف غير آمن.', line: null, codeLine: '' };
    }
    const tmpCheck = path.join(os.tmpdir(), `_check_${Date.now()}.mjs`);
    try {
        await fs.promises.copyFile(safe, tmpCheck);
        // spawn بدل exec — لا shell — آمن من injection
        await new Promise((res, rej) => {
            const proc = spawn(
                process.execPath,
                ['--input-type=module', '--check', tmpCheck],
                { stdio: ['ignore','ignore','pipe'] }
            );
            let stderr = '';
            proc.stderr?.on('data', d => { stderr += d; });
            proc.on('close', code => code === 0 ? res() : rej(new Error(stderr)));
            proc.on('error', rej);
        });
        await fs.promises.unlink(tmpCheck).catch(() => {});
        return { ok: true };
    } catch (e) {
        await fs.promises.unlink(tmpCheck).catch(() => {});
        const errMsg = (e.stderr || e.message || '').trim();
        const lineMatch = errMsg.match(/:(\d+)$/m);
        const line = lineMatch ? parseInt(lineMatch[1]) : null;
        let codeLine = '';
        if (line) {
            try {
                const src = await fs.promises.readFile(filePath, 'utf8');
                codeLine = src.split('\n')[line-1]?.trim() || '';
            } catch (e) { if (e?.message) console.error('[catch]', e.message); }
        }
        return { ok: false, error: errMsg, line, codeLine };
    }
}

// ══════════════════════════════════════════════════════════════
//  ☑️ FIX-4: messageCache مُحسَّن — يحفظ النوع + المحتوى لكل رسالة
// ══════════════════════════════════════════════════════════════
const messageCache = new Map();
const _deleteKey   = Symbol('deleteRegistered');
const _welcomeKey  = Symbol('welcomeRegistered');
const _banKey      = Symbol('banRegistered');

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
    } catch (e) { if (e?.message) console.error('[catch]', e.message); }
}

function registerDeleteListener(sock) {
    const ev = sock.ev;
    if (!ev || ev[_deleteKey]) return;
    ev[_deleteKey] = true;
    try { ev.setMaxListeners(Math.max(ev.getMaxListeners(), 30)); } catch (e) { if (e?.message) console.error('[catch]', e.message); }
    ev.on('messages.delete', ({ keys }) => antiDeleteHandler(sock, keys));
}

// ── cache صور القروب: طلب واحد فقط لكل قروب كل ساعة ──
const _grpPhotoCache = new Map(); // { groupId → { buf, ts } }

async function _getGroupPhoto(sock, groupId) {
    const cached = _grpPhotoCache.get(groupId);
    if (cached && Date.now() - cached.ts < 3_600_000) return cached.buf;
    try {
        const ppUrl = await sock.profilePictureUrl(groupId, 'image');
        if (!ppUrl) { _grpPhotoCache.set(groupId, { buf: null, ts: Date.now() }); return null; }
        const r   = await fetch(ppUrl, { signal: AbortSignal.timeout(8_000) });
        const buf = Buffer.from(await r.arrayBuffer());
        _grpPhotoCache.set(groupId, { buf, ts: Date.now() });
        return buf;
    } catch (e) {
        console.error('[groupPhoto] فشل جلب الصورة:', e.message);
        _grpPhotoCache.set(groupId, { buf: null, ts: Date.now() });
        return null;
    }
}

function registerWelcomeListener(sock) {
    const ev = sock.ev;
    if (!ev || ev[_welcomeKey]) return;
    ev[_welcomeKey] = true;
    try { ev.setMaxListeners(Math.max(ev.getMaxListeners(), 30)); } catch (e) { if (e?.message) console.error('[catch]', e.message); }
    ev.on('group-participants.update', async ({ id, participants, action }) => {
        if (action !== 'add') return;
        try {
            const wf = grpFile('welcome', id);
            if (!fs.existsSync(wf)) return;
            const { text: wt } = readJSON(wf, {});
            if (!wt) return;

            // جلب صورة القروب مرة واحدة مهما كان عدد الجدد
            const groupPhoto = await _getGroupPhoto(sock, id);

            for (const jid of participants) {
                const num     = normalizeJid(jid);
                const caption = wt
                    .replace(/\{name\}/g,   `@${num}`)
                    .replace(/\{number\}/g, num);
                try {
                    if (groupPhoto) {
                        await sock.sendMessage(id, { image: groupPhoto, caption, mentions: [jid] });
                    } else {
                        await sock.sendMessage(id, { text: caption, mentions: [jid] });
                    }
                } catch (e) {
                    console.error('[welcome] فشل إرسال ترحيب:', e.message);
                    await sock.sendMessage(id, { text: caption, mentions: [jid] }).catch(() => {});
                }
                await sleep(800);
            }
        } catch (e) { console.error('[welcomeListener]', e.message); }
    });
}


// ══════════════════════════════════════════════════════════════
//  registerBanListener — طرد تلقائي عند محاولة إعادة الانضمام
// ══════════════════════════════════════════════════════════════
function registerBanListener(sock) {
    const ev = sock.ev;
    if (!ev || ev[_banKey]) return;
    ev[_banKey] = true;
    try { ev.setMaxListeners(Math.max(ev.getMaxListeners(), 30)); } catch (e) { if (e?.message) console.error('[catch]', e.message); }
    ev.on('group-participants.update', async ({ id, participants, action }) => {
        if (action !== 'add') return;
        try {
            const bans = readJSON(grpFile('bans', id), []);
            if (!bans.length) return;
            for (const jid of participants) {
                const num = normalizeJid(jid);
                const isBanned = bans.some(b => normalizeJid(b) === num);
                if (!isBanned) continue;
                // طرد تلقائي
                try {
                    await sock.groupParticipantsUpdate(id, [jid], 'remove');
                    await sock.sendMessage(id, {
                        text: `⛔ @${num} محظور من هذه المجموعة`,
                        mentions: [jid],
                    });
                } catch (e) { console.error('[banListener] فشل الطرد التلقائي:', e.message); }
            }
        } catch (e) { console.error('[banListener]', e.message); }
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

// ── تطبيع النص العربي قبل فحص الشتائم ───────────────
// يزيل: تشكيل + تطويل (ـ) + مسافات زائدة
function normalizeArabicText(text) {
    if (!text) return '';
    return text
        .replace(/[ً-ٰٟٱ]/g, '') // تشكيل
        .replace(/ـ/g, '')                           // تطويل
        .replace(/\s+/g, '')                         // مسافات
        .replace(/أ|إ|آ/g, 'ا')                     // همزات
        .replace(/ة/g, 'ه')                         // تاء مربوطة
        .replace(/ى/g, 'ي')                         // ألف مقصورة
        .toLowerCase();
}

function containsInsult(text) {
    const normalized = normalizeArabicText(text || '');
    return INSULT_WORDS.some(w => normalized.includes(normalizeArabicText(w)));
}

// ☑️ FIX-3: regex للروابط شامل يغطي جميع أشكالها
// ── _LINK_RE: https/www + روابط wa.me / t.me / chat.whatsapp.com ──
// يكتشف: http/https روابط + روابط wa.me + نطاقات شائعة
// ── روابط مختصرة + مخفية + شائعة ──────────────────
const _LINK_RE = new RegExp(
    '(' +
    'https?:\/\/[^\\s<>"]{4,}' +                    // http/https عادي
    '|\\bwww\\.[^\\s<>"]{4,}' +                   // www.
    '|\\b(wa\\.me|t\\.me|chat\\.whatsapp\\.com)\\/' + // واتساب/تيليجرام
    '|\\b(discord\\.gg|discord\\.com\/invite)\\/' +     // ديسكورد
    '|\\b(bit\\.ly|tinyurl\\.com|t\\.co|goo\\.gl|ow\\.ly|is\\.gd|buff\\.ly|rb\\.gy|shorturl\\.at)\\/' + // مختصرة
    ')',
    'i'
);
const hasLink  = text => _LINK_RE.test(text || '');

// ☑️ FIX-3: استخراج كل النصوص الممكنة من الرسالة (نص + كابشن)
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

// ☑️ دالة موحدة — تجلب groupMetadata مرة واحدة فقط لكل رسالة
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
global.activeSessions = activeSessions; // ← يُتاح لـ تصفير.js

// ── ضبط owner من config.js ──────────────────────────
// الأولوية: config.js → _botConfig الموجود → البوت نفسه
if (!global._botConfig) global._botConfig = {};
// owner من config.js دائماً
global._botConfig.owner = (configObj?.owner || '213540419314').toString().replace(/\D/g, '');
// fallback: رقم البوت نفسه (يُضبط بعد اتصال البوت)
// يُحدَّث في messages.js أو index.js عند open connection

// ── Rate Limiter — الحد: 20 رسالة/دقيقة لكل مستخدم ──
const _rateMap = new Map();
function isRateLimited(jid, max = 20) {
    const now    = Date.now();
    const prev   = _rateMap.get(jid) || [];
    const recent = prev.filter(t => now - t < 60_000);
    // تحقق أولاً قبل push لتقليل allocation
    if (recent.length >= max) return true;
    recent.push(now);
    _rateMap.set(jid, recent);
    return false;
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
    if (global._slashPending?.size > 500 || (typeof _slashPending !== 'undefined' && _slashPending?.size > 500)) {
        try { _slashPending?.clear(); } catch (e) { if (e?.message) console.error('[catch]', e.message); }
    }
    // flush stats للـ disk كل دقيقة بدل كل رسالة
    flushStats();
    // تنظيف activeSessions — حذف جلسات أكثر من 5 دقائق بدون نشاط
    for (const [id, s] of activeSessions) {
        if (s.lastActivity && now - s.lastActivity > 300_000) {
            try { s.cleanupFn?.(); } catch (e) { if (e?.message) console.error('[catch]', e.message); }
            activeSessions.delete(id);
        }
    }
    // حد أقصى للجلسات 100
    if (activeSessions.size > 100) {
        // احذف أقدم جلسة
        const oldest = [...activeSessions.entries()].sort((a,b) => (a[1].lastActivity||0) - (b[1].lastActivity||0))[0];
        if (oldest) { try { oldest[1].cleanupFn?.(); } catch (e) { if (e?.message) console.error('[catch]', e.message); } activeSessions.delete(oldest[0]); }
    }
}, 60_000);



const MAIN_MENU =
`✧━── ❝ 𝐍𝐎𝐕𝐀 𝐒𝐘𝐒𝐓𝐄𝐌 ❞ ──━✧

✦ *تنزيلات*
\`⬇️ تنزيل من يوتيوب وانستقرام وغيرها\`

✦ *إحصاءات*
\`📊 تقارير الاستخدام\`

┄┄┄┄ 👑 للنخبة ┄┄┄┄

✦ *نخبة*
\`👑 ادارة قائمة النخبة\`

✦ *بلاجنز*
\`🧩 ادارة وعرض الاوامر\`

✦ *حماية*
\`🛡️ انظمة الحماية\`

✦ *إدارة*
\`🛠️ إدارة المجموعات\`

✦ *بوت*
\`🤖 إعدادات البوت\`

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`;

export {
    sleep, react, reactWait, reactOk, reactFail, reactInput,
    normalizeJid, getBotJid, checkElite,
    resolveTarget, pinMessage,
    readJSON, writeJSON, readJSONSync, writeJSONSync, atomicWrite,
    readProt, writeProt, readStats, writeStats,
    readBanned, isBanned, addBan, removeBan, reloadBanCache,
    getAllPluginFiles, getPluginInfo, updatePluginField, findPluginByCmd,
    quickLint, checkPluginSyntax,
    isGroupAdmin, isBotGroupAdmin, getGroupAdminInfo,
    grpFile, DATA_DIR, PLUGINS_DIR, BOT_DIR, PROT_FILE, STATS_FILE,
    BAN_FILE, PLUGINS_CFG_FILE, _eliteProPath,
    activeSessions, MAIN_MENU,
    registerDeleteListener, registerWelcomeListener, isRateLimited,
    configObj,
};
