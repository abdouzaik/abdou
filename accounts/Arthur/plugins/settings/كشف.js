// ══════════════════════════════════════════════════════════════
//  كشف.js — Silent Bot Scanner v3 (Advanced Cybersecurity Edition)
//
//  الأوامر:
//  .هو     — في الخاص: جلب المجموعات وتحديد المجموعة المراقبة
//  .كشف    — في المجموعة: استخراج النتائج + تنظيف الذاكرة
//
//  محركات الكشف (صامتة بالكامل — لا ترسل أي شيء):
//  1. Signature ID        — كشف توقيعات مكتبات Node.js (3EB0, BAE5...)
//  2. Instant Receipt     — استجابة الخوادم (أقل من 150 ملي ثانية)
//  3. Zero Jitter         — انحراف معياري آلي (تذبذب شبه معدوم)
//  4. Read-Without-Online — قراءة الرسائل بدون الاتصال بالخادم
//  5. Ghost Connect       — اتصال برمجي سريع (أقل من ثانيتين)
// ══════════════════════════════════════════════════════════════

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── State (الذاكرة المؤقتة) ───────────────────────────────────
const activeGroups  = new Set();          // مجموعات المراقبة النشطة
const _detected     = new Map();          // jid → { groupId, reasons }
const _receiptLog   = new Map();          // msgId → { sentAt, groupId }
const _latencyBuf   = new Map();          // jid → [latencyMs…]
const _presenceTs   = new Map();          // jid → { connectedAt, lastSeen }
const _pending      = new Map();          // chatId → { groups, timer } لجلسة .هو

const REGISTERED    = Symbol('v3scanner_pro');

// ── ثوابت الكشف (Detection Thresholds) ────────────────────────
const BOT_SIGNATURES         = ['3EB0', 'BAE5', 'B24E', 'DF39']; // توقيعات مكتبات البوتات المعروفة
const VALID_ID_LENGTHS       = [16, 20, 22]; // أطوال المعرفات البرمجية
const RECEIPT_BOT_MS         = 150;     // استجابة الخادم
const JITTER_STDEV_MAX       = 40;      // أقصى انحراف معياري للبوت
const LATENCY_MIN_SAMPLES    = 3;       // أقل عدد عينات لحساب التذبذب
const READ_NO_PRESENT_MS     = 5_000;   // 5 ثواني
const GHOST_CONNECT_MAX_MS   = 2_000;   // ثانيتين كحد أقصى للاتصال الشوكي
const MAX_MEMORY_LOGS        = 1000;    // الحد الأقصى للسجلات لحماية الرام

// ── دوال مساعدة ───────────────────────────────────────────────
const norm = j => j?.split('@')[0]?.split(':')[0] || '';

// دالة حساب الانحراف المعياري (الـ Jitter)
function stdev(arr) {
    if (!arr || arr.length < 2) return 9999;
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / arr.length;
    return Math.sqrt(variance);
}

// دالة تسجيل البوتات المكتشفة
function flag(jid, groupId, reason) {
    const key = `${jid}::${groupId}`;
    if (!_detected.has(key)) {
        _detected.set(key, { jid, groupId, reasons: new Set() });
    }
    _detected.get(key).reasons.add(reason);
}

