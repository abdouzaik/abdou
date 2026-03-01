// ════════════════════════════════════════════════
//   ملف التفعيلات — لوحة تحكم كاملة
// ════════════════════════════════════════════════
import fs from 'fs';
import path from 'path';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';

// ── إدارة ملف الإعدادات ──
const dataDir  = path.join(process.cwd(), 'nova', 'data');
const featPath = path.join(dataDir, 'features.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function loadF() {
    try {
        if (!fs.existsSync(featPath)) return { groups: {}, antiPrivate: false };
        return JSON.parse(fs.readFileSync(featPath, 'utf8'));
    } catch { return { groups: {}, antiPrivate: false }; }
}

function saveF(d) {
    try { fs.writeFileSync(featPath, JSON.stringify(d, null, 2), 'utf8'); } catch (e) { console.error('[تفعيلات] saveF:', e.message); }
}

function getGroup(d, gid) {
    if (!d.groups) d.groups = {};
    if (!d.groups[gid]) d.groups[gid] = {
        antiLink:        { enabled: false, warns: {} },
        antiToxic:       { enabled: false, warns: {} },
        antiViewOnce:    false,
        antiBot:         false,
        antiAdminChange: false
    };
    return d.groups[gid];
}

async function isAdmin(sock, chatId, sender) {
    try {
        const meta = await sock.groupMetadata(chatId);
        const normalized = sender.replace(/:\d+/, '');
        return meta.participants.some(p => {
            const pid = p.id.replace(/:\d+/, '');
            return pid === normalized && (p.admin === 'admin' || p.admin === 'superadmin');
        });
    } catch { return false; }
}

// ════════════════════════════════════════════════
//   المعالجات التلقائية
// ════════════════════════════════════════════════
if (!global.featureHandlers) global.featureHandlers = [];
if (!global.groupEvHandlers) global.groupEvHandlers = [];

// امسح النسخ القديمة عند إعادة التحميل
global.featureHandlers = global.featureHandlers.filter(h => h._src !== 'تفعيلات');
global.groupEvHandlers = global.groupEvHandlers.filter(h => h._src !== 'تفعيلات');

// ─── مضاد الروابط ────────────────────────────────
const LINK_REGEX = /(https?:\/\/[^\s]+|chat\.whatsapp\.com\/[^\s]+|wa\.me\/[^\s]+)/i;

async function fAntiLink(sock, msg, { isGroup, chatId }) {
    if (!isGroup || msg.key.fromMe) return true;
    const d = loadF();
    const g = getGroup(d, chatId);
    if (!g.antiLink.enabled) return true;

    const text = msg.message?.conversation ||
                 msg.message?.extendedTextMessage?.text ||
                 msg.message?.imageMessage?.caption || '';
    if (!LINK_REGEX.test(text)) return true;

    const sender = msg.key.participant;
    if (!sender) return true;
    if (await isAdmin(sock, chatId, sender)) return true;

    g.antiLink.warns[sender] = (g.antiLink.warns[sender] || 0) + 1;
    const w = g.antiLink.warns[sender];
    try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}

    if (w >= 3) {
        g.antiLink.warns[sender] = 0;
        saveF(d);
        await sock.sendMessage(chatId, {
            text: `⛔ @${sender.split('@')[0]} تم طرده بسبب نشر الروابط (3/3)`,
            mentions: [sender]
        });
        try { await sock.groupParticipantsUpdate(chatId, [sender], 'remove'); } catch {}
    } else {
        saveF(d);
        await sock.sendMessage(chatId, {
            text: `⚠️ @${sender.split('@')[0]} تحذير ${w}/3 — ممنوع نشر الروابط`,
            mentions: [sender]
        });
    }
    return false;
}
fAntiLink._src = 'تفعيلات';
global.featureHandlers.push(fAntiLink);

// ─── مضاد الشتائم ─────────────────────────────────
const TOXIC = /(كسمك|كس\s|زب\s|نيك|متناك|خول|شرموط|لبوه|عرص|قحبة|منيوك|زبي|طيز|كساسك|كس امك|زب امك|قحبه|منيك|ابن الشرموطة|ابن القحبة|عاهرة|لبوة|ابن الحرام|ولد الزنا|كسخت|قواد|مأبون)/i;

