// ══════════════════════════════════════════════════════════════
//  نظام-4.js — النسخة الشاملة المدمجة (مُصلَّحة)
//  يشمل: نخبة، بلاجنز، تنصيب، إحصاءات، حماية، اوامر، إدارة
// ══════════════════════════════════════════════════════════════
import fs          from 'fs-extra';
import path        from 'path';
import os          from 'os';
import { fileURLToPath } from 'url';
import { loadPlugins, getPlugins } from '../../handlers/plugins.js';
import { exec }    from 'child_process';
import { promisify } from 'util';
import pino        from 'pino';
import {
    makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers,
    downloadMediaMessage,
    jidDecode,
} from '@whiskeysockets/baileys';
import * as accountUtils from '../../../accountUtils.js';

const execAsync   = promisify(exec);
const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const BOT_DIR     = path.resolve(__dirname, '../../');
const ROOT_DIR    = path.resolve(__dirname, '../../../../');
const DATA_DIR    = path.join(BOT_DIR, 'nova', 'data');
const PLUGINS_DIR = path.join(BOT_DIR, 'plugins');
const ACCOUNTS_DIR= path.join(ROOT_DIR, 'accounts');
const CONFIG_PATH = path.join(BOT_DIR, 'nova', 'config.js');
const PROT_FILE   = path.join(DATA_DIR, 'protection.json');
const STATS_FILE  = path.join(DATA_DIR, 'sys_stats.json');
const SUB_FILE    = path.join(ACCOUNTS_DIR, 'sub_accounts.json');

fs.ensureDirSync(DATA_DIR);

// ── helpers ───────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

const react = (sock, msg, e) =>
    sock.sendMessage(msg.key.remoteJid, { react: { text: e, key: msg.key } }).catch(() => {});

// ✅ FIX 1: normalizeJid يدعم LID و JID بشكل صحيح
const normalizeJid = (jid) => {
    if (!jid || typeof jid !== 'string') return '';
    const clean = jid.split(':')[0];
    if (clean.includes('@lid')) return clean;
    if (clean.includes('@')) return clean;
    return clean + '@s.whatsapp.net';
};

// ✅ FIX 2: botJid صحيح باستخدام jidDecode مثل finish.js
const getBotJid = (sock) =>
    (jidDecode(sock.user?.id)?.user || sock.user?.id?.split(':')[0]?.split('@')[0] || '') + '@s.whatsapp.net';

function readJSON(file, def = {}) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
}
function writeJSON(file, data) {
    try { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); } catch {}
}

const readProt  = () => readJSON(PROT_FILE, {
    antiCrash: 'off', antiLink: 'off', antiDelete: 'off',
    antiInsult: 'off', antiViewOnce: 'off', antiPrivate: 'off',
});
const writeProt = d => writeJSON(PROT_FILE, d);
const readStats = () => readJSON(STATS_FILE, { commands: {}, users: {}, total: 0 });
const writeStats= d => writeJSON(STATS_FILE, d);
const readSubs  = () => readJSON(SUB_FILE, []);
const writeSubs = d => writeJSON(SUB_FILE, d);

function grpFile(prefix, chatId) {
    return path.join(DATA_DIR, prefix + '_' + chatId.replace(/[^\w]/g, '_') + '.json');
}

// ── plugin utils ──────────────────────────────────────────────
function getAllPluginFiles(dir = PLUGINS_DIR, list = []) {
    if (!fs.existsSync(dir)) return list;
    for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) getAllPluginFiles(full, list);
        else if (f.endsWith('.js')) list.push(full);
    }
    return list;
}

