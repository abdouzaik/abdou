// ══════════════════════════════════════════════════════════════
//  لعبة الغزو الفضائي — غزو.js
//  البقاء للأسرع | Area 51
// ══════════════════════════════════════════════════════════════

const NovaUltra = {
    command: 'غزو',
    description: 'لعبة الغزو الفضائي — البقاء للأسرع',
    elite: 'off',
    group: true,
    prv: false,
    lock: 'off'
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// جلسات اللعب النشطة
const activeGames = new Map(); // chatId → { stop, round, players }

// ── رسائل الخطف العشوائية ──────────────────────────────────────
const ABDUCT_MSGS = [
    p => `☄️ @${p} تأخر لحظة واحدة — تم اختطافه.`,
    p => `👾 الفضائيون طافوا على @${p} وأخذوه.`,
    p => `🚀 @${p} وجد نفسه فجأة داخل المركبة.`,
    p => `🛸 @${p} كان ينظر للسماء — هذا كان غلطه.`,
    p => `🌌 @${p} اختفى من الرادار.`,
    p => `⚡ @${p} كان الأبطأ — الفضاء لا يرحم.`,
    p => `🔭 @${p} رصده الفضائيون وحملوه.`,
];

const MULTI_ABDUCT_MSGS = [
    n => `☄️ ${n} أعضاء تم اختطافهم في هذه الجولة.`,
    n => `👾 الفضائيون فازوا بـ ${n} هذه المرة.`,
    n => `🛸 المركبة أقلعت وعلى متنها ${n} ضحية.`,
];

const SAFE_MSGS = [
    '✅ الجميع تجاوب — لكن الفضائيين ما استسلموا بعد.',
    '✅ لم يُختطف أحد هذه الجولة — الخطر لم ينتهِ.',
    '✅ نجا الكل — المركبة تعيد تحميل أسلحتها.',
];

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ── توليد أرقام غير مكررة ──────────────────────────────────────
function genCodes(count = 3) {
    const codes = new Set();
    while (codes.size < count)
        codes.add(String(Math.floor(1000 + Math.random() * 9000)));
    return [...codes];
}

// ── تنسيق الثواني المتبقية (عداد تنازلي بالتعديل) ─────────────
async function sendCountdown(sock, chatId, sentKey, seconds) {
    const steps = [Math.floor(seconds * 0.5), Math.floor(seconds * 0.25)].filter(s => s > 1);
    for (const s of steps) {
        await sleep((seconds - s) * 1000);
        await sock.sendMessage(chatId, {
            text: `⏱️ *${s} ثانية متبقية...*`,
            edit: sentKey
        }).catch(() => {});
        seconds = s;
    }
    await sleep(seconds * 1000);
}

// ══════════════════════════════════════════════════════════════
async function execute({ sock, msg, args, sender }) {
    const chatId = msg.key.remoteJid;
    const pfx    = global._botConfig?.prefix || '.';

    // ── أمر الإيقاف .وقف ──────────────────────────────────────
    const subCmd = args?.[0]?.trim();
    if (subCmd === 'وقف') {
        if (!activeGames.has(chatId))
            return sock.sendMessage(chatId, { text: '❌ ما في غزو يعمل حالياً.' }, { quoted: msg });
        // تحقق إن المستخدم مشرف
        try {
            const meta    = await sock.groupMetadata(chatId);
            const botNum  = sock.user.id.split(':')[0];
            const normalizeJid2 = (jid) => jid ? jid.split('@')[0].split(':')[0].replace(/\D/g,'') : '';
            const admins  = meta.participants.filter(p => p.admin).map(p => normalizeJid2(p.id));
            const sNum    = normalizeJid2(sender?.pn || msg.key.participant || '');
            if (!msg.key.fromMe && !admins.includes(sNum))
                return sock.sendMessage(chatId, { text: '❌ فقط المشرفين يقدرون يوقفون اللعبة.' }, { quoted: msg });
        } catch {}
        activeGames.get(chatId).stop = true;
        return sock.sendMessage(chatId, { text: '🛑 تم إيقاف الغزو من قِبَل المشرف.' }, { quoted: msg });
    }

    // ── منع التكرار ───────────────────────────────────────────
    if (activeGames.has(chatId))
        return sock.sendMessage(chatId, { text: `⚠️ الغزو شغّال. لإيقافه: *${pfx}غزو وقف*` }, { quoted: msg });

    // ── تحقق من صلاحيات البوت ─────────────────────────────────
    let meta;
    try { meta = await sock.groupMetadata(chatId); }
    catch { return sock.sendMessage(chatId, { text: '❌ تعذر جلب بيانات المجموعة.' }, { quoted: msg }); }

    // تطبيع الـ JID — يحذف رقم الجهاز (:XX) للمقارنة الصحيحة
    // نفس normalizeJid المستخدمة في messages.js — أرقام فقط
    const normalizeJid = (jid) => {
        if (!jid) return '';
        return jid.split('@')[0].split(':')[0].replace(/\D/g, '');
    };
    const botNum   = normalizeJid(sock.user.id);
    const botId    = botNum + '@s.whatsapp.net';

    const botEntry = meta.participants.find(p => normalizeJid(p.id) === botNum);
    const botIsAdmin = botEntry?.admin === 'admin' || botEntry?.admin === 'superadmin';

    if (!botIsAdmin)
        return sock.sendMessage(chatId, { text: '❌ البوت يحتاج صلاحية مشرف لتشغيل اللعبة.' }, { quoted: msg });

    // ── تجهيز اللاعبين — بدون البوت فقط (المشرفين يلعبون) ─────
    let activePlayers = meta.participants
        .filter(p => normalizeJid(p.id).split('@')[0] !== botNum)
        .map(p => normalizeJid(p.id));

    if (activePlayers.length < 2)
        return sock.sendMessage(chatId, { text: '❌ يحتاج على الأقل لاعبَين لبدء اللعبة.' }, { quoted: msg });

    const session = { stop: false, round: 1 };
    activeGames.set(chatId, session);

    // ── إحصاء السرعة (للترتيب النهائي) ───────────────────────
    const speedLog = {}; // jid → [responseTime, ...]
    activePlayers.forEach(p => speedLog[p] = []);

    const playerMentions = (list) => list.map(p => `@${p.split('@')[0]}`).join(' ');

    try {
        // ── رسالة البداية ─────────────────────────────────────
        await sock.sendMessage(chatId, {
            text:
`🛸 *غزو فضائي — المنطقة 51*

المركبة الفضائية تقترب من المجموعة.
كل جولة سيظهر *كود مكون من 4 أرقام* — اكتبه بأسرع ما تقدر.

📋 *القواعد:*
— الجولة الأولى: من ما يكتب يُختطف
— الجولات التالية: الأبطأ يُختطف
— ${pfx}غزو وقف — للمشرفين فقط

👾 *اللاعبون (${activePlayers.length}):*
${playerMentions(activePlayers)}

⏳ يبدأ الغزو بعد *30 ثانية* — استعدوا!`,
            mentions: activePlayers
        });

        await sleep(30_000);

        // ══════════════════════════════════════════════════════
        // حلقة الجولات
        // ══════════════════════════════════════════════════════
        while (activePlayers.length > 1) {
            if (session.stop) break;

            const round    = session.round;
            const codes    = genCodes(3);
            const ROUND_T  = 15; // ثانية

            // رسالة الجولة
            const roundSent = await sock.sendMessage(chatId, {
                text:
`━━━━━━━━━━━━━━━━━━━
👾 *الجولة ${round}* | الناجون: ${activePlayers.length}
━━━━━━━━━━━━━━━━━━━

اكتب أحد هذه الأكواد للنجاة:
*${codes[0]}*   *${codes[1]}*   *${codes[2]}*

⏱️ لديك *${ROUND_T} ثانية*`
            });

            // مراقبة الردود
            const roundStart  = Date.now();
            const responded   = new Map(); // jid → timestamp

            const roundListener = ({ messages }) => {
                const m = messages?.[0];
                if (!m?.message || m.key.remoteJid !== chatId || m.key.fromMe) return;


                const rawJid = m.key.participant || m.key.remoteJid;
                const jid  = normalizeJid(rawJid) + '@s.whatsapp.net';
                const text = (m.message.conversation || m.message.extendedTextMessage?.text || '').trim();

                if (codes.includes(text) && activePlayers.includes(jid) && !responded.has(jid)) {
                    responded.set(jid, Date.now() - roundStart);
                    sock.sendMessage(chatId, { react: { text: '✅', key: m.key } }).catch(() => {});
                }
            };

            sock.ev.on('messages.upsert', roundListener);
            await sleep(ROUND_T * 1000);
            sock.ev.off('messages.upsert', roundListener);

            if (session.stop) break;

            // ── تحديد المختطفين ──────────────────────────────
            const didNotAnswer = activePlayers.filter(p => !responded.has(p));
            let kidnapped = [];

            if (round === 1) {
                // الجولة الأولى: طرد كل من ما جاوب
                kidnapped = didNotAnswer;
            } else {
                if (didNotAnswer.length > 0) {
                    kidnapped = didNotAnswer;
                } else {
                    // الكل جاوب — اطرد الأبطأ
                    const sorted = [...responded.entries()].sort((a, b) => b[1] - a[1]);
                    kidnapped = [sorted[0][0]];
                }
            }

            // ── تسجيل السرعة ─────────────────────────────────
            for (const [jid, ms] of responded.entries()) {
                if (!speedLog[jid]) speedLog[jid] = [];
                speedLog[jid].push(ms);
            }

            // ── تنفيذ الاختطاف ───────────────────────────────
            const toKick = kidnapped.filter(p => normalizeJid(p) !== botNum);

            if (toKick.length > 0) {
                try {
                    await sock.groupParticipantsUpdate(chatId, toKick, 'remove');
                } catch {}

                // رسائل الخطف
                let kidnappedText = '';
                if (toKick.length === 1) {
                    const pName = `${normalizeJid(toKick[0])}`;
                    kidnappedText = pickRandom(ABDUCT_MSGS)(pName);
                } else {
                    const names = toKick.map(p => `@${p.split('@')[0]}`).join(', ');
                    kidnappedText = `${pickRandom(MULTI_ABDUCT_MSGS)(toKick.length)}\n${names}`;
                }

                await sock.sendMessage(chatId, {
                    text: kidnappedText,
                    mentions: toKick
                });

                activePlayers = activePlayers.filter(p => !toKick.includes(p));
            } else {
                await sock.sendMessage(chatId, { text: pickRandom(SAFE_MSGS) });
            }

            // ── تحقق من نهاية اللعبة ─────────────────────────
            if (activePlayers.length <= 1) break;

            // عداد الجولة التالية
            const countdown = await sock.sendMessage(chatId, {
                text: `⏳ الجولة القادمة بعد *10 ثوانٍ* — الناجون: ${activePlayers.length}\n${playerMentions(activePlayers)}`,
                mentions: activePlayers
            });
            await sleep(10_000);
            session.round++;
        }

        // ══════════════════════════════════════════════════════
        // نهاية اللعبة
        // ══════════════════════════════════════════════════════
        if (session.stop) {
            await sock.sendMessage(chatId, { text: '🛑 الغزو أُوقف قبل انتهائه.' });
        } else if (activePlayers.length === 1) {
            // حساب متوسط السرعة للترتيب
            const winner = activePlayers[0];
            const avgSpeed = (times) => times.length
                ? (times.reduce((a, b) => a + b, 0) / times.length / 1000).toFixed(2)
                : '—';

            // أسرع 3 لاعبين (ممن بقوا وخرجوا)
            const allSpeeds = Object.entries(speedLog)
                .map(([jid, times]) => ({ jid, avg: times.length ? times.reduce((a,b)=>a+b,0)/times.length : Infinity }))
                .filter(x => x.avg < Infinity)
                .sort((a, b) => a.avg - b.avg)
                .slice(0, 3);

            const topList = allSpeeds.map((x, i) => {
                const medals = ['🥇','🥈','🥉'];
                return `${medals[i]} @${normalizeJid(x.jid)} — ${(x.avg/1000).toFixed(2)}s`;
            }).join('\n');

            await sock.sendMessage(chatId, {
                text:
`🏆 *انتهى الغزو*

الناجي الوحيد: @${normalizeJid(winner)}
الفضائيون خسروا هذه المرة.

${topList ? `⚡ *أسرع اللاعبين:*\n${topList}` : ''}`,
                mentions: [winner, ...allSpeeds.map(x => x.jid)]
            });

        } else if (activePlayers.length === 0) {
            await sock.sendMessage(chatId, {
                text: '💀 *انتهى الغزو*\n\nتم اختطاف الجميع. لا يوجد ناجين.'
            });
        } else {
            // أُوقفت اللعبة وفيه أكثر من لاعب
            await sock.sendMessage(chatId, {
                text: `🛑 *توقف الغزو*\nالناجون (${activePlayers.length}): ${playerMentions(activePlayers)}`,
                mentions: activePlayers
            });
        }

    } catch (err) {
        console.error('[غزو] خطأ:', err);
        await sock.sendMessage(chatId, { text: '❌ توقفت اللعبة بسبب خطأ تقني.' }).catch(() => {});
    } finally {
        activeGames.delete(chatId);
    }
}

export default { NovaUltra, execute };
