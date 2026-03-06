// ══════════════════════════════════════════════════════════════
//  كاشف البوتات — 5 طبقات
//  L1: device index في JID          (فوري)
//  L2: getUSyncDevices               (دقيق)
//  L3: صورة البروفايل                (بدون صورة = مشتبه)
//  L4: presence — هل يكتب؟          (بوتات ما تكتب)
//  L5: سرعة الرد + pushName          (من message history)
// ══════════════════════════════════════════════════════════════

const react = (sock, msg, e) =>
    sock.sendMessage(msg.key.remoteJid, { react: { text: e, key: msg.key } });

// ── إخفاء الرقم ───────────────────────────────────────────────
function maskPhone(pn = '') {
    if (pn.length <= 6) return `+${pn}`;
    return `+${pn.slice(0,3)}${'*'.repeat(pn.length-6)}${pn.slice(-3)}`;
}

function isAdmin(p) {
    const a = p?.admin;
    if (!a) return false;
    return typeof a === 'boolean' ? a : ['admin','superadmin'].includes(String(a).toLowerCase());
}

function getPhone(p) {
    if (p?.phoneNumber) return p.phoneNumber.split('@')[0].replace(/\D/g,'');
    const raw = p?.id ?? '';
    if (raw.includes('@lid')) return null;
    return raw.split('@')[0].split(':')[0].replace(/\D/g,'') || null;
}

function deviceIdx(jid = '') {
    const m = String(jid).match(/:(\d+)@/);
    return m ? parseInt(m[1]) : 0;
}

// ══════════════════════════════════════════════════════════════
// L2 — getUSyncDevices
// ══════════════════════════════════════════════════════════════
async function checkUsync(sock, jid) {
    if (typeof sock.getUSyncDevices !== 'function') return false;
    try {
        const res = await Promise.race([
            sock.getUSyncDevices([jid], false, true),
            new Promise((_,r) => setTimeout(() => r(new Error('to')), 4000))
        ]);
        if (!res) return false;
        for (const [, list] of Object.entries(res)) {
            for (const d of (list||[])) {
                const id = d?.deviceJid || d?.jid || String(d);
                if (deviceIdx(id) >= 2) return true;
            }
        }
        return false;
    } catch { return false; }
}

// ══════════════════════════════════════════════════════════════
// L3 — صورة البروفايل
// ══════════════════════════════════════════════════════════════
async function hasProfilePic(sock, jid) {
    try {
        const url = await Promise.race([
            sock.profilePictureUrl(jid, 'image'),
            new Promise((_,r) => setTimeout(() => r(null), 3000))
        ]);
        return !!url;
    } catch { return false; }
}

// ══════════════════════════════════════════════════════════════
// L4 — presence (هل سبق وكتب؟)
//  البوتات ما عندهم "composing" في السجل
// ══════════════════════════════════════════════════════════════
function checkPresence(sock, jid) {
    try {
        // conn.chats من store.js
        const chats   = sock.chats || global.conn?.chats || {};
        const contact = chats[jid];
        if (!contact) return null; // ما عندنا بيانات
        const p = contact.presences;
        // لو presences موجود ومش composing/available → بوت محتمل
        if (p === undefined || p === null) return 'unknown';
        return p; // 'composing', 'available', 'unavailable', 'paused'
    } catch { return null; }
}

// ══════════════════════════════════════════════════════════════
// L5 — تحليل pushName + سرعة الرد من message history
// ══════════════════════════════════════════════════════════════
function analyzePushName(name = '') {
    if (!name) return { score: 1, reason: 'بدون اسم 🔕' };

    // أسماء بوتات شائعة
    const botNames = [
        /bot/i, /بوت/i, /robot/i, /auto/i, /yuki/i, /anastasia/i,
        /arthur/i, /nova/i, /assistant/i, /helper/i, /^v\d/i,
        /🤖/, /⚡/, /✨.*bot/i
    ];
    for (const pattern of botNames) {
        if (pattern.test(name)) return { score: 2, reason: `اسم مشتبه: ${name} 🔕` };
    }

    // اسم فيه رموز كثيرة = مشتبه
    const emojiCount = (name.match(/\p{Emoji}/gu) || []).length;
    if (emojiCount >= 3) return { score: 1, reason: `رموز كثيرة في الاسم 🔕` };

    return { score: 0, reason: null };
}

