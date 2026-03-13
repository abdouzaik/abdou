// ══════════════════════════════════════════════════════════════
//  لعبة الغزو الفضائي — غزو.js
// ══════════════════════════════════════════════════════════════

// ── helpers (نفس أسلوب اسم_المجموعة.js + messages.js) ────────
const normalizeJid = (jid) => {
    if (!jid) return '';
    return jid.split('@')[0].split(':')[0].replace(/\D/g, '');
};

async function getBotAdminStatus(sock, chatId) {
    try {
        const meta   = await sock.groupMetadata(chatId);
        const botNum = normalizeJid(sock.user.id);
        const entry  = meta.participants.find(p => normalizeJid(p.id) === botNum);
        return {
            meta,
            botNum,
            isAdmin: entry?.admin === 'admin' || entry?.admin === 'superadmin',
        };
    } catch { return { meta: null, botNum: '', isAdmin: false }; }
}

function isSenderAdmin(meta, senderJid) {
    const sNum = normalizeJid(senderJid);
    return meta.participants.some(
        p => normalizeJid(p.id) === sNum &&
            (p.admin === 'admin' || p.admin === 'superadmin')
    );
}

function reply(sock, chatId, text, msg) {
    return sock.sendMessage(chatId, { text }, { quoted: msg });
}
function react(sock, msg, emoji) {
    return sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } }).catch(() => {});
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── رسائل عشوائية ─────────────────────────────────────────────
const ABDUCT_ONE = [
    p => `☄️ @${p} تأخر لحظة — تم اختطافه.`,
    p => `👾 الفضائيون طافوا على @${p} وأخذوه.`,
    p => `🛸 @${p} كان الأبطأ — الفضاء لا يرحم.`,
    p => `🌌 @${p} اختفى من الرادار.`,
    p => `⚡ @${p} ما لحق — تم حمله.`,
];
const ABDUCT_MULTI = [
    n => `☄️ ${n} أعضاء تم اختطافهم.`,
    n => `🛸 المركبة أقلعت وعلى متنها ${n} ضحايا.`,
    n => `👾 الفضائيون فازوا بـ ${n} هذه الجولة.`,
];
const SAFE_MSGS = [
    '✅ الجميع تجاوب — المركبة تعيد تحميل أسلحتها.',
    '✅ لم يُختطف أحد — الخطر لم ينتهِ.',
    '✅ نجا الكل هذه الجولة.',
];
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function genCodes(n = 3) {
    const s = new Set();
    while (s.size < n) s.add(String(Math.floor(1000 + Math.random() * 9000)));
    return [...s];
}

// ── جلسات اللعب ───────────────────────────────────────────────
const activeGames = new Map();

// ══════════════════════════════════════════════════════════════
const NovaUltra = {
    command: 'غزو',
    description: 'لعبة الغزو الفضائي — البقاء للأسرع',
    elite: 'off',
    group: true,
    prv: false,
    lock: 'off'
};

