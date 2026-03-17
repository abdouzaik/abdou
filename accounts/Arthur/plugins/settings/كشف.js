// ══════════════════════════════════════════════════════════════
//  كشف.js — Silent Bot Scanner v2
//
//  الأوامر:
//  .تفعيل  — في الخاص: تحديد المجموعة المراقبة
//  .كشف    — في المجموعة: استخراج النتائج + تنظيف
//
//  محركات الكشف (صامتة بالكامل — لا ترسل أي شيء):
//  1. Baileys Message-ID  — معرّف يبدأ بـ 3EB0 طوله 20
//  2. Instant Receipt     — استجابة receipt < 150ms
//  3. Zero Jitter         — انحراف معياري < 40ms
//  4. Read-Without-Online — قرأ بدون حضور في آخر 5 ثوانٍ
//  5. Ghost Connect       — ظهر "متصل" لأقل من 2 ثانية فقط
// ══════════════════════════════════════════════════════════════

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── State ────────────────────────────────────────────────────
const activeGroups  = new Set();          // مجموعات المراقبة النشطة
const _detected     = new Map();          // jid → { groupId, reasons }
const _receiptLog   = new Map();          // msgId → { sentAt, groupId }
const _latencyBuf   = new Map();          // jid → [latencyMs…]
const _presenceTs   = new Map();          // jid → { connectedAt, lastSeen }
const _pending      = new Map();          // chatId → { groups, timer } لجلسة .تفعيل

const REGISTERED    = Symbol('v2scanner');

// ── ثوابت الكشف ──────────────────────────────────────────────
const BAILEYS_PREFIX         = '3EB0';
const BAILEYS_ID_LEN         = 20;
const RECEIPT_BOT_MS         = 150;
const JITTER_STDEV_MAX       = 40;
const LATENCY_MIN_SAMPLES    = 4;
const READ_NO_PRESENT_MS     = 5_000;
const GHOST_CONNECT_MAX_MS   = 2_000;   // ظهر ثم اختفى في أقل من 2 ثانية

const norm = j => j?.split('@')[0]?.split(':')[0] || '';

function stdev(arr) {
    if (arr.length < 2) return 9999;
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((s, v) => s + (v - avg) ** 2, 0) / arr.length);
}

function flag(jid, groupId, reason) {
    const key = `${jid}::${groupId}`;
    if (!_detected.has(key)) _detected.set(key, { jid, groupId, reasons: new Set() });
    _detected.get(key).reasons.add(reason);
}

// ══════════════════════════════════════════════════════════════
//  محرك الكشف الصامت
// ══════════════════════════════════════════════════════════════
function startScanner(sock) {
    if (sock[REGISTERED]) return;
    sock[REGISTERED] = true;

    // ──────────────────────────────────────────────────────────
    //  ثغرة 1: Baileys Message-ID Signature
    // ──────────────────────────────────────────────────────────
    sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            try {
                if (msg.key.fromMe) continue;
                const groupId = msg.key.remoteJid;
                if (!activeGroups.has(groupId)) continue;          // ← فقط المجموعات النشطة

                const jid   = msg.key.participant || groupId;
                const msgId = msg.key.id || '';

                // توقيع Baileys
                if (msgId.startsWith(BAILEYS_PREFIX) && msgId.length === BAILEYS_ID_LEN) {
                    flag(jid, groupId, 'BAILEYS_ID');
                }

                // سجّل الرسالة لقياس receipt لاحقاً
                _receiptLog.set(msgId, { sentAt: Date.now(), groupId });
                if (_receiptLog.size > 1000) _receiptLog.delete(_receiptLog.keys().next().value);
            } catch {}
        }
    });

    // ──────────────────────────────────────────────────────────
    //  ثغرة 2 + 3 + 4: Receipt Latency / Zero Jitter / Read-Without-Online
    // ──────────────────────────────────────────────────────────
    sock.ev.on('message-receipt.update', (updates) => {
        const now = Date.now();
        for (const update of (updates || [])) {
            try {
                const msgId   = update.key?.id;
                const groupId = update.key?.remoteJid;
                const jid     = update.key?.participant || groupId;
                if (!msgId || !jid) continue;
                if (!activeGroups.has(groupId)) continue;           // ← فقط المجموعات النشطة

                const logged = _receiptLog.get(msgId);
                if (logged) {
                    const latency = now - logged.sentAt;

                    // ثغرة 2: استجابة أسرع من 150ms
                    if (latency > 0 && latency < RECEIPT_BOT_MS) {
                        flag(jid, groupId, 'INSTANT_RECEIPT');
                    }

                    // ثغرة 3: Zero Jitter — انحراف معياري
                    if (latency > 0 && latency < 30_000) {
                        if (!_latencyBuf.has(jid)) _latencyBuf.set(jid, []);
                        const buf = _latencyBuf.get(jid);
                        buf.push(latency);
                        if (buf.length > 20) buf.shift();
                        if (buf.length >= LATENCY_MIN_SAMPLES && stdev(buf) < JITTER_STDEV_MAX) {
                            flag(jid, groupId, 'ZERO_JITTER');
                        }
                    }
                }

                // ثغرة 4: Read-Without-Online
                const readTs = update.receipt?.readTimestamp;
                if (readTs) {
                    const pData    = _presenceTs.get(jid) || {};
                    const lastSeen = pData.lastSeen || 0;
                    const readMs   = readTs * 1000;
                    if (!lastSeen || (readMs - lastSeen) > READ_NO_PRESENT_MS) {
                        flag(jid, groupId, 'READ_NO_PRESENCE');
                    }
                }
            } catch {}
        }
    });

    // ──────────────────────────────────────────────────────────
    //  ثغرة 5: Ghost Connect — يظهر "متصل" ثم يختفي فوراً
    //  البوت يتصل لإرسال رسالة أو قراءة ثم يقطع خلال ثانيتين
    // ──────────────────────────────────────────────────────────
    sock.ev.on('presence.update', ({ id: groupId, presences }) => {
        if (!activeGroups.has(groupId)) return;
        const now = Date.now();
        for (const [jid, data] of Object.entries(presences || {})) {
            if (!_presenceTs.has(jid)) _presenceTs.set(jid, {});
            const pData = _presenceTs.get(jid);
            const s     = data?.lastKnownPresence;

            if (s === 'available') {
                pData.connectedAt = now;
                pData.lastSeen    = now;
            } else if (s === 'composing' || s === 'recording') {
                pData.lastSeen = now;
            } else if (s === 'unavailable' && pData.connectedAt) {
                const onlineDuration = now - pData.connectedAt;
                // كان online أقل من ثانيتين = ghost connect
                if (onlineDuration < GHOST_CONNECT_MAX_MS) {
                    flag(jid, groupId, 'GHOST_CONNECT');
                }
                pData.connectedAt = null;
            }
        }
    });
}

