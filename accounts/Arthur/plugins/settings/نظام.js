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
import { fileURLToPath } from 'url';
import { exec }      from 'child_process';
import { promisify } from 'util';
import { loadPlugins, getPlugins } from '../../handlers/plugins.js';
import {
    downloadMediaMessage,
    downloadContentFromMessage,
    jidDecode,
    generateMessageID,
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
    'تغيير الاسم':  '✏️', 'كود':          '💻',
};

const reactInput = (sock, m, text) => {
    const key = Object.keys(INPUT_REACT_MAP).find(k => text.trim() === k);
    if (key) return sock.sendMessage(m.key.remoteJid, { react: { text: INPUT_REACT_MAP[key], key: m.key } }).catch(() => {});
};

// normalizeJid — مطابق تماماً لـ messages.js
const normalizeJid = jid =>
    jid ? jid.split('@')[0].split(':')[0] : '';

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

const readStats  = () => readJSON(STATS_FILE, { commands:{}, users:{}, total:0 });
const writeStats = d  => writeJSON(STATS_FILE, d);

const grpFile = (prefix, chatId) =>
    path.join(DATA_DIR, prefix + '_' + chatId.replace(/[^\w]/g, '_') + '.json');

// ══════════════════════════════════════════════════════════════
//  plugin utils
// ══════════════════════════════════════════════════════════════
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