// سرعة الرد: لو عندنا رسائل مخزنة
function checkResponseSpeed(sock, jid) {
    try {
        const chats = sock.chats || global.conn?.chats || {};
        const msgs  = chats[jid]?.messages || chats[jid]?.msgs || null;
        if (!msgs) return null;

        const list = Array.isArray(msgs) ? msgs : Object.values(msgs);
        if (list.length < 4) return null;

        // رتّب حسب الوقت
        const sorted = list
            .filter(m => m?.messageTimestamp)
            .map(m => ({
                ts:     typeof m.messageTimestamp === 'number'
                            ? m.messageTimestamp
                            : m.messageTimestamp?.low || 0,
                fromMe: m.key?.fromMe
            }))
            .sort((a,b) => a.ts - b.ts);

        // احسب متوسط الفاصل الزمني بين رسائل الشخص
        const myMsgs = sorted.filter(m => !m.fromMe);
        if (myMsgs.length < 3) return null;

        let gaps = [];
        for (let i = 1; i < myMsgs.length; i++) {
            gaps.push(myMsgs[i].ts - myMsgs[i-1].ts);
        }
        const avg = gaps.reduce((a,b) => a+b, 0) / gaps.length;

        // أقل من 0.8 ثانية بين رسائل → بوت محتمل
        if (avg < 0.8) return { score: 2, reason: `رد فوري: ${avg.toFixed(2)}ث ⚡` };
        if (avg < 2)   return { score: 1, reason: `رد سريع جداً ⚡` };
        return null;
    } catch { return null; }
}

// ══════════════════════════════════════════════════════════════
// فحص رقم واحد — كل الطبقات
// ══════════════════════════════════════════════════════════════
async function analyzeParticipant(sock, p) {
    const pn    = getPhone(p);
    const raw   = p?.id ?? '';
    const admin = isAdmin(p);
    const jid   = raw.includes('@lid') ? raw
                : pn ? `${pn}@s.whatsapp.net` : null;

    const flags = [];
    let score   = 0;

    // ── L1: device index ─────────────────────────────────────
    const idx = deviceIdx(raw);
    if (idx >= 2) {
        score += 3;
        flags.push(`device:${idx} 📱`);
    }

    // ── L1b: LID بدون رقم ────────────────────────────────────
    if (raw.includes('@lid') && !p?.phoneNumber) {
        score += 1;
        flags.push('LID بدون رقم 🔎');
    }

    if (!jid) return { pn: raw.split('@')[0], score, flags, admin };

    // ── L2: USync ────────────────────────────────────────────
    if (score < 3) {
        const usync = await checkUsync(sock, jid);
        if (usync) {
            score += 3;
            flags.push('USync:بوت 📡');
        }
    }

    // ── L3: صورة البروفايل ───────────────────────────────────
    const hasPic = await hasProfilePic(sock, jid);
    if (!hasPic) {
        score += 1;
        flags.push('بدون صورة 🚫');
    }

    // ── L4: presence ─────────────────────────────────────────
    const presence = checkPresence(sock, jid);
    if (presence === 'unknown' || presence === null) {
        // لا نعاقب — ما عندنا بيانات
    } else if (presence === 'unavailable' || presence === 'paused') {
        score += 1;
        flags.push(`حضور: ${presence} 👻`);
    }

    // ── L5: pushName ─────────────────────────────────────────
    const pushName = p?.notify || p?.name
        || sock.chats?.[jid]?.name
        || global.conn?.chats?.[jid]?.name || '';

    const nameAnalysis = analyzePushName(pushName);
    if (nameAnalysis.score > 0) {
        score += nameAnalysis.score;
        flags.push(nameAnalysis.reason);
    }

    // ── L5b: سرعة الرد ───────────────────────────────────────
    const speedResult = checkResponseSpeed(sock, jid);
    if (speedResult) {
        score += speedResult.score;
        flags.push(speedResult.reason);
    }

    return { pn: pn || raw.split('@')[0], score, flags, admin };
}

