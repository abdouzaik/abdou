// ══════════════════════════════════════════════════════════════
//  لعبة الغزو الفضائي — غزو.js (Ultra Edition)
//  الإصدار: 5.3.0 — elite.js pattern: فصل النص عن الإشعار
// ══════════════════════════════════════════════════════════════
import { fileURLToPath } from "url";

const wait = ms => new Promise(r => setTimeout(r, ms));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// ── استخراج الرقم النظيف من أي JID ──────────────────────────
const numOf = jid =>
    jid ? jid.split("@")[0].split(":")[0] : "";

// ── هل هو رقم هاتف حقيقي؟ (7-13 رقم) ─────────────────────────
// LID دائماً أكثر من 13 رقم
const isPhone = id => {
    const n = numOf(id);
    return n.length >= 7 && n.length <= 13;
};

/**
 * نفس نمط elite.js:
 *   mentions[] ← الـ JID الأصلي كامل (حتى LID) → يرن هاتف الشخص
 *   text       ← @رقم لو phone حقيقي، وإلا 👤
 *
 * @param {string[]} jids  - قائمة الـ JIDs
 * @param {number}   [seq] - رقم تسلسلي (اختياري) لعرضه بدل 👤
 */
const display = id => isPhone(id) ? `@${numOf(id)}` : "👤";

// ── رسائل اللعبة ──────────────────────────────────────────────
const ABDUCT = [
    id => `☄️ *تم اختطاف اللاعب:* ${display(id)}`,
    id => `👾 *تم سحب:* ${display(id)} _بسبب بطء الاستجابة_`,
    id => `🛸 *الاختطاف تم بنجاح لـ:* ${display(id)}`,
    id => `🌌 *الضحية الحالية:* ${display(id)} _غادر الكوكب_`,
];

const WIN = [
    id => `🏆 *تـهـانـيـنـا!* ${display(id)} _هو الناجي الوحيد والبطل._`,
    id => `🥇 *الـبـطـل الـخـارق:* ${display(id)} _صمد أمام الغزو الفضائي._`,
];

// ── جلسات ─────────────────────────────────────────────────────
const activeGames = new Map();

export const NovaUltra = {
    command: "غزو", description: "لعبة الغزو الفضائي",
    group: true, elite: "off",
};