// ══════════════════════════════════════════════════════════════
//  Plugin Metadata (أمر .كشف للمجموعة + .تفعيل للخاص)
// ══════════════════════════════════════════════════════════════
const KashfPlugin = {
    command:     'كشف',
    description: 'Silent Bot Scanner',
    elite:       'on',
    group:       false,
    prv:         false,
    lock:        'off',
};

const TafeilPlugin = {
    command:     'تفعيل',
    description: 'تفعيل مراقبة مجموعة (في الخاص)',
    elite:       'on',
    group:       false,
    prv:         true,
    lock:        'off',
};

// ──────────────────────────────────────────────────────────────
//  .تفعيل — في الخاص فقط
// ──────────────────────────────────────────────────────────────
async function executeTafeil({ sock, msg }) {
    const chatId  = msg.key.remoteJid;
    const isGroup = chatId.endsWith('@g.us');
    if (isGroup) return;

    startScanner(sock);

    // جلب المجموعات
    let groups;
    try {
        const all = await sock.groupFetchAllParticipating();
        groups = Object.entries(all).map(([id, g]) => ({ id, name: g.subject || id }));
    } catch {
        return;
    }

    if (!groups.length) return;

    // ابن القائمة وأرسلها
    const list = groups.map((g, i) => `${i + 1}. ${g.name}`).join('\n');
    await sock.sendMessage(chatId, {
        text: `*اختر رقم المجموعة:*\n\n${list}`,
    }).catch(() => {});

    // احفظ الجلسة وانتظر الرد
    const timer = setTimeout(() => _pending.delete(chatId), 60_000);
    _pending.set(chatId, { groups, timer });
}

// ──────────────────────────────────────────────────────────────
//  معالج الرد على رقم المجموعة (featureHandler)
// ──────────────────────────────────────────────────────────────
async function pendingHandler(sock, msg) {
    try {
        if (!msg?.message || msg.key.fromMe) return;
        const chatId  = msg.key.remoteJid;
        if (chatId.endsWith('@g.us')) return;
        if (!_pending.has(chatId)) return;

        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const num  = parseInt(text);
        if (isNaN(num)) return;

        const { groups, timer } = _pending.get(chatId);
        clearTimeout(timer);
        _pending.delete(chatId);

        const chosen = groups[num - 1];
        if (!chosen) return;

        activeGroups.add(chosen.id);
        try { await sock.presenceSubscribe(chosen.id); } catch {}

        await sock.sendMessage(chatId, {
            text: `✅ *تم تشغيل وضع المراقبة في*\n_${chosen.name}_\n\nيمكنك الآن المراقبة.`,
        }).catch(() => {});
    } catch {}
}
pendingHandler._src = 'kashf_pending';

// تسجيل featureHandler
if (!global.featureHandlers) global.featureHandlers = [];
global.featureHandlers = global.featureHandlers.filter(h => h._src !== 'kashf_pending');
global.featureHandlers.push(pendingHandler);

// ──────────────────────────────────────────────────────────────
//  .كشف — في المجموعة
// ──────────────────────────────────────────────────────────────
async function executeKashf({ sock, msg }) {
    const chatId  = msg.key.remoteJid;
    const isGroup = chatId.endsWith('@g.us');
    if (!isGroup) return;

    startScanner(sock);

    // فقط البوتات المرصودة في هذه المجموعة
    const found = [..._detected.values()].filter(e => e.groupId === chatId);

    if (!found.length) return;

    let counter = 1;
    for (const entry of found) {
        const mention = entry.jid.includes('@') ? entry.jid : entry.jid + '@s.whatsapp.net';

        await sock.sendMessage(chatId, {
            text: `@${norm(mention)}\n*تم كشف البوت رقم ${counter}*`,
            mentions: [mention],
        }).catch(() => {});

        counter++;
        await new Promise(r => setTimeout(r, 1000));
    }

    // تنظيف الذاكرة لهذه المجموعة بعد الاستخراج
    activeGroups.delete(chatId);
    for (const key of [..._detected.keys()]) {
        if (key.endsWith(`::${chatId}`)) _detected.delete(key);
    }
}

// ──────────────────────────────────────────────────────────────
//  export: ملفان في export default — الـ loader يختار بـ command
// ──────────────────────────────────────────────────────────────
export const kashf  = { ...KashfPlugin,  execute: executeKashf  };
export const tafeil = { ...TafeilPlugin, execute: executeTafeil };

export default { ...KashfPlugin, execute: executeKashf };