// ══════════════════════════════════════════════════════════════
export default {
    NovaUltra: {
        command: ['كشف', 'كشف_بوتات', 'بوتات'],
        description: 'كشف البوتات — 5 طبقات',
        elite: 'off', group: true, prv: false, lock: 'off'
    },

    execute: async ({ sock, msg }) => {
        const chatId = msg.key.remoteJid;
        await react(sock, msg, '🔍');

        // ── جلب الأعضاء ────────────────────────────────────────
        let meta;
        try {
            meta = await Promise.race([
                sock.groupMetadata(chatId),
                new Promise((_,r) => setTimeout(() => r(new Error('to')), 10000))
            ]);
        } catch {
            await react(sock, msg, '❌');
            return sock.sendMessage(chatId, { text: '❌ تعذّر جلب بيانات المجموعة.' }, { quoted: msg });
        }

        const participants = meta.participants ?? [];
        const botPhone     = sock.user?.id?.split(':')[0];
        const members      = participants.filter(p => {
            const pn  = getPhone(p);
            const raw = p?.id ?? '';
            return pn !== botPhone && raw.split('@')[0].split(':')[0] !== botPhone;
        });

        await sock.sendMessage(chatId, {
            text: `🔍 جاري فحص *${members.length}* عضو بـ 5 طبقات...\n⏳ انتظر`
        }, { quoted: msg });

        // ── فحص دفعات ──────────────────────────────────────────
        const BATCH   = 6;
        const results = [];

        for (let i = 0; i < members.length; i += BATCH) {
            const batch  = members.slice(i, i + BATCH);
            const batchR = await Promise.allSettled(
                batch.map(p => analyzeParticipant(sock, p))
            );
            for (const r of batchR) {
                if (r.status === 'fulfilled' && r.value.score > 0) {
                    results.push(r.value);
                }
            }
        }

        // ── تصنيف ───────────────────────────────────────────────
        const confirmed = results.filter(r => r.score >= 3).sort((a,b) => b.score - a.score);
        const suspected = results.filter(r => r.score >= 1 && r.score < 3).sort((a,b) => b.score - a.score);
        const total     = confirmed.length + suspected.length;

        // ── التقرير ─────────────────────────────────────────────
        const now = new Date().toLocaleString('ar-SA', {
            timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit',
            day: 'numeric', month: 'long'
        });

        let text = `🤖 *تقرير كشف البوتات*\n`;
        text += `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n`;
        text += `⌚ ${now}\n`;
        text += `👥 الأعضاء: *${participants.length}*\n`;
        text += `🔍 مكتشف: *${total}*\n`;
        text += `🧪 طبقات: device • USync • صورة • presence • pushName\n`;
        text += `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n\n`;

        if (confirmed.length) {
            text += `*🤖 بوتات مؤكدة — (${confirmed.length}):*\n`;
            text += `╭${'─'.repeat(26)}\n`;
            for (const r of confirmed) {
                text += `┊ ${maskPhone(r.pn)}${r.isAdmin ? ' 👑' : ''} — نقاط: ${r.score}\n`;
                text += `┊  └ ${r.flags.join(' • ')}\n`;
            }
            text += `╰${'─'.repeat(26)}\n\n`;
        }

        if (suspected.length) {
            text += `*⚠️ مشتبه بهم — (${suspected.length}):*\n`;
            text += `╭${'─'.repeat(26)}\n`;
            for (const r of suspected) {
                text += `┊ ${maskPhone(r.pn)}${r.isAdmin ? ' 👑' : ''} — نقاط: ${r.score}\n`;
                text += `┊  └ ${r.flags.join(' • ')}\n`;
            }
            text += `╰${'─'.repeat(26)}\n\n`;
        }

        if (total === 0) {
            text += `✅ لم يتم اكتشاف بوتات.\n`;
            text += `> جرب في قروب فيه بوتات معروفة للتحقق.`;
        } else {
            text += `> ⚠️ البوتات المتوقفة لا تُكشف.`;
        }

        text += `\n\n> © 𝘼𝙍𝙏𝙃𝙐𝙍 𝘽𝙊𝙏`;

        await react(sock, msg, '✅');
        await sock.sendMessage(chatId, { text }, { quoted: msg });
    }
};