// ══════════════════════════════════════════════════════════════
//  محرك الكشف الصامت (The Core Engine)
// ══════════════════════════════════════════════════════════════
function startScanner(sock) {
    if (sock[REGISTERED]) return;
    sock[REGISTERED] = true;

    // ──────────────────────────────────────────────────────────
    //  ثغرة 1: Message-ID Signature (بصمة الحزمة)
    // ──────────────────────────────────────────────────────────
    sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            try {
                if (msg.key.fromMe) continue;
                const groupId = msg.key.remoteJid;
                
                // تجاهل الرسائل خارج المجموعات المراقبة لتوفير الموارد
                if (!activeGroups.has(groupId)) continue;          

                const jid   = msg.key.participant || groupId;
                const msgId = msg.key.id || '';

                // فحص توقيعات مكتبات برمجية (Baileys/Whatsapp-web.js)
                const isBotSig = BOT_SIGNATURES.some(sig => msgId.startsWith(sig));
                const isValidLen = VALID_ID_LENGTHS.includes(msgId.length);
                
                if (isBotSig && isValidLen) {
                    flag(jid, groupId, 'توقيع مكتبة برمجية (ID Signature)');
                }

                // تسجيل الرسالة لقياس الاستجابة (Latency)
                _receiptLog.set(msgId, { sentAt: Date.now(), groupId });
                
                // تنظيف الذاكرة بشكل آمن
                if (_receiptLog.size > MAX_MEMORY_LOGS) {
                    const firstKey = _receiptLog.keys().next().value;
                    _receiptLog.delete(firstKey);
                }
            } catch {}
        }
    });

    // ──────────────────────────────────────────────────────────
    //  ثغرة 2 + 3 + 4: Latency / Jitter / Read-Without-Online
    // ──────────────────────────────────────────────────────────
    sock.ev.on('message-receipt.update', (updates) => {
        const now = Date.now();
        for (const update of (updates || [])) {
            try {
                const msgId   = update.key?.id;
                const groupId = update.key?.remoteJid;
                const jid     = update.key?.participant || groupId;
                
                if (!msgId || !jid || !activeGroups.has(groupId)) continue;

                const logged = _receiptLog.get(msgId);
                if (logged) {
                    const latency = now - logged.sentAt;

                    // ثغرة 2: استجابة خادم خارقة (أسرع من 150ms)
                    if (latency > 0 && latency < RECEIPT_BOT_MS) {
                        flag(jid, groupId, `سرعة خادم خارقة (${latency}ms)`);
                    }

                    // ثغرة 3: Zero Jitter (تذبذب معدوم)
                    if (latency > 0 && latency < 30_000) {
                        if (!_latencyBuf.has(jid)) _latencyBuf.set(jid, []);
                        const buf = _latencyBuf.get(jid);
                        buf.push(latency);
                        
                        // الاحتفاظ بآخر 20 عينة فقط
                        if (buf.length > 20) buf.shift();
                        
                        if (buf.length >= LATENCY_MIN_SAMPLES) {
                            const currentJitter = stdev(buf);
                            if (currentJitter < JITTER_STDEV_MAX) {
                                flag(jid, groupId, `انحراف معياري آلي (±${Math.round(currentJitter)}ms)`);
                            }
                        }
                    }
                }

                // ثغرة 4: Read-Without-Online (قراءة الشبح)
                const readTs = update.receipt?.readTimestamp || update.receipt?.receiptTimestamp;
                if (readTs) {
                    const pData    = _presenceTs.get(jid) || {};
                    const lastSeen = pData.lastSeen || 0;
                    const readMs   = readTs * 1000;
                    if (!lastSeen || (readMs - lastSeen) > READ_NO_PRESENT_MS) {
                        flag(jid, groupId, 'قراءة صامتة (بدون تواجد شبكي)');
                    }
                }
            } catch {}
        }
    });

    // ──────────────────────────────────────────────────────────
    //  ثغرة 5: Ghost Connect (تذبذب حالة الاتصال)
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
                if (onlineDuration < GHOST_CONNECT_MAX_MS) {
                    flag(jid, groupId, `اتصال شبحي سريع (${onlineDuration}ms)`);
                }
                pData.connectedAt = null;
            }
        }
    });
}

// ══════════════════════════════════════════════════════════════
//  تكوين الأوامر (Plugins Metadata)
// ══════════════════════════════════════════════════════════════
const KashfPlugin = {
    command:     'كشف',
    description: 'استخراج نتائج الرادار الصامت',
    elite:       'on',
    group:       false,
    prv:         false,
    lock:        'off',
};

const TafeilPlugin = {
    command:     'هو',
    description: 'تفعيل المراقبة عن بعد (للخاص)',
    elite:       'on',
    group:       false,
    prv:         true,
    lock:        'off',
};