export async function execute({ sock, msg, args }) {
    const chatId   = msg.key.remoteJid;
    const botNum   = numOf(sock.user?.id || "");
    const ownerNum = (global._botConfig?.owner || "213540419314").replace(/\D/g, "");

    // ── وقف اللعبة ──────────────────────────────────────────
    if (args?.[0] === "وقف") {
        if (!activeGames.has(chatId))
            return sock.sendMessage(chatId, { text: "❌ _لا توجد جولة قائمة._" });
        activeGames.get(chatId).stop = true;
        return sock.sendMessage(chatId, { react: { text: "🛑", key: msg.key } });
    }
    if (activeGames.has(chatId))
        return sock.sendMessage(chatId, { text: "⚠️ _الغزو مستمر بالفعل!_" });

    // ── جلب بيانات المجموعة ──────────────────────────────────
    const metadata = await sock.groupMetadata(chatId).catch(() => null);
    if (!metadata) return;

    // ── بناء قائمة اللاعبين ──────────────────────────────────
    let elitesList = [];
    try {
        if (typeof sock.getEliteList === "function")
            elitesList = (await sock.getEliteList()) || [];
    } catch {}

    // allMembers: الـ JIDs الأصلية كما هي (phone أو LID)
    const allMembers = metadata.participants.map(p => p.id);

    // اللاعبون = غير البوت وغير الأونر وغير النخبة
    let players = [];
    for (const id of allMembers) {
        const n = numOf(id);
        const isBot   = n === botNum;
        const isOwner = n === ownerNum;
        const isElite = elitesList.some(e => numOf(e) === n);
        if (!isBot && !isOwner && !isElite) players.push(id);
    }

    if (players.length < 2)
        return sock.sendMessage(chatId, {
            text: "❌ *العدد غير كافي!*\n_اللعبة تحتاج شخصين عاديين على الأقل._",
        });

    // ── إنشاء الجلسة ──────────────────────────────────────────
    const session = { stop: false, round: 1, speedLog: {}, startTime: Date.now() };
    activeGames.set(chatId, session);
    players.forEach(p => { session.speedLog[p] = []; });

    try {
        // ── إعلان البداية (نمط elite.js) ─────────────────────
        let startText = "🛸 *--- إنـذار بـغـزو فـضـائـي ---*\n\n";
        startText += "_تم رصد مركبات تقترب من المجموعة..._\n";
        startText += "_القوانين:_ `أسرع من يكتب الكود ينجو، والأبطأ يطرد!`\n\n";
        startText += "_المشاركون:_\n";

        const startMentions = [];
        for (const id of allMembers) {
            // النص: @رقم لو phone، وإلا لا نذكر الرقم (عشان ما يظهر LID)
            if (isPhone(id)) startText += `@${numOf(id)} `;
            startMentions.push(id); // الإشعار: الـ JID الأصلي دائماً
        }
        startText += "\n\n⏳ _سيتم إطلاق أول كود بعد_ *15 ثانية*";

        await sock.sendMessage(chatId, { text: startText, mentions: startMentions });
        await wait(15000);

        // ── حلقة اللعب ────────────────────────────────────────
        while (players.length > 1 && !session.stop) {
            const codes = [
                Math.floor(1000 + Math.random() * 9000).toString(),
                Math.floor(1000 + Math.random() * 9000).toString(),
            ];

            await sock.sendMessage(chatId, {
                text:
`👾 *الـجـولـة [ ${session.round} ]*
_الناجون المتبقون:_ *${players.length}*

_اكتب أحد الأكواد التالية:_
\`${codes[0]}\`  -  \`${codes[1]}\`

⏱️ *10 ثوانٍ فقط!*`,
            });

            const roundStart = Date.now();
            const responded  = new Map();

            const rl = ({ messages }) => {
                const m = messages[0];
                if (!m?.message || m.key.remoteJid !== chatId) return;
                const txt  = (m.message.conversation || m.message.extendedTextMessage?.text || "").trim();
                const from = m.key.participant || m.key.remoteJid;
                const fromNum = numOf(from);
                // مقابلة اللاعب بالرقم (يعمل مع phone وLID)
                const matchP = players.find(p => numOf(p) === fromNum);
                if (codes.includes(txt) && matchP && !responded.has(matchP)) {
                    responded.set(matchP, Date.now() - roundStart);
                    sock.sendMessage(chatId, { react: { text: "✅", key: m.key } }).catch(() => {});
                }
            };
            sock.ev.on("messages.upsert", rl);
            await wait(10000);
            sock.ev.off("messages.upsert", rl);
            if (session.stop) break;

            // ── تحديد المطرود ──────────────────────────────────
            const didNot = players.filter(p => !responded.has(p));
            const target = didNot.length > 0
                ? pick(didNot)
                : players.map(p => ({ p, t: responded.get(p) })).sort((a, b) => b.t - a.t)[0].p;

            // طرد
            await sock.groupParticipantsUpdate(chatId, [target], "remove")
                .catch(err => console.log(`[Kick]: ${err.message}`));

            // رسالة الاختطاف — نفس نمط elite.js
            await sock.sendMessage(chatId, {
                text:     pick(ABDUCT)(target),   // display() يقرر النص
                mentions: [target],               // JID أصلي دائماً للإشعار
            });

            players = players.filter(p => p !== target);
            for (const p of players) {
                if (responded.has(p)) session.speedLog[p].push(responded.get(p));
            }

            if (players.length > 1) {
                await sock.sendMessage(chatId, { text: "⏳ _استعدوا للجولة التالية..._" });
                await wait(5000);
            }
            session.round++;
        }

        // ── النتائج النهائية ──────────────────────────────────
        if (session.stop) {
            await sock.sendMessage(chatId, { text: "🛑 *توقف الغزو بناءً على طلب القائد.*" });

        } else if (players.length === 1) {
            const winner = players[0];

            // ترتيب السرعة — نفس نمط elite.js
            let statsText = "";
            const topMentions = [winner];
            const top = Object.entries(session.speedLog)
                .map(([jid, ts]) => ({ jid, avg: ts.length ? ts.reduce((a,b) => a+b,0)/ts.length : 99999 }))
                .filter(x => x.avg < 99999)
                .sort((a, b) => a.avg - b.avg)
                .slice(0, 3);

            for (let i = 0; i < top.length; i++) {
                const x    = top[i];
                const disp = isPhone(x.jid) ? `@${numOf(x.jid)}` : "👤";
                statsText += `${["🥇","🥈","🥉"][i]} *${disp}* : \`${(x.avg/1000).toFixed(2)}s\`\n`;
                topMentions.push(x.jid);
            }

            await sock.sendMessage(chatId, {
                text: `${pick(WIN)(winner)}\n\n⚡ *تـرتـيـب الأسـرع:*\n${statsText||"_لا توجد بيانات_"}`,
                mentions: [...new Set(topMentions)],  // JIDs أصلية دائماً
            });

        } else {
            await sock.sendMessage(chatId, { text: "💀 *انتهى الغزو بإبادة الجميع.*" });
        }

    } catch (err) {
        console.error("[الغزو] خطأ:", err);
        await sock.sendMessage(chatId, { text: "❌ _خطأ تقني أدى لتوقف الغزو._" });
    } finally {
        activeGames.delete(chatId);
    }
}

export default { NovaUltra, execute };
