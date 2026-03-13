// ══════════════════════════════════════════════════════════════
//  نظام-4.js — النسخة الشاملة المدمجة (مُصلَّحة بالكامل)
//  يشمل: نخبة، تنزيلات، إحصاءات، حماية، اوامر، إدارة
// ══════════════════════════════════════════════════════════════
import fs           from 'fs-extra';
import path         from 'path';
import os           from 'os';
import { fileURLToPath } from 'url';
import { exec }     from 'child_process';
import { promisify } from 'util';
import { loadPlugins, getPlugins } from '../../handlers/plugins.js';
import {
    downloadMediaMessage,
    jidDecode,
    generateMessageID,
} from '@whiskeysockets/baileys';
import * as accountUtils from '../../../accountUtils.js';

const execAsync   = promisify(exec);
const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const BOT_DIR     = path.resolve(__dirname, '../../');
const ROOT_DIR    = path.resolve(__dirname, '../../../../');
const DATA_DIR    = path.join(BOT_DIR, 'nova', 'data');
const PLUGINS_DIR = path.join(BOT_DIR, 'plugins');
const ACCOUNTS_DIR= path.join(ROOT_DIR, 'accounts');
const PROT_FILE   = path.join(DATA_DIR, 'protection.json');
const STATS_FILE  = path.join(DATA_DIR, 'sys_stats.json');

fs.ensureDirSync(DATA_DIR);

// ══════════════════════════════════════════════════════════════
//  helpers
// ══════════════════════════════════════════════════════════════
const sleep = ms => new Promise(r => setTimeout(r, ms));

const react = (sock, msg, e) =>
    sock.sendMessage(msg.key.remoteJid, { react: { text: e, key: msg.key } }).catch(() => {});

// normalizeJid: يشيل @domain و :resource — متوافق مع messages.js
const normalizeJid = (jid) => {
    if (!jid || typeof jid !== 'string') return '';
    return jid.split('@')[0].split(':')[0];
};

// getBotJid: phone JID للبوت باستخدام jidDecode
const getBotJid = (sock) =>
    (jidDecode(sock.user?.id)?.user || sock.user?.id?.split(':')[0]?.split('@')[0] || '') + '@s.whatsapp.net';

// ══════════════════════════════════════════════════════════════
//  resolveTarget — يحل LID الى phone JID
// ══════════════════════════════════════════════════════════════
async function resolveTarget(sock, chatId, m) {
    const ctx = m.message?.extendedTextMessage?.contextInfo;
    if (!ctx) return null;
    const raw = ctx.mentionedJid?.[0] || ctx.participant;
    if (!raw) return null;
    if (raw.endsWith('@s.whatsapp.net')) return raw;
    try {
        const meta   = await sock.groupMetadata(chatId);
        const rawNum = raw.split(':')[0].split('@')[0];
        const found  = meta.participants.find(p =>
            p.id?.split(':')[0]?.split('@')[0] === rawNum ||
            (p.lid || '')?.split(':')[0]?.split('@')[0] === rawNum
        );
        if (found?.id?.endsWith('@s.whatsapp.net')) return found.id;
        if (found?.id) return found.id;
    } catch {}
    return raw.split('@')[0].split(':')[0] + '@s.whatsapp.net';
}

// ══════════════════════════════════════════════════════════════
//  file utils
// ══════════════════════════════════════════════════════════════
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

function grpFile(prefix, chatId) {
    return path.join(DATA_DIR, prefix + '_' + chatId.replace(/[^\w]/g, '_') + '.json');
}

// ══════════════════════════════════════════════════════════════
//  plugin utils
// ══════════════════════════════════════════════════════════════
function getAllPluginFiles(dir = PLUGINS_DIR, list = []) {
    if (!fs.existsSync(dir)) return list;
    for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) getAllPluginFiles(full, list);
        else if (f.endsWith('.js')) list.push(full);
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
        group: (code.match(/group:\s*(true|false)/i)?.[1]       || 'false') === 'true',
        prv:   (code.match(/prv:\s*(true|false)/i)?.[1]         || 'false') === 'true',
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
    const issues = [];
    const opens  = (code.match(/\{/g) || []).length;
    const closes = (code.match(/\}/g) || []).length;
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
        if (line) { try { codeLine = fs.readFileSync(filePath, 'utf8').split('\n')[line - 1]?.trim() || ''; } catch {} }
        return { ok: false, error: errMsg, line, codeLine };
    }
}

// ══════════════════════════════════════════════════════════════
//  message cache (antiDelete)
// ══════════════════════════════════════════════════════════════
const messageCache = new Map();
const _deleteSocks = new WeakSet();

function cacheMessage(msg) {
    try {
        if (!msg?.key?.id) return;
        const text = msg.message?.conversation ||
                     msg.message?.extendedTextMessage?.text ||
                     msg.message?.imageMessage?.caption || '';
        messageCache.set(msg.key.id, { chatId: msg.key.remoteJid, sender: msg.key.participant || msg.key.remoteJid, text });
        if (messageCache.size > 500) messageCache.delete(messageCache.keys().next().value);
    } catch {}
}

function registerDeleteListener(sock) {
    if (_deleteSocks.has(sock)) return;
    _deleteSocks.add(sock);
    sock.ev.on('messages.delete', ({ keys }) => antiDeleteHandler(sock, keys));
}

// ══════════════════════════════════════════════════════════════
//  welcome auto-handler (group-participants.update)
// ══════════════════════════════════════════════════════════════
const _welcomeSocks = new WeakSet();

function registerWelcomeListener(sock) {
    if (_welcomeSocks.has(sock)) return;
    _welcomeSocks.add(sock);
    sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
        if (action !== 'add') return;
        try {
            const wf = grpFile('welcome', id);
            if (!fs.existsSync(wf)) return;
            const { text: wt } = readJSON(wf, {});
            if (!wt) return;
            for (const jid of participants) {
                const num  = jid.split('@')[0].split(':')[0];
                const text = wt.replace(/\{name\}/g, `@${num}`).replace(/\{number\}/g, num);
                await sock.sendMessage(id, { text, mentions: [jid] });
                await sleep(600);
            }
        } catch {}
    });
}

// ══════════════════════════════════════════════════════════════
//  protection handlers
// ══════════════════════════════════════════════════════════════
const CRASH_PATTERNS = [
    /[\u202E\u200F\u200E]{10,}/,
    /(.)(\1){300,}/,
    /[\uD83D][\uDC00-\uDFFF]{50,}/,
];

const INSULT_WORDS = ['كس','طيز','شرموط','عاهر','زب','كسمك','عرص','منيوك','قحبة'];