function getPluginInfo(filePath) {
    const code = fs.readFileSync(filePath, 'utf8');
    let cmd;
    const arr = code.match(/command:\s*\[([^\]]+)\]/);
    if (arr) {
        const cmds = arr[1].match(/['"`]([^'"`]+)['"`]/g);
        cmd = cmds ? cmds[0].replace(/['"`]/g, '') : path.basename(filePath, '.js');
    } else {
        cmd = code.match(/command:\s*['"`]([^'"`]+)['"`]/)?.[1] || path.basename(filePath, '.js');
    }
    return {
        cmd,
        elite: code.match(/elite:\s*['"`](on|off)['"`]/i)?.[1]  || 'off',
        lock:  code.match(/lock:\s*['"`](on|off)['"`]/i)?.[1]   || 'off',
        group: (code.match(/group:\s*(true|false)/i)?.[1]        || 'false') === 'true',
        prv:   (code.match(/prv:\s*(true|false)/i)?.[1]          || 'false') === 'true',
        filePath,
    };
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

async function findPluginByCmd(cmdName) {
    for (const f of getAllPluginFiles()) {
        try {
            const code = fs.readFileSync(f, 'utf8');
            if (new RegExp(`command:\\s*['"\`]${cmdName}['"\`]`, 'i').test(code)) return f;
            if (new RegExp(`command:\\s*\\[[^\\]]*['"\`]${cmdName}['"\`]`, 'i').test(code)) return f;
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
    try {
        await execAsync(`node --input-type=module --check < "${filePath}"`);
        return { ok: true };
    } catch (e) {
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
            for (const jid of participants) {
                const num  = normalizeJid(jid);
                const text = wt.replace(/\{name\}/g, `@${num}`).replace(/\{number\}/g, num);
                await sock.sendMessage(id, { text, mentions: [jid] });
                await sleep(600);
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

async function isGroupAdmin(sock, chatId, rawParticipant) {
    try {
        const meta      = await sock.groupMetadata(chatId);
        const senderNum = normalizeJid(rawParticipant);
        return meta.participants
            .filter(p => p.admin)
            .some(p =>
                normalizeJid(p.id) === senderNum ||
                normalizeJid(p.lid || '') === senderNum
            );
    } catch { return false; }
}

async function isBotGroupAdmin(sock, chatId) {
    try {
        const meta   = await sock.groupMetadata(chatId);
        const botNum = normalizeJid(getBotJid(sock));
        return meta.participants
            .filter(p => p.admin)
            .some(p => normalizeJid(p.id) === botNum || normalizeJid(p.lid || '') === botNum);
    } catch { return false; }
}

// cooldown لـ antiPrivate — يمنع تكرار الرسائل
const _pvtCooldown = new Map();

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
        if (prot.antiCrash === 'on') {
            for (const p of CRASH_PATTERNS) {
                if (p.test(text)) {
                    try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}
                    return;
                }
            }
        }

        // ── ✅ FIX-3: antiLink — يشمل جميع أنواع الرسائل ──
        if (prot.antiLink === 'on' && isGroup && hasLink(text)) {
            if (!msg.key.fromMe) {
                const senderRaw = msg.key.participant || '';
                const isAdmin   = await isGroupAdmin(sock, chatId, senderRaw);
                const isBotAdm  = await isBotGroupAdmin(sock, chatId);

                if (!isAdmin && isBotAdm) {
                    // حذف الرسالة فوراً
                    try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}

                    // نظام التحذيرات
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
            if (INSULT_WORDS.some(w => text.toLowerCase().includes(w))) {
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

        // ── antiViewOnce ──
        if (prot.antiViewOnce === 'on') {
            const vMsg =
                msg.message?.viewOnceMessage?.message ||
                msg.message?.viewOnceMessageV2?.message ||
                msg.message?.viewOnceMessageV2Extension?.message ||
                msg.message?.ephemeralMessage?.message?.viewOnceMessage?.message;

            if (vMsg) {
                const mtype = Object.keys(vMsg).find(k =>
                    ['imageMessage', 'videoMessage'].includes(k)
                );
                if (mtype) {
                    try {
                        const stream = await downloadContentFromMessage(
                            vMsg[mtype],
                            mtype.replace('Message', '')
                        );
                        let buf = Buffer.alloc(0);
                        for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
                        const sender = msg.key.participant || msg.key.remoteJid;
                        await sock.sendMessage(chatId, {
                            [mtype.replace('Message', '')]: buf,
                            caption: (vMsg[mtype]?.caption ? vMsg[mtype].caption + '\n\n' : '') +
                                     `👁️ *كُشفت بواسطة مضاد المشاهدة*\n` +
                                     `👤 @${normalizeJid(sender)}`,
                            mentions: [sender],
                        });
                    } catch (e) { console.error('[antiViewOnce]', e.message); }
                }
            }
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
        const cmd    = text.slice(pfx.length).split(/\s+/)[0]?.toLowerCase();
        const sender = msg.key.participant || msg.key.remoteJid;
        if (!cmd || !sender) return;
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
// ══════════════════════════════════════════════════════════════
const SLASH = '/';
const _SLASH_MEMBER = {
    'رفع':'promote', 'تنزيل مشرف':'demote',
    'طرد':'remove',  'حظر':'ban',
};
const _SLASH_PROT = {
    'انتي كراش':'antiCrash', 'انتي لينكات':'antiLink',
    'انتي حذف':'antiDelete', 'انتي سب':'antiInsult',
    'view once':'antiViewOnce', 'انتي خاص':'antiPrivate',
};

async function slashCommandHandler(sock, msg) {
    try {
        const raw  = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const text = raw.trim();
        if (!text.startsWith(SLASH)) return;

        const chatId = msg.key.remoteJid;

        // فحص النخبة بـ sock.isElite (نفس طريقة messages.js)
        try {
            const senderRaw = msg.key.participant || chatId;
            const isElite   = msg.key.fromMe || await sock.isElite?.({ sock, id: senderRaw });
            if (!isElite) return;
        } catch { return; }

        const body    = text.slice(SLASH.length).trim();
        const spIdx   = body.indexOf(' ');
        const cmd     = spIdx === -1 ? body : body.slice(0, spIdx);
        const rest    = spIdx === -1 ? '' : body.slice(spIdx + 1).trim();
        const twoWord = body.split(/\s+/).slice(0, 2).join(' ');
        const isGroup = chatId.endsWith('@g.us');

        const reply = t => sock.sendMessage(chatId, { text: t }, { quoted: msg }).catch(() => {});

        const getPerms = async () => {
            if (!isGroup) return { isGroup: false, isAdmin: false, isBotAdmin: false };
            try {
                const meta      = await sock.groupMetadata(chatId);
                const senderRaw = msg.key.participant || '';
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
            } catch { return { isGroup: true, isAdmin: false, isBotAdmin: false }; }
        };

        const tryDo = async (fn, emoji = '✅') => {
            try { await fn(); react(sock, msg, emoji); return true; } catch (e) {
                const { isGroup: ig, isAdmin, isBotAdmin } = await getPerms();
                if (!ig)        return reply('❌ هذا الامر للمجموعات فقط.'),  false;
                if (!isBotAdmin) return reply('❌ البوت ليس مشرفاً.'),         false;
                if (!isAdmin)   return reply('❌ انت لست مشرفاً.'),            false;
                return reply(`❌ فشل: ${e?.message || e}`), false;
            }
        };

        // /مسح
        if (cmd === 'مسح') {
            const ctx = msg.message?.extendedTextMessage?.contextInfo;
            if (!ctx?.stanzaId) return reply('↩️ رد على الرسالة اللي تبي تمسحها.');
            await tryDo(() => sock.sendMessage(chatId, { delete: {
                remoteJid: chatId, id: ctx.stanzaId,
                participant: ctx.participant, fromMe: false,
            }}), '🗑️');
            return;
        }

        // /تثبيت
        if (cmd === 'تثبيت') {
            const ctx = msg.message?.extendedTextMessage?.contextInfo;
            if (!ctx?.stanzaId) return reply('↩️ رد على الرسالة اللي تبي تثبتها.');
            await tryDo(() => sock.groupMessagePin(chatId,
                { id: ctx.stanzaId, participant: ctx.participant, remoteJid: chatId }, 1, 86400), '📌');
            return;
        }

        // /الغاء تثبيت
        if (twoWord === 'الغاء تثبيت') {
            const ctx = msg.message?.extendedTextMessage?.contextInfo;
            if (!ctx?.stanzaId) return reply('↩️ رد على الرسالة المثبتة.');
            await tryDo(() => sock.groupMessagePin(chatId,
                { id: ctx.stanzaId, participant: ctx.participant, remoteJid: chatId }, 0), '📌');
            return;
        }

        // /رفع  /طرد  /حظر  /تنزيل مشرف
        const memberAction = _SLASH_MEMBER[cmd] || _SLASH_MEMBER[twoWord];
        if (memberAction) {
            const target = await resolveTarget(sock, chatId, msg);
            if (!target) return reply('↩️ منشن العضو او رد على رسالته.');
            if (memberAction === 'ban') {
                await tryDo(async () => {
                    await sock.groupParticipantsUpdate(chatId, [target], 'remove');
                    const bans = readJSON(grpFile('bans', chatId), []);
                    if (!bans.includes(target)) { bans.push(target); writeJSON(grpFile('bans', chatId), bans); }
                }, '🔨');
            } else {
                await tryDo(() => sock.groupParticipantsUpdate(chatId, [target], memberAction),
                    { promote:'👑', demote:'⬇️', remove:'🚪' }[memberAction] || '✅');
            }
            return;
        }

        // /الغاء حظر
        if (twoWord === 'الغاء حظر') {
            const target = await resolveTarget(sock, chatId, msg);
            if (!target) return reply('↩️ منشن العضو.');
            const bf = grpFile('bans', chatId);
            writeJSON(bf, readJSON(bf, []).filter(b => b !== target));
            react(sock, msg, '✅');
            return;
        }

        // /كتم [دقائق]
        if (cmd === 'كتم') {
            const target = await resolveTarget(sock, chatId, msg);
            if (!target) return reply('↩️ منشن العضو.');
            const mins = parseInt(rest) || 30;
            await tryDo(async () => {
                await sock.groupParticipantsUpdate(chatId, [target], 'demote');
                await sock.sendMessage(chatId, {
                    text: `🔇 تم كتم @${normalizeJid(target)} لمدة ${mins} دقيقة`,
                    mentions: [target],
                });
                setTimeout(async () => {
                    try { await sock.groupParticipantsUpdate(chatId, [target], 'promote'); } catch {}
                }, mins * 60_000);
            }, '🔇');
            return;
        }

        // /الغاء كتم
        if (twoWord === 'الغاء كتم') {
            const target = await resolveTarget(sock, chatId, msg);
            if (!target) return reply('↩️ منشن العضو.');
            await tryDo(() => sock.groupParticipantsUpdate(chatId, [target], 'promote'), '🔊');
            return;
        }

        // ✅ FIX-2: /تحميل — فيديو أكبر من 70MB يُرسَل مستنداً
        if (cmd === 'تحميل') {
            const audioMode = rest.startsWith('صوت');
            const urlRaw    = audioMode ? rest.slice(4).trim() : rest.trim();
            const url       = urlRaw.match(/https?:\/\/[^\s]+/i)?.[0] ||
                              (urlRaw.startsWith('http') ? urlRaw : null);
            if (!url) return reply('↩️ الاستخدام:\n`/تحميل [رابط]`\n`/تحميل صوت [رابط]`');
            const icon     = audioMode ? '🎵' : '🎬';
            const platform = detectPlatform(url) || 'رابط';
            react(sock, msg, '⏳');
            const stMsg = await sock.sendMessage(chatId, {
                text: `${icon} *جاري تحميل ${platform}...*\nقد يأخذ بضع ثوانٍ.`,
            }, { quoted: msg });
            const upd = t => sock.sendMessage(chatId, { text: t, edit: stMsg.key }).catch(() => {});
            try {
                const { filePath, ext, cleanup } = await ytdlpDownload(url, { audio: audioMode });
                const fileSize = fs.statSync(filePath).size;
                const isVideo  = ['mp4','mkv','webm','mov','avi'].includes(ext);
                const isAudio  = ['mp3','m4a','ogg','aac','opus','wav'].includes(ext);
                const isImage  = ['jpg','jpeg','png','webp','gif'].includes(ext);

                // حد أقصى مطلق 150MB
                if (fileSize > 150 * 1024 * 1024) {
                    cleanup();
                    return upd('❌ الملف أكبر من 150MB — غير قابل للإرسال.');
                }

                const buffer = fs.readFileSync(filePath); cleanup();

                // ✅ فيديو أكبر من 70MB → مستند بدل فيديو
                if (isVideo && fileSize > 70 * 1024 * 1024) {
                    await sock.sendMessage(chatId, {
                        document: buffer,
                        mimetype:  'video/mp4',
                        fileName:  `${platform}_video.mp4`,
                        caption:   `📎 ${platform} — تم الإرسال كمستند (حجم الفيديو كبير)`,
                    }, { quoted: msg });
                } else if (isVideo) {
                    await sock.sendMessage(chatId, { video: buffer, caption: `${icon} ${platform}` }, { quoted: msg });
                } else if (isAudio) {
                    await sock.sendMessage(chatId, { audio: buffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                } else if (isImage) {
                    await sock.sendMessage(chatId, { image: buffer, caption: `${icon} ${platform}` }, { quoted: msg });
                } else {
                    await sock.sendMessage(chatId, {
                        document: buffer, mimetype: 'application/octet-stream',
                        fileName: path.basename(filePath), caption: `${icon} ${platform}`,
                    }, { quoted: msg });
                }
                react(sock, msg, '✅'); await upd(`✅ *تم التحميل!*`);
            } catch (e) {
                react(sock, msg, '❌');
                const em = e?.message || '';
                let hint = '';
                if (em.includes('غير مثبت') || em.includes('yt-dlp'))              hint = '\n💡 شغّل: `pip install -U yt-dlp`';
                else if (em.toLowerCase().includes('private') || em.includes('login')) hint = '\n⚠️ المحتوى خاص.';
                else if (em.includes('Unsupported URL') || em.includes('unable'))    hint = '\n⚠️ الرابط غير مدعوم.';
                else if (em.includes('filesize') || em.includes('large'))            hint = '\n⚠️ جرّب `/تحميل صوت`';
                await upd(`❌ *فشل التحميل*\n\`${em.slice(0, 150)}\`${hint}`);
            }
            return;
        }

        // /قفل  /فتح
        if (cmd === 'قفل') { await tryDo(() => sock.groupSettingUpdate(chatId, 'announcement'), '🔒'); return; }
        if (cmd === 'فتح') { await tryDo(() => sock.groupSettingUpdate(chatId, 'not_announcement'), '🔓'); return; }

        // /رابط
        if (cmd === 'رابط') {
            try { const code = await sock.groupInviteCode(chatId); await reply(`🔗 *رابط المجموعة:*\nhttps://chat.whatsapp.com/${code}`); }
            catch (e) { await reply(`❌ ${e?.message}`); }
            return;
        }

        // /تحديث
        if (cmd === 'تحديث') {
            react(sock, msg, '⏳');
            try { await loadPlugins(); react(sock, msg, '✅'); await reply('✅ تم تحديث الاوامر.'); }
            catch (e) { react(sock, msg, '❌'); await reply(`❌ ${e?.message}`); }
            return;
        }

        // /مسح كاش
        if (twoWord === 'مسح كاش') {
            react(sock, msg, '⏳');
            try {
                if (global._pluginsCache) global._pluginsCache = {};
                await loadPlugins().catch(() => {});
                react(sock, msg, '✅'); await reply('✅ تم مسح الكاش.');
            } catch (e) { react(sock, msg, '❌'); await reply(`❌ ${e?.message}`); }
            return;
        }

        // /اذاعة [نص]
        if (cmd === 'اذاعة' && rest) {
            react(sock, msg, '⏳');
            try {
                const chats = await sock.groupFetchAllParticipating();
                let sent = 0;
                for (const gid of Object.keys(chats)) {
                    try { await sock.sendMessage(gid, { text: rest }); sent++; } catch {}
                    await sleep(500);
                }
                react(sock, msg, '✅'); await reply(`✅ تم الارسال لـ ${sent} مجموعة.`);
            } catch (e) { await reply(`❌ ${e?.message}`); }
            return;
        }

        // /إحصاءات
        if (cmd === 'إحصاءات' || cmd === 'احصاءات') {
            const s       = readStats();
            const topCmds = Object.entries(s.commands || {})
                .sort((a, b) => b[1] - a[1]).slice(0, 5)
                .map(([k, v], i) => `${i+1}. ${k}: *${v}*`).join('\n') || 'لا يوجد';
            const up = process.uptime();
            const h  = Math.floor(up/3600), mm = Math.floor((up%3600)/60), ss = Math.floor(up%60);
            await reply(`✧━── ❝ 𝐒𝐓𝐀𝐓𝐒 ❞ ──━✧\n\n📨 الاوامر: *${s.total||0}*\n⏱️ التشغيل: *${h}h ${mm}m ${ss}s*\n\n🏆 *اكثر الاوامر:*\n${topCmds}`);
            return;
        }

        // /تغيير اسم [امر_حالي] [اسم_جديد]
        if (twoWord === 'تغيير اسم') {
            const parts   = rest.trim().split(/\s+/);
            const oldName = parts[0];
            const newName = parts.slice(1).join(' ').trim();
            if (!oldName || !newName)
                return reply('✏️ *الاستخدام:*\n`/تغيير اسم [الامر_الحالي] [الاسم_الجديد]`');
            react(sock, msg, '⏳');
            const fp = await findPluginByCmd(oldName);
            if (!fp) return reply(`❌ ما وجدت أمر باسم: *${oldName}*`);
            try {
                updatePluginField(fp, 'command', newName);
                await loadPlugins().catch(() => {});
                react(sock, msg, '✅');
                await reply(`✅ تم تغيير: *${oldName}* ➔ *${newName}*`);
            } catch (e) { react(sock, msg, '❌'); await reply(`❌ فشل: ${e?.message}`); }
            return;
        }

        // /toggle الحماية
        const protKey = _SLASH_PROT[cmd] || _SLASH_PROT[twoWord];
        if (protKey) {
            const p = readProt();
            p[protKey] = p[protKey] === 'on' ? 'off' : 'on';
            writeProt(p);
            react(sock, msg, p[protKey] === 'on' ? '✅' : '⛔');
            await reply(`${p[protKey]==='on'?'✅ شُغِّل':'⛔ أُوقف'}: *${twoWord || cmd}*`);
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
//  تنزيلات — yt-dlp
// ══════════════════════════════════════════════════════════════
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

let _ytdlpBin = null;
async function getYtdlpBin() {
    if (_ytdlpBin) return _ytdlpBin;
    for (const bin of ['yt-dlp', 'yt_dlp', 'python3 -m yt_dlp']) {
        try { await execAsync(`${bin} --version`, { timeout: 5000 }); _ytdlpBin = bin; return bin; } catch {}
    }
    throw new Error('yt-dlp غير مثبت — شغّل: pip install yt-dlp');
}

const _VIDEO_FORMATS = [
    'bestvideo[ext=mp4][filesize<100M]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio/best[ext=mp4][filesize<100M]/best[filesize<100M]',
    'best[ext=mp4]/best',
    'best',
];

async function ytdlpDownload(url, opts = {}) {
    const bin    = await getYtdlpBin();
    const outDir = path.join(os.tmpdir(), `dl_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    fs.ensureDirSync(outDir);
    const baseArgs = `--no-playlist --no-warnings --socket-timeout 30 --retries 3 --fragment-retries 3 --output "${outDir}/media.%(ext)s"`;
    const cleanup  = () => { try { fs.removeSync(outDir); } catch {} };

    if (opts.audio) {
        try {
            await execAsync(`${bin} ${baseArgs} -x --audio-format mp3 --audio-quality 0 "${url}"`, { timeout: 150_000 });
        } catch (e) {
            try { await execAsync(`${bin} ${baseArgs} -x "${url}"`, { timeout: 150_000 }); }
            catch (e2) { cleanup(); throw new Error((e2.stderr || e2.message || e.stderr || 'فشل الصوت').slice(0, 200)); }
        }
    } else {
        let lastErr = null, done = false;
        for (const fmt of _VIDEO_FORMATS) {
            try {
                await execAsync(`${bin} ${baseArgs} -f "${fmt}" --merge-output-format mp4 "${url}"`, { timeout: 150_000 });
                done = true; break;
            } catch (e) { lastErr = e; }
        }
        if (!done) { cleanup(); throw new Error((lastErr?.stderr || lastErr?.message || 'فشل الفيديو').slice(0, 200)); }
    }

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

    const update = async (textOrObj) => {
        const payload = typeof textOrObj === 'string' ? { text: textOrObj } : textOrObj;
        try { await sock.sendMessage(chatId, { ...payload, edit: botMsgKey }); }
        catch { const s = await sock.sendMessage(chatId, payload); botMsgKey = s.key; }
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

        // إعادة ضبط timeout عند كل تفاعل
        clearTimeout(timeout);
        timeout = setTimeout(cleanup, 300_000);

        reactInput(sock, m, text);

        // ══════════════════════════════════════════════════
        // MAIN
        // ══════════════════════════════════════════════════
        if (state === 'MAIN') {
            if (text === 'نخبة')                          { await showEliteMenu();   state = 'ELITE';    return; }
            if (text === 'بلاجنز')                        { await showPluginsMenu(); state = 'PLUGINS';  return; }
            if (text === 'تنزيلات')                       { await showDlMenu();      state = 'DL_MENU';  return; }
            if (text === 'إحصاءات' || text === 'احصاءات') { await showStats();      state = 'STATS';    return; }
            if (text === 'حماية')                         { await showProtMenu();    state = 'PROT';     return; }
            if (text === 'اوامر')                         { await showCmdTools();    state = 'CMDTOOLS'; return; }
            if (text === 'إدارة')                         { await showAdminMenu();   state = 'ADMIN';    return; }
            return;
        }

        // ══════════════════════════════════════════════════
        // ELITE
        // ══════════════════════════════════════════════════
        if (state === 'ELITE') {
            if (text === 'رجوع') { await update(MAIN_MENU); state = 'MAIN'; return; }
            if (text === 'عرض') {
                try {
                    const elites = sock.getElites?.() || [];
                    if (!elites.length) return update(`✧━── ❝ 𝐍𝐗𝐁𝐀 ❞ ──━✧\n\n📋 القائمة فارغة.\n\n🔙 *رجوع*\n\n✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
                    const list = elites.map((id, i) => `${i+1}. @${normalizeJid(id)}`).join('\n');
                    return update({
                        text: `✧━── ❝ 𝐍𝐗𝐁𝐀 ❞ ──━✧\n\n👑 *قائمة النخبة (${elites.length}):*\n\n${list}\n\n🔙 *رجوع*\n\n✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`,
                        mentions: elites,
                    });
                } catch { return update('❌ تعذر جلب القائمة.\n\n🔙 *رجوع*'); }
            }
            if (text === 'اضافة')    { await update('📱 ارسل الرقم:\nمثال: 966501234567\nاو منشن شخص\n\n🔙 *رجوع*'); state = 'ELITE_ADD'; return; }
            if (text === 'حذف')      { await update('📱 ارسل الرقم للحذف:\nاو منشن شخص\n\n🔙 *رجوع*'); state = 'ELITE_DEL'; return; }
            if (text === 'مسح الكل') { await update('⚠️ *تاكيد مسح كل النخبة؟*\nاكتب *نعم* او *رجوع*'); state = 'ELITE_CLEAR'; return; }
            return;
        }

        if (state === 'ELITE_ADD') {
            if (text === 'رجوع') { await showEliteMenu(); state = 'ELITE'; return; }
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
            if (text === 'رجوع') { await showEliteMenu(); state = 'ELITE'; return; }
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
            if (text === 'رجوع') { await showEliteMenu(); state = 'ELITE'; return; }
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
            if (text === 'رجوع')    { await update(MAIN_MENU); state = 'MAIN'; return; }
            if (text === 'الاوامر') { await showPluginsListMenu(); state = 'PLUGINS_LIST'; return; }
            if (text === 'التعديل') { await showPluginsEditMenu(); state = 'PLUGINS_EDIT_MENU'; return; }
            if (text === 'جديد')    { await update('📝 اكتب اسم الامر الجديد:\n`بدون .js`\n\n🔙 *رجوع*'); state = 'PLUGIN_NEW_NAME'; return; }
            return;
        }

        if (state === 'PLUGINS_LIST') {
            if (text === 'رجوع') { await showPluginsMenu(); state = 'PLUGINS'; return; }
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
                await showPluginDetail(fp, cmdName); state = 'PLUGIN_DETAIL'; return;
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
            if (text === 'رجوع') { await showPluginsMenu(); state = 'PLUGINS'; return; }
            if (text.startsWith('بحث ')) {
                const cmdName = text.slice(4).trim();
                const fp = await findPluginByCmd(cmdName);
                if (!fp) return update(`❌ ما وجدت: ${cmdName}\n\n🔙 *رجوع*`);
                tmp.targetFile = fp; tmp.targetCmd = cmdName;
                await showPluginDetail(fp, cmdName); state = 'PLUGIN_DETAIL'; return;
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
            if (text === 'رجوع') { await showPluginsEditMenu(); state = 'PLUGINS_EDIT_MENU'; return; }
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
            if (text === 'تغيير الاسم') { await update('✏️ اكتب الاسم الجديد:\n\n🔙 *رجوع*'); state = 'PLUGIN_RENAME'; return; }
            return;
        }

        if (state === 'PLUGIN_RENAME') {
            if (text === 'رجوع') { await showPluginDetail(tmp.targetFile, tmp.targetCmd); state = 'PLUGIN_DETAIL'; return; }
            try { updatePluginField(tmp.targetFile,'command',text.trim()); await loadPlugins().catch(()=>{}); } catch {}
            await update(`✅ ${tmp.targetCmd} ➔ ${text.trim()}`);
            tmp.targetCmd = text.trim(); await sleep(1200); await showPluginDetail(tmp.targetFile, tmp.targetCmd); state = 'PLUGIN_DETAIL'; return;
        }

        if (state === 'PLUGIN_NEW_NAME') {
            if (text === 'رجوع') { await showPluginsMenu(); state = 'PLUGINS'; return; }
            const name = text.trim().replace(/\.js$/, '').replace(/[^\w\u0600-\u06FF]/g, '');
            if (!name) return update('❌ اسم غير صحيح.\n\n🔙 *رجوع*');
            tmp.newPluginName = name; await update(`📝 ارسل كود الامر [ *${name}* ]:\n\n🔙 *رجوع*`);
            state = 'PLUGIN_NEW_CODE'; return;
        }

        if (state === 'PLUGIN_NEW_CODE') {
            if (text === 'رجوع') { await showPluginsMenu(); state = 'PLUGINS'; return; }
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
            if (text === 'رجوع') { await update(MAIN_MENU); state = 'MAIN'; return; }
            if (text === 'فيديو' || text === 'صوت') {
                tmp.dlMode = text === 'فيديو' ? 'video' : 'audio';
                await update(`${text==='فيديو'?'🎬':'🎵'} ارسل الرابط:\n\n🔙 *رجوع*`);
                state = 'DL_WAIT'; return;
            }
            const url = extractUrl(text);
            if (url) { await handleDownload(url, false, m); await sleep(1000); await showDlMenu(); return; }
            return;
        }

        if (state === 'DL_WAIT') {
            if (text === 'رجوع') { await showDlMenu(); state = 'DL_MENU'; return; }
            const url = extractUrl(text) || (text.startsWith('http') ? text : null);
            if (!url) return update('❌ الرابط غير صحيح.\n\n🔙 *رجوع*');
            await handleDownload(url, tmp.dlMode === 'audio', m);
            await sleep(1500); await showDlMenu(); state = 'DL_MENU'; return;
        }

        // ══════════════════════════════════════════════════
        // STATS
        // ══════════════════════════════════════════════════
        if (state === 'STATS') {
            if (text === 'رجوع') { await update(MAIN_MENU); state = 'MAIN'; return; }
            if (text === 'مسح') { writeStats({ commands:{}, users:{}, total:0 }); await update('✅ تم المسح.'); await sleep(800); await showStats(); }
            return;
        }

        // ══════════════════════════════════════════════════
        // PROT
        // ══════════════════════════════════════════════════
        if (state === 'PROT') {
            if (text === 'رجوع') { await update(MAIN_MENU); state = 'MAIN'; return; }
            const protMap = {
                'انتي كراش':'antiCrash',   'انتي لينكات':'antiLink',
                'انتي حذف':'antiDelete',   'انتي سب':'antiInsult',
                'view once':'antiViewOnce', 'انتي خاص':'antiPrivate',
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
            if (text === 'رجوع') { await update(MAIN_MENU); state = 'MAIN'; return; }
            if (text === 'تغيير اسم')  { await update('✏️ اكتب اسم الامر الحالي:\n\n🔙 *رجوع*'); state = 'RENAME_WAIT'; return; }
            if (text === 'فاحص الكود') { await update('🔍 اكتب اسم الامر:\n\n🔙 *رجوع*'); state = 'CODE_CHECK_WAIT'; return; }
            if (text === 'مسح كاش') {
                react(sock, m, '⏳');
                try { if (global._pluginsCache) global._pluginsCache = {}; await loadPlugins().catch(()=>{}); react(sock, m, '✅'); await update('✅ تم المسح.'); }
                catch (e) { react(sock, m, '❌'); await update(`❌ ${e?.message}`); }
                await sleep(800); await showCmdTools(); return;
            }
            return;
        }

        if (state === 'RENAME_WAIT') {
            if (text === 'رجوع') { await showCmdTools(); state = 'CMDTOOLS'; return; }
            const fp = await findPluginByCmd(text);
            if (!fp) return update(`❌ ما وجدت: ${text}`);
            tmp.targetFile = fp; tmp.targetCmd = text;
            await update(`✅ [ ${text} ] — اكتب الاسم الجديد:\n\n🔙 *رجوع*`);
            state = 'RENAME_NEW'; return;
        }

        if (state === 'RENAME_NEW') {
            if (text === 'رجوع') { await showCmdTools(); state = 'CMDTOOLS'; return; }
            try { updatePluginField(tmp.targetFile,'command',text.trim()); await loadPlugins().catch(()=>{}); } catch {}
            await update(`✅ ${tmp.targetCmd} ➔ ${text.trim()}`);
            await sleep(1200); await showCmdTools(); state = 'CMDTOOLS'; return;
        }

        if (state === 'CODE_CHECK_WAIT') {
            if (text === 'رجوع') { await showCmdTools(); state = 'CMDTOOLS'; return; }
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
            if (text === 'رجوع')         { await update(MAIN_MENU); state = 'MAIN'; return; }
            if (text === 'الاعضاء')      { await showAdminMembersMenu();  state = 'ADMIN_MEMBERS';   return; }
            if (text === 'الرسائل')      { await showAdminMessagesMenu(); state = 'ADMIN_MESSAGES';  return; }
            if (text === 'المجموعة')     { await showAdminGroupMenu();    state = 'ADMIN_GROUP_SET'; return; }
            if (text === 'المحتوى')      { await showAdminContentMenu();  state = 'ADMIN_CONTENT';   return; }
            if (text === 'قفل المحتوى') { await showAdminLocksMenu();    state = 'ADMIN_LOCKS';     return; }
            if (text === 'الادوات')      { await showAdminToolsMenu();    state = 'ADMIN_TOOLS';     return; }
            return;
        }

        // ADMIN_MEMBERS
        if (state === 'ADMIN_MEMBERS') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
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
                state = 'ADMIN_TARGET'; return;
            }
            return;
        }

        // ADMIN_TARGET
        if (state === 'ADMIN_TARGET') {
            if (text === 'رجوع') { await showAdminMembersMenu(); state = 'ADMIN_MEMBERS'; return; }
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
                }, '🔨');
            } else if (action === 'unban') {
                const bans = readJSON(grpFile('bans', chatId), []);
                writeJSON(grpFile('bans', chatId), bans.filter(b => b !== target));
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
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
            if (text === 'تثبيت' || text === 'الغاء التثبيت') {
                const ctx2 = m.message?.extendedTextMessage?.contextInfo;
                if (!ctx2?.stanzaId) return update('↩️ رد على الرسالة اللي تبيها.');
                const pinKey = { remoteJid: chatId, id: ctx2.stanzaId, participant: ctx2.participant, fromMe: false };
                if (text === 'تثبيت') await tryAdminAction(() => sock.groupMessagePin(chatId, pinKey, 1, 86400), '📌');
                else                  await tryAdminAction(() => sock.groupMessagePin(chatId, pinKey, 0), '📌');
                return;
            }
            if (text === 'مسح') {
                const ctx2 = m.message?.extendedTextMessage?.contextInfo;
                if (!ctx2?.stanzaId) return update('↩️ رد على الرسالة اللي تبيها.');
                await tryAdminAction(() => sock.sendMessage(chatId, { delete: { remoteJid: chatId, fromMe: false, id: ctx2.stanzaId, participant: ctx2.participant } }), '🗑️');
                return;
            }
            return;
        }

        // ADMIN_GROUP_SET
        if (state === 'ADMIN_GROUP_SET') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
            if (text === 'وضع اسم')      { await update('✏️ ارسل الاسم الجديد:\n\n🔙 *رجوع*'); state = 'ADMIN_SETNAME'; return; }
            if (text === 'وضع وصف')      { await update('📝 ارسل الوصف الجديد:\n\n🔙 *رجوع*'); state = 'ADMIN_SETDESC'; return; }
            if (text === 'وضع صورة')     { await update('🖼️ ارسل او اقتبس صورة:\n\n🔙 *رجوع*'); state = 'ADMIN_SETIMG'; return; }
            if (text === 'قفل المحادثة') { await tryAdminAction(() => sock.groupSettingUpdate(chatId, 'announcement'), '🔒'); return; }
            if (text === 'فتح المحادثة') { await tryAdminAction(() => sock.groupSettingUpdate(chatId, 'not_announcement'), '🔓'); return; }
            if (text === 'رابط') {
                try { const code = await sock.groupInviteCode(chatId); await update(`🔗 *رابط المجموعة:*\nhttps://chat.whatsapp.com/${code}\n\n🔙 *رجوع*`); }
                catch (e) { await update(`❌ ${e?.message}`); }
                return;
            }
            if (text === 'انضم') { await update('🔗 ارسل رابط المجموعة:\n\n🔙 *رجوع*'); state = 'ADMIN_JOIN'; return; }
            if (text === 'خروج') { await update('⚠️ تاكيد الخروج؟\nاكتب *نعم* او *رجوع*'); state = 'ADMIN_LEAVE'; return; }
            return;
        }

        if (state === 'ADMIN_SETNAME') {
            if (text === 'رجوع') { await showAdminGroupMenu(); state = 'ADMIN_GROUP_SET'; return; }
            react(sock, m, '⏳'); await tryAdminAction(() => sock.groupUpdateSubject(chatId, text), '✅');
            await sleep(800); await showAdminGroupMenu(); state = 'ADMIN_GROUP_SET'; return;
        }

        if (state === 'ADMIN_SETDESC') {
            if (text === 'رجوع') { await showAdminGroupMenu(); state = 'ADMIN_GROUP_SET'; return; }
            react(sock, m, '⏳'); await tryAdminAction(() => sock.groupUpdateDescription(chatId, text), '✅');
            await sleep(800); await showAdminGroupMenu(); state = 'ADMIN_GROUP_SET'; return;
        }

        if (state === 'ADMIN_SETIMG') {
            if (text === 'رجوع') { await showAdminGroupMenu(); state = 'ADMIN_GROUP_SET'; return; }
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
            if (text === 'رجوع') { await showAdminGroupMenu(); state = 'ADMIN_GROUP_SET'; return; }
            const match = text.match(/chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/i);
            if (!match) return update('❌ رابط غير صحيح.\n\n🔙 *رجوع*');
            react(sock, m, '⏳');
            try { await sock.groupAcceptInvite(match[1]); react(sock, m, '✅'); await update('✅ تم الانضمام.'); }
            catch (e) { react(sock, m, '❌'); await update(`❌ ${e?.message}`); }
            await sleep(800); await showAdminGroupMenu(); state = 'ADMIN_GROUP_SET'; return;
        }

        if (state === 'ADMIN_LEAVE') {
            if (text === 'رجوع') { await showAdminGroupMenu(); state = 'ADMIN_GROUP_SET'; return; }
            if (text === 'نعم') { try { await sock.groupLeave(chatId); } catch (e) { await update(`❌ ${e?.message}`); } }
            state = 'ADMIN_GROUP_SET'; return;
        }

        // ADMIN_CONTENT
        if (state === 'ADMIN_CONTENT') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
            if (text === 'وضع ترحيب') { await update('👋 اكتب رسالة الترحيب:\nاستخدم {name} للاسم و {number} للرقم\n\n🔙 *رجوع*'); state = 'ADMIN_SETWELCOME'; return; }
            if (text === 'ترحيب') {
                const wf = grpFile('welcome', chatId);
                if (!fs.existsSync(wf)) return update('❌ لم يُضبط ترحيب بعد.\n\nاكتب *وضع ترحيب* لضبطه.\n\n🔙 *رجوع*');
                const { text: wt } = readJSON(wf, {});
                await update(`📋 *رسالة الترحيب:*\n\n${wt}\n\nاكتب *حذف* لحذفه\n🔙 *رجوع*`);
                state = 'ADMIN_WELCOME_VIEW'; return;
            }
            if (text === 'وضع قوانين') { await update('📜 اكتب القوانين:\n\n🔙 *رجوع*'); state = 'ADMIN_SETRULES'; return; }
            if (text === 'قوانين') {
                const rf = grpFile('rules', chatId);
                if (!fs.existsSync(rf)) return update('❌ لم تُضبط قوانين بعد.\n\n🔙 *رجوع*');
                const { text: rt } = readJSON(rf, {});
                await update(`📜 *القوانين:*\n\n${rt}\n\nاكتب *حذف* لحذفها\n🔙 *رجوع*`);
                state = 'ADMIN_RULES_VIEW'; return;
            }
            if (text === 'كلمات ممنوعة') { await showBadwords(); state = 'ADMIN_BADWORDS'; return; }
            return;
        }

        if (state === 'ADMIN_SETWELCOME') {
            if (text === 'رجوع') { await showAdminContentMenu(); state = 'ADMIN_CONTENT'; return; }
            writeJSON(grpFile('welcome', chatId), { text });
            react(sock, m, '✅');
            await update(`✅ تم حفظ رسالة الترحيب.\n\n🔙 *رجوع*`);
            await sleep(800); await showAdminContentMenu(); state = 'ADMIN_CONTENT'; return;
        }

        if (state === 'ADMIN_SETRULES') {
            if (text === 'رجوع') { await showAdminContentMenu(); state = 'ADMIN_CONTENT'; return; }
            writeJSON(grpFile('rules', chatId), { text });
            react(sock, m, '✅');
            await sleep(800); await showAdminContentMenu(); state = 'ADMIN_CONTENT'; return;
        }

        if (state === 'ADMIN_WELCOME_VIEW') {
            if (text === 'رجوع') { await showAdminContentMenu(); state = 'ADMIN_CONTENT'; return; }
            if (text === 'حذف') { try { fs.removeSync(grpFile('welcome', chatId)); react(sock, m, '🗑️'); } catch {} await sleep(400); await showAdminContentMenu(); state = 'ADMIN_CONTENT'; }
            return;
        }

        if (state === 'ADMIN_RULES_VIEW') {
            if (text === 'رجوع') { await showAdminContentMenu(); state = 'ADMIN_CONTENT'; return; }
            if (text === 'حذف') { try { fs.removeSync(grpFile('rules', chatId)); react(sock, m, '🗑️'); } catch {} await sleep(400); await showAdminContentMenu(); state = 'ADMIN_CONTENT'; }
            return;
        }

        if (state === 'ADMIN_BADWORDS') {
            if (text === 'رجوع') { await showAdminContentMenu(); state = 'ADMIN_CONTENT'; return; }
            const bf = grpFile('badwords', chatId); let words = readJSON(bf, []);
            if (text.startsWith('اضافة ')) { const w = text.slice(6).trim(); if (w) { words.push(w.toLowerCase()); writeJSON(bf, words); react(sock, m, '✅'); } await sleep(400); await showBadwords(); return; }
            if (text.startsWith('حذف '))   { writeJSON(bf, words.filter(x => x !== text.slice(4).trim())); react(sock, m, '🗑️'); await sleep(400); await showBadwords(); return; }
            return;
        }

        // ADMIN_LOCKS
        if (state === 'ADMIN_LOCKS') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
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
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
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
            if (text === 'اذاعة') { await update('📢 اكتب رسالة الإذاعة:\n\n🔙 *رجوع*'); state = 'ADMIN_BROADCAST'; return; }
            if (text === 'تحديث') {
                react(sock, m, '⏳');
                try { await loadPlugins(); react(sock, m, '✅'); await update('✅ تم تحديث الاوامر.\n\n🔙 *رجوع*'); }
                catch (e) { react(sock, m, '❌'); await update(`❌ ${e?.message}`); }
                return;
            }
            return;
        }

        if (state === 'ADMIN_BROADCAST') {
            if (text === 'رجوع') { await showAdminToolsMenu(); state = 'ADMIN_TOOLS'; return; }
            react(sock, m, '⏳');
            try {
                const chats = await sock.groupFetchAllParticipating();
                let sent = 0;
                for (const gid of Object.keys(chats)) { try { await sock.sendMessage(gid, { text }); sent++; } catch {} await sleep(500); }
                react(sock, m, '✅'); await update(`✅ الإرسال لـ ${sent} مجموعة.`);
            } catch (e) { await update(`❌ ${e?.message}`); }
            await sleep(1000); await showAdminToolsMenu(); state = 'ADMIN_TOOLS'; return;
        }

    }; // نهاية listener

    // ══════════════════════════════════════════════════════
    //  ✅ FIX-2: download handler — فيديو >70MB → مستند
    // ══════════════════════════════════════════════════════
    async function handleDownload(url, audioOnly, m) {
        const platform = detectPlatform(url) || 'رابط';
        const icon     = audioOnly ? '🎵' : '🎬';
        react(sock, m, '⏳');
        await update(`${icon} *جاري تحميل ${platform}...*\nقد ياخذ بضع ثوانٍ.`);
        try {
            const { filePath, ext, cleanup } = await ytdlpDownload(url, { audio: audioOnly });
            const fileSize = fs.statSync(filePath).size;
            const isVideo  = ['mp4','mkv','webm','mov','avi'].includes(ext);
            const isAudio  = ['mp3','m4a','ogg','aac','opus','wav'].includes(ext);
            const isImage  = ['jpg','jpeg','png','webp','gif'].includes(ext);

            // حد أقصى مطلق 150MB
            if (fileSize > 150 * 1024 * 1024) {
                cleanup();
                return update('❌ الملف أكبر من 150MB، لا يمكن إرساله.\n\n🔙 *رجوع*');
            }

            const buffer = fs.readFileSync(filePath); cleanup();

            // ✅ فيديو أكبر من 70MB → مستند بدل فيديو
            if (isVideo && fileSize > 70 * 1024 * 1024) {
                await sock.sendMessage(chatId, {
                    document: buffer,
                    mimetype:  'video/mp4',
                    fileName:  `${platform}_video.mp4`,
                    caption:   `📎 ${platform} — تم إرساله كمستند (الحجم: ${(fileSize/1024/1024).toFixed(1)}MB)`,
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
            if (errText.includes('غير مثبت') || errText.includes('yt-dlp')) hint = '\n\n💡 شغّل: `pip install -U yt-dlp`';
            else if (errText.toLowerCase().includes('private'))               hint = '\n\n⚠️ المحتوى خاص.';
            else if (errText.includes('Unsupported URL'))                      hint = '\n\n⚠️ الرابط غير مدعوم.';
            else if (errText.includes('filesize') || errText.includes('large')) hint = '\n\n⚠️ جرّب الصوت.';
            await update(`❌ *فشل التحميل*\n\`${errText.slice(0, 150)}\`${hint}\n\n🔙 *رجوع*`);
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

🔙 *رجوع*

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

🔙 *رجوع*

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

🔙 *رجوع*

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

🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showDlMenu() {
        await update(
`✧━── ❝ 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃 ❞ ──━✧

✦ *فيديو*
\`🎬 تنزيل كفيديو MP4\`

✦ *صوت*
\`🎵 تنزيل كصوت MP3\`

*او ارسل رابط مباشرة*

📌 فيديو أكبر من 70MB يُرسَل مستنداً

المصادر:
يوتيوب | انستقرام | تيك توك
فيسبوك | بنترست | تويتر | ساوند

🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showStats() {
        const s = readStats();
        const topCmds  = Object.entries(s.commands||{}).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v],i)=>`${i+1}. ${k}: *${v}*`).join('\n') || 'لا يوجد';
        const topUsers = Object.entries(s.users||{}).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v],i)=>`${i+1}. ${normalizeJid(k)}: *${v}*`).join('\n') || 'لا يوجد';
        const up = process.uptime();
        const h = Math.floor(up/3600), mm = Math.floor((up%3600)/60), ss = Math.floor(up%60);
        await update(
`✧━── ❝ 𝐒𝐓𝐀𝐓𝐒 ❞ ──━✧

📨 الاوامر: *${s.total||0}*
⏱️ التشغيل: *${h}h ${mm}m ${ss}s*

🏆 *اكثر الاوامر:*
${topCmds}

👤 *اكثر المستخدمين:*
${topUsers}

✦ *مسح* — تصفير الإحصاءات
🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showProtMenu() {
        const p = readProt(), s = k => p[k]==='on'?'✅':'⛔';
        await update(
`✧━── ❝ 𝐏𝐑𝐎𝐓𝐄𝐂𝐓𝐈𝐎𝐍 ❞ ──━✧

✦ *انتي كراش* ${s('antiCrash')}
\`💥 حماية من رسائل التجميد\`

✦ *انتي لينكات* ${s('antiLink')}
\`🔗 حذف اي رابط بالمجموعة\`

✦ *انتي حذف* ${s('antiDelete')}
\`🗑️ إظهار الرسائل المحذوفة\`

✦ *انتي سب* ${s('antiInsult')}
\`🤬 حذف الكلمات البذيئة\`

✦ *view once* ${s('antiViewOnce')}
\`👁️ كشف وسائط المشاهدة لمرة\`

✦ *انتي خاص* ${s('antiPrivate')}
\`🚫 حظر من يراسل البوت خاص\`

اكتب اسم الميزة لتشغيلها او إيقافها
🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showCmdTools() {
        await update(
`✧━── ❝ 𝐂𝐌𝐃 𝐓𝐎𝐎𝐋𝐒 ❞ ──━✧

✦ *تغيير اسم*
\`✏️ تغيير اسم امر موجود\`

✦ *فاحص الكود*
\`🔍 فحص syntax البلاجن\`

✦ *مسح كاش*
\`🗑️ مسح الكاش وإعادة التحميل\`

🔙 *رجوع*

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

🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showAdminMembersMenu() {
        await update(
`✧━── ❝ 𝐌𝐄𝐌𝐁𝐄𝐑𝐒 ❞ ──━✧

✦ *رفع مشرف*    ✦ *تنزيل مشرف*
✦ *المشرفين*     ✦ *طرد*
✦ *حظر*          ✦ *الغاء حظر*
✦ *كتم*          ✦ *الغاء كتم*

🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showAdminMessagesMenu() {
        await update(
`✧━── ❝ 𝐌𝐄𝐒𝐒𝐀𝐆𝐄𝐒 ❞ ──━✧

✦ *تثبيت*         \`📌 رد على الرسالة\`
✦ *الغاء التثبيت* \`📌 رد على الرسالة\`
✦ *مسح*           \`🗑️ رد على الرسالة\`

🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showAdminGroupMenu() {
        await update(
`✧━── ❝ 𝐆𝐑𝐎𝐔𝐏 ❞ ──━✧

✦ *وضع اسم*       ✦ *وضع وصف*
✦ *وضع صورة*      ✦ *قفل المحادثة*
✦ *فتح المحادثة*  ✦ *رابط*
✦ *انضم*          ✦ *خروج*

🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showAdminContentMenu() {
        await update(
`✧━── ❝ 𝐂𝐎𝐍𝐓𝐄𝐍𝐓 ❞ ──━✧

✦ *وضع ترحيب*   ✦ *ترحيب*
✦ *وضع قوانين*  ✦ *قوانين*
✦ *كلمات ممنوعة*

🔙 *رجوع*

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
🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showAdminToolsMenu() {
        await update(
`✧━── ❝ 𝐓𝐎𝐎𝐋𝐒 ❞ ──━✧

✦ *معلومات*   \`ℹ️ معلومات المجموعة\`
✦ *اذاعة*     \`📢 إرسال لكل المجموعات\`
✦ *تحديث*     \`🔄 إعادة تحميل الاوامر\`

🔙 *رجوع*

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

🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    // تسجيل الجلسة
    sock.ev.on('messages.upsert', listener);
    // let بدل const حتى يُعاد ضبطه عند كل تفاعل
    let timeout = setTimeout(cleanup, 300_000);
    activeSessions.set(chatId, { listener, timeout });
}

export default { NovaUltra, execute };