async function fAntiToxic(sock, msg, { isGroup, chatId }) {
    if (!isGroup || msg.key.fromMe) return true;
    const d = loadF();
    const g = getGroup(d, chatId);
    if (!g.antiToxic.enabled) return true;

    const text = msg.message?.conversation ||
                 msg.message?.extendedTextMessage?.text ||
                 msg.message?.imageMessage?.caption || '';
    if (!TOXIC.test(text)) return true;

    const sender = msg.key.participant;
    if (!sender) return true;
    if (await isAdmin(sock, chatId, sender)) return true;

    g.antiToxic.warns[sender] = (g.antiToxic.warns[sender] || 0) + 1;
    const w = g.antiToxic.warns[sender];
    try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}

    if (w >= 3) {
        g.antiToxic.warns[sender] = 0;
        saveF(d);
        await sock.sendMessage(chatId, {
            text: `⛔ @${sender.split('@')[0]} تم طرده بسبب الشتائم (3/3)`,
            mentions: [sender]
        });
        try { await sock.groupParticipantsUpdate(chatId, [sender], 'remove'); } catch {}
    } else {
        saveF(d);
        await sock.sendMessage(chatId, {
            text: `⚠️ @${sender.split('@')[0]} تحذير ${w}/3 — ممنوع الشتم`,
            mentions: [sender]
        });
    }
    return false;
}
fAntiToxic._src = 'تفعيلات';
global.featureHandlers.push(fAntiToxic);

// ─── مضاد الخاص ───────────────────────────────────
async function fAntiPrivate(sock, msg, { isGroup, chatId }) {
    if (isGroup || msg.key.fromMe) return true;
    const d = loadF();
    if (!d.antiPrivate) return true;

    try {
        await sock.sendMessage(chatId, {
            text: `❍━═━═━═━❍\n❍⇇ ممنوع الكلام في الخاص\n❍⇇ تم حظرك تلقائياً\n❍━═━═━═━❍`
        });
        await sock.updateBlockStatus(chatId, 'block');
    } catch (e) { console.error('[antiPrivate]', e.message); }
    return false;
}
fAntiPrivate._src = 'تفعيلات';
global.featureHandlers.push(fAntiPrivate);

// ─── مضاد المشاهدة ────────────────────────────────
async function fAntiViewOnce(sock, msg, { isGroup, chatId }) {
    if (!isGroup) return true;
    const d = loadF();
    const g = getGroup(d, chatId);
    if (!g.antiViewOnce) return true;

    // baileys يخزن viewOnce بعدة طرق
    const vMsg =
        msg.message?.viewOnceMessage?.message ||
        msg.message?.viewOnceMessageV2?.message ||
        msg.message?.viewOnceMessageV2Extension?.message ||
        msg.message?.ephemeralMessage?.message?.viewOnceMessage?.message;

    if (!vMsg) return true;

    const mtype = Object.keys(vMsg).find(k =>
        ['imageMessage', 'videoMessage'].includes(k)
    );
    if (!mtype) return true;

    try {
        const stream = await downloadContentFromMessage(
            vMsg[mtype],
            mtype.replace('Message', '')
        );
        let buf = Buffer.alloc(0);
        for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);

        await sock.sendMessage(chatId, {
            [mtype.replace('Message', '')]: buf,
            caption: (vMsg[mtype]?.caption || '') + '\n\n👁 *كُشف بواسطة مضاد المشاهدة*'
        });
    } catch (e) { console.error('[antiViewOnce]', e.message); }
    return true;
}
fAntiViewOnce._src = 'تفعيلات';
global.featureHandlers.push(fAntiViewOnce);

// ─── مضاد البوتات (حدث المجموعة) ─────────────────
async function evAntiBot(sock, { id, participants, action }) {
    if (action !== 'add') return;
    const d = loadF();
    const g = d.groups?.[id];
    if (!g?.antiBot) return;
    for (const p of participants) {
        const num = p.replace(/[^0-9]/g, '');
        // أرقام أطول من 13 رقم = غالباً بوت
        if (num.length > 13) {
            try {
                await sock.sendMessage(id, {
                    text: `🤖 تم اكتشاف بوت وإزالته @${num}`,
                    mentions: [p]
                });
                await sock.groupParticipantsUpdate(id, [p], 'remove');
            } catch {}
        }
    }
}
evAntiBot._src = 'تفعيلات';
global.groupEvHandlers.push(evAntiBot);

