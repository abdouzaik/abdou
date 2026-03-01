// ══════════════════════════════════════════════════════════════
//  كشف البوتات — نسخة سريعة (حد أقصى 30 ثانية)
// ══════════════════════════════════════════════════════════════

const LOG_PREFIX = '[كشف-بوتات]';
const log = {
    info:  (...a) => console.log( `${LOG_PREFIX} ℹ️ `, ...a),
    warn:  (...a) => console.warn(`${LOG_PREFIX} ⚠️ `, ...a),
    error: (...a) => console.error(`${LOG_PREFIX} ❌`, ...a),
    debug: (...a) => process.env.DEBUG_BOTS && console.log(`${LOG_PREFIX} 🐛`, ...a),
};

// ── Timeout بسيط ──────────────────────────────────────────────
function withTimeout(promise, ms, label = '') {
    return new Promise(resolve => {
        const t = setTimeout(() => {
            log.warn(`⏱ timeout(${ms}ms): ${label}`);
            resolve(null);
        }, ms);
        promise
            .then(v  => { clearTimeout(t); resolve(v); })
            .catch(e => { clearTimeout(t); log.warn(`${label} error: ${e.message}`); resolve(null); });
    });
}

const JID = {
    toPhone(p) {
        try {
            const src = p?.phoneNumber || p?.id || '';
            if (!src || src.includes('@lid')) return null;
            const pn = src.split('@')[0].split(':')[0].replace(/\D/g, '');
            return pn.length >= 7 ? pn : null;
        } catch { return null; }
    },
    toLid(p) {
        try {
            const raw = p?.id ?? '';
            if (!raw.includes('@lid')) return null;
            const part = raw.split(':')[0];
            return part ? `${part}@lid` : null;
        } catch { return null; }
    },
    deviceIndex(jid = '') {
        const m = String(jid).match(/:(\d+)@/);
        return m ? parseInt(m[1], 10) : 0;
    },
    mask(pn = '') {
        if (pn.length <= 6) return `+${pn}`;
        const v = 3;
        return `+${pn.slice(0, v)}${'*'.repeat(pn.length - v * 2)}${pn.slice(-v)}`;
    }
};

function isAdmin(p) {
    const a = p?.admin;
    if (!a) return false;
    if (typeof a === 'boolean') return a;
    if (typeof a === 'string') return ['admin', 'superadmin', 'owner'].includes(a.toLowerCase());
    return false;
}

function react(sock, msg, e) {
    return sock.sendMessage(msg.key.remoteJid, { react: { text: e, key: msg.key } });
}

// ── getUSyncDevices: محاولة واحدة فقط، 4 ثوانٍ max ──────────
async function queryDevices(sock, jids) {
    if (typeof sock.getUSyncDevices !== 'function') return null;

    // نجرب البارامترات من الأفضل للأضعف، كل واحدة 4 ثوانٍ فقط
    for (const args of [[jids, false, true], [jids, true, true], [jids, false, false]]) {
        const res = await withTimeout(sock.getUSyncDevices(...args), 4000, `getUSyncDevices(${args[1]},${args[2]})`);
        if (res && Object.keys(res).length > 0) return res;
        // لو null أو فارغ، انتقل للتالي فوراً بدون انتظار
    }
    return null;
}

// ── كشف من تاريخ الرسائل (أسرع وأدق طريقة) ─────────────────
function detectFromMessages(sock, chatId) {
    const scores = {};
    try {
        const store = sock.store || sock.messageStore;
        const chatMsgs = store?.messages?.[chatId];
        if (!chatMsgs) return scores;

        const msgs = chatMsgs.array?.slice(-100) ??
                     chatMsgs.toJSON?.()?.slice(-100) ??
                     (Array.isArray(chatMsgs) ? chatMsgs.slice(-100) : []);

        for (const m of msgs) {
            // participant JID فيه device index
            const participant = m?.key?.participant ?? '';
            if (participant) {
                const pn  = JID.toPhone({ id: participant });
                const idx = JID.deviceIndex(participant);
                if (pn && idx >= 2) {
                    scores[pn] = (scores[pn] ?? 0) + 2;
                    log.debug(`رسالة device:${idx} من ${JID.mask(pn)}`);
                }
            }

            // فحص كل أنواع الرسائل
            for (const block of Object.values(m?.message ?? {})) {
                if (typeof block !== 'object' || !block) continue;
                const ctx = block?.contextInfo;
                if (!ctx) continue;

                if (ctx.botMessageInvokedJid) {
                    const pn = JID.toPhone({ id: ctx.botMessageInvokedJid });
                    if (pn) scores[pn] = (scores[pn] ?? 0) + 3;
                }
                if (ctx.participant && JID.deviceIndex(ctx.participant) >= 2) {
                    const pn = JID.toPhone({ id: ctx.participant });
                    if (pn) scores[pn] = (scores[pn] ?? 0) + 1;
                }
            }
        }
    } catch (e) {
        log.error('detectFromMessages:', e.message);
    }
    return scores;
}

