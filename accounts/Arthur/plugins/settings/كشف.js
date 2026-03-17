// ══════════════════════════════════════════════════════════════
//  رادار.js — نظام كشف البوتات الشامل (S.A.P)
//  متوافق تماماً مع بنية نظام NOVA / الجلسات التفاعلية
// ══════════════════════════════════════════════════════════════
import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { jidDecode } from '@whiskeysockets/baileys';

// ── دوال التفاعل المساعدة (من نظامك) ──
const react = (sock, msg, e) =>
    sock.sendMessage(msg.key.remoteJid, { react: { text: e, key: msg.key } }).catch(() => {});
const reactWait = (sock, msg) => react(sock, msg, '🕒');
const reactOk   = (sock, msg) => react(sock, msg, '☑️');
const reactFail = (sock, msg) => react(sock, msg, '✖️');

const normalizeJid = jid => {
    if (!jid) return '';
    const part = jid.split('@')[0].split(':')[0];
    const digits = part.replace(/\D/g, '');
    return digits || part;
};

// ── الذاكرة المشتركة للرادار (تعمل في الخلفية) ──
if (!global.SAP) {
    global.SAP = {
        activeGroups: new Set(),
        detected: new Map(),
        receiptLog: new Map(),
        latencyBuf: new Map(),
        isRunning: false
    };
}
const state = global.SAP;

const BOT_SIGNATURES = ['3EB0', 'BAE5', 'B24E', 'DF39'];
const VALID_ID_LENGTHS = [16, 20, 22];

function stdev(arr) {
    if (!arr || arr.length < 2) return 9999;
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / arr.length;
    return Math.sqrt(variance);
}

function flag(jid, groupId, reason) {
    const key = `${jid}::${groupId}`;
    if (!state.detected.has(key)) {
        state.detected.set(key, { jid, groupId, reasons: new Set() });
    }
    state.detected.get(key).reasons.add(reason);
}

// ── محرك الفحص الصامت ──
function startScanner(sock) {
    if (state.isRunning) return;
    state.isRunning = true;

    sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            try {
                if (msg.key.fromMe) continue;
                const groupId = msg.key.remoteJid;
                if (!state.activeGroups.has(groupId)) continue;

                const jid = msg.key.participant || groupId;
                const msgId = msg.key.id || '';

                if (BOT_SIGNATURES.some(sig => msgId.startsWith(sig)) && VALID_ID_LENGTHS.includes(msgId.length)) {
                    flag(jid, groupId, 'توقيع مكتبة برمجية (ID Signature)');
                }

                state.receiptLog.set(msgId, { sentAt: Date.now(), groupId });
                if (state.receiptLog.size > 1000) state.receiptLog.delete(state.receiptLog.keys().next().value);
            } catch {}
        }
    });

    sock.ev.on('message-receipt.update', (updates) => {
        const now = Date.now();
        for (const update of (updates || [])) {
            try {
                const msgId = update.key?.id;
                const groupId = update.key?.remoteJid;
                const jid = update.key?.participant || groupId;
                
                if (!msgId || !jid || !state.activeGroups.has(groupId)) continue;

                const logged = state.receiptLog.get(msgId);
                if (logged) {
                    const latency = now - logged.sentAt;
                    if (latency > 0 && latency < 150) {
                        flag(jid, groupId, `سرعة خادم خارقة (${latency}ms)`);
                    }
                    if (latency > 0 && latency < 30000) {
                        if (!state.latencyBuf.has(jid)) state.latencyBuf.set(jid, []);
                        const buf = state.latencyBuf.get(jid);
                        buf.push(latency);
                        if (buf.length > 20) buf.shift();
                        if (buf.length >= 3 && stdev(buf) < 40) {
                            flag(jid, groupId, `انحراف معياري آلي`);
                        }
                    }
                }
            } catch {}
        }
    });
}

// ── إدارة الجلسات ──
const activeSessions = new Map();

// ── إعداد البلاجن ──
const RadarPlugin = {
    command: 'كشف', 
    description: 'نظام كشف البوتات الشامل (S.A.P)',
    elite: 'on',
    group: false, // يعمل في الخاص والعام بذكاء
    prv: false,
    lock: 'off',
};