// regex شامل — يكتشف أي رابط حتى بدون http/www
// يغطي: https?:// و www. وأي domain.tld معروف
const _LINK_RE = /(?:https?:\/\/|www\.)\S+|(?<![a-zA-Z0-9])(?:[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+(?:com|net|org|io|me|app|gg|ly|to|co|tv|ai|dev|xyz|info|online|site|link|live|store|shop|cc|ru|uk|de|fr|br|sa|ae|eg|iq|sy|jo|kw|bh|qa|om|ye|ma|dz|tn|lb|ps|so|ws|tk|ml|id|in|pk|ng|gh|ke)\b[^\s]*/i;
const hasLink = (text) => _LINK_RE.test(text);

async function protectionHandler(sock, msg) {
    try {
        registerDeleteListener(sock);
        registerWelcomeListener(sock);
        cacheMessage(msg);

        const prot   = readProt();
        const chatId = msg.key.remoteJid;
        const isGroup= chatId.endsWith('@g.us');
        const text   = msg.message?.conversation ||
                       msg.message?.extendedTextMessage?.text ||
                       msg.message?.imageMessage?.caption || '';

        // antiPrivate: يحظر من يراسل في الخاص تلقائياً
        if (prot.antiPrivate === 'on' && !isGroup && !msg.key.fromMe) {
            try { await sock.updateBlockStatus(chatId, 'block'); } catch {}
            return;
        }

        // antiCrash
        if (prot.antiCrash === 'on') {
            for (const p of CRASH_PATTERNS) {
                if (p.test(text)) { try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {} return; }
            }
        }

        // antiLink: فحص بالبدايات المشهورة فقط
        if (prot.antiLink === 'on' && isGroup && hasLink(text)) {
            try {
                const meta    = await sock.groupMetadata(chatId);
                const botJid  = getBotJid(sock);
                const botNum  = normalizeJid(botJid);

                const adminNums = new Set(
                    meta.participants
                        .filter(p => p.admin)
                        .flatMap(p => [
                            normalizeJid(p.id),
                            normalizeJid(p.lid || ''),
                            normalizeJid(p.pn  || ''),
                        ])
                        .filter(Boolean)
                );

                const senderPn  = normalizeJid(msg.key.participant || chatId);
                const senderLid = normalizeJid(msg.key.participant || '');

                const isAdminOrBot = msg.key.fromMe ||
                                     adminNums.has(senderPn) ||
                                     adminNums.has(senderLid) ||
                                     adminNums.has(botNum);

                if (!isAdminOrBot) {
                    try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}
                }
            } catch {}
            // لا return — نكمل باقي الحمايات
        }

        // antiInsult
        if (prot.antiInsult === 'on') {
            if (INSULT_WORDS.some(w => text.toLowerCase().includes(w))) {
                try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}
                return;
            }
        }

        // antiViewOnce: منطق فضح.js بالضبط
        if (prot.antiViewOnce === 'on') {
            const ctx    = msg.message?.extendedTextMessage?.contextInfo;
            const quoted = ctx?.quotedMessage;

            // فحص الاقتباس (نفس طريقة فضح.js بالضبط)
            if (quoted) {
                const mtype = Object.keys(quoted).find(k => ['imageMessage','videoMessage'].includes(k));
                if (mtype && quoted[mtype]?.viewOnce) {
                    try {
                        const buffer = await downloadMediaMessage(
                            { message: quoted, key: ctx },
                            'buffer',
                            {}
                        );
                        if (buffer) {
                            const type    = mtype.replace('Message', '');
                            const caption = (quoted[mtype]?.caption ? quoted[mtype].caption + '\n\n' : '') +
                                            '👁️ _تم كشف وسائط المشاهدة لمرة واحدة_';
                            await sock.sendMessage(chatId, { [type]: buffer, caption });
                        }
                    } catch {}
                }
            }

            // فحص الرسالة المباشرة (viewOnceMessage wrapper)
            const wrapper = msg.message?.viewOnceMessage?.message || msg.message?.viewOnceMessageV2?.message;
            if (wrapper) {
                const mtype = Object.keys(wrapper).find(k => ['imageMessage','videoMessage'].includes(k));
                if (mtype) {
                    try {
                        const buffer = await downloadMediaMessage(
                            { message: wrapper, key: msg.key },
                            'buffer',
                            {}
                        );
                        if (buffer) {
                            const type    = mtype.replace('Message', '');
                            const caption = (wrapper[mtype]?.caption ? wrapper[mtype].caption + '\n\n' : '') +
                                            '👁️ _تم كشف وسائط المشاهدة لمرة واحدة_';
                            await sock.sendMessage(chatId, { [type]: buffer, caption });
                        }
                    } catch {}
                }
            }
        }
    } catch {}
}
protectionHandler._src = 'protection_system';

async function antiDeleteHandler(sock, keys) {
    try {
        if (readProt().antiDelete !== 'on') return;
        for (const key of keys) {
            try {
                const cached = messageCache.get(key.id);
                const chatId = key.remoteJid;
                const sender = key.participant || key.remoteJid;
                const extra  = cached?.text ? `\n📝 *المحتوى:* ${cached.text}` : '';
                await sock.sendMessage(chatId, {
                    text: `🗑️ *تم حذف رسالة*\n👤 @${sender.split('@')[0].split(':')[0]}${extra}`,
                    mentions: [sender],
                });
            } catch {}
        }
    } catch {}
}
antiDeleteHandler._src = 'antiDelete_system';