// ✅ FIX 3: getPluginInfo يدعم command بصيغة Array
function getPluginInfo(filePath) {
    const code  = fs.readFileSync(filePath, 'utf8');
    let cmd;
    const arrayMatch = code.match(/command:\s*\[([^\]]+)\]/);
    if (arrayMatch) {
        const cmds = arrayMatch[1].match(/['"`]([^'"`]+)['"`]/g);
        cmd = cmds ? cmds[0].replace(/['"`]/g, '') : path.basename(filePath, '.js');
    } else {
        cmd = code.match(/command:\s*['"`]([^'"`]+)['"`]/)?.[1] || path.basename(filePath, '.js');
    }
    const elite = code.match(/elite:\s*['"`](on|off)['"`]/i)?.[1]   || 'off';
    const lock  = code.match(/lock:\s*['"`](on|off)['"`]/i)?.[1]    || 'off';
    const group = code.match(/group:\s*(true|false)/i)?.[1]         || 'false';
    const prv   = code.match(/prv:\s*(true|false)/i)?.[1]           || 'false';
    return { cmd, elite, lock, group: group === 'true', prv: prv === 'true', filePath };
}

function updatePluginField(filePath, key, value) {
    let code = fs.readFileSync(filePath, 'utf8');
    if (key === 'elite' || key === 'lock') {
        code = code.replace(new RegExp(`(${key}:\\s*['"\`])(on|off)(['"\`])`, 'i'), `$1${value}$3`);
    } else if (key === 'group' || key === 'prv') {
        code = code.replace(new RegExp(`(${key}:\\s*)(true|false)`, 'i'), `$1${value}`);
    } else if (key === 'command') {
        code = code.replace(/command:\s*['"`][^'"`]+['"`]/, `command: '${value}'`);
    }
    fs.writeFileSync(filePath, code, 'utf8');
}

// ✅ FIX 4: findPluginByCmd يدعم Array commands
async function findPluginByCmd(cmdName) {
    for (const f of getAllPluginFiles()) {
        try {
            const code = fs.readFileSync(f, 'utf8');
            // string format
            if (new RegExp(`command:\\s*['"\`]${cmdName}['"\`]`, 'i').test(code)) return f;
            // array format
            if (new RegExp(`command:\\s*\\[[^\\]]*['"\`]${cmdName}['"\`]`, 'i').test(code)) return f;
        } catch {}
    }
    return null;
}

// ── فاحص syntax ───────────────────────────────────────────────
async function checkPluginSyntax(filePath) {
    try {
        await execAsync(`node --input-type=module --check < "${filePath}"`);
        return { ok: true };
    } catch (e) {
        const errMsg = (e.stderr || e.message || '').trim();
        const lineMatch = errMsg.match(/:(\d+)$/m);
        const line = lineMatch ? parseInt(lineMatch[1]) : null;
        let codeLine = '';
        if (line) {
            try { codeLine = fs.readFileSync(filePath, 'utf8').split('\n')[line - 1]?.trim() || ''; } catch {}
        }
        return { ok: false, error: errMsg, line, codeLine };
    }
}

function quickLint(filePath) {
    const code = fs.readFileSync(filePath, 'utf8');
    const issues = [];
    const opens  = (code.match(/\{/g) || []).length;
    const closes = (code.match(/\}/g) || []).length;
    if (opens !== closes) issues.push(`الاقواس {} غير متوازنة — مفتوحة:${opens} مغلقة:${closes}`);
    if (!/export default/.test(code)) issues.push('لا يوجد export default — البوت لن يحملها');
    if (!/command\s*:/.test(code))    issues.push('لا يوجد حقل command — الامر لن يُعرف');
    return issues;
}

// ✅ FIX 5: messageCache لحفظ الرسائل قبل حذفها
const messageCache = new Map();
const _registeredDeleteSocks = new WeakSet();

function cacheMessage(msg) {
    try {
        if (!msg?.key?.id) return;
        const text = msg.message?.conversation ||
                     msg.message?.extendedTextMessage?.text ||
                     msg.message?.imageMessage?.caption || '';
        messageCache.set(msg.key.id, {
            chatId: msg.key.remoteJid,
            sender: msg.key.participant || msg.key.remoteJid,
            text,
            type: Object.keys(msg.message || {})[0] || 'unknown',
        });
        if (messageCache.size > 500) {
            messageCache.delete(messageCache.keys().next().value);
        }
    } catch {}
}

function registerDeleteListener(sock) {
    if (_registeredDeleteSocks.has(sock)) return;
    _registeredDeleteSocks.add(sock);
    // ✅ FIX 6: تسجيل messages.delete بشكل صحيح مع البنية الصحيحة
    sock.ev.on('messages.delete', ({ keys }) => {
        antiDeleteHandler(sock, keys);
    });
}

// ══════════════════════════════════════════════════════════════
//  featureHandlers
// ══════════════════════════════════════════════════════════════
const CRASH_PATTERNS = [
    /[\u202E\u200F\u200E]{10,}/,
    /(.)(\1){300,}/,
    /[\uD83D][\uDC00-\uDFFF]{50,}/,
];
const INSULT_WORDS = ['كس','طيز','شرموط','عاهر','زب','كسمك','عرص','منيوك','قحبة'];
const LINK_REGEX   = /(?:https?:\/\/|wa\.me\/|chat\.whatsapp\.com\/)[^\s]*/i;

async function protectionHandler(sock, msg) {
    try {
        // تسجيل delete listener عند اول رسالة
        registerDeleteListener(sock);
        // حفظ الرسالة في الكاش قبل ما تُحذف
        cacheMessage(msg);

        const prot   = readProt();
        const chatId = msg.key.remoteJid;
        const isGroup= chatId.endsWith('@g.us');
        const text   = msg.message?.conversation ||
                       msg.message?.extendedTextMessage?.text ||
                       msg.message?.imageMessage?.caption || '';

        // antiPrivate — حظر اي شخص يراسل البوت في الخاص تلقائياً
        if (prot.antiPrivate === 'on' && !isGroup && !msg.key.fromMe) {
            try {
                await sock.updateBlockStatus(chatId, 'block');
            } catch {}
            return;
        }

        // antiCrash
        if (prot.antiCrash === 'on') {
            for (const p of CRASH_PATTERNS) {
                if (p.test(text)) {
                    try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}
                    return;
                }
            }
        }

        // ✅ FIX 7: antiLink بدون return مبكر حتى لا يوقف بقية الحماية
        if (prot.antiLink === 'on' && isGroup && LINK_REGEX.test(text)) {
            try {
                const meta    = await sock.groupMetadata(chatId);
                const botJid  = getBotJid(sock);
                const admins  = meta.participants.filter(p => p.admin).map(p => normalizeJid(p.id));
                const sender  = normalizeJid(msg.key.participant || chatId);
                if (!msg.key.fromMe && !admins.includes(sender) && normalizeJid(botJid) !== sender) {
                    try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}
                }
            } catch {}
            // لا return — نكمل فحص الحماية الاخرى
        }

        // antiInsult
        if (prot.antiInsult === 'on') {
            const lower = text.toLowerCase();
            if (INSULT_WORDS.some(w => lower.includes(w))) {
                try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}
                return;
            }
        }

        // antiViewOnce — منطق فضح.js بالضبط
        if (prot.antiViewOnce === 'on') {
            const ctx    = msg.message?.extendedTextMessage?.contextInfo;
            const quoted = ctx?.quotedMessage;

            // الرسالة نفسها أو الاقتباس
            const targets = [];
            if (quoted) targets.push({ message: quoted, key: ctx });
            // كذلك تحقق من الرسالة المباشرة (بدون اقتباس)
            const directInner = msg.message?.viewOnceMessage?.message
                             || msg.message?.viewOnceMessageV2?.message
                             || (msg.message?.imageMessage?.viewOnce ? msg.message : null)
                             || (msg.message?.videoMessage?.viewOnce ? msg.message : null);
            if (directInner && directInner !== msg.message) targets.push({ message: directInner, key: null });
            else if (directInner === msg.message) targets.push({ message: msg.message, key: null, direct: true });

            for (const t of targets) {
                try {
                    const m = t.message;
                    // فورمات فضح.js: imageMessage/videoMessage مباشرة في quoted
                    const mtype = Object.keys(m).find(k => ['imageMessage','videoMessage'].includes(k));
                    if (!mtype) continue;
                    const mediaMsg = m[mtype];
                    if (!mediaMsg?.viewOnce) continue;

                    // تنزيل بنفس طريقة فضح.js
                    const buffer = await downloadMediaMessage(
                        t.direct
                            ? msg
                            : { message: m, key: msg.message?.extendedTextMessage?.contextInfo || msg.key },
                        'buffer',
                        {}
                    );
                    if (!buffer) continue;

                    const type    = mtype.replace('Message', '');
                    const caption = (mediaMsg?.caption ? mediaMsg.caption + '\n\n' : '') +
                                    '👁️ _تم كشف وسائط المشاهدة لمرة واحدة_';
                    await sock.sendMessage(chatId, { [type]: buffer, caption });
                    break; // نكتفي بالأول
                } catch {}
            }
        }
    } catch {}
}
protectionHandler._src = 'protection_system';

async function statsAutoHandler(sock, msg) {
    try {
        const pfx  = global._botConfig?.prefix || '.';
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        if (!text.startsWith(pfx)) return;
        const cmd    = text.slice(pfx.length).split(/\s+/)[0]?.toLowerCase();
        const sender = normalizeJid(msg.key.participant || msg.key.remoteJid);
        if (!cmd || !sender) return;
        const stats = readStats();
        stats.total = (stats.total || 0) + 1;
        stats.commands[cmd] = (stats.commands[cmd] || 0) + 1;
        stats.users[sender] = (stats.users[sender] || 0) + 1;
        writeStats(stats);
    } catch {}
}
statsAutoHandler._src = 'stats_system';

// ✅ FIX 6b: antiDeleteHandler يستخدم البنية الصحيحة مع الكاش
async function antiDeleteHandler(sock, keys) {
    try {
        if (readProt().antiDelete !== 'on') return;
        for (const key of keys) {
            try {
                const chatId = key.remoteJid;
                const sender = key.participant || key.remoteJid;
                const cached = messageCache.get(key.id);
                let extra = '';
                if (cached?.text) extra = `\n📝 *المحتوى:* ${cached.text}`;
                await sock.sendMessage(chatId, {
                    text: `🗑️ *تم حذف رسالة*\nالمرسل: @${normalizeJid(sender)}${extra}`,
                    mentions: [sender],
                });
            } catch {}
        }
    } catch {}
}
antiDeleteHandler._src = 'antiDelete_system';

if (!global.featureHandlers) global.featureHandlers = [];
global.featureHandlers = global.featureHandlers.filter(
    h => !['protection_system','stats_system','antiDelete_system'].includes(h._src)
);
global.featureHandlers.push(protectionHandler, statsAutoHandler, antiDeleteHandler);

// ══════════════════════════════════════════════════════════════
//  القوائم — اسلوب settings.js بالضبط
// ══════════════════════════════════════════════════════════════
const MAIN_MENU =
`✧━── ❝ 𝐍𝐎𝐕𝐀 𝐒𝐘𝐒𝐓𝐄𝐌 ❞ ──━✧

✦ *نخبة*
\`👑 إدارة قائمة النخبة\`

✦ *بلاجنز*
\`🧩 إدارة وعرض الاوامر\`

✦ *تنصيب*
\`🤖 البوتات الفرعية\`

✦ *إحصاءات*
\`📊 تقارير الاستخدام\`

✦ *حماية*
\`🛡️ انظمة الحماية\`

✦ *اوامر*
\`🔧 ادوات الاوامر\`

✦ *إدارة*
\`🛠️ إدارة المجموعات\`

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`;

const activeSessions = new Map();

// ══════════════════════════════════════════════════════════════
//  NovaUltra
// ══════════════════════════════════════════════════════════════
const NovaUltra = {
    command: 'نظام',
    description: 'نظام البوت الشامل',
    elite: 'on',
    group: false,
    prv: false,
    lock: 'off',
};

async function execute({ sock, msg }) {
    const chatId    = msg.key.remoteJid;
    const senderJid = msg.key.participant || chatId;

    // تسجيل delete listener عند فتح اي جلسة
    registerDeleteListener(sock);

    if (activeSessions.has(chatId)) {
        const old = activeSessions.get(chatId);
        sock.ev.off('messages.upsert', old.listener);
        clearTimeout(old.timeout);
        activeSessions.delete(chatId);
    }

    const sentMsg  = await sock.sendMessage(chatId, { text: MAIN_MENU }, { quoted: msg });
    let botMsgKey  = sentMsg.key;
    let state      = 'MAIN';
    let tmp        = {};

    const update = async (text) => sock.sendMessage(chatId, { text, edit: botMsgKey }).catch(async () => {
        const s = await sock.sendMessage(chatId, { text });
        botMsgKey = s.key;
    });

    // ✅ FIX 1b: getAdminPerms يستخدم normalizeJid الصحيح
    async function getAdminPerms() {
        if (!chatId.endsWith('@g.us')) return { isAdmin: false, isBotAdmin: false, meta: null, isGroup: false };
        try {
            const meta    = await sock.groupMetadata(chatId);
            const botJid  = getBotJid(sock);
            const admins  = meta.participants.filter(p => p.admin).map(p => normalizeJid(p.id));
            const sNum    = normalizeJid(senderJid);
            const botNorm = normalizeJid(botJid);
            return {
                meta,
                isGroup:    true,
                isAdmin:    msg.key.fromMe || admins.includes(sNum),
                isBotAdmin: admins.includes(botNorm),
            };
        } catch {
            return { isAdmin: false, isBotAdmin: false, meta: null, isGroup: true };
        }
    }

    // ✅ FIX 9: دالة مساعدة لرسائل خطا الصلاحيات الدقيقة
    async function checkAndReportPerms() {
        const { isAdmin, isBotAdmin, isGroup } = await getAdminPerms();
        if (!isGroup)    { await update('❌ هذا الامر للمجموعات فقط.'); return false; }
        if (!isBotAdmin) { await update('❌ البوت ليس مشرفا، رقه اولا.'); return false; }
        if (!isAdmin)    { await update('❌ انت لست مشرفا.'); return false; }
        return true;
    }

    const REACTS = {
        'رجوع':'🔙','تشغيل':'✅','اطفاء':'⛔','نعم':'👍','لا':'❌',
        'حذف':'🗑️','اضافة':'➕','عرض':'📋','مسح الكل':'🗑️',
        'تنصيب':'🤖','نخبة':'👑','بلاجنز':'🧩','إحصاءات':'📊',
        'حماية':'🛡️','اوامر':'🔧','بحث':'🔍','فاحص الكود':'🔍',
        'حفظ':'💾','تغيير':'✏️','نظام':'⚙️','إدارة':'🛠️',
        'مسح كاش':'🗑️','نسخ':'💾','استعادة':'↩️','جديد':'➕',
        'حالة':'📊','طرد':'🚪','حظر':'🔨','كتم':'🔇','إيقاف':'🛑',
        'تثبيت':'📌','رابط':'🔗','قوانين':'📜','ترحيب':'👋',
        'الاوامر':'📋','معلومات':'ℹ️','اذاعة':'📢','تحديث':'🔄',
        'انضم':'🔗','خروج':'🚪','توكن':'🔑','البوتات':'🤖',
        'اذاعة بوتات':'📢','مسح جلسة':'🗑️',
    };

    const listener = async ({ messages }) => {
        const m = messages[0];
        if (!m?.message || m.key.remoteJid !== chatId) return;

        // ✅ FIX 2b: مقارنة JID بعد تطبيع لدعم LID
        const incomingJid = m.key.participant || m.key.remoteJid;
        if (normalizeJid(incomingJid) !== normalizeJid(senderJid)) return;

        const text = (m.message.conversation || m.message.extendedTextMessage?.text || '').trim();
        if (!text) return;

        if (REACTS[text]) react(sock, m, REACTS[text]);

        // ════════════════════════════════════════════════════
        // MAIN
        // ════════════════════════════════════════════════════
        if (state === 'MAIN') {
            if (text === 'نخبة')    { await showEliteMenu();   state = 'ELITE';    return; }
            if (text === 'بلاجنز')  { await showPluginsMenu(); state = 'PLUGINS';  return; }
            if (text === 'تنصيب')   { await showSubMenu();     state = 'SUBS';     return; }
            if (text === 'إحصاءات') { await showStats();       state = 'STATS';    return; }
            if (text === 'حماية')   { await showProtMenu();    state = 'PROT';     return; }
            if (text === 'اوامر')   { await showCmdTools();    state = 'CMDTOOLS'; return; }
            if (text === 'إدارة')   { await showAdminMenu();   state = 'ADMIN';    return; }
            return;
        }

        // ════════════════════════════════════════════════════
        // ELITE
        // ════════════════════════════════════════════════════
        if (state === 'ELITE') {
            if (text === 'رجوع') { await update(MAIN_MENU); state = 'MAIN'; return; }
            if (text === 'عرض') {
                try {
                    const list = await sock.getEliteList?.() || [];
                    if (!list.length) return update(`✧━── ❝ 𝐍𝐗𝐁𝐀 ❞ ──━✧\n\n📋 القائمة فارغة.\n\n🔙 *رجوع*\n\n✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
                    return update(`✧━── ❝ 𝐍𝐗𝐁𝐀 ❞ ──━✧\n\n*قائمة النخبة 👑*\n\n${list.map((n,i)=>`${i+1}. ${n}`).join('\n')}\n\n🔙 *رجوع*\n\n✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
                } catch { return update('❌ تعذر جلب القائمة.\n\n🔙 *رجوع*'); }
            }
            if (text === 'اضافة') { await update('📱 ارسل الرقم لإضافته:\nمثال: 966501234567\n\n🔙 *رجوع*'); state = 'ELITE_ADD'; return; }
            if (text === 'حذف')   { await update('📱 ارسل الرقم لحذفه:\n\n🔙 *رجوع*'); state = 'ELITE_DEL'; return; }
            if (text === 'مسح الكل') {
                await update('⚠️ *تاكيد مسح كل النخبة؟*\naكتب *نعم* او *رجوع*');
                state = 'ELITE_CLEAR'; return;
            }
            return;
        }

        if (state === 'ELITE_ADD') {
            if (text === 'رجوع') { await showEliteMenu(); state = 'ELITE'; return; }
            const num = text.replace(/\D/g, '');
            if (num.length < 9) return update('❌ رقم غير صحيح.');
            try {
                await sock.addElite?.({ id: num + '@s.whatsapp.net' });
                await update(`✅ تم إضافة [ ${num} ] للنخبة.`);
                await sleep(1200); await showEliteMenu(); state = 'ELITE';
            } catch (e) { await update(`❌ فشل: ${e?.message}`); }
            return;
        }

        if (state === 'ELITE_DEL') {
            if (text === 'رجوع') { await showEliteMenu(); state = 'ELITE'; return; }
            const num = text.replace(/\D/g, '');
            if (num.length < 9) return update('❌ رقم غير صحيح.');
            try {
                await sock.removeElite?.({ id: num + '@s.whatsapp.net' });
                await update(`✅ تم حذف [ ${num} ] من النخبة.`);
                await sleep(1200); await showEliteMenu(); state = 'ELITE';
            } catch (e) { await update(`❌ فشل: ${e?.message}`); }
            return;
        }

        if (state === 'ELITE_CLEAR') {
            if (text === 'رجوع') { await showEliteMenu(); state = 'ELITE'; return; }
            if (text === 'نعم') {
                try {
                    const list = await sock.getEliteList?.() || [];
                    for (const id of list) { try { await sock.removeElite?.({ id }); } catch {} }
                    await update('✅ تم مسح جميع النخبة.');
                    await sleep(1200); await showEliteMenu(); state = 'ELITE';
                } catch (e) { await update(`❌ ${e?.message}`); }
            }
            return;
        }

        // ════════════════════════════════════════════════════
        // PLUGINS
        // ════════════════════════════════════════════════════
        if (state === 'PLUGINS') {
            if (text === 'رجوع') { await update(MAIN_MENU); state = 'MAIN'; return; }

            if (text === 'عرض') {
                const files = getAllPluginFiles();
                let chunk   = `✧━── ❝ 𝐏𝐋𝐔𝐆𝐈𝐍𝐒 ❞ ──━✧\n\n*الاوامر المتوفرة 🧩 (${files.length}):*\n\n`;
                const chunks= [];
                for (const f of files) {
                    const { cmd, elite, lock } = getPluginInfo(f);
                    const line = `✦ ${cmd}${elite==='on'?' 👑':''}${lock==='on'?' 🔒':''}\n`;
                    if ((chunk + line).length > 3500) { chunks.push(chunk); chunk = ''; }
                    chunk += line;
                }
                if (chunk) chunks.push(chunk);
                for (const c of chunks) await sock.sendMessage(chatId, { text: c });
                await update('🔙 *رجوع* | اكتب *بحث [اسم]* للتفاصيل | *كود [اسم]* لعرض الكود');
                return;
            }

            if (text.startsWith('بحث ')) {
                const cmdName = text.slice(4).trim();
                const fp = await findPluginByCmd(cmdName);
                if (!fp) return update(`❌ ما وجدت الامر: ${cmdName}`);
                tmp.targetFile = fp; tmp.targetCmd = cmdName;
                await showPluginDetail(fp, cmdName); state = 'PLUGIN_EDIT'; return;
            }

            if (text.startsWith('كود ')) {
                const cmdName = text.slice(4).trim();
                const fp = await findPluginByCmd(cmdName);
                if (!fp) return update(`❌ ما وجدت الامر: ${cmdName}\n\n🔙 *رجوع*`);
                try {
                    const code = fs.readFileSync(fp, 'utf8');
                    await sock.sendMessage(chatId, { text: `📄 *${cmdName}.js*\n\n${code.slice(0, 3500)}` });
                    await sock.sendMessage(chatId, {
                        document: fs.readFileSync(fp),
                        mimetype: 'application/javascript',
                        fileName: path.basename(fp),
                    });
                } catch (e) { await update(`❌ ${e?.message}`); }
                return;
            }

            if (text === 'اضافة امر') {
                await update('📝 ارسل اسم الامر الجديد:\n`بدون .js`\n\n🔙 *رجوع*');
                state = 'PLUGIN_NEW_NAME'; return;
            }

            if (text === 'طفي الكل') {
                for (const f of getAllPluginFiles()) {
                    if (f.includes('نظام')) continue;
                    try { updatePluginField(f, 'lock', 'on'); } catch {}
                }
                await loadPlugins().catch(() => {});
                await update('🔒 تم قفل جميع البلاجنز.'); return;
            }
            if (text === 'شغل الكل') {
                for (const f of getAllPluginFiles()) {
                    if (f.includes('نظام')) continue;
                    try { updatePluginField(f, 'lock', 'off'); } catch {}
                }
                await loadPlugins().catch(() => {});
                await update('🔓 تم فتح جميع البلاجنز.'); return;
            }
            return;
        }

        if (state === 'PLUGIN_EDIT') {
            if (text === 'رجوع') { await showPluginsMenu(); state = 'PLUGINS'; return; }
            const { targetFile: fp, targetCmd: tc } = tmp;
            if (!fp) return;

            if (text === 'كود') {
                try {
                    const code = fs.readFileSync(fp, 'utf8');
                    await sock.sendMessage(chatId, { text: code.slice(0, 3500) });
                    await sock.sendMessage(chatId, {
                        document: fs.readFileSync(fp),
                        mimetype: 'application/javascript',
                        fileName: path.basename(fp),
                    });
                } catch (e) { await update(`❌ ${e?.message}`); }
                return;
            }
            if (text === 'قفل' || text === 'فتح') {
                try { updatePluginField(fp, 'lock', text === 'قفل' ? 'on' : 'off'); await loadPlugins().catch(()=>{}); } catch {}
                await sleep(800); await showPluginDetail(fp, tc); return;
            }
            if (text === 'نخبة' || text === 'عام') {
                try { updatePluginField(fp, 'elite', text === 'نخبة' ? 'on' : 'off'); await loadPlugins().catch(()=>{}); } catch {}
                await sleep(800); await showPluginDetail(fp, tc); return;
            }
            if (text === 'مجموعات') { try { updatePluginField(fp,'group','true'); updatePluginField(fp,'prv','false'); await loadPlugins().catch(()=>{}); } catch {} await sleep(800); await showPluginDetail(fp,tc); return; }
            if (text === 'خاص')     { try { updatePluginField(fp,'prv','true');   updatePluginField(fp,'group','false'); await loadPlugins().catch(()=>{}); } catch {} await sleep(800); await showPluginDetail(fp,tc); return; }
            if (text === 'للجميع')  { try { updatePluginField(fp,'group','false'); updatePluginField(fp,'prv','false'); await loadPlugins().catch(()=>{}); } catch {} await sleep(800); await showPluginDetail(fp,tc); return; }
            if (text === 'تغيير الاسم') { await update(`✏️ اكتب الاسم الجديد للامر [ ${tc} ]:\n\n🔙 *رجوع*`); state = 'PLUGIN_RENAME'; return; }
            return;
        }

        if (state === 'PLUGIN_RENAME') {
            if (text === 'رجوع') { await showPluginDetail(tmp.targetFile, tmp.targetCmd); state = 'PLUGIN_EDIT'; return; }
            const pfx = global._botConfig?.prefix || '.';
            const newCmd = text.replace(pfx, '').trim();
            try { updatePluginField(tmp.targetFile, 'command', newCmd); await loadPlugins().catch(()=>{}); } catch {}
            await update(`✅ \`${pfx}${tmp.targetCmd}\` ➔ \`${pfx}${newCmd}\``);
            tmp.targetCmd = newCmd;
            await sleep(1200); await showPluginDetail(tmp.targetFile, newCmd); state = 'PLUGIN_EDIT'; return;
        }

        if (state === 'PLUGIN_NEW_NAME') {
            if (text === 'رجوع') { await showPluginsMenu(); state = 'PLUGINS'; return; }
            const name = text.trim().replace(/\.js$/, '').replace(/[^\w\u0600-\u06FF]/g, '');
            if (!name) return update('❌ اسم غير صحيح.\n\n🔙 *رجوع*');
            tmp.newPluginName = name;
            await update(`📝 الان ارسل كود الامر [ *${name}* ] كاملاً:\n\n🔙 *رجوع*`);
            state = 'PLUGIN_NEW_CODE'; return;
        }

        if (state === 'PLUGIN_NEW_CODE') {
            if (text === 'رجوع') { await showPluginsMenu(); state = 'PLUGINS'; return; }
            const targetPath = path.join(PLUGINS_DIR, 'tools', `${tmp.newPluginName}.js`);
            try {
                fs.ensureDirSync(path.dirname(targetPath));
                fs.writeFileSync(targetPath, text, 'utf8');
                await loadPlugins().catch(() => {});
                react(sock, m, '✅');
                await update(`✅ تم إنشاء الامر [ ${tmp.newPluginName} ] بنجاح.\n📁 \`${path.basename(targetPath)}\`\n\n🔙 *رجوع*`);
            } catch (e) { await update(`❌ ${e?.message}\n\n🔙 *رجوع*`); }
            await sleep(1000); await showPluginsMenu(); state = 'PLUGINS'; return;
        }

        // ════════════════════════════════════════════════════
        // SUBS — البوتات الفرعية
        // ════════════════════════════════════════════════════
        if (state === 'SUBS') {
            if (text === 'رجوع') { await update(MAIN_MENU); state = 'MAIN'; return; }

            if (text === 'جديد') {
                await update('*اكتب اسم البوت الجديد:*\n`حروف وارقام انجليزية فقط`\n\n🔙 *رجوع*');
                state = 'SUBS_NEWNAME'; return;
            }

            if (text === 'حالة') {
                const subs = readSubs();
                if (!subs.length) return update('📭 لا يوجد حسابات فرعية.\n\n🔙 *رجوع*');
                const lines = subs.map(name => {
                    const cp = path.join(ACCOUNTS_DIR, name, 'nova', 'data', 'creds.json');
                    let jid  = '—';
                    if (fs.existsSync(cp)) {
                        try { jid = JSON.parse(fs.readFileSync(cp, 'utf8')).me?.id?.split(':')[0] || '—'; } catch {}
                    }
                    return `✦ *${name}* | +${jid}`;
                }).join('\n');
                await update(`✧━── ❝ 𝐒𝐔𝐁𝐒 ❞ ──━✧\n\n${lines}\n\n🔙 *رجوع*\n\n✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
                return;
            }

            if (text === 'البوتات') {
                try {
                    const conns = (global.conns || []).filter(c => c?.user?.id);
                    if (!conns.length) return update('📭 لا يوجد بوتات متصلة حالياً.\n\n🔙 *رجوع*');
                    const lines = conns.map((c, i) => {
                        const num  = normalizeJid(c.user.id).split('@')[0];
                        const name = c.user.name || '—';
                        return `${i+1}. *${name}* | +${num}`;
                    }).join('\n');
                    await update(`✧━── ❝ 𝐁𝐎𝐓𝐒 ❞ ──━✧\n\n*البوتات المتصلة الان 🟢 (${conns.length}):*\n\n${lines}\n\n🔙 *رجوع*\n\n✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
                } catch (e) { await update(`❌ ${e?.message}\n\n🔙 *رجوع*`); }
                return;
            }

            if (text.startsWith('توكن ')) {
                const name = text.slice(5).trim();
                const cp   = path.join(ACCOUNTS_DIR, name, 'nova', 'data', 'creds.json');
                if (!fs.existsSync(cp)) return update(`❌ ما وجدت جلسة [ ${name} ].\n\n🔙 *رجوع*`);
                try {
                    const token = Buffer.from(fs.readFileSync(cp, 'utf8')).toString('base64');
                    await sock.sendMessage(chatId, { text: `🔑 *توكن [ ${name} ]:*\n\n${token}` });
                } catch (e) { await update(`❌ ${e?.message}`); }
                return;
            }

            if (text.startsWith('مسح جلسة ')) {
                const name = text.slice(9).trim();
                await update(`⚠️ *تاكيد مسح جلسة [ ${name} ]؟*\naكتب *نعم* او *رجوع*`);
                tmp.pendingDelSession = name; state = 'SUBS_DEL_SESSION'; return;
            }

            if (text.startsWith('إيقاف ')) {
                const name = text.slice(6).trim();
                const subs = readSubs();
                if (!subs.includes(name)) return update(`❌ البوت [ ${name} ] غير موجود.`);
                process.send?.({ type: 'kill_sub', name });
                react(sock, m, '🛑');
                await update(`🛑 تم إيقاف [ ${name} ] مؤقتاً.\nلإعادة تشغيله: *ريستارت ${name}*\n\n🔙 *رجوع*`);
                return;
            }

            if (text.startsWith('ريستارت ')) {
                const name = text.slice(8).trim();
                const subs = readSubs();
                if (!subs.includes(name)) return update(`❌ البوت [ ${name} ] غير موجود.`);
                process.send?.({ type: 'kill_sub', name });
                await sleep(800);
                process.send?.({ type: 'spawn_sub', name });
                react(sock, m, '🔄');
                await update(`🔄 تم إعادة تشغيل [ ${name} ]`);
                await sleep(1000); await showSubMenu(); return;
            }

            if (text.startsWith('حذف ')) {
                const name = text.slice(4).trim();
                if (!readSubs().includes(name)) return update(`❌ البوت [ ${name} ] غير موجود.`);
                await update(`⚠️ *تاكيد حذف [ ${name} ] نهائياً؟*\naكتب *نعم* او *رجوع*`);
                tmp.pendingDelete = name; state = 'SUBS_CONFIRM_DEL'; return;
            }

            if (text === 'اذاعة بوتات') {
                await update('📢 ارسل نص الإذاعة للبوتات الفرعية:\n\n🔙 *رجوع*');
                state = 'SUBS_BROADCAST'; return;
            }
            return;
        }

        if (state === 'SUBS_CONFIRM_DEL') {
            if (text === 'رجوع') { await showSubMenu(); state = 'SUBS'; return; }
            if (text === 'نعم') {
                const name = tmp.pendingDelete;
                process.send?.({ type: 'kill_sub', name });
                await sleep(400);
                try {
                    const res = accountUtils.deleteAccount(name);
                    writeSubs(readSubs().filter(s => s !== name));
                    react(sock, m, res.success ? '🗑️' : '❌');
                    await update(res.success ? `🗑️ تم حذف [ ${name} ] نهائياً.` : `❌ ${res.msg}`);
                } catch (e) { await update(`❌ ${e?.message}`); }
                await sleep(1000); await showSubMenu(); state = 'SUBS'; return;
            }
            return;
        }

        if (state === 'SUBS_DEL_SESSION') {
            if (text === 'رجوع') { await showSubMenu(); state = 'SUBS'; return; }
            if (text === 'نعم') {
                const name    = tmp.pendingDelSession;
                const sessDir = path.join(ACCOUNTS_DIR, name, 'nova', 'data');
                try {
                    process.send?.({ type: 'kill_sub', name });
                    await sleep(400);
                    fs.removeSync(sessDir);
                    react(sock, m, '🗑️');
                    await update(`🗑️ تم مسح جلسة [ ${name} ].\nيمكنك ربطه من جديد بامر جديد.`);
                } catch (e) { await update(`❌ ${e?.message}`); }
                await sleep(1000); await showSubMenu(); state = 'SUBS'; return;
            }
            return;
        }

        // ✅ FIX 10: SUBS_NEWNAME يعمل نسخ الملفات للبوت الجديد
        if (state === 'SUBS_NEWNAME') {
            if (text === 'رجوع') { await showSubMenu(); state = 'SUBS'; return; }
            const name = text.trim().replace(/[^a-zA-Z0-9_-]/g, '');
            if (!name) return update('❌ اسم غير صحيح.\n\n🔙 *رجوع*');

            let res;
            try { res = accountUtils.createAccount(name); } catch (e) { res = { success: false, msg: e?.message }; }
            if (!res.success) return update(`❌ ${res.msg}\n\n🔙 *رجوع*`);

            // نسخ ملفات البوت (plugins + nova بدون creds) للحساب الجديد
            try {
                await update(`⏳ *جاري إنشاء [ ${name} ] ونسخ الملفات...*`);
                const destDir = path.join(ACCOUNTS_DIR, name);

                // نسخ plugins كاملاً
                const srcPlugins = path.join(BOT_DIR, 'plugins');
                const dstPlugins = path.join(destDir, 'plugins');
                if (fs.existsSync(srcPlugins)) {
                    fs.copySync(srcPlugins, dstPlugins, { overwrite: false });
                }

                // نسخ nova بدون ملفات الجلسة
                const srcNova = path.join(BOT_DIR, 'nova');
                const dstNova = path.join(destDir, 'nova');
                if (fs.existsSync(srcNova)) {
                    fs.copySync(srcNova, dstNova, {
                        overwrite: false,
                        filter: (src) => {
                            const rel = path.relative(srcNova, src);
                            // لا تنسخ ملفات الجلسة والبيانات الشخصية
                            if (rel.includes('creds.json')) return false;
                            if (rel.includes('app-state')) return false;
                            if (rel.includes('pre-key')) return false;
                            return true;
                        },
                    });
                }
            } catch (copyErr) {
                // لو فشل النسخ نكمل بدون وقف التنصيب
                console.error('[نظام] copy error:', copyErr?.message);
            }

            const subs = readSubs();
            if (!subs.includes(name)) { subs.push(name); writeSubs(subs); }
            tmp.subName = name;
            await update(`✅ تم إنشاء [ *${name}* ] ونسخ الملفات\n\n📱 *ارسل رقم الهاتف للربط:*\nمثال: 966501234567\n\n🔙 *رجوع*`);
            state = 'SUBS_GETPHONE'; return;
        }

        if (state === 'SUBS_GETPHONE') {
            if (text === 'رجوع') {
                try { accountUtils.deleteAccount(tmp.subName); } catch {}
                writeSubs(readSubs().filter(s => s !== tmp.subName));
                await showSubMenu(); state = 'SUBS'; return;
            }
            const phone = text.replace(/\D/g, '');
            if (phone.length < 9 || phone.length > 15)
                return update('❌ رقم غير صحيح.\nمثال: 966501234567\n\n🔙 *رجوع*');

            tmp.subPhone = phone;
            await update(`⏳ *جاري توليد كود الربط لـ [ ${tmp.subName} ]...*`);
            react(sock, m, '⏳');

            try {
                const sessDir = path.join(ACCOUNTS_DIR, tmp.subName, 'nova', 'data');
                fs.ensureDirSync(sessDir);
                const { state: authState, saveCreds } = await useMultiFileAuthState(sessDir);
                const { version } = await fetchLatestBaileysVersion();

                const tempSock = makeWASocket({
                    version,
                    logger: pino({ level: 'silent' }),
                    printQRInTerminal: false,
                    browser: Browsers.macOS('Chrome'),
                    auth: authState,
                    markOnlineOnConnect: false,
                    syncFullHistory: false,
                    getMessage: async () => undefined,
                });

                tempSock.ev.on('creds.update', saveCreds);

                let codeReceived = false;
                let pairingDone  = false;

                const pairTimeout = setTimeout(() => {
                    if (!pairingDone) {
                        try { tempSock.end(); } catch {}
                        update('❌ انتهى وقت الانتظار.\n\n🔙 *رجوع*');
                        state = 'SUBS';
                    }
                }, 70_000);

                tempSock.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {
                    if (qr && !codeReceived) {
                        try {
                            let code = await tempSock.requestPairingCode(phone);
                            code = code.match(/.{1,4}/g)?.join('-') || code;
                            codeReceived = true;
                            await update(
`✅ *كود ربط البوت [ ${tmp.subName} ]*

\`${code}\`

📱 *كيفية الاستخدام:*
واتساب ← إعدادات ← الاجهزة المرتبطة
← ربط جهاز ← ربط برمز بدلاً من ذلك

⏱️ الكود صالح *60 ثانية*
🔙 *رجوع*`
                            );
                        } catch (e) {
                            await update(`❌ فشل توليد الكود: ${e?.message}\n\n🔙 *رجوع*`);
                            clearTimeout(pairTimeout);
                            try { tempSock.end(); } catch {}
                            state = 'SUBS';
                        }
                    }

                    if (connection === 'open' && !pairingDone) {
                        pairingDone = true;
                        clearTimeout(pairTimeout);
                        const jid = normalizeJid(tempSock.user?.id || phone).split('@')[0];
                        try { tempSock.end(); } catch {}
                        process.send?.({ type: 'spawn_sub', name: tmp.subName });
                        react(sock, m, '✅');
                        await update(`🎉 *تم ربط [ ${tmp.subName} ] بنجاح!*\n\n📱 الرقم: +${jid}\n🤖 البوت يعمل الان.\n\n🔙 *رجوع*`);
                        await sleep(2000); await showSubMenu(); state = 'SUBS';
                    }

                    if (connection === 'close' && !pairingDone) {
                        const code = lastDisconnect?.error?.output?.statusCode;
                        if (code === 401 || code === 403) {
                            await update('❌ انتهت صلاحية الكود.\n\n🔙 *رجوع*');
                        } else {
                            await update('❌ انقطع الاتصال — حاول مجدداً.\n\n🔙 *رجوع*');
                        }
                        clearTimeout(pairTimeout);
                        try { tempSock.end(); } catch {}
                        state = 'SUBS';
                    }
                });

            } catch (e) {
                await update(`❌ خطا تقني: ${e?.message}\n\n🔙 *رجوع*`);
                state = 'SUBS';
            }
            return;
        }

        if (state === 'SUBS_BROADCAST') {
            if (text === 'رجوع') { await showSubMenu(); state = 'SUBS'; return; }
            react(sock, m, '⏳');
            try {
                const conns = (global.conns || []).filter(c => c?.user?.id);
                if (!conns.length) return update('❌ لا يوجد بوتات متصلة.\n\n🔙 *رجوع*');
                let sent = 0;
                for (const c of conns) {
                    try {
                        await c.sendMessage(normalizeJid(c.user.id), { text });
                        sent++;
                    } catch {}
                    await sleep(1000);
                }
                react(sock, m, '✅');
                await update(`✅ تم الإرسال لـ ${sent} بوت.\n\n🔙 *رجوع*`);
            } catch (e) { await update(`❌ ${e?.message}`); }
            await sleep(1000); await showSubMenu(); state = 'SUBS'; return;
        }

        // ════════════════════════════════════════════════════
        // STATS
        // ════════════════════════════════════════════════════
        if (state === 'STATS') {
            if (text === 'رجوع') { await update(MAIN_MENU); state = 'MAIN'; return; }
            if (text === 'مسح') {
                writeStats({ commands: {}, users: {}, total: 0 });
                await update('✅ تم مسح الإحصاءات.'); await sleep(800); await showStats(); return;
            }
            return;
        }

        // ════════════════════════════════════════════════════
        // PROT
        // ════════════════════════════════════════════════════
        if (state === 'PROT') {
            if (text === 'رجوع') { await update(MAIN_MENU); state = 'MAIN'; return; }
            const protMap = {
                'انتي كراش':   'antiCrash',
                'انتي لينكات': 'antiLink',
                'انتي حذف':    'antiDelete',
                'انتي سب':     'antiInsult',
                'view once':    'antiViewOnce',
                'انتي خاص':    'antiPrivate',
            };
            for (const [label, key] of Object.entries(protMap)) {
                if (text === label) {
                    const p  = readProt();
                    p[key]   = p[key] === 'on' ? 'off' : 'on';
                    writeProt(p);
                    await update(`${p[key]==='on'?'✅':'⛔'} \`${p[key]==='on'?'تفعيل':'تعطيل'} [ ${label} ]\``);
                    await sleep(800); await showProtMenu(); return;
                }
            }
            return;
        }

        // ════════════════════════════════════════════════════
        // CMDTOOLS
        // ════════════════════════════════════════════════════
        if (state === 'CMDTOOLS') {
            if (text === 'رجوع') { await update(MAIN_MENU); state = 'MAIN'; return; }
            if (text === 'تغيير اسم')   { await update('✏️ اكتب اسم الامر الحالي:\n\n🔙 *رجوع*'); state = 'RENAME_WAIT'; return; }
            if (text === 'فاحص الكود')  { await update('🔍 اكتب اسم الامر للفحص:\n\n🔙 *رجوع*'); state = 'CODE_CHECK_WAIT'; return; }
            if (text === 'مسح كاش') {
                react(sock, m, '⏳');
                try {
                    if (global._pluginsCache) global._pluginsCache = {};
                    if (global._handlers)     global._handlers     = {};
                    if (global.featureHandlers) {
                        global.featureHandlers = global.featureHandlers.filter(h =>
                            ['protection_system','stats_system','antiDelete_system'].includes(h._src));
                    }
                    await loadPlugins().catch(() => {});
                    react(sock, m, '✅');
                    await update('✅ تم مسح الكاش وإعادة التحميل.');
                } catch (e) { react(sock, m, '❌'); await update(`❌ ${e?.message}`); }
                await sleep(800); await showCmdTools(); return;
            }
            return;
        }

        if (state === 'RENAME_WAIT') {
            if (text === 'رجوع') { await showCmdTools(); state = 'CMDTOOLS'; return; }
            const fp = await findPluginByCmd(text);
            if (!fp) return update(`❌ ما وجدت الامر: ${text}`);
            tmp.targetFile = fp; tmp.targetCmd = text;
            await update(`✅ الامر [ ${text} ] — اكتب الاسم الجديد:\n\n🔙 *رجوع*`);
            state = 'RENAME_NEW'; return;
        }

        if (state === 'RENAME_NEW') {
            if (text === 'رجوع') { await showCmdTools(); state = 'CMDTOOLS'; return; }
            const pfx = global._botConfig?.prefix || '.';
            const newCmd = text.trim();
            try { updatePluginField(tmp.targetFile, 'command', newCmd); await loadPlugins().catch(()=>{}); } catch {}
            await update(`✅ \`${pfx}${tmp.targetCmd}\` ➔ \`${pfx}${newCmd}\``);
            await sleep(1200); await showCmdTools(); state = 'CMDTOOLS'; return;
        }

        if (state === 'CODE_CHECK_WAIT') {
            if (text === 'رجوع') { await showCmdTools(); state = 'CMDTOOLS'; return; }
            const fp = await findPluginByCmd(text);
            if (!fp) return update(`❌ ما وجدت الامر: ${text}`);
            react(sock, m, '⏳');
            const lintIssues = quickLint(fp);
            const checkRes   = await checkPluginSyntax(fp);
            let report = `✧━── ❝ 𝐂𝐇𝐄𝐂𝐊 ❞ ──━✧\n\n*فحص [ ${text} ] 🔍*\n📁 \`${path.basename(fp)}\`\n\n`;
            if (checkRes.ok && !lintIssues.length) {
                report += '✅ *الكود سليم*\n';
            } else {
                if (!checkRes.ok) {
                    report += `❌ *خطا Syntax:*\n`;
                    if (checkRes.line)     report += `السطر: *${checkRes.line}*\n`;
                    if (checkRes.codeLine) report += `\`${checkRes.codeLine}\`\n`;
                    report += `\`${(checkRes.error||'').split('\n').slice(0,2).join(' ').slice(0,180)}\`\n\n`;
                }
                if (lintIssues.length) {
                    report += `⚠️ *تحذيرات:*\n`;
                    lintIssues.forEach(i => { report += `✦ ${i}\n`; });
                }
            }
            report += '\n*نسخ* للنسخ الاحتياطي | *استعادة* إن وُجدت\n🔙 *رجوع*\n\n✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧';
            tmp.checkFile = fp; tmp.checkCmd = text;
            await update(report); state = 'CODE_CHECK_RESULT'; return;
        }

        if (state === 'CODE_CHECK_RESULT') {
            if (text === 'رجوع') { await showCmdTools(); state = 'CMDTOOLS'; return; }
            if (text === 'نسخ') {
                const bak = tmp.checkFile + '.bak';
                try { fs.copyFileSync(tmp.checkFile, bak); react(sock, m, '💾'); await update(`💾 نسخة احتياطية:\n\`${path.basename(bak)}\`\n\n🔙 *رجوع*`); }
                catch (e) { await update(`❌ ${e?.message}`); }
                return;
            }
            if (text === 'استعادة') {
                const bak = tmp.checkFile + '.bak';
                if (!fs.existsSync(bak)) return update('❌ لا توجد نسخة احتياطية.\n\n🔙 *رجوع*');
                try { fs.copyFileSync(bak, tmp.checkFile); fs.removeSync(bak); await loadPlugins().catch(()=>{}); react(sock, m, '↩️'); await update('↩️ تم استعادة النسخة الاصلية.'); }
                catch (e) { await update(`❌ ${e?.message}`); }
                await sleep(800); await showCmdTools(); state = 'CMDTOOLS'; return;
            }
            return;
        }

        // ════════════════════════════════════════════════════
        // ADMIN — إدارة المجموعات
        // ════════════════════════════════════════════════════
        if (state === 'ADMIN') {
            if (text === 'رجوع') { await update(MAIN_MENU); state = 'MAIN'; return; }

            const memberActions = {
                'رفع مشرف':'promote','تنزيل مشرف':'demote',
                'طرد':'remove','حظر':'ban','الغاء حظر':'unban',
                'كتم':'mute','الغاء كتم':'unmute',
            };
            if (memberActions[text]) {
                tmp.adminAction = memberActions[text];
                const hint = text === 'كتم'
                    ? 'منشن العضو + الوقت بالدقائق (مثال: @رقم 30)'
                    : 'منشن العضو او الرد على رسالته';
                await update(`📌 \`${hint}\`\n\n🔙 *رجوع*`);
                state = 'ADMIN_TARGET'; return;
            }

            if (text === 'المشرفين') {
                const { meta, isGroup } = await getAdminPerms();
                if (!isGroup || !meta) return update('❌ مخصص للمجموعات فقط.');
                const admins = meta.participants.filter(p => p.admin);
                if (!admins.length) return update('لا يوجد مشرفين.');
                const list = admins.map((a,i) => `${i+1}. @${normalizeJid(a.id).split('@')[0]} ${a.admin==='superadmin'?'👑':''}`).join('\n');
                await sock.sendMessage(chatId, { text: `*المشرفون (${admins.length}) 👑:*\n\n${list}`, mentions: admins.map(a=>a.id) }, { quoted: m });
                return;
            }

            if (text === 'رابط') {
                // ✅ FIX 9: try/catch اولاً ثم نشرح الخطا
                try {
                    const code = await sock.groupInviteCode(chatId);
                    await update(`🔗 https://chat.whatsapp.com/${code}`);
                } catch (e) {
                    const { isAdmin, isBotAdmin, isGroup } = await getAdminPerms();
                    if (!isGroup)    return update('❌ هذا الامر للمجموعات فقط.');
                    if (!isBotAdmin) return update('❌ البوت ليس مشرفا، رقه اولا.');
                    if (!isAdmin)    return update('❌ انت لست مشرفا.');
                    await update(`❌ ${e?.message}`);
                }
                return;
            }

            if (['تثبيت','الغاء التثبيت','قفل المحادثة','فتح المحادثة','مسح'].includes(text)) {
                const ctx = m.message?.extendedTextMessage?.contextInfo;
                if ((text === 'تثبيت' || text === 'مسح') && !ctx?.stanzaId)
                    return update('↩️ يجب الرد على الرسالة اولاً.');
                react(sock, m, '⏳');
                try {
                    if (text === 'تثبيت')          await sock.sendMessage(chatId, { pin: { type:1, time:604800 }, key: { ...m.key, id: ctx.stanzaId, participant: ctx.participant } });
                    if (text === 'الغاء التثبيت')   await sock.sendMessage(chatId, { pin: { type:2 } });
                    if (text === 'قفل المحادثة')    await sock.groupSettingUpdate(chatId, 'announcement');
                    if (text === 'فتح المحادثة')    await sock.groupSettingUpdate(chatId, 'not_announcement');
                    if (text === 'مسح')              await sock.sendMessage(chatId, { delete: { remoteJid: chatId, fromMe: false, id: ctx.stanzaId, participant: ctx.participant } });
                    react(sock, m, text === 'مسح' ? '🗑️' : text === 'قفل المحادثة' ? '🔒' : text === 'فتح المحادثة' ? '🔓' : '✅');
                } catch (e) {
                    const { isAdmin, isBotAdmin, isGroup } = await getAdminPerms();
                    if (!isGroup)    { react(sock, m, '❌'); return update('❌ هذا الامر للمجموعات فقط.'); }
                    if (!isBotAdmin) { react(sock, m, '❌'); return update('❌ البوت ليس مشرفا، رقه اولا.'); }
                    if (!isAdmin)    { react(sock, m, '❌'); return update('❌ انت لست مشرفا.'); }
                    react(sock, m, '❌'); await update(`❌ ${e?.message}`);
                }
                return;
            }

            if (text === 'وضع اسم')   { await update('✍️ اكتب الاسم الجديد:\n\n🔙 *رجوع*');  state = 'ADMIN_SETNAME';    return; }
            if (text === 'وضع وصف')   { await update('✍️ اكتب الوصف الجديد:\n\n🔙 *رجوع*');  state = 'ADMIN_SETDESC';    return; }
            if (text === 'وضع صورة')  { await update('🖼️ ارسل او اقتبس صورة:\n\n🔙 *رجوع*'); state = 'ADMIN_SETIMG';     return; }
            if (text === 'وضع ترحيب') { await update('✍️ اكتب رسالة الترحيب ({name} = اسم العضو):\n\n🔙 *رجوع*'); state = 'ADMIN_SETWELCOME'; return; }
            if (text === 'وضع قوانين'){ await update('✍️ اكتب قوانين المجموعة:\n\n🔙 *رجوع*'); state = 'ADMIN_SETRULES';  return; }

            if (text === 'ترحيب') {
                const wf = grpFile('welcome', chatId);
                if (!fs.existsSync(wf)) return update('📭 لا توجد رسالة ترحيب — استخدم *وضع ترحيب*.');
                const { text: wt } = readJSON(wf);
                await update(`*رسالة الترحيب 📋:*\n${wt}\n\n- اكتب *حذف* لإزالتها.\n🔙 *رجوع*`);
                state = 'ADMIN_WELCOME_VIEW'; return;
            }
            if (text === 'قوانين') {
                const rf = grpFile('rules', chatId);
                if (!fs.existsSync(rf)) return update('📭 لا توجد قوانين — استخدم *وضع قوانين*.');
                const { text: rt } = readJSON(rf);
                await update(`*القوانين 📜:*\n${rt}\n\n- اكتب *حذف* لإزالتها.\n🔙 *رجوع*`);
                state = 'ADMIN_RULES_VIEW'; return;
            }

            const LOCK_MAP = { 'قفل الروابط':'antiLink','قفل الصور':'images','قفل الفيديو':'videos','قفل البوتات':'bots' };
            if (LOCK_MAP[text]) {
                try {
                    const pf = grpFile('locks', chatId);
                    const p  = readJSON(pf, {}); const key = LOCK_MAP[text];
                    p[key] = p[key] === 'on' ? 'off' : 'on'; writeJSON(pf, p);
                    react(sock, m, p[key] === 'on' ? '✅' : '⛔');
                    await update(`${p[key]==='on'?'✅':'⛔'} ${text}: *${p[key]}*`);
                } catch (e) {
                    const { isAdmin, isBotAdmin, isGroup } = await getAdminPerms();
                    if (!isGroup)    return update('❌ هذا الامر للمجموعات فقط.');
                    if (!isBotAdmin) return update('❌ البوت ليس مشرفا، رقه اولا.');
                    if (!isAdmin)    return update('❌ انت لست مشرفا.');
                    await update(`❌ ${e?.message}`);
                }
                await sleep(800); await showAdminMenu(); return;
            }

            if (text === 'كلمات ممنوعة') { await showBadwords(); state = 'ADMIN_BADWORDS'; return; }
            if (text === 'انضم') { await update('🔗 ارسل رابط المجموعة:\n\n🔙 *رجوع*'); state = 'ADMIN_JOIN'; return; }
            if (text === 'خروج') { await update('⚠️ *تاكيد مغادرة هذه المجموعة؟*\naكتب *نعم* او *رجوع*'); state = 'ADMIN_LEAVE'; return; }

            if (text === 'الاوامر') {
                const plugins = getPlugins(), pfxC = global._botConfig?.prefix || '.';
                const lines   = Object.entries(plugins)
                    .filter(([k]) => !k.startsWith('_'))
                    .map(([k,v]) => `✦ ${pfxC}${k}${v.description?' — '+v.description:''}`)
                    .join('\n');
                let chunk = `✧━── ❝ 𝐂𝐌𝐃𝐒 ❞ ──━✧\n\n`, chunks = [];
                for (const line of lines.split('\n')) {
                    if ((chunk + line).length > 3500) { chunks.push(chunk); chunk = ''; }
                    chunk += line + '\n';
                }
                if (chunk) chunks.push(chunk);
                for (const c of chunks) await sock.sendMessage(chatId, { text: c }, { quoted: m });
                return;
            }

            if (text === 'بحث اوامر') { await update('🔍 اكتب اسم الامر:\n\n🔙 *رجوع*'); state = 'ADMIN_SRCHCMD'; return; }

            if (text === 'معلومات') {
                const plugins = getPlugins(), up = process.uptime();
                const h = Math.floor(up/3600), mm2 = Math.floor((up%3600)/60), ss2 = Math.floor(up%60);
                const ram = os.totalmem(), free = os.freemem();
                const ramU = ((ram-free)/1024/1024).toFixed(0), ramT = (ram/1024/1024).toFixed(0);
                let groups = 0;
                try { groups = Object.keys(await sock.groupFetchAllParticipating()).length; } catch {}
                const cfg = global._botConfig || {};
                await update(`✧━── ❝ 𝐈𝐍𝐅𝐎 ❞ ──━✧\n\n*معلومات النظام 🤖:*\n\n✦ *الاسم:* ${cfg.botName||'البوت'}\n✦ *الإصدار:* ${cfg.version||'1.0.0'}\n✦ *التشغيل:* ${h}h ${mm2}m ${ss2}s\n✦ *الذاكرة:* ${ramU}/${ramT} MB\n✦ *الاوامر:* ${Object.keys(plugins).length}\n✦ *المجموعات:* ${groups}\n\n🔙 *رجوع*\n\n✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
                return;
            }

            if (text === 'اذاعة') { await update('📢 اكتب رسالة الإذاعة:\n\n🔙 *رجوع*'); state = 'ADMIN_BROADCAST'; return; }

            if (text === 'تحديث') {
                react(sock, m, '⏳');
                try { await loadPlugins(); react(sock, m, '✅'); await update('✅ تم التحديث.'); }
                catch (e) { react(sock, m, '❌'); await update(`❌ ${e?.message}`); }
                return;
            }
            return;
        }

        // ── ADMIN_TARGET ──────────────────────────────────────
        if (state === 'ADMIN_TARGET') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }

            const ctx    = m.message?.extendedTextMessage?.contextInfo;
            const target = ctx?.mentionedJid?.[0] || ctx?.participant || null;
            if (!target) return update('❌ منشن العضو او الرد على رسالته.');

            react(sock, m, '⏳');
            const action = tmp.adminAction;

            // ✅ FIX 9: try/catch اولاً ثم نشرح الخطا
            const tryAction = async (fn, successEmoji) => {
                try { await fn(); react(sock, m, successEmoji); }
                catch (e) {
                    const { isAdmin, isBotAdmin, isGroup } = await getAdminPerms();
                    if (!isGroup)    { react(sock, m, '❌'); await update('❌ للمجموعات فقط.'); return; }
                    if (!isBotAdmin) { react(sock, m, '❌'); await update('❌ البوت ليس مشرفا.'); return; }
                    if (!isAdmin)    { react(sock, m, '❌'); await update('❌ انت لست مشرفا.'); return; }
                    react(sock, m, '❌'); await update(`❌ فشل: ${e?.message}`);
                }
            };

            if (action === 'promote') await tryAction(() => sock.groupParticipantsUpdate(chatId, [target], 'promote'), '👑');
            else if (action === 'demote') await tryAction(() => sock.groupParticipantsUpdate(chatId, [target], 'demote'), '⬇️');
            else if (action === 'remove') await tryAction(() => sock.groupParticipantsUpdate(chatId, [target], 'remove'), '🚪');
            else if (action === 'ban') {
                await tryAction(async () => {
                    await sock.groupParticipantsUpdate(chatId, [target], 'remove');
                    const bans = readJSON(grpFile('bans', chatId), []);
                    if (!bans.includes(target)) bans.push(target);
                    writeJSON(grpFile('bans', chatId), bans);
                }, '🔨');
            }
            else if (action === 'unban') {
                await tryAction(() => {
                    const bans = readJSON(grpFile('bans', chatId), []);
                    writeJSON(grpFile('bans', chatId), bans.filter(b => b !== target));
                }, '✅');
            }
            else if (action === 'mute') {
                const mins = parseInt((text.match(/\d+/) || ['30'])[0]);
                await tryAction(async () => {
                    await sock.groupParticipantsUpdate(chatId, [target], 'demote');
                    await sock.sendMessage(chatId, { text: `🔇 تم كتم @${normalizeJid(target).split('@')[0]} لمدة ${mins} دقيقة`, mentions: [target] });
                    setTimeout(async () => {
                        try { await sock.groupParticipantsUpdate(chatId, [target], 'promote'); } catch {}
                    }, mins * 60_000);
                }, '🔇');
            }
            else if (action === 'unmute') await tryAction(() => sock.groupParticipantsUpdate(chatId, [target], 'promote'), '🔊');

            await sleep(600); await showAdminMenu(); state = 'ADMIN'; return;
        }

        if (state === 'ADMIN_SETNAME') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
            react(sock, m, '⏳');
            try {
                await sock.groupUpdateSubject(chatId, text);
                react(sock, m, '✅');
            } catch (e) {
                const { isAdmin, isBotAdmin, isGroup } = await getAdminPerms();
                if (!isGroup)    return update('❌ للمجموعات فقط.');
                if (!isBotAdmin) return update('❌ البوت ليس مشرفا، رقه اولا.');
                if (!isAdmin)    return update('❌ انت لست مشرفا.');
                await update(`❌ ${e?.message}`);
            }
            await sleep(800); await showAdminMenu(); state = 'ADMIN'; return;
        }

        if (state === 'ADMIN_SETDESC') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
            react(sock, m, '⏳');
            try {
                await sock.groupUpdateDescription(chatId, text);
                react(sock, m, '✅');
            } catch (e) {
                const { isAdmin, isBotAdmin, isGroup } = await getAdminPerms();
                if (!isGroup)    return update('❌ للمجموعات فقط.');
                if (!isBotAdmin) return update('❌ البوت ليس مشرفا، رقه اولا.');
                if (!isAdmin)    return update('❌ انت لست مشرفا.');
                await update(`❌ ${e?.message}`);
            }
            await sleep(800); await showAdminMenu(); state = 'ADMIN'; return;
        }

        if (state === 'ADMIN_SETIMG') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
            const ctx    = m.message?.extendedTextMessage?.contextInfo;
            const target2= ctx?.quotedMessage
                ? { message: ctx.quotedMessage, key: { ...m.key, id: ctx.stanzaId, participant: ctx.participant } }
                : m;
            if (!target2.message?.imageMessage) return update('🖼️ ارسل او اقتبس صورة.');
            react(sock, m, '⏳');
            try {
                const buf = await downloadMediaMessage(target2, 'buffer', {});
                await sock.updateProfilePicture(chatId, buf);
                react(sock, m, '✅');
            } catch (e) {
                const { isAdmin, isBotAdmin, isGroup } = await getAdminPerms();
                if (!isGroup)    return update('❌ للمجموعات فقط.');
                if (!isBotAdmin) return update('❌ البوت ليس مشرفا، رقه اولا.');
                if (!isAdmin)    return update('❌ انت لست مشرفا.');
                await update(`❌ ${e?.message}`);
            }
            await sleep(800); await showAdminMenu(); state = 'ADMIN'; return;
        }

        if (state === 'ADMIN_SETWELCOME') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
            try { writeJSON(grpFile('welcome', chatId), { text }); react(sock, m, '✅'); await update(`✅ رسالة الترحيب:\n${text}`); }
            catch (e) { await update(`❌ ${e?.message}`); }
            await sleep(800); await showAdminMenu(); state = 'ADMIN'; return;
        }

        if (state === 'ADMIN_SETRULES') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
            try { writeJSON(grpFile('rules', chatId), { text }); react(sock, m, '✅'); }
            catch (e) { await update(`❌ ${e?.message}`); }
            await sleep(800); await showAdminMenu(); state = 'ADMIN'; return;
        }

        if (state === 'ADMIN_WELCOME_VIEW') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
            if (text === 'حذف') { try { fs.removeSync(grpFile('welcome', chatId)); react(sock, m, '🗑️'); } catch {} await sleep(400); await showAdminMenu(); state = 'ADMIN'; }
            return;
        }

        if (state === 'ADMIN_RULES_VIEW') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
            if (text === 'حذف') { try { fs.removeSync(grpFile('rules', chatId)); react(sock, m, '🗑️'); } catch {} await sleep(400); await showAdminMenu(); state = 'ADMIN'; }
            return;
        }

        if (state === 'ADMIN_BADWORDS') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
            const bf = grpFile('badwords', chatId);
            let words = readJSON(bf, []);
            if (text.startsWith('اضافة ')) {
                const w = text.slice(6).trim().toLowerCase();
                if (w) { words.push(w); writeJSON(bf, words); react(sock, m, '✅'); }
                await sleep(400); await showBadwords(); return;
            }
            if (text.startsWith('حذف ')) {
                const w = text.slice(4).trim().toLowerCase();
                writeJSON(bf, words.filter(x => x !== w)); react(sock, m, '🗑️');
                await sleep(400); await showBadwords(); return;
            }
            return;
        }

        if (state === 'ADMIN_BROADCAST') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
            react(sock, m, '⏳');
            try {
                const chats = await sock.groupFetchAllParticipating();
                let sent = 0;
                for (const gid of Object.keys(chats)) {
                    try { await sock.sendMessage(gid, { text }); sent++; } catch {}
                    await sleep(500);
                }
                react(sock, m, '✅'); await update(`✅ تم الإرسال لـ ${sent} مجموعة.`);
            } catch (e) { await update(`❌ ${e?.message}`); }
            await sleep(1000); await showAdminMenu(); state = 'ADMIN'; return;
        }

        if (state === 'ADMIN_SRCHCMD') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
            const plugins = getPlugins(), pfxC = global._botConfig?.prefix || '.';
            const res = Object.entries(plugins)
                .filter(([k,v]) => k.includes(text) || (v.description||'').includes(text))
                .map(([k,v]) => `✦ ${pfxC}${k}${v.description?' — '+v.description:''}`)
                .join('\n');
            await update(res || `❌ لا نتائج لـ "${text}"\n\n🔙 *رجوع*`);
            return;
        }

        if (state === 'ADMIN_JOIN') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
            const match = text.match(/chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/i);
            if (!match) return update('❌ رابط غير صحيح.\n\n🔙 *رجوع*');
            react(sock, m, '⏳');
            try {
                await sock.groupAcceptInvite(match[1]);
                react(sock, m, '✅'); await update('✅ تم الانضمام للمجموعة.');
            } catch (e) {
                react(sock, m, '❌'); await update(`❌ ${e?.message}`);
            }
            await sleep(800); await showAdminMenu(); state = 'ADMIN'; return;
        }

        if (state === 'ADMIN_LEAVE') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
            if (text === 'نعم') {
                try { await sock.groupLeave(chatId); }
                catch (e) { await update(`❌ ${e?.message}`); }
            }
            state = 'ADMIN'; return;
        }

    }; // نهاية listener

    // ════════════════════════════════════════════════════════
    // دوال عرض القوائم — اسلوب settings.js بالضبط
    // ════════════════════════════════════════════════════════
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

🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`
        );
    }

    async function showPluginsMenu() {
        const count = getAllPluginFiles().length;
        await update(
`✧━── ❝ 𝐏𝐋𝐔𝐆𝐈𝐍𝐒 ❞ ──━✧

📦 الاوامر: *${count}*

✦ *عرض*
\`📋 كل الاوامر\`

✦ *بحث [اسم]*
\`🔍 تفاصيل امر\`

✦ *كود [اسم]*
\`💻 عرض الكود\`

✦ *اضافة امر*
\`➕ امر جديد\`

✦ *طفي الكل*
\`🔒 قفل الكل\`

✦ *شغل الكل*
\`🔓 فتح الكل\`

🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`
        );
    }

    async function showPluginDetail(fp, cmd) {
        const { elite, lock, group, prv } = getPluginInfo(fp);
        await update(
`✧━── ❝ 𝐏𝐋𝐔𝐆𝐈𝐍 ❞ ──━✧

*تفاصيل [ ${cmd} ] 📋:*

✦ نخبة: ${elite==='on'?'✅':'❌'}
✦ قفل:  ${lock==='on'?'✅':'❌'}
✦ مجموعات: ${group?'✅':'❌'}
✦ خاص: ${prv?'✅':'❌'}

*تعديل:*
\`تغيير الاسم | نخبة | عام\`
\`قفل | فتح\`
\`مجموعات | خاص | للجميع\`
\`كود\` — عرض الكود كاملاً

🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`
        );
    }

    async function showSubMenu() {
        const subs = readSubs();
        const list = subs.map(name => {
            const cp = path.join(ACCOUNTS_DIR, name, 'nova', 'data', 'creds.json');
            let jid  = '—';
            if (fs.existsSync(cp)) {
                try { jid = JSON.parse(fs.readFileSync(cp,'utf8')).me?.id?.split(':')[0] || '—'; } catch {}
            }
            return `✦ *${name}* +${jid}`;
        }).join('\n') || 'لا يوجد بوتات فرعية';

        await update(
`✧━── ❝ 𝐒𝐔𝐁𝐒 ❞ ──━✧

${list}

✦ *جديد* — إنشاء وربط بوت
✦ *حالة* — عرض الارقام
✦ *البوتات* — المتصلون الان
✦ *إيقاف [اسم]* — إيقاف مؤقت
✦ *ريستارت [اسم]* — إعادة تشغيل
✦ *توكن [اسم]* — توكن الجلسة
✦ *حذف [اسم]* — حذف نهائي
✦ *مسح جلسة [اسم]* — مسح ملفات الجلسة
✦ *اذاعة بوتات* — رسالة لكل البوتات

🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`
        );
    }

    async function showStats() {
        const s = readStats();
        const topCmds  = Object.entries(s.commands).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v],i)=>`${i+1}. ${k}: *${v}*`).join('\n') || 'لا يوجد';
        const topUsers = Object.entries(s.users).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v],i)=>`${i+1}. ${k}: *${v}*`).join('\n') || 'لا يوجد';
        const up = process.uptime();
        const h = Math.floor(up/3600), mm = Math.floor((up%3600)/60), ss = Math.floor(up%60);
        const ram = os.totalmem(), free = os.freemem();
        await update(
`✧━── ❝ 𝐒𝐓𝐀𝐓𝐒 ❞ ──━✧

📨 إجمالي الاوامر: *${s.total}*
⏱️ وقت التشغيل: *${h}h ${mm}m ${ss}s*
💾 الذاكرة: *${((ram-free)/1024/1024/1024).toFixed(1)}/${(ram/1024/1024/1024).toFixed(1)} GB*

🏆 *اكثر الاوامر:*
${topCmds}

👤 *اكثر المستخدمين:*
${topUsers}

\`مسح\` لتصفير
🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`
        );
    }

    async function showProtMenu() {
        const p = readProt();
        const s = k => p[k]==='on' ? '✅' : '⛔';
        await update(
`✧━── ❝ 𝐏𝐑𝐎𝐓𝐄𝐂𝐓𝐈𝐎𝐍 ❞ ──━✧

✦ *انتي كراش* ${s('antiCrash')}
\`💥 حماية من رسائل التجميد\`

✦ *انتي لينكات* ${s('antiLink')}
\`🔗 منع الروابط بالمجموعات\`

✦ *انتي حذف* ${s('antiDelete')}
\`🗑️ إظهار الرسائل المحذوفة\`

✦ *انتي سب* ${s('antiInsult')}
\`🤬 حذف الكلمات البذيئة\`

✦ *view once* ${s('antiViewOnce')}
\`👁️ كشف وسائط المشاهدة لمرة\`

✦ *انتي خاص* ${s('antiPrivate')}
\`🚫 حظر اي شخص يراسل في الخاص\`

\`اكتب اسم الميزة لتشغيلها/إيقافها\`
🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`
        );
    }

    async function showCmdTools() {
        await update(
`✧━── ❝ 𝐂𝐌𝐃 𝐓𝐎𝐎𝐋𝐒 ❞ ──━✧

✦ *تغيير اسم*
\`✏️ تغيير اسم امر\`

✦ *فاحص الكود*
\`🔍 فحص syntax البلاجن\`

✦ *مسح كاش*
\`🗑️ مسح الكاش وإعادة التحميل\`

🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`
        );
    }

    async function showAdminMenu() {
        await update(
`✧━── ❝ 𝐀𝐃𝐌𝐈𝐍 ❞ ──━✧

*👥 الاعضاء:*
\`رفع مشرف | تنزيل مشرف | المشرفين\`
\`طرد | حظر | الغاء حظر | كتم | الغاء كتم\`

*⚙️ المجموعة:*
\`وضع اسم | وضع وصف | وضع صورة\`
\`قفل المحادثة | فتح المحادثة\`
\`تثبيت | الغاء التثبيت | مسح | رابط\`
\`انضم\` — الانضمام برابط
\`خروج\` — مغادرة المجموعة

*📋 محتوى:*
\`وضع ترحيب | ترحيب\`
\`وضع قوانين | قوانين\`
\`كلمات ممنوعة\`

*🔒 قفل المحتوى:*
\`قفل الروابط | قفل الصور\`
\`قفل الفيديو | قفل البوتات\`

*🤖 بوت:*
\`الاوامر | بحث اوامر | معلومات\`
\`اذاعة | تحديث\`

🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`
        );
    }

    async function showBadwords() {
        const bf    = grpFile('badwords', chatId);
        const words = readJSON(bf, []);
        const list  = words.length ? words.map((w,i) => `${i+1}. ${w}`).join('\n') : 'لا يوجد كلمات';
        await update(
`✧━── ❝ 𝐁𝐀𝐃𝐖𝐎𝐑𝐃𝐒 ❞ ──━✧

*الكلمات الممنوعة 🚫:*

${list}

\`اضافة [الكلمة]\`
\`حذف [الكلمة]\`
🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`
        );
    }

    sock.ev.on('messages.upsert', listener);
    const timeout = setTimeout(() => {
        sock.ev.off('messages.upsert', listener);
        activeSessions.delete(chatId);
    }, 300_000);

    activeSessions.set(chatId, { listener, timeout });
}

export default { NovaUltra, execute };