// ─── مضاد الإشراف (حدث المجموعة) ─────────────────
async function evAntiAdmin(sock, { id, participants, action }) {
    if (action !== 'demote') return;
    const d = loadF();
    const g = d.groups?.[id];
    if (!g?.antiAdminChange) return;
    for (const p of participants) {
        try {
            await sock.groupParticipantsUpdate(id, [p], 'promote');
            await sock.sendMessage(id, {
                text: `🛡 تم استعادة إشراف @${p.split('@')[0]} تلقائياً`,
                mentions: [p]
            });
        } catch (e) { console.error('[antiAdminChange]', e.message); }
    }
}
evAntiAdmin._src = 'تفعيلات';
global.groupEvHandlers.push(evAntiAdmin);

// ════════════════════════════════════════════════
//   أمر التفعيلات
// ════════════════════════════════════════════════
const FEATURES = {
    'مضاد_روابط':  { key: 'antiLink',        label: 'مضاد الروابط',  group: true,  nested: true  },
    'مضاد_شتائم':  { key: 'antiToxic',       label: 'مضاد الشتائم',  group: true,  nested: true  },
    'مضاد_مشاهدة': { key: 'antiViewOnce',    label: 'مضاد المشاهدة', group: true,  nested: false },
    'مضاد_بوتات':  { key: 'antiBot',         label: 'مضاد البوتات',  group: true,  nested: false },
    'مضاد_اشراف':  { key: 'antiAdminChange', label: 'مضاد الإشراف',  group: true,  nested: false },
    'مضاد_خاص':    { key: 'antiPrivate',     label: 'مضاد الخاص',    group: false, nested: false },
};

function getVal(g, feat) {
    const v = feat.group ? g?.[feat.key] : null;
    if (v === undefined || v === null) return false;
    return feat.nested ? v.enabled : v;
}

const NovaUltra = {
    command: ['تفعيلات', 'تفعيل', 'تعطيل'],
    description: 'لوحة تحكم التفعيلات',
    elite: 'off',
    group: false,
    prv: false,
    lock: 'on',
};

async function execute({ sock, msg, args }) {
    const chatId    = msg.key.remoteJid;
    const isGroup   = chatId.endsWith('@g.us');
    const d         = loadF();

    // استخرج الأمر من نص الرسالة
    const rawText   = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const parts     = rawText.trim().split(/\s+/);
    // أزل البريفكس من أول كلمة
    const cmdWord   = parts[0].replace(/^[^\u0600-\u06FFa-zA-Z0-9]/, '').toLowerCase();
    const fname     = args[0];

    // ─ عرض القائمة ─
    if (cmdWord === 'تفعيلات' || !fname) {
        let txt = `╔══════════════════╗\n║  ⚙️  التـفـعـيـلات   ║\n╚══════════════════╝\n`;
        if (isGroup) {
            const g = getGroup(d, chatId);
            txt += `\n📌 *إعدادات المجموعة:*\n`;
            for (const [k, f] of Object.entries(FEATURES)) {
                if (!f.group) continue;
                txt += `${getVal(g, f) ? '✅' : '❌'} ${f.label}  ‹${k}›\n`;
            }
        }
        txt += `\n🌐 *إعدادات عامة:*\n`;
        txt += `${d.antiPrivate ? '✅' : '❌'} مضاد الخاص  ‹مضاد_خاص›\n`;
        txt += `\n💡 *تفعيل:*  \`تفعيل مضاد_روابط\`\n💡 *تعطيل:* \`تعطيل مضاد_روابط\``;
        return await sock.sendMessage(chatId, { text: txt }, { quoted: msg });
    }

    // ─ تفعيل / تعطيل ─
    const feature = FEATURES[fname];
    if (!feature) {
        return await sock.sendMessage(chatId, {
            text: `❌ اسم غير صحيح.\n\nالأسماء المتاحة:\n${Object.keys(FEATURES).map(k => `• ${k}`).join('\n')}`
        }, { quoted: msg });
    }

    const enable = cmdWord === 'تفعيل';

    if (feature.group) {
        if (!isGroup) return await sock.sendMessage(chatId, {
            text: '❌ هذه الميزة تعمل في المجموعات فقط.'
        }, { quoted: msg });
        const g = getGroup(d, chatId);
        if (feature.nested) g[feature.key].enabled = enable;
        else                g[feature.key]         = enable;
    } else {
        d[feature.key] = enable;
    }

    saveF(d);
    await sock.sendMessage(chatId, { react: { text: enable ? '✅' : '❌', key: msg.key } });
    await sock.sendMessage(chatId, {
        text: `${enable ? '✅ تم تفعيل' : '❌ تم تعطيل'} *${feature.label}*`
    }, { quoted: msg });
}

export default { NovaUltra, execute };