async function execute({ sock, msg, args, sender }) {
    const chatId = msg.key.remoteJid;
    const pfx    = global._botConfig?.prefix || '.';
    const subCmd = args?.[0]?.trim();

    // ── إيقاف اللعبة ──────────────────────────────────────────
    if (subCmd === 'وقف') {
        if (!activeGames.has(chatId))
            return reply(sock, chatId, '❌ ما في غزو يعمل حالياً.', msg);
        const { meta } = await getBotAdminStatus(sock, chatId);
        const senderJid = msg.key.participant || msg.key.remoteJid;
        if (!msg.key.fromMe && meta && !isSenderAdmin(meta, senderJid))
            return reply(sock, chatId, '❌ فقط المشرفين يقدرون يوقفون اللعبة.', msg);
        activeGames.get(chatId).stop = true;
        return react(sock, msg, '🛑');
    }

    // ── منع التكرار ───────────────────────────────────────────
    if (activeGames.has(chatId))
        return reply(sock, chatId, `⚠️ الغزو شغّال. لإيقافه: *${pfx}غزو وقف*`, msg);

    // ── تحقق من صلاحيات البوت ────────────────────────────────
    const { meta, botNum, isAdmin } = await getBotAdminStatus(sock, chatId);
    if (!meta)   return reply(sock, chatId, '❌ تعذر جلب بيانات المجموعة.', msg);
    if (!isAdmin) return reply(sock, chatId, '❌ البوت يحتاج صلاحية مشرف لتشغيل اللعبة.', msg);

    // ── اللاعبون (بدون البوت) ─────────────────────────────────
    let activePlayers = meta.participants
        .filter(p => normalizeJid(p.id) !== botNum)
        .map(p => normalizeJid(p.id) + '@s.whatsapp.net');

    if (activePlayers.length < 2)
        return reply(sock, chatId, '❌ يحتاج على الأقل لاعبَين.', msg);

    const session = { stop: false, round: 1 };
    activeGames.set(chatId, session);

    const speedLog = {};
    activePlayers.forEach(p => { speedLog[p] = []; });
    const mentions = list => list.map(p => `@${normalizeJid(p)}`).join(' ');

    try {
        // ── رسالة البداية ─────────────────────────────────────
        await sock.sendMessage(chatId, {
            text:
`🛸 *غزو فضائي — المنطقة 51*

كل جولة سيظهر *كود من 4 أرقام* — اكتبه بأسرع ما تقدر.

📋 *القواعد:*
— الجولة الأولى: من ما يكتب يُطرد
— الجولات التالية: الأبطأ يُطرد
— ${pfx}غزو وقف — للمشرفين

👾 *اللاعبون (${activePlayers.length}):*
${mentions(activePlayers)}

⏳ يبدأ الغزو بعد *30 ثانية*`,
            mentions: activePlayers
        });

        await sleep(30_000);

        // ══════════════════════════════════════════════════════
        while (activePlayers.length > 1) {
            if (session.stop) break;

            const codes   = genCodes(3);
            const ROUND_T = 15;

            await sock.sendMessage(chatId, {
                text:
`━━━━━━━━━━━━━━━━
👾 *الجولة ${session.round}* | الناجون: ${activePlayers.length}
━━━━━━━━━━━━━━━━

اكتب أحد هذه الأكواد:
*${codes[0]}*   *${codes[1]}*   *${codes[2]}*

⏱️ لديك *${ROUND_T} ثانية*`
            });

            const roundStart = Date.now();
            const responded  = new Map();

            const roundListener = ({ messages }) => {
                const m = messages?.[0];
                if (!m?.message || m.key.remoteJid !== chatId || m.key.fromMe) return;
                const jid  = normalizeJid(m.key.participant || m.key.remoteJid) + '@s.whatsapp.net';
                const text = (m.message.conversation || m.message.extendedTextMessage?.text || '').trim();
                if (codes.includes(text) && activePlayers.includes(jid) && !responded.has(jid)) {
                    responded.set(jid, Date.now() - roundStart);
                    react(sock, m, '✅');
                }
            };

            sock.ev.on('messages.upsert', roundListener);
            await sleep(ROUND_T * 1000);
            sock.ev.off('messages.upsert', roundListener);

            if (session.stop) break;

            // ── تحديد المطرودين ───────────────────────────────
            const didNotAnswer = activePlayers.filter(p => !responded.has(p));
            let toRemove = [];

            if (session.round === 1) {
                toRemove = didNotAnswer;
            } else if (didNotAnswer.length > 0) {
                toRemove = didNotAnswer;
            } else {
                const sorted = [...responded.entries()].sort((a, b) => b[1] - a[1]);
                toRemove = [sorted[0][0]];
            }

            // تسجيل السرعة
            for (const [jid, ms] of responded.entries()) {
                if (!speedLog[jid]) speedLog[jid] = [];
                speedLog[jid].push(ms);
            }

            // ── الطرد (نفس أسلوب tayer.js) ───────────────────
            const toKick = toRemove.filter(p => normalizeJid(p) !== botNum);

            if (toKick.length > 0) {
                try {
                    await sock.groupParticipantsUpdate(chatId, toKick, 'remove');
                } catch (e) {
                    console.error('[غزو] خطأ في الطرد:', e);
                }

                const kickText = toKick.length === 1
                    ? pick(ABDUCT_ONE)(normalizeJid(toKick[0]))
                    : `${pick(ABDUCT_MULTI)(toKick.length)}\n${toKick.map(p => `@${normalizeJid(p)}`).join(' ')}`;

                await sock.sendMessage(chatId, { text: kickText, mentions: toKick });
                activePlayers = activePlayers.filter(p => !toKick.includes(p));
            } else {
                await sock.sendMessage(chatId, { text: pick(SAFE_MSGS) });
            }

            if (activePlayers.length <= 1) break;

            await sock.sendMessage(chatId, {
                text: `⏳ الجولة القادمة بعد *10 ثوانٍ* — الناجون: ${activePlayers.length}\n${mentions(activePlayers)}`,
                mentions: activePlayers
            });
            await sleep(10_000);
            session.round++;
        }

        // ══════════════════════════════════════════════════════
        // نهاية اللعبة
        // ══════════════════════════════════════════════════════
        if (session.stop) {
            await reply(sock, chatId, '🛑 الغزو أُوقف.', msg);

        } else if (activePlayers.length === 1) {
            const winner  = activePlayers[0];
            const topList = Object.entries(speedLog)
                .map(([jid, times]) => ({
                    jid,
                    avg: times.length ? times.reduce((a, b) => a + b, 0) / times.length : Infinity
                }))
                .filter(x => x.avg < Infinity)
                .sort((a, b) => a.avg - b.avg)
                .slice(0, 3)
                .map((x, i) => `${'🥇🥈🥉'[i]} @${normalizeJid(x.jid)} — ${(x.avg / 1000).toFixed(2)}s`)
                .join('\n');

            await sock.sendMessage(chatId, {
                text: `🏆 *انتهى الغزو*\n\nالناجي: @${normalizeJid(winner)}${topList ? `\n\n⚡ *أسرع اللاعبين:*\n${topList}` : ''}`,
                mentions: [winner, ...Object.keys(speedLog)]
            });

        } else if (activePlayers.length === 0) {
            await reply(sock, chatId, '💀 تم اختطاف الجميع. لا يوجد ناجين.', msg);

        } else {
            await sock.sendMessage(chatId, {
                text: `🛑 توقف الغزو — الناجون (${activePlayers.length}):\n${mentions(activePlayers)}`,
                mentions: activePlayers
            });
        }

    } catch (err) {
        console.error('[غزو] خطأ:', err);
        await reply(sock, chatId, '❌ توقفت اللعبة بسبب خطأ تقني.', msg).catch(() => {});
    } finally {
        activeGames.delete(chatId);
    }
}

export default { NovaUltra, execute };