// ──────────────────────────────────────────────────────────────
//  أمر .هو — (لوحة التحكم في الخاص)
// ──────────────────────────────────────────────────────────────
async function executeTafeil({ sock, msg }) {
    const chatId  = msg.key.remoteJid;
    const isGroup = chatId.endsWith('@g.us');
    if (isGroup) return; // يعمل في الخاص فقط

    startScanner(sock);

    let groups;
    try {
        const all = await sock.groupFetchAllParticipating();
        groups = Object.entries(all).map(([id, g]) => ({ id, name: g.subject || id }));
    } catch {
        return;
    }

    if (!groups.length) {
        return sock.sendMessage(chatId, { text: '❌ لا توجد مجموعات متاحة.' });
    }

    const list = groups.map((g, i) => `*${i + 1}.* ${g.name}`).join('\n');
    await sock.sendMessage(chatId, {
        text: `📡 *لوحة تحكم الرادار الصامت*\n\nالرجاء إرسال رقم المجموعة لتفعيل الرادار بداخلها:\n\n${list}`,
    }).catch(() => {});

    // حفظ الجلسة لمدة دقيقة لانتظار الرد
    const timer = setTimeout(() => _pending.delete(chatId), 60_000);
    _pending.set(chatId, { groups, timer });
}

// معالج الرد على رقم المجموعة
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

        // تفعيل الرادار للمجموعة
        activeGroups.add(chosen.id);
        
        // إجبار السيرفر على جلب حالات التواجد للمجموعة
        try { await sock.presenceSubscribe(chosen.id); } catch {}

        await sock.sendMessage(chatId, {
            text: `✅ *تم تفعيل الرادار بنجاح*\n\n📍 *الهدف:* _${chosen.name}_\n\nالرادار الآن يعمل في الخلفية بصمت. اذهب للمجموعة وأرسل الطعوم، ثم اكتب \`.كشف\`.`,
        }).catch(() => {});
    } catch {}
}
pendingHandler._src = 'kashf_pending_v3';

// دمج معالج الرد في البيئة الخاصة بك بشكل آمن
if (!global.featureHandlers) global.featureHandlers = [];
global.featureHandlers = global.featureHandlers.filter(h => h._src !== 'kashf_pending_v3');
global.featureHandlers.push(pendingHandler);

// ──────────────────────────────────────────────────────────────
//  أمر .كشف — (استخراج النتائج في المجموعة)
// ──────────────────────────────────────────────────────────────
async function executeKashf({ sock, msg }) {
    const chatId  = msg.key.remoteJid;
    const isGroup = chatId.endsWith('@g.us');
    if (!isGroup) return;

    startScanner(sock);

    // فلترة البوتات المرصودة لهذه المجموعة فقط
    const found = [..._detected.values()].filter(e => e.groupId === chatId);

    if (!found.length) {
        return sock.sendMessage(chatId, {
            text: '🛡️ _لم يتم رصد أي نشاط آلي حتى الآن._',
        }, { quoted: msg }).catch(() => {});
    }

    let counter = 1;
    for (const entry of found) {
        const mention = entry.jid.includes('@') ? entry.jid : entry.jid + '@s.whatsapp.net';
        
        // تحويل أسباب الكشف إلى نص مقروء
        const reasonsList = Array.from(entry.reasons).join(' | ');

        await sock.sendMessage(chatId, {
            text: `@${norm(mention)}\nتم كشف البوت رقم ${counter}\n\n🔍 _السبب: ${reasonsList}_`,
            mentions: [mention],
        }).catch(() => {});

        counter++;
        
        // تأخير زمني 1 ثانية لتجنب حظر رسائل الواتساب (Rate Limit)
        await new Promise(r => setTimeout(r, 1000));
    }

    // تنظيف الذاكرة بعد الاستخراج وإيقاف المراقبة لهذه المجموعة
    activeGroups.delete(chatId);
    for (const key of [..._detected.keys()]) {
        if (key.endsWith(`::${chatId}`)) _detected.delete(key);
    }
}

// ──────────────────────────────────────────────────────────────
//  تصدير الأوامر لتعمل مع نظام الـ Loader الخاص بك
// ──────────────────────────────────────────────────────────────
export const kashf  = { ...KashfPlugin,  execute: executeKashf  };
export const tafeil = { ...TafeilPlugin, execute: executeTafeil };

export default { ...KashfPlugin, execute: executeKashf };