async function statsAutoHandler(sock, msg) {
    try {
        const pfx  = global._botConfig?.prefix || '.';
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        if (!text.startsWith(pfx)) return;
        const cmd    = text.slice(pfx.length).split(/\s+/)[0]?.toLowerCase();
        const sender = msg.sender?.pn || msg.key.participant || msg.key.remoteJid;
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
//  slash command handler — /امر مباشر بدون قائمة نظام
//  /مسح  /تثبيت  /طرد  /حظر  /رفع  /كتم  /تحميل
//  /قفل  /فتح  /رابط  /تحديث  /اذاعة  /إحصاءات
//  /تغيير اسم [امر] [جديد]  /انتي كراش  /انتي لينكات ...
// ══════════════════════════════════════════════════════════════
const SLASH = '/';

// امر → groupParticipantsUpdate action
const _SLASH_MEMBER = { 'رفع':'promote', 'تنزيل مشرف':'demote', 'طرد':'remove', 'حظر':'ban' };

// امر → مفتاح الحماية
const _SLASH_PROT = {
    'انتي كراش':'antiCrash',  'انتي لينكات':'antiLink',
    'انتي حذف':'antiDelete',  'انتي سب':'antiInsult',
    'view once':'antiViewOnce', 'انتي خاص':'antiPrivate',
};

async function slashCommandHandler(sock, msg) {
    try {
        const raw  = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const text = raw.trim();
        if (!text.startsWith(SLASH)) return;

        const chatId    = msg.key.remoteJid;
        const senderJid = msg.sender?.pn || msg.key.participant || chatId;

        // ── فحص النخبة ──
        try {
            const eliteList = await sock.getEliteList?.() || [];
            const senderNum = senderJid.split('@')[0].split(':')[0];
            const isElite   = msg.key.fromMe || eliteList.some(e =>
                e.split('@')[0].split(':')[0] === senderNum
            );
            if (!isElite) return;
        } catch { return; }

        const body  = text.slice(SLASH.length).trim();
        // نقسّم على اول مسافة فقط لأن بعض الاوامر مثل "الغاء حظر" فيها مسافة
        const spIdx = body.indexOf(' ');
        const cmd   = spIdx === -1 ? body : body.slice(0, spIdx);
        const rest  = spIdx === -1 ? '' : body.slice(spIdx + 1).trim();
        // امر مركّب مثل "الغاء حظر" أو "الغاء كتم"
        const twoWord = body.split(/\s+/).slice(0, 2).join(' ');

        const isGroup = chatId.endsWith('@g.us');

        const reply = async (t) =>
            sock.sendMessage(chatId, { text: t }, { quoted: msg }).catch(() => {});

        const getAdminPerms = async () => {
            if (!isGroup) return { isGroup: false, isAdmin: false, isBotAdmin: false };
            try {
                const meta    = await sock.groupMetadata(chatId);
                const botJid  = getBotJid(sock);
                const botNum  = normalizeJid(botJid);

                const adminNums = new Set(
                    meta.participants
                        .filter(p => p.admin)
                        .flatMap(p => [
                            normalizeJid(p.id),
                            normalizeJid(p.lid || ''),
                            normalizeJid(p.pn  || ''),
                        ])
                        .filter(Boolean)
                );

                const senderPn  = normalizeJid(senderJid);
                const senderLid = normalizeJid(msg.sender?.lid || msg.key.participant || '');

                return {
                    meta,
                    isGroup:    true,
                    isAdmin:    msg.key.fromMe || adminNums.has(senderPn) || (senderLid && adminNums.has(senderLid)),
                    isBotAdmin: adminNums.has(botNum),
                };
            } catch { return { isGroup: true, isAdmin: false, isBotAdmin: false }; }
        };

        const tryDo = async (fn, okEmoji = '✅') => {
            try { await fn(); react(sock, msg, okEmoji); return true; } catch (e) {
                const { isGroup: ig, isAdmin, isBotAdmin } = await getAdminPerms();
                if (!ig)       { await reply('❌ هذا الامر للمجموعات فقط.');  return false; }
                if (!isBotAdmin){ await reply('❌ البوت ليس مشرفاً.');          return false; }
                if (!isAdmin)  { await reply('❌ انت لست مشرفاً.');             return false; }
                await reply(`❌ فشل: ${e?.message || e}`); return false;
            }
        };

        // ────────────────────────────────────────────────
        // /مسح — حذف رسالة مقتبسة
        // ────────────────────────────────────────────────
        if (cmd === 'مسح') {
            const ctx = msg.message?.extendedTextMessage?.contextInfo;
            if (!ctx?.stanzaId) return reply('↩️ رد على الرسالة اللي تبي تمسحها.');
            const delKey = {
                remoteJid:   chatId,
                id:          ctx.stanzaId,
                participant: ctx.participant,
                fromMe:      false,
            };
            await tryDo(() => sock.sendMessage(chatId, { delete: delKey }), '🗑️');
            return;
        }

        // ────────────────────────────────────────────────
        // /تثبيت — تثبيت رسالة مقتبسة
        // ────────────────────────────────────────────────
        if (cmd === 'تثبيت') {
            const ctx = msg.message?.extendedTextMessage?.contextInfo;
            if (!ctx?.stanzaId) return reply('↩️ رد على الرسالة اللي تبي تثبتها.');
            await tryDo(() => sock.groupMessagePin(chatId, {
                id:          ctx.stanzaId,
                participant: ctx.participant,
                remoteJid:   chatId,
            }, 1, 86400), '📌');
            return;
        }

        // ────────────────────────────────────────────────
        // /الغاء تثبيت
        // ────────────────────────────────────────────────
        if (twoWord === 'الغاء تثبيت') {
            const ctx = msg.message?.extendedTextMessage?.contextInfo;
            if (!ctx?.stanzaId) return reply('↩️ رد على الرسالة المثبتة.');
            await tryDo(() => sock.groupMessagePin(chatId, {
                id:          ctx.stanzaId,
                participant: ctx.participant,
                remoteJid:   chatId,
            }, 0), '📌');
            return;
        }

        // ────────────────────────────────────────────────
        // /رفع  /تنزيل مشرف  /طرد  /حظر
        // ────────────────────────────────────────────────
        const memberAction = _SLASH_MEMBER[cmd] || _SLASH_MEMBER[twoWord];
        if (memberAction) {
            const target = await resolveTarget(sock, chatId, msg);
            if (!target) return reply('↩️ منشن العضو او رد على رسالته.');
            if (memberAction === 'ban') {
                await tryDo(async () => {
                    await sock.groupParticipantsUpdate(chatId, [target], 'remove');
                    const bf = grpFile('bans', chatId);
                    const bans = readJSON(bf, []);
                    if (!bans.includes(target)) { bans.push(target); writeJSON(bf, bans); }
                }, '🔨');
            } else {
                const emoji = { promote:'👑', demote:'⬇️', remove:'🚪' }[memberAction] || '✅';
                await tryDo(() => sock.groupParticipantsUpdate(chatId, [target], memberAction), emoji);
            }
            return;
        }

        // ────────────────────────────────────────────────
        // /الغاء حظر
        // ────────────────────────────────────────────────
        if (twoWord === 'الغاء حظر') {
            const target = await resolveTarget(sock, chatId, msg);
            if (!target) return reply('↩️ منشن العضو.');
            const bf = grpFile('bans', chatId);
            writeJSON(bf, readJSON(bf, []).filter(b => b !== target));
            react(sock, msg, '✅');
            return;
        }

        // ────────────────────────────────────────────────
        // /كتم [دقائق]  — يخفّض لعضو مؤقتاً
        // ────────────────────────────────────────────────
        if (cmd === 'كتم') {
            const target = await resolveTarget(sock, chatId, msg);
            if (!target) return reply('↩️ منشن العضو.');
            const mins = parseInt(rest) || 30;
            await tryDo(async () => {
                await sock.groupParticipantsUpdate(chatId, [target], 'demote');
                await sock.sendMessage(chatId, {
                    text:     `🔇 تم كتم @${target.split('@')[0].split(':')[0]} لمدة ${mins} دقيقة`,
                    mentions: [target],
                });
                setTimeout(async () => {
                    try { await sock.groupParticipantsUpdate(chatId, [target], 'promote'); } catch {}
                }, mins * 60_000);
            }, '🔇');
            return;
        }

        // ────────────────────────────────────────────────
        // /الغاء كتم
        // ────────────────────────────────────────────────
        if (twoWord === 'الغاء كتم') {
            const target = await resolveTarget(sock, chatId, msg);
            if (!target) return reply('↩️ منشن العضو.');
            await tryDo(() => sock.groupParticipantsUpdate(chatId, [target], 'promote'), '🔊');
            return;
        }

        // ────────────────────────────────────────────────
        // /تحميل [رابط] أو /تحميل صوت [رابط]
        // ────────────────────────────────────────────────
        if (cmd === 'تحميل') {
            const audioMode = rest.startsWith('صوت');
            const urlRaw    = audioMode ? rest.slice(4).trim() : rest.trim();
            const url       = urlRaw.match(/https?:\/\/[^\s]+/i)?.[0] ||
                              (urlRaw.startsWith('http') ? urlRaw : null);
            if (!url) return reply('↩️ الاستخدام: `/تحميل [رابط]` أو `/تحميل صوت [رابط]`');

            const platform = detectPlatform(url) || 'رابط';
            const icon     = audioMode ? '🎵' : '🎬';
            react(sock, msg, '⏳');
            const stMsg = await sock.sendMessage(chatId, {
                text: `${icon} *جاري تحميل ${platform}...*\nقد يأخذ بضع ثوانٍ.`,
            }, { quoted: msg });
            const upd = async (t) => {
                try { await sock.sendMessage(chatId, { text: t, edit: stMsg.key }); } catch {}
            };
            try {
                const { filePath, ext, cleanup } = await ytdlpDownload(url, { audio: audioMode });
                const isVideo = ['mp4','mkv','webm','mov','avi'].includes(ext);
                const isAudio = ['mp3','m4a','ogg','aac','opus','wav'].includes(ext);
                const isImage = ['jpg','jpeg','png','webp','gif'].includes(ext);
                if (fs.statSync(filePath).size > 60 * 1024 * 1024) {
                    cleanup(); return upd('❌ الملف اكبر من 60MB.');
                }
                const buffer = fs.readFileSync(filePath); cleanup();
                if (isVideo)      await sock.sendMessage(chatId, { video: buffer, caption: `${icon} ${platform}` }, { quoted: msg });
                else if (isAudio) await sock.sendMessage(chatId, { audio: buffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                else if (isImage) await sock.sendMessage(chatId, { image: buffer, caption: `${icon} ${platform}` }, { quoted: msg });
                else              await sock.sendMessage(chatId, { document: buffer, mimetype: 'application/octet-stream', fileName: path.basename(filePath), caption: `${icon} ${platform}` }, { quoted: msg });
                react(sock, msg, '✅');
                await upd(`✅ *تم التحميل!*`);
            } catch (e) {
                react(sock, msg, '❌');
                const em = e?.message || '';
                let hint = '';
                if (em.includes('غير مثبت') || em.includes('yt-dlp'))
                    hint = '\n💡 شغّل: `pip install -U yt-dlp`';
                else if (em.toLowerCase().includes('private') || em.includes('login'))
                    hint = '\n⚠️ المحتوى خاص أو يحتاج تسجيل دخول.';
                else if (em.includes('Unsupported URL') || em.includes('unable to extract'))
                    hint = '\n⚠️ الرابط غير مدعوم.';
                else if (em.includes('filesize') || em.includes('large'))
                    hint = '\n⚠️ الملف كبير — جرّب `/تحميل صوت [رابط]`';
                await upd(`❌ *فشل التحميل*\n\`${em.slice(0,150)}\`${hint}`);
            }
            return;
        }

        // ────────────────────────────────────────────────
        // /قفل  /فتح — قفل/فتح المحادثة
        // ────────────────────────────────────────────────
        if (cmd === 'قفل') {
            await tryDo(() => sock.groupSettingUpdate(chatId, 'announcement'), '🔒');
            return;
        }
        if (cmd === 'فتح') {
            await tryDo(() => sock.groupSettingUpdate(chatId, 'not_announcement'), '🔓');
            return;
        }

        // ────────────────────────────────────────────────
        // /رابط — رابط دعوة المجموعة
        // ────────────────────────────────────────────────
        if (cmd === 'رابط') {
            try {
                const code = await sock.groupInviteCode(chatId);
                await reply(`🔗 *رابط المجموعة:*\nhttps://chat.whatsapp.com/${code}`);
            } catch (e) { await reply(`❌ ${e?.message}`); }
            return;
        }

        // ────────────────────────────────────────────────
        // /تحديث — إعادة تحميل البلاجنز
        // ────────────────────────────────────────────────
        if (cmd === 'تحديث') {
            react(sock, msg, '⏳');
            try { await loadPlugins(); react(sock, msg, '✅'); await reply('✅ تم تحديث الاوامر.'); }
            catch (e) { react(sock, msg, '❌'); await reply(`❌ ${e?.message}`); }
            return;
        }

        // ────────────────────────────────────────────────
        // /مسح كاش
        // ────────────────────────────────────────────────
        if (twoWord === 'مسح كاش') {
            react(sock, msg, '⏳');
            try {
                if (global._pluginsCache) global._pluginsCache = {};
                await loadPlugins().catch(() => {});
                react(sock, msg, '✅'); await reply('✅ تم مسح الكاش.');
            } catch (e) { react(sock, msg, '❌'); await reply(`❌ ${e?.message}`); }
            return;
        }

        // ────────────────────────────────────────────────
        // /اذاعة [نص] — ارسل لكل المجموعات
        // ────────────────────────────────────────────────
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

        // ────────────────────────────────────────────────
        // /إحصاءات — ملخص سريع
        // ────────────────────────────────────────────────
        if (cmd === 'إحصاءات' || cmd === 'احصاءات') {
            const s       = readStats();
            const topCmds = Object.entries(s.commands || {})
                .sort((a, b) => b[1] - a[1]).slice(0, 5)
                .map(([k, v], i) => `${i + 1}. ${k}: *${v}*`).join('\n') || 'لا يوجد';
            const up = process.uptime();
            const h  = Math.floor(up / 3600), mm = Math.floor((up % 3600) / 60), ss = Math.floor(up % 60);
            await reply(
`✧━── ❝ 𝐒𝐓𝐀𝐓𝐒 ❞ ──━✧

📨 الاوامر: *${s.total || 0}*
⏱️ التشغيل: *${h}h ${mm}m ${ss}s*

🏆 *اكثر الاوامر:*
${topCmds}`);
            return;
        }

        // ────────────────────────────────────────────────
        // /تغيير اسم [امر_حالي] [اسم_جديد]
        // ────────────────────────────────────────────────
        if (twoWord === 'تغيير اسم') {
            // rest = "امر_حالي اسم_جديد"
            const parts    = rest.trim().split(/\s+/);
            const oldName  = parts[0];
            const newName  = parts.slice(1).join(' ').trim();

            if (!oldName || !newName) {
                return reply(
`✏️ *الاستخدام:*
\`/تغيير اسم [الامر_الحالي] [الاسم_الجديد]\`

*مثال:*
\`/تغيير اسم سلام هلا\``
                );
            }

            react(sock, msg, '⏳');
            const fp = await findPluginByCmd(oldName);
            if (!fp) return reply(`❌ ما وجدت أمر باسم: *${oldName}*`);

            try {
                updatePluginField(fp, 'command', newName);
                await loadPlugins().catch(() => {});
                react(sock, msg, '✅');
                await reply(`✅ تم تغيير: *${oldName}* ➔ *${newName}*`);
            } catch (e) {
                react(sock, msg, '❌');
                await reply(`❌ فشل: ${e?.message}`);
            }
            return;
        }

        // ────────────────────────────────────────────────
        // /toggle الحماية — مثل: /انتي كراش
        // ────────────────────────────────────────────────
        const protKey = _SLASH_PROT[cmd] || _SLASH_PROT[twoWord];
        if (protKey) {
            const p = readProt();
            p[protKey] = p[protKey] === 'on' ? 'off' : 'on';
            writeProt(p);
            react(sock, msg, p[protKey] === 'on' ? '✅' : '⛔');
            await reply(`${p[protKey] === 'on' ? '✅ شُغِّل' : '⛔ أُوقف'}: *${twoWord || cmd}*`);
            return;
        }

    } catch {}
}
slashCommandHandler._src = 'slash_system';

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
    const match = text.match(/https?:\/\/[^\s]+/i);
    return match ? match[0] : null;
}

// ── helper: تحقق من وجود yt-dlp ──
let _ytdlpBin = null;
async function getYtdlpBin() {
    if (_ytdlpBin) return _ytdlpBin;
    for (const bin of ['yt-dlp', 'yt_dlp', 'python3 -m yt_dlp']) {
        try { await execAsync(`${bin} --version`, { timeout: 5000 }); _ytdlpBin = bin; return bin; } catch {}
    }
    throw new Error('yt-dlp غير مثبت — شغّل: pip install yt-dlp');
}

// ── formats مرتبة من الأجود للأبسط ──
const _VIDEO_FORMATS = [
    // بدون تحديد — yt-dlp يختار أفضل ما هو متاح تحت 50MB
    'bestvideo[ext=mp4][filesize<50M]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio/best[ext=mp4][filesize<50M]/best[filesize<50M]',
    // fallback: أي mp4
    'best[ext=mp4]/best',
    // آخر حل: أي شيء
    'best',
];

async function ytdlpDownload(url, opts = {}) {
    const bin    = await getYtdlpBin();
    const outDir = path.join(os.tmpdir(), `dl_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    fs.ensureDirSync(outDir);

    const baseArgs = [
        '--no-playlist',
        '--no-warnings',
        '--socket-timeout 30',
        '--retries 3',
        '--fragment-retries 3',
        `--output "${outDir}/media.%(ext)s"`,
    ].join(' ');

    const cleanup = () => { try { fs.removeSync(outDir); } catch {} };

    // ── صوت ──
    if (opts.audio) {
        const cmd = `${bin} ${baseArgs} -x --audio-format mp3 --audio-quality 0 "${url}"`;
        try {
            await execAsync(cmd, { timeout: 150_000 });
        } catch (e) {
            // fallback: بدون تحويل
            try {
                const cmd2 = `${bin} ${baseArgs} -x "${url}"`;
                await execAsync(cmd2, { timeout: 150_000 });
            } catch (e2) {
                cleanup();
                throw new Error((e2.stderr || e2.stdout || e2.message || e.stderr || 'فشل تحميل الصوت').slice(0, 200));
            }
        }
    } else {
        // ── فيديو: جرّب الـ formats بالترتيب ──
        let lastErr = null;
        let downloaded = false;
        for (const fmt of _VIDEO_FORMATS) {
            try {
                const cmd = `${bin} ${baseArgs} -f "${fmt}" --merge-output-format mp4 "${url}"`;
                await execAsync(cmd, { timeout: 150_000 });
                downloaded = true;
                break;
            } catch (e) {
                lastErr = e;
            }
        }
        if (!downloaded) {
            cleanup();
            throw new Error((lastErr?.stderr || lastErr?.stdout || lastErr?.message || 'فشل تحميل الفيديو').slice(0, 200));
        }
    }

    // ── تحقق من الملف ──
    let files;
    try { files = fs.readdirSync(outDir).filter(f => !f.endsWith('.part') && !f.endsWith('.ytdl')); } catch { files = []; }
    if (!files.length) { cleanup(); throw new Error('لم يُحمَّل أي ملف — الرابط قد يكون خاطئاً أو محدوداً.'); }

    // اختر الملف الأكبر لو كان في أكثر من ملف
    const sorted = files
        .map(f => ({ f, size: fs.statSync(path.join(outDir, f)).size }))
        .sort((a, b) => b.size - a.size);

    const chosenFile = sorted[0].f;
    const filePath   = path.join(outDir, chosenFile);
    const ext        = path.extname(chosenFile).slice(1).toLowerCase();

    return { filePath, ext, cleanup };
}

// ══════════════════════════════════════════════════════════════
//  main menu
// ══════════════════════════════════════════════════════════════
const MAIN_MENU =
`✧━── ❝ 𝐍𝐎𝐕𝐀 𝐒𝐘𝐒𝐓𝐄𝐌 ❞ ──━✧

✦ *نخبة*
\`👑 إدارة قائمة النخبة\`

✦ *بلاجنز*
\`🧩 إدارة وعرض الاوامر\`

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
    command: 'نظام',
    description: 'نظام البوت الشامل',
    elite: 'on',
    group: false,
    prv: false,
    lock: 'off',
};

async function execute({ sock, msg }) {
    const chatId    = msg.key.remoteJid;
    // sender.pn من messages.js هو phone JID الصحيح دائماً
    const senderJid = msg.sender?.pn || msg.key.participant || chatId;

    registerDeleteListener(sock);
    registerWelcomeListener(sock);

    // إنهاء الجلسة السابقة
    if (activeSessions.has(chatId)) {
        const old = activeSessions.get(chatId);
        sock.ev.off('messages.upsert', old.listener);
        clearTimeout(old.timeout);
        sock.activeListeners?.delete(chatId);
        activeSessions.delete(chatId);
    }

    const sentMsg = await sock.sendMessage(chatId, { text: MAIN_MENU }, { quoted: msg });
    let botMsgKey = sentMsg.key;
    let state     = 'MAIN';
    let tmp       = {};

    const update = async (text) => {
        try {
            await sock.sendMessage(chatId, { text, edit: botMsgKey });
        } catch {
            const s = await sock.sendMessage(chatId, { text });
            botMsgKey = s.key;
        }
    };

    async function getAdminPerms() {
        if (!chatId.endsWith('@g.us')) return { isGroup: false, isAdmin: false, isBotAdmin: false };
        try {
            const meta    = await sock.groupMetadata(chatId);
            const botJid  = getBotJid(sock);
            const botNum  = normalizeJid(botJid);

            // كل مشارك له p.id (قد يكون LID) وأحياناً p.lid أو p.pn
            const adminNums = new Set(
                meta.participants
                    .filter(p => p.admin)
                    .flatMap(p => [
                        normalizeJid(p.id),
                        normalizeJid(p.lid || ''),
                        normalizeJid(p.pn  || ''),
                    ])
                    .filter(Boolean)
            );

            // نفحص المرسل بـ pn وبـ lid
            const senderPn  = normalizeJid(senderJid);
            const senderLid = normalizeJid(msg.sender?.lid || msg.key.participant || '');

            const isAdmin    = msg.key.fromMe ||
                               adminNums.has(senderPn) ||
                               (senderLid && adminNums.has(senderLid));

            const isBotAdmin = adminNums.has(botNum);

            return { meta, isGroup: true, isAdmin, isBotAdmin };
        } catch {
            return { isGroup: true, isAdmin: false, isBotAdmin: false, meta: null };
        }
    }

    // ينفذ اولاً ثم يشخص الخطا بدقة
    const tryAdminAction = async (fn, okEmoji = '✅') => {
        try { await fn(); react(sock, msg, okEmoji); return true; }
        catch (e) {
            const { isGroup, isAdmin, isBotAdmin } = await getAdminPerms();
            if (!isGroup)    { await update('❌ هذا الامر للمجموعات فقط.');     return false; }
            if (!isBotAdmin) { await update('❌ البوت ليس مشرفا، رقه اولا.'); return false; }
            if (!isAdmin)    { await update('❌ انت لست مشرفا.');               return false; }
            await update(`❌ فشل: ${e?.message || e}`); return false;
        }
    };

    const cleanup = () => {
        sock.ev.off('messages.upsert', listener);
        clearTimeout(timeout);
        sock.activeListeners?.delete(chatId);
        activeSessions.delete(chatId);
    };

    const listener = async ({ messages }) => {
        const m = messages[0];
        if (!m?.message || m.key.remoteJid !== chatId) return;

        // مقارنة JID بعد تطبيع (يدعم LID)
        const incoming = m.sender?.pn || m.key.participant || m.key.remoteJid;
        if (normalizeJid(incoming) !== normalizeJid(senderJid)) return;

        const text = (m.message.conversation || m.message.extendedTextMessage?.text || '').trim();
        if (!text) return;

        // ══════════════════════════════════════════════════
        // MAIN
        // ══════════════════════════════════════════════════
        if (state === 'MAIN') {
            if (text === 'نخبة')    { await showEliteMenu();   state = 'ELITE';    return; }
            if (text === 'بلاجنز')  { await showPluginsMenu(); state = 'PLUGINS';  return; }
            if (text === 'تنزيلات') { await showDlMenu();      state = 'DL_MENU';  return; }
            if (text === 'إحصاءات') { await showStats();       state = 'STATS';    return; }
            if (text === 'حماية')   { await showProtMenu();    state = 'PROT';     return; }
            if (text === 'اوامر')   { await showCmdTools();    state = 'CMDTOOLS'; return; }
            if (text === 'إدارة')   { await showAdminMenu();   state = 'ADMIN';    return; }
            return;
        }

        // ══════════════════════════════════════════════════
        // ELITE
        // ══════════════════════════════════════════════════
        if (state === 'ELITE') {
            if (text === 'رجوع') { await update(MAIN_MENU); state = 'MAIN'; return; }
            if (text === 'عرض') {
                try {
                    const list = await sock.getEliteList?.() || [];
                    if (!list.length) return update(`✧━── ❝ 𝐍𝐗𝐁𝐀 ❞ ──━✧\n\n📋 القائمة فارغة.\n\n🔙 *رجوع*\n\n✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
                    return update(`✧━── ❝ 𝐍𝐗𝐁𝐀 ❞ ──━✧\n\n👑 *قائمة النخبة:*\n\n${list.map((n,i)=>`${i+1}. ${n}`).join('\n')}\n\n🔙 *رجوع*\n\n✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
                } catch { return update('❌ تعذر جلب القائمة.\n\n🔙 *رجوع*'); }
            }
            if (text === 'اضافة')   { await update('📱 ارسل الرقم:\nمثال: 966501234567\n\n🔙 *رجوع*'); state = 'ELITE_ADD'; return; }
            if (text === 'حذف')     { await update('📱 ارسل الرقم للحذف:\n\n🔙 *رجوع*'); state = 'ELITE_DEL'; return; }
            if (text === 'مسح الكل') { await update('⚠️ *تاكيد مسح كل النخبة؟*\naكتب *نعم* او *رجوع*'); state = 'ELITE_CLEAR'; return; }
            return;
        }
        if (state === 'ELITE_ADD') {
            if (text === 'رجوع') { await showEliteMenu(); state = 'ELITE'; return; }
            const num = text.replace(/\D/g, '');
            if (num.length < 9) return update('❌ رقم غير صحيح.');
            try { await sock.addElite?.({ id: num + '@s.whatsapp.net' }); await update(`✅ تم اضافة [ ${num} ]`); } catch (e) { await update(`❌ ${e?.message}`); }
            await sleep(1200); await showEliteMenu(); state = 'ELITE'; return;
        }
        if (state === 'ELITE_DEL') {
            if (text === 'رجوع') { await showEliteMenu(); state = 'ELITE'; return; }
            const num = text.replace(/\D/g, '');
            if (num.length < 9) return update('❌ رقم غير صحيح.');
            try { await sock.removeElite?.({ id: num + '@s.whatsapp.net' }); await update(`✅ تم حذف [ ${num} ]`); } catch (e) { await update(`❌ ${e?.message}`); }
            await sleep(1200); await showEliteMenu(); state = 'ELITE'; return;
        }
        if (state === 'ELITE_CLEAR') {
            if (text === 'رجوع') { await showEliteMenu(); state = 'ELITE'; return; }
            if (text === 'نعم') {
                try { const list = await sock.getEliteList?.() || []; for (const id of list) { try { await sock.removeElite?.({ id }); } catch {} } await update('✅ تم مسح الكل.'); } catch (e) { await update(`❌ ${e?.message}`); }
                await sleep(1200); await showEliteMenu(); state = 'ELITE';
            }
            return;
        }

        // ══════════════════════════════════════════════════
        // PLUGINS
        // ══════════════════════════════════════════════════
        if (state === 'PLUGINS') {
            if (text === 'رجوع') { await update(MAIN_MENU); state = 'MAIN'; return; }
            if (text === 'عرض') {
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
                await update('🔙 *رجوع* | *بحث [اسم]* | *كود [اسم]*');
                return;
            }
            if (text.startsWith('بحث ')) {
                const cmdName = text.slice(4).trim();
                const fp = await findPluginByCmd(cmdName);
                if (!fp) return update(`❌ ما وجدت: ${cmdName}\n\n🔙 *رجوع*`);
                tmp.targetFile = fp; tmp.targetCmd = cmdName;
                await showPluginDetail(fp, cmdName); state = 'PLUGIN_EDIT'; return;
            }
            if (text.startsWith('كود ')) {
                const cmdName = text.slice(4).trim();
                const fp = await findPluginByCmd(cmdName);
                if (!fp) return update(`❌ ما وجدت: ${cmdName}`);
                try { await sock.sendMessage(chatId, { document: fs.readFileSync(fp), mimetype: 'application/javascript', fileName: path.basename(fp) }); } catch (e) { await update(`❌ ${e?.message}`); }
                return;
            }
            if (text === 'اضافة امر') { await update('📝 اكتب اسم الامر:\n\n🔙 *رجوع*'); state = 'PLUGIN_NEW_NAME'; return; }
            if (text === 'طفي الكل') { for (const f of getAllPluginFiles()) { if (f.includes('نظام')) continue; try { updatePluginField(f,'lock','on'); } catch {} } await loadPlugins().catch(()=>{}); await update('🔒 تم قفل الكل.'); return; }
            if (text === 'شغل الكل') { for (const f of getAllPluginFiles()) { if (f.includes('نظام')) continue; try { updatePluginField(f,'lock','off'); } catch {} } await loadPlugins().catch(()=>{}); await update('🔓 تم فتح الكل.'); return; }
            return;
        }
        if (state === 'PLUGIN_EDIT') {
            if (text === 'رجوع') { await showPluginsMenu(); state = 'PLUGINS'; return; }
            const fp = tmp.targetFile, tc = tmp.targetCmd;
            if (!fp) return;
            if (text === 'كود') { try { await sock.sendMessage(chatId, { document: fs.readFileSync(fp), mimetype: 'application/javascript', fileName: path.basename(fp) }); } catch (e) { await update(`❌ ${e?.message}`); } return; }
            if (text === 'قفل' || text === 'فتح') { try { updatePluginField(fp,'lock',text==='قفل'?'on':'off'); await loadPlugins().catch(()=>{}); } catch {} await sleep(800); await showPluginDetail(fp,tc); return; }
            if (text === 'نخبة' || text === 'عام') { try { updatePluginField(fp,'elite',text==='نخبة'?'on':'off'); await loadPlugins().catch(()=>{}); } catch {} await sleep(800); await showPluginDetail(fp,tc); return; }
            if (text === 'مجموعات') { try { updatePluginField(fp,'group','true'); updatePluginField(fp,'prv','false'); await loadPlugins().catch(()=>{}); } catch {} await sleep(800); await showPluginDetail(fp,tc); return; }
            if (text === 'خاص')    { try { updatePluginField(fp,'prv','true'); updatePluginField(fp,'group','false'); await loadPlugins().catch(()=>{}); } catch {} await sleep(800); await showPluginDetail(fp,tc); return; }
            if (text === 'للجميع') { try { updatePluginField(fp,'group','false'); updatePluginField(fp,'prv','false'); await loadPlugins().catch(()=>{}); } catch {} await sleep(800); await showPluginDetail(fp,tc); return; }
            if (text === 'تغيير الاسم') { await update(`✏️ اكتب الاسم الجديد:\n\n🔙 *رجوع*`); state = 'PLUGIN_RENAME'; return; }
            return;
        }
        if (state === 'PLUGIN_RENAME') {
            if (text === 'رجوع') { await showPluginDetail(tmp.targetFile, tmp.targetCmd); state = 'PLUGIN_EDIT'; return; }
            try { updatePluginField(tmp.targetFile,'command',text.trim()); await loadPlugins().catch(()=>{}); } catch {}
            await update(`✅ ${tmp.targetCmd} ➔ ${text.trim()}`);
            tmp.targetCmd = text.trim(); await sleep(1200); await showPluginDetail(tmp.targetFile, tmp.targetCmd); state = 'PLUGIN_EDIT'; return;
        }
        if (state === 'PLUGIN_NEW_NAME') {
            if (text === 'رجوع') { await showPluginsMenu(); state = 'PLUGINS'; return; }
            const name = text.trim().replace(/\.js$/,'').replace(/[^\w\u0600-\u06FF]/g,'');
            if (!name) return update('❌ اسم غير صحيح.\n\n🔙 *رجوع*');
            tmp.newPluginName = name; await update(`📝 ارسل كود الامر [ *${name}* ]:\n\n🔙 *رجوع*`);
            state = 'PLUGIN_NEW_CODE'; return;
        }
        if (state === 'PLUGIN_NEW_CODE') {
            if (text === 'رجوع') { await showPluginsMenu(); state = 'PLUGINS'; return; }
            const targetPath = path.join(PLUGINS_DIR, 'tools', `${tmp.newPluginName}.js`);
            try { fs.ensureDirSync(path.dirname(targetPath)); fs.writeFileSync(targetPath, text, 'utf8'); await loadPlugins().catch(()=>{}); react(sock, msg, '✅'); await update(`✅ تم إنشاء [ ${tmp.newPluginName} ]`); } catch (e) { await update(`❌ ${e?.message}`); }
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
                'انتي كراش':'antiCrash','انتي لينكات':'antiLink',
                'انتي حذف':'antiDelete','انتي سب':'antiInsult',
                'view once':'antiViewOnce','انتي خاص':'antiPrivate',
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
                try { if (global._pluginsCache) global._pluginsCache = {}; await loadPlugins().catch(()=>{}); react(sock, m, '✅'); await update('✅ تم المسح.'); } catch (e) { react(sock, m, '❌'); await update(`❌ ${e?.message}`); }
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
            if (checkRes.ok && !lintIssues.length) { report += '✅ *الكود سليم*\n'; }
            else {
                if (!checkRes.ok) { report += `❌ *خطا Syntax:*\n`; if (checkRes.line) report += `السطر: *${checkRes.line}*\n`; if (checkRes.codeLine) report += `\`${checkRes.codeLine}\`\n`; report += `\`${(checkRes.error||'').split('\n').slice(0,2).join(' ').slice(0,160)}\`\n\n`; }
                if (lintIssues.length) { report += `⚠️ *تحذيرات:*\n`; lintIssues.forEach(i => { report += `✦ ${i}\n`; }); }
            }
            report += '\n*نسخ* | *استعادة*\n🔙 *رجوع*\n\n✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧';
            tmp.checkFile = fp; tmp.checkCmd = text;
            await update(report); state = 'CODE_CHECK_RESULT'; return;
        }
        if (state === 'CODE_CHECK_RESULT') {
            if (text === 'رجوع') { await showCmdTools(); state = 'CMDTOOLS'; return; }
            if (text === 'نسخ') { try { fs.copyFileSync(tmp.checkFile, tmp.checkFile+'.bak'); react(sock, m, '💾'); await update(`💾 تم حفظ نسخة احتياطية.\n\n🔙 *رجوع*`); } catch (e) { await update(`❌ ${e?.message}`); } return; }
            if (text === 'استعادة') {
                const bak = tmp.checkFile + '.bak';
                if (!fs.existsSync(bak)) return update('❌ لا نسخة احتياطية.\n\n🔙 *رجوع*');
                try { fs.copyFileSync(bak, tmp.checkFile); fs.removeSync(bak); await loadPlugins().catch(()=>{}); react(sock, m, '↩️'); await update('↩️ تم الاستعادة.'); } catch (e) { await update(`❌ ${e?.message}`); }
                await sleep(800); await showCmdTools(); state = 'CMDTOOLS'; return;
            }
            return;
        }

        // ══════════════════════════════════════════════════
        // ADMIN
        // ══════════════════════════════════════════════════
        if (state === 'ADMIN') {
            if (text === 'رجوع') { await update(MAIN_MENU); state = 'MAIN'; return; }

            const memberActions = { 'رفع مشرف':'promote','تنزيل مشرف':'demote','طرد':'remove','حظر':'ban','الغاء حظر':'unban','كتم':'mute','الغاء كتم':'unmute' };
            if (memberActions[text]) {
                tmp.adminAction = memberActions[text];
                const hint = text === 'كتم' ? 'رد على رسالة العضو + اكتب عدد الدقائق مثال: 30' : 'رد على رسالة العضو او منشنه';
                await update(`📌 *${text}*\n\`${hint}\`\n\n🔙 *رجوع*`);
                state = 'ADMIN_TARGET'; return;
            }

            if (text === 'المشرفين') {
                const { meta, isGroup } = await getAdminPerms();
                if (!isGroup || !meta) return update('❌ للمجموعات فقط.');
                const admins = meta.participants.filter(p => p.admin);
                if (!admins.length) return update('📭 لا يوجد مشرفين.');
                const list = admins.map((a,i)=>`${i+1}. @${a.id.split('@')[0].split(':')[0]} ${a.admin==='superadmin'?'👑':''}`).join('\n');
                await sock.sendMessage(chatId, { text:`👑 *المشرفون (${admins.length}):*\n\n${list}`, mentions: admins.map(a=>a.id) }, { quoted: m });
                return;
            }

            if (text === 'رابط') {
                try { const code = await sock.groupInviteCode(chatId); await update(`🔗 https://chat.whatsapp.com/${code}`); }
                catch (e) { const {isGroup,isAdmin,isBotAdmin} = await getAdminPerms(); if(!isGroup) return update('❌ للمجموعات فقط.'); if(!isBotAdmin) return update('❌ البوت ليس مشرفا.'); if(!isAdmin) return update('❌ انت لست مشرفا.'); await update(`❌ ${e?.message}`); }
                return;
            }

            // تثبيت — يحتاج reply
            if (text === 'تثبيت' || text === 'الغاء التثبيت') {
                const ctx2 = m.message?.extendedTextMessage?.contextInfo;
                if (!ctx2?.stanzaId && text === 'تثبيت') return update('↩️ رد على الرسالة التي تريد تثبيتها اولاً.');
                react(sock, m, '⏳');
                try {
                    const pinKey = { remoteJid: chatId, id: ctx2?.stanzaId, participant: ctx2?.participant, fromMe: false };
                    const msgId  = generateMessageID();
                    await sock.relayMessage(chatId, {
                        pinInChatMessage: {
                            key: pinKey,
                            type: text === 'تثبيت' ? 1 : 2,
                            senderTimestampMs: BigInt(Date.now()),
                        },
                    }, { messageId: msgId });
                    react(sock, m, text === 'تثبيت' ? '📌' : '✅');
                } catch (e) {
                    const {isGroup,isAdmin,isBotAdmin} = await getAdminPerms();
                    if (!isGroup)    { react(sock, m, '❌'); return update('❌ للمجموعات فقط.'); }
                    if (!isBotAdmin) { react(sock, m, '❌'); return update('❌ البوت ليس مشرفا.'); }
                    if (!isAdmin)    { react(sock, m, '❌'); return update('❌ انت لست مشرفا.'); }
                    react(sock, m, '❌'); await update(`❌ ${e?.message}`);
                }
                return;
            }

            // مسح رسالة
            if (text === 'مسح') {
                const ctx2 = m.message?.extendedTextMessage?.contextInfo;
                if (!ctx2?.stanzaId) return update('↩️ رد على الرسالة التي تريد مسحها.');
                await tryAdminAction(() => sock.sendMessage(chatId, { delete: { remoteJid: chatId, fromMe: false, id: ctx2.stanzaId, participant: ctx2.participant } }), '🗑️');
                return;
            }

            if (text === 'قفل المحادثة') { await tryAdminAction(() => sock.groupSettingUpdate(chatId, 'announcement'), '🔒'); return; }
            if (text === 'فتح المحادثة') { await tryAdminAction(() => sock.groupSettingUpdate(chatId, 'not_announcement'), '🔓'); return; }

            // ترحيب: يرسل رسالة منفصلة
            if (text === 'ترحيب') {
                const wf = grpFile('welcome', chatId);
                if (!fs.existsSync(wf)) return update('📭 لا توجد رسالة ترحيب — استخدم *وضع ترحيب*.');
                const { text: wt } = readJSON(wf, {});
                await sock.sendMessage(chatId, { text: `👋 *رسالة الترحيب الحالية:*\n\n${wt}\n\n_استخدم {name} لمنشن العضو_` }, { quoted: m });
                await update('اكتب *حذف* لإزالتها | 🔙 *رجوع*');
                state = 'ADMIN_WELCOME_VIEW'; return;
            }

            // قوانين: رسالة منفصلة
            if (text === 'قوانين') {
                const rf = grpFile('rules', chatId);
                if (!fs.existsSync(rf)) return update('📭 لا توجد قوانين — استخدم *وضع قوانين*.');
                const { text: rt } = readJSON(rf, {});
                await sock.sendMessage(chatId, { text: `📜 *قوانين المجموعة:*\n\n${rt}` }, { quoted: m });
                await update('اكتب *حذف* لإزالتها | 🔙 *رجوع*');
                state = 'ADMIN_RULES_VIEW'; return;
            }

            if (text === 'وضع ترحيب') { await update('✍️ اكتب رسالة الترحيب:\n`استخدم {name} لمنشن العضو`\n\n🔙 *رجوع*'); state = 'ADMIN_SETWELCOME'; return; }
            if (text === 'وضع قوانين') { await update('✍️ اكتب القوانين:\n\n🔙 *رجوع*'); state = 'ADMIN_SETRULES'; return; }
            if (text === 'وضع اسم')    { await update('✍️ اكتب الاسم الجديد:\n\n🔙 *رجوع*'); state = 'ADMIN_SETNAME'; return; }
            if (text === 'وضع وصف')    { await update('✍️ اكتب الوصف الجديد:\n\n🔙 *رجوع*'); state = 'ADMIN_SETDESC'; return; }
            if (text === 'وضع صورة')   { await update('🖼️ ارسل او اقتبس صورة:\n\n🔙 *رجوع*'); state = 'ADMIN_SETIMG'; return; }

            if (text === 'كلمات ممنوعة') { await showBadwords(); state = 'ADMIN_BADWORDS'; return; }

            const LOCK_MAP = { 'قفل الروابط':'antiLink','قفل الصور':'images','قفل الفيديو':'videos','قفل البوتات':'bots' };
            if (LOCK_MAP[text]) {
                const pf = grpFile('locks', chatId); const p = readJSON(pf, {}); const key2 = LOCK_MAP[text];
                p[key2] = p[key2]==='on'?'off':'on'; writeJSON(pf, p);
                react(sock, m, p[key2]==='on'?'✅':'⛔'); await update(`${p[key2]==='on'?'✅':'⛔'} ${text}: *${p[key2]}*`);
                await sleep(800); await showAdminMenu(); return;
            }

            if (text === 'معلومات') {
                const plugins = getPlugins(); const up = process.uptime();
                const h = Math.floor(up/3600), mm2 = Math.floor((up%3600)/60), ss2 = Math.floor(up%60);
                const ram = os.totalmem(), free = os.freemem();
                let groups = 0; try { groups = Object.keys(await sock.groupFetchAllParticipating()).length; } catch {}
                await update(`✧━── ❝ 𝐈𝐍𝐅𝐎 ❞ ──━✧\n\n✦ *التشغيل:* ${h}h ${mm2}m ${ss2}s\n✦ *الذاكرة:* ${((ram-free)/1024/1024).toFixed(0)}/${(ram/1024/1024).toFixed(0)} MB\n✦ *الاوامر:* ${Object.keys(plugins).length}\n✦ *المجموعات:* ${groups}\n\n🔙 *رجوع*\n\n✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
                return;
            }

            if (text === 'اذاعة') { await update('📢 اكتب رسالة الإذاعة:\n\n🔙 *رجوع*'); state = 'ADMIN_BROADCAST'; return; }
            if (text === 'انضم')  { await update('🔗 ارسل رابط المجموعة:\n\n🔙 *رجوع*'); state = 'ADMIN_JOIN'; return; }
            if (text === 'خروج')  { await update('⚠️ تاكيد مغادرة المجموعة؟\naكتب *نعم* او *رجوع*'); state = 'ADMIN_LEAVE'; return; }
            if (text === 'تحديث') { react(sock, m, '⏳'); try { await loadPlugins(); react(sock, m, '✅'); await update('✅ تم التحديث.'); } catch (e) { react(sock, m, '❌'); await update(`❌ ${e?.message}`); } return; }
            return;
        }

        // ── ADMIN_TARGET ──────────────────────────────────
        if (state === 'ADMIN_TARGET') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }

            // resolveTarget يحل LID → phone JID
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
                    await sock.sendMessage(chatId, { text: `🔇 تم كتم @${target.split('@')[0].split(':')[0]} لمدة ${mins} دقيقة`, mentions: [target] });
                    setTimeout(async () => { try { await sock.groupParticipantsUpdate(chatId, [target], 'promote'); } catch {} }, mins * 60_000);
                }, '🔇');
            } else if (action === 'unmute') {
                await tryAdminAction(() => sock.groupParticipantsUpdate(chatId, [target], 'promote'), '🔊');
            }

            await sleep(600); await showAdminMenu(); state = 'ADMIN'; return;
        }

        if (state === 'ADMIN_SETNAME') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
            react(sock, m, '⏳'); await tryAdminAction(() => sock.groupUpdateSubject(chatId, text), '✅');
            await sleep(800); await showAdminMenu(); state = 'ADMIN'; return;
        }
        if (state === 'ADMIN_SETDESC') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
            react(sock, m, '⏳'); await tryAdminAction(() => sock.groupUpdateDescription(chatId, text), '✅');
            await sleep(800); await showAdminMenu(); state = 'ADMIN'; return;
        }
        if (state === 'ADMIN_SETIMG') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
            const ctx2   = m.message?.extendedTextMessage?.contextInfo;
            const imgMsg = m.message?.imageMessage || ctx2?.quotedMessage?.imageMessage;
            if (!imgMsg) return update('🖼️ ارسل او اقتبس صورة فقط.\n\n🔙 *رجوع*');
            react(sock, m, '⏳');
            try {
                const target2 = m.message?.imageMessage ? m : { message: ctx2.quotedMessage, key: { ...m.key, id: ctx2.stanzaId, participant: ctx2.participant } };
                const buf = await downloadMediaMessage(target2, 'buffer', {});
                await tryAdminAction(() => sock.updateProfilePicture(chatId, buf), '✅');
            } catch (e) { react(sock, m, '❌'); await update(`❌ ${e?.message}`); }
            await sleep(800); await showAdminMenu(); state = 'ADMIN'; return;
        }
        if (state === 'ADMIN_SETWELCOME') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
            writeJSON(grpFile('welcome', chatId), { text });
            react(sock, m, '✅');
            await update(`✅ تم حفظ رسالة الترحيب.\n\nسيتم منشنة اي حد يدخل تلقائياً.\n\n🔙 *رجوع*`);
            await sleep(800); await showAdminMenu(); state = 'ADMIN'; return;
        }
        if (state === 'ADMIN_SETRULES') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
            writeJSON(grpFile('rules', chatId), { text });
            react(sock, m, '✅');
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
            const bf = grpFile('badwords', chatId); let words = readJSON(bf, []);
            if (text.startsWith('اضافة ')) { const w = text.slice(6).trim(); if (w) { words.push(w.toLowerCase()); writeJSON(bf, words); react(sock, m, '✅'); } await sleep(400); await showBadwords(); return; }
            if (text.startsWith('حذف '))   { writeJSON(bf, words.filter(x => x !== text.slice(4).trim())); react(sock, m, '🗑️'); await sleep(400); await showBadwords(); return; }
            return;
        }
        if (state === 'ADMIN_BROADCAST') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
            react(sock, m, '⏳');
            try { const chats = await sock.groupFetchAllParticipating(); let sent = 0; for (const gid of Object.keys(chats)) { try { await sock.sendMessage(gid, { text }); sent++; } catch {} await sleep(500); } react(sock, m, '✅'); await update(`✅ الإرسال لـ ${sent} مجموعة.`); } catch (e) { await update(`❌ ${e?.message}`); }
            await sleep(1000); await showAdminMenu(); state = 'ADMIN'; return;
        }
        if (state === 'ADMIN_JOIN') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
            const match = text.match(/chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/i);
            if (!match) return update('❌ رابط غير صحيح.\n\n🔙 *رجوع*');
            react(sock, m, '⏳');
            try { await sock.groupAcceptInvite(match[1]); react(sock, m, '✅'); await update('✅ تم الانضمام.'); } catch (e) { react(sock, m, '❌'); await update(`❌ ${e?.message}`); }
            await sleep(800); await showAdminMenu(); state = 'ADMIN'; return;
        }
        if (state === 'ADMIN_LEAVE') {
            if (text === 'رجوع') { await showAdminMenu(); state = 'ADMIN'; return; }
            if (text === 'نعم') { try { await sock.groupLeave(chatId); } catch (e) { await update(`❌ ${e?.message}`); } }
            state = 'ADMIN'; return;
        }

    }; // نهاية listener

    // ══════════════════════════════════════════════════════
    //  download handler
    // ══════════════════════════════════════════════════════
    async function handleDownload(url, audioOnly, m) {
        const platform = detectPlatform(url) || 'رابط';
        const icon     = audioOnly ? '🎵' : '🎬';
        react(sock, m, '⏳');
        await update(`${icon} *جاري تحميل ${platform}...*\nقد يأخذ بضع ثوانٍ.`);
        try {
            const { filePath, ext, cleanup } = await ytdlpDownload(url, { audio: audioOnly });
            const isVideo = ['mp4','mkv','webm','mov','avi'].includes(ext);
            const isAudio = ['mp3','m4a','ogg','aac','opus','wav'].includes(ext);
            const isImage = ['jpg','jpeg','png','webp','gif'].includes(ext);
            const fileSize= fs.statSync(filePath).size;

            if (fileSize > 60 * 1024 * 1024) {
                cleanup();
                return update('❌ الملف أكبر من 60MB — جرّب طلب الصوت بدل الفيديو.\n\n🔙 *رجوع*');
            }

            const buffer = fs.readFileSync(filePath); cleanup();

            if (isVideo)      await sock.sendMessage(chatId, { video: buffer, caption: `${icon} ${platform}` }, { quoted: m });
            else if (isAudio) await sock.sendMessage(chatId, { audio: buffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: m });
            else if (isImage) await sock.sendMessage(chatId, { image: buffer, caption: `${icon} ${platform}` }, { quoted: m });
            else              await sock.sendMessage(chatId, { document: buffer, mimetype: 'application/octet-stream', fileName: path.basename(filePath), caption: `${icon} ${platform}` }, { quoted: m });

            react(sock, m, '✅');
            await update(`✅ *تم التحميل!*\n\n🔙 *رجوع*`);
        } catch (e) {
            react(sock, m, '❌');
            const errText = e?.message || '';
            let hint = '';
            if (errText.includes('غير مثبت') || errText.includes('yt-dlp'))
                hint = '\n\n💡 شغّل: `pip install -U yt-dlp`';
            else if (errText.toLowerCase().includes('private') || errText.includes('login'))
                hint = '\n\n⚠️ المحتوى خاص أو يحتاج تسجيل دخول.';
            else if (errText.includes('not a') || errText.includes('Unsupported URL') || errText.includes('unable to extract'))
                hint = '\n\n⚠️ الرابط غير مدعوم أو غير صحيح.';
            else if (errText.includes('filesize') || errText.includes('large') || errText.includes('60MB'))
                hint = '\n\n⚠️ الملف كبير جداً — جرّب /تحميل صوت.';
            await update(`❌ *فشل التحميل*\n\`${errText.slice(0, 150)}\`${hint}\n\n🔙 *رجوع*`);
        }
    }

    // ══════════════════════════════════════════════════════
    //  قوائم
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

📦 الاوامر: *${count}*

✦ *عرض*
\`📋 قائمة كل الاوامر\`

✦ *بحث [اسم]*
\`🔍 تفاصيل وتعديل\`

✦ *كود [اسم]*
\`💻 تحميل الكود\`

✦ *اضافة امر*
\`➕ امر جديد\`

✦ *طفي الكل* | *شغل الكل*
\`🔒 قفل او فتح الكل\`

🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showPluginDetail(fp, cmd) {
        const { elite, lock, group, prv } = getPluginInfo(fp);
        await update(
`✧━── ❝ 𝐏𝐋𝐔𝐆𝐈𝐍 ❞ ──━✧

*[ ${cmd} ] 📋*

✦ نخبة:     ${elite==='on'?'✅':'❌'}
✦ قفل:      ${lock==='on'?'✅':'❌'}
✦ مجموعات:  ${group?'✅':'❌'}
✦ خاص:      ${prv?'✅':'❌'}

\`نخبة | عام | قفل | فتح\`
\`مجموعات | خاص | للجميع\`
\`تغيير الاسم | كود\`

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

*المصادر:*
يوتيوب | انستقرام | تيك توك
فيسبوك | بنترست | تويتر | ساوند كلاود

🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showStats() {
        const s = readStats();
        const topCmds  = Object.entries(s.commands||{}).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v],i)=>`${i+1}. ${k}: *${v}*`).join('\n') || 'لا يوجد';
        const topUsers = Object.entries(s.users||{}).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v],i)=>`${i+1}. ${k.split('@')[0]}: *${v}*`).join('\n') || 'لا يوجد';
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

\`مسح\` لتصفير | 🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showProtMenu() {
        const p = readProt(), s = k => p[k]==='on'?'✅':'⛔';
        await update(
`✧━── ❝ 𝐏𝐑𝐎𝐓𝐄𝐂𝐓𝐈𝐎𝐍 ❞ ──━✧

✦ *انتي كراش* ${s('antiCrash')}
\`💥 حماية من رسائل التجميد\`

✦ *انتي لينكات* ${s('antiLink')}
\`🔗 حذف اي رابط مشهور بالمجموعة\`

✦ *انتي حذف* ${s('antiDelete')}
\`🗑️ إظهار الرسائل المحذوفة\`

✦ *انتي سب* ${s('antiInsult')}
\`🤬 حذف الكلمات البذيئة\`

✦ *view once* ${s('antiViewOnce')}
\`👁️ كشف وسائط المشاهدة لمرة\`

✦ *انتي خاص* ${s('antiPrivate')}
\`🚫 حظر من يراسل البوت في الخاص\`

\`اكتب اسم الميزة لتشغيلها او إيقافها\`
🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
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

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showAdminMenu() {
        await update(
`✧━── ❝ 𝐀𝐃𝐌𝐈𝐍 ❞ ──━✧

*👥 الاعضاء:*
\`رفع مشرف | تنزيل مشرف | المشرفين\`
\`طرد | حظر | الغاء حظر\`
\`كتم [دقائق] | الغاء كتم\`

*📌 الرسائل:*
\`تثبيت | الغاء التثبيت | مسح\`

*⚙️ المجموعة:*
\`وضع اسم | وضع وصف | وضع صورة\`
\`قفل المحادثة | فتح المحادثة | رابط\`

*👋 المحتوى:*
\`وضع ترحيب | ترحيب\`
\`وضع قوانين | قوانين\`
\`كلمات ممنوعة\`

*🔒 قفل المحتوى:*
\`قفل الروابط | قفل الصور\`
\`قفل الفيديو | قفل البوتات\`

*🤖 ادوات:*
\`معلومات | اذاعة | تحديث\`
\`انضم | خروج\`

🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    async function showBadwords() {
        const bf = grpFile('badwords', chatId); const words = readJSON(bf, []);
        const list = words.length ? words.map((w,i)=>`${i+1}. ${w}`).join('\n') : 'لا يوجد كلمات';
        await update(
`✧━── ❝ 𝐁𝐀𝐃𝐖𝐎𝐑𝐃𝐒. ❞ ──━✧

*الكلمات الممنوعة 🚫:*
${list}

\`اضافة [كلمة]\`
\`حذف [كلمة]\`
🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    // تسجيل الجلسة
    sock.ev.on('messages.upsert', listener);
    const timeout = setTimeout(() => { cleanup(); }, 300_000);
    sock.activeListeners?.set(chatId, cleanup);
    activeSessions.set(chatId, { listener, timeout });
}

export default { NovaUltra, execute };