// ══════════════════════════════════════════════════════════════
const NovaUltra = {
    command: ['كشف', 'كشف_بوتات', 'بوتات'],
    description: 'كشف البوتات في المجموعة',
    elite: 'off', group: true, prv: false, lock: 'off'
};

async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;
    const botPn  = JID.toPhone({ id: sock.user?.id }) ?? '';
    const botLid = (sock.user?.lid ?? '').split(':')[0];

    await react(sock, msg, '🔍');

    // ── timeout عام: 28 ثانية على الكل ───────────────────────
    let globalDone = false;
    const globalTimer = setTimeout(async () => {
        if (globalDone) return;
        globalDone = true;
        log.warn('⏱ timeout عام — إرسال النتائج الجزئية');
        await sock.sendMessage(chatId, {
            text: '⚠️ انتهى الوقت المسموح (28ث) — تأكد من اتصال البوت وحاول مجدداً.'
        }, { quoted: msg });
    }, 28000);

    try {
        await _execute({ sock, msg, args, chatId, botPn, botLid });
    } finally {
        globalDone = true;
        clearTimeout(globalTimer);
    }
}

async function _execute({ sock, msg, args, chatId, botPn, botLid }) {
    const meta = await withTimeout(sock.groupMetadata(chatId), 8000, 'groupMetadata');
    if (!meta) {
        return sock.sendMessage(chatId, { text: '❌ تعذّر جلب بيانات المجموعة.' }, { quoted: msg });
    }

    const participants = meta.participants ?? [];
    const members = participants.filter(p => {
        const pn = JID.toPhone(p);
        if (!pn && !JID.toLid(p)) return false;
        if (pn === botPn) return false;
        if ((p.id ?? '').split(':')[0] === botLid) return false;
        return true;
    });

    log.info(`الأعضاء: ${participants.length} | فحص: ${members.length}`);

    if (!members.length)
        return sock.sendMessage(chatId, { text: '❌ لا يوجد أعضاء للفحص.' }, { quoted: msg });

    await sock.sendMessage(chatId, {
        text: `🔍 جاري فحص *${members.length}* عضو...`
    }, { quoted: msg });

    const scoreMap = {};
    function addScore(pn, delta, flag, admin = false) {
        if (!pn) return;
        if (!scoreMap[pn]) scoreMap[pn] = { score: 0, flags: [], isAdmin: admin };
        scoreMap[pn].score   += delta;
        scoreMap[pn].isAdmin  = scoreMap[pn].isAdmin || admin;
        if (flag && !scoreMap[pn].flags.includes(flag)) scoreMap[pn].flags.push(flag);
    }

    // ── المرحلة 1: رسائل المجموعة (فوري، لا شبكة) ───────────
    log.info('م1: رسائل');
    const msgScores = detectFromMessages(sock, chatId); // sync
    for (const [pn, delta] of Object.entries(msgScores)) {
        const orig = members.find(p => JID.toPhone(p) === pn);
        addScore(pn, delta, 'device index في الرسائل ⚡', orig ? isAdmin(orig) : false);
    }

    // ── المرحلة 2: getUSyncDevices (كل الأعضاء دفعة واحدة) ──
    // بدل batches متسلسلة — ندفع الكل مرة واحدة
    log.info('م2: getUSyncDevices');

    async function runUSyncFor(jids, batch, mode) {
        const res = await queryDevices(sock, jids);
        if (!res) return;
        for (const [jid, devList] of Object.entries(res)) {
            const devArr = Array.isArray(devList) ? devList : [];
            const rawKey = jid.split(':')[0].split('@')[0];
            const orig   = batch.find(p =>
                (JID.toPhone(p) ?? '') === rawKey ||
                (JID.toLid(p)  ?? '').split('@')[0] === rawKey
            );
            if (!orig) continue;
            const pn    = JID.toPhone(orig) ?? rawKey;
            const admin = isAdmin(orig);

            if      (devArr.length >= 3) addScore(pn, 3, `${devArr.length} أجهزة (${mode}) 📱`, admin);
            else if (devArr.length === 2) addScore(pn, 2, `جهازان (${mode}) 📱`, admin);
            else if (devArr.length === 1) {
                const idx = JID.deviceIndex(devArr[0]?.deviceJid ?? devArr[0]?.jid ?? '');
                if (idx >= 2) addScore(pn, 1, `device:${idx} (${mode}) 🔎`, admin);
            }
        }
    }

    // اجمع كل الـ JIDs وارسلها مرة واحدة
    const allLidJids  = members.map(p => JID.toLid(p)).filter(Boolean);
    const allPhoneJids = members.map(p => JID.toPhone(p)).filter(Boolean).map(pn => `${pn}@s.whatsapp.net`);

    await Promise.allSettled([
        allLidJids.length  ? runUSyncFor(allLidJids, members, 'LID')   : Promise.resolve(),
        allPhoneJids.length ? runUSyncFor(allPhoneJids, members, 'Phone') : Promise.resolve(),
    ]);

    // ── المرحلة 3: onWhatsApp (كل الأعضاء دفعة واحدة) ────────
    log.info('م3: onWhatsApp');
    if (allPhoneJids.length) {
        const res = await withTimeout(sock.onWhatsApp(...allPhoneJids), 6000, 'onWhatsApp');
        if (res) {
            const arr = Array.isArray(res) ? res : [res];
            for (const r of arr) {
                if (!r?.jid) continue;
                const pn  = JID.toPhone({ id: r.jid });
                const idx = JID.deviceIndex(r.jid);
                if (pn && idx >= 2) {
                    const orig = members.find(p => JID.toPhone(p) === pn);
                    addScore(pn, 2, `onWhatsApp device:${idx} ⚡`, orig ? isAdmin(orig) : false);
                }
            }
        }
    }

    // ── تصنيف ────────────────────────────────────────────────
    const confirmed = [], suspected = [];
    for (const [pn, data] of Object.entries(scoreMap)) {
        if      (data.score >= 3) confirmed.push({ pn, ...data });
        else if (data.score >= 1) suspected.push({ pn, ...data });
    }

    log.info(`النتائج → مؤكد: ${confirmed.length} | مشتبه: ${suspected.length}`);

    // ── التقرير ───────────────────────────────────────────────
    const tz  = args?.[0] ?? 'Asia/Riyadh';
    const now = new Date().toLocaleString('ar-SA', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'long'
    });

    const total = confirmed.length + suspected.length;
    let text  = `🤖 *تقرير كشف البوتات*\n`;
    text += `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n`;
    text += `⌚ ${now}\n`;
    text += `👥 الأعضاء: *${participants.length}*\n`;
    text += `🔍 مكتشف: *${total}*\n`;
    text += `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n\n`;

    if (confirmed.length) {
        text += `*🤖 بوتات مؤكدة — (${confirmed.length}):*\n`;
        text += `╭${'─'.repeat(24)}\n`;
        for (const r of confirmed) {
            text += `┊ ${JID.mask(r.pn)}${r.isAdmin ? ' 👑' : ''}\n`;
            text += `┊  └ ${r.flags.join(' • ')} [${r.score}pts]\n`;
        }
        text += `╰${'─'.repeat(24)}\n\n`;
    }

    if (suspected.length) {
        text += `*⚠️ مشتبه بهم — (${suspected.length}):*\n`;
        text += `╭${'─'.repeat(24)}\n`;
        for (const r of suspected) {
            text += `┊ ${JID.mask(r.pn)}${r.isAdmin ? ' 👑' : ''}\n`;
            text += `┊  └ ${r.flags.join(' • ')} [${r.score}pts]\n`;
        }
        text += `╰${'─'.repeat(24)}\n\n`;
    }

    if (total === 0) {
        text += `✅ لم يتم اكتشاف بوتات شغّالة.\n`;
        text += `> تأكد أن البوت الهدف أرسل رسالة مؤخراً.\n`;
        text += `> البوتات المتوقفة لا تُكشف.`;
    } else {
        text += `> ⚠️ البوتات المتوقفة لا تُكشف.`;
    }

    text += `\n\n> © 𝘼𝙍𝙏𝙃𝙐𝙍 𝘽𝙊𝙏`;

    await react(sock, msg, '✅');
    await sock.sendMessage(chatId, { text }, { quoted: msg });
}

export default { NovaUltra, execute };
