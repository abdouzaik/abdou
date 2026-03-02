// ══════════════════════════════════════════════════════════════
//  كشف البوتات — يعتمد على groupMetadata فقط (موثوق وسريع)
// ══════════════════════════════════════════════════════════════

function react(sock, msg, e) {
    return sock.sendMessage(msg.key.remoteJid, { react: { text: e, key: msg.key } });
}

function maskPhone(pn = '') {
    if (pn.length <= 6) return `+${pn}`;
    return `+${pn.slice(0, 3)}${'*'.repeat(pn.length - 6)}${pn.slice(-3)}`;
}

function isAdmin(p) {
    const a = p?.admin;
    if (!a) return false;
    if (typeof a === 'boolean') return a;
    if (typeof a === 'string') return ['admin', 'superadmin'].includes(a.toLowerCase());
    return false;
}

// ── استخراج رقم الهاتف من participant ──────────────────────
function getPhone(p) {
    // phoneNumber مباشر
    if (p?.phoneNumber) return p.phoneNumber.split('@')[0].replace(/\D/g, '');
    const raw = p?.id ?? '';
    if (!raw.includes('@lid')) return raw.split('@')[0].split(':')[0].replace(/\D/g, '');
    return null;
}

// ── كشف البوت عبر device index في الـ JID ─────────────────
// لو الـ participant JID فيه :N@ حيث N >= 2 → غالباً بوت
function getDeviceIndex(jid = '') {
    const m = String(jid).match(/:(\d+)@/);
    return m ? parseInt(m[1], 10) : 0;
}

// ══════════════════════════════════════════════════════════════
const NovaUltra = {
    command: ['كشف', 'كشف_بوتات', 'بوتات'],
    description: 'كشف البوتات في المجموعة',
    elite: 'off', group: true, prv: false, lock: 'off'
};

async function execute({ sock, msg }) {
    const chatId = msg.key.remoteJid;

    await react(sock, msg, '🔍');

    // ── جلب بيانات المجموعة ────────────────────────────────
    let meta;
    try {
        meta = await Promise.race([
            sock.groupMetadata(chatId),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000))
        ]);
    } catch (e) {
        await react(sock, msg, '❌');
        return sock.sendMessage(chatId, { text: '❌ تعذّر جلب بيانات المجموعة.' }, { quoted: msg });
    }

    const participants = meta.participants ?? [];
    const botId = sock.user?.id?.split(':')[0];

    // ── فحص كل عضو ────────────────────────────────────────
    const confirmed = [];
    const suspected = [];

    for (const p of participants) {
        const pn  = getPhone(p);
        const raw = p?.id ?? '';

        // تجاهل البوت نفسه
        if (pn === botId || raw.split('@')[0].split(':')[0] === botId) continue;

        const admin = isAdmin(p);
        const flags = [];
        let score = 0;

        // ── إشارة 1: device index في الـ ID
        const devIdx = getDeviceIndex(raw);
        if (devIdx >= 2) {
            score += 3;
            flags.push(`device:${devIdx} 📱`);
        }

        // ── إشارة 2: رقم الهاتف يبدأ بصفر أو طويل جداً (بعض البوتات)
        if (pn && (pn.startsWith('0') || pn.length > 15)) {
            score += 1;
            flags.push('رقم غير اعتيادي 🔎');
        }

        // ── إشارة 3: @lid بدون phoneNumber (بعض البوتات الجديدة)
        if (raw.includes('@lid') && !p?.phoneNumber) {
            score += 1;
            flags.push('LID بدون رقم 🔎');
        }

        if      (score >= 3) confirmed.push({ pn: pn || raw.split('@')[0], flags, isAdmin: admin });
        else if (score >= 1) suspected.push({ pn: pn || raw.split('@')[0], flags, isAdmin: admin });
    }

    // ── التقرير ───────────────────────────────────────────
    const now   = new Date().toLocaleString('ar-SA', {
        timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit',
        day: 'numeric', month: 'long'
    });
    const total = confirmed.length + suspected.length;

    let text = `🤖 *تقرير كشف البوتات*\n`;
    text += `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n`;
    text += `⌚ ${now}\n`;
    text += `👥 الأعضاء: *${participants.length}*\n`;
    text += `🔍 مكتشف: *${total}*\n`;
    text += `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n\n`;

    if (confirmed.length) {
        text += `*🤖 بوتات مؤكدة — (${confirmed.length}):*\n`;
        text += `╭${'─'.repeat(22)}\n`;
        for (const r of confirmed) {
            text += `┊ ${maskPhone(r.pn)}${r.isAdmin ? ' 👑' : ''}\n`;
            text += `┊  └ ${r.flags.join(' • ')}\n`;
        }
        text += `╰${'─'.repeat(22)}\n\n`;
    }

    if (suspected.length) {
        text += `*⚠️ مشتبه بهم — (${suspected.length}):*\n`;
        text += `╭${'─'.repeat(22)}\n`;
        for (const r of suspected) {
            text += `┊ ${maskPhone(r.pn)}${r.isAdmin ? ' 👑' : ''}\n`;
            text += `┊  └ ${r.flags.join(' • ')}\n`;
        }
        text += `╰${'─'.repeat(22)}\n\n`;
    }

    if (total === 0) {
        text += `✅ لم يتم اكتشاف بوتات نشطة.\n`;
        text += `> البوتات المتوقفة أو التي ما أرسلت رسائل لا تُكشف.\n`;
    } else {
        text += `> ⚠️ البوتات المتوقفة لا تُكشف.`;
    }

    text += `\n\n> © 𝘼𝙍𝙏𝙃𝙐𝙍 𝘽𝙊𝙏`;

    await react(sock, msg, '✅');
    await sock.sendMessage(chatId, { text }, { quoted: msg });
}

export default { NovaUltra, execute };