// ── دالة التنفيذ الأساسية ──
async function execute({ sock, msg }) {
    const chatId = msg.key.remoteJid;
    const isGroup = chatId.endsWith('@g.us');
    
    // تشغيل المحرك في الخلفية (مرة واحدة فقط)
    startScanner(sock);

    if (activeSessions.has(chatId)) {
        reactWait(sock, msg);
        await sock.sendMessage(chatId, { text: '⏳ *هناك جلسة كاشف نشطة حالياً.* الرجاء إكمالها أو الانتظار.' }, { quoted: msg });
        return;
    }

    if (!isGroup) {
        // ══════════════════════════════════════════════════════════════
        //  1. وضع الخاص (غرفة العمليات لاختيار المجموعة)
        // ══════════════════════════════════════════════════════════════
        reactWait(sock, msg);
        let groups;
        try {
            const all = await sock.groupFetchAllParticipating();
            groups = Object.entries(all).map(([id, g]) => ({ id, name: g.subject || id }));
        } catch {
            reactFail(sock, msg);
            return sock.sendMessage(chatId, { text: '❌ لا توجد مجموعات متاحة.' });
        }

        if (!groups.length) {
            reactFail(sock, msg);
            return sock.sendMessage(chatId, { text: '❌ البوت غير موجود في أي مجموعة.' });
        }

        const list = groups.map((g, i) => `*${i + 1}.* ${g.name}`).join('\n');
        const menuText = `📡 *لوحة تحكم كاشف البوتات الصامت*\n\nالرجاء إرسال رقم المجموعة لتفعيل وضع المراقبة بداخلها:\n\n${list}\n\n*للخروج أرسل:* الغاء`;
        
        await sock.sendMessage(chatId, { text: menuText }, { quoted: msg });
        reactOk(sock, msg);

        // إنشاء جلسة انتظار للرد (نفس نظام-3.js)
        const cleanup = () => {
            sock.ev.off('messages.upsert', listener);
            activeSessions.delete(chatId);
        };

        const listener = async ({ messages, type }) => {
            if (type !== 'notify') return;
            const m = messages[0];
            if (!m || m.key.remoteJid !== chatId || m.key.fromMe) return;

            const text = (m.message?.conversation || m.message?.extendedTextMessage?.text || '').trim();
            
            if (text === 'الغاء' || text === 'إلغاء') {
                reactOk(sock, m);
                await sock.sendMessage(chatId, { text: '☑️ تم إلغاء العملية.' });
                return cleanup();
            }

            const num = parseInt(text);
            if (!isNaN(num) && num > 0 && num <= groups.length) {
                const chosen = groups[num - 1];
                
                // تفعيل الرادار للمجموعة المختارة
                state.activeGroups.add(chosen.id);
                try { await sock.presenceSubscribe(chosen.id); } catch {}
                
                reactOk(sock, m);
                await sock.sendMessage(chatId, {
                    text: `✅ *تم تفعيل المراقب بنجاح*\n📍 *الهدف:* _${chosen.name}_\n\nالمراقب الآن يعمل في الخلفية بصمت. اذهب للمجموعة وأرسل الطعوم، ثم اكتب \`.كشف\` هناك لاستخراج النتائج.`
                });
                cleanup();
            } else {
                reactFail(sock, m);
            }
        };

        sock.ev.on('messages.upsert', listener);
        activeSessions.set(chatId, { listener, cleanupFn: cleanup });
        
        // إغلاق الجلسة التلقائي بعد دقيقتين
        setTimeout(() => {
            if (activeSessions.has(chatId)) {
                sock.sendMessage(chatId, { text: '⏱️ انتهى وقت الجلسة.' }).catch(() => {});
                cleanup();
            }
        }, 120_000);

    } else {
        // ══════════════════════════════════════════════════════════════
        //  2. وضع المجموعة (استخراج النتائج والفضح)
        // ══════════════════════════════════════════════════════════════
        reactWait(sock, msg);

        if (!state.activeGroups.has(chatId)) {
            reactFail(sock, msg);
            return sock.sendMessage(chatId, {
                text: '⚠️ المراقب غير مفعل في هذه المجموعة.\nقم بتفعيله من الخاص أولاً بإرسال `.كشف`'
            }, { quoted: msg }).catch(() => {});
        }

        const found = [...state.detected.values()].filter(e => e.groupId === chatId);

        if (!found.length) {
            reactOk(sock, msg);
            return sock.sendMessage(chatId, {
                text: '🛡️ _لم يتم رصد أي نشاط آلي حتى الآن._'
            }, { quoted: msg }).catch(() => {});
        }

        let counter = 1;
        for (const entry of found) {
            const mention = entry.jid.includes('@') ? entry.jid : entry.jid + '@s.whatsapp.net';
            const reasonsList = Array.from(entry.reasons).join(' | ');

            await sock.sendMessage(chatId, {
                text: `@${normalizeJid(mention)}\nتم كشف البوت رقم ${counter}\n\n🔍 _السبب: ${reasonsList}_`,
                mentions: [mention]
            }).catch(() => {});

            counter++;
            await new Promise(r => setTimeout(r, 1000));
        }

        // تنظيف الذاكرة للمجموعة وإيقاف المراقبة
        state.activeGroups.delete(chatId);
        for (const key of [...state.detected.keys()]) {
            if (key.endsWith(`::${chatId}`)) state.detected.delete(key);
        }
        
        reactOk(sock, msg);
    }
}

export default { ...RadarPlugin, execute };
