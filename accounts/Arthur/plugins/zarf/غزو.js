// ══════════════════════════════════════════════════════════════
//  لعبة الغزو الفضائي — غزو.js (Ultra Edition 7.0)
//  ✅ متوافق مع بيئة Arthur_Bot (BIDS / sender / sock.getElites)
//  ✅ LID→JID mentions (twice map + cache)
//  ✅ Anti-Self-Kick via BIDS.pn + BIDS.lid
//  ✅ Elite & Admin immunity
//  ✅ Memory leak fix (try/finally)
//  ✅ Fisher-Yates, DRY loop, return-based elimination
// ══════════════════════════════════════════════════════════════
import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(process.cwd(), "nova", "data");

const wait    = ms  => new Promise(r => setTimeout(r, ms));
const pick    = arr => arr[Math.floor(Math.random() * arr.length)];
const numOf   = jid => jid ? jid.split("@")[0].split(":")[0] : "";
const isPhone = jid => { const n = numOf(jid); return n.length >= 7 && n.length <= 13; };
const display = jid => isPhone(jid) ? `@${numOf(jid)}` : "👤";

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ══════════════════════════════════════════════════════════════
//  Cache — بنية elite-pro.json (jids / lids / twice)
// ══════════════════════════════════════════════════════════════
const cachePath  = chatId =>
    path.join(DATA_DIR, "group_members_" + chatId.replace(/[^\w]/g, "_") + ".json");

const readCache  = chatId => {
    try {
        const p = cachePath(chatId);
        return fs.existsSync(p)
            ? JSON.parse(fs.readFileSync(p, "utf8"))
            : { jids: [], lids: [], twice: {} };
    } catch { return { jids: [], lids: [], twice: {} }; }
};
const writeCache = (chatId, d) => {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(cachePath(chatId), JSON.stringify(d, null, 2), "utf8");
    } catch {}
};

// ── بناء cache بـ chunks (10 طلب / 100ms) ────────────────────
async function buildGroupCache(sock, chatId, participants) {
    const cache   = readCache(chatId);
    const updated = { jids: [...cache.jids], lids: [...cache.lids], twice: { ...cache.twice } };
    const CHUNK = 10, DELAY = 100;

    for (let i = 0; i < participants.length; i += CHUNK) {
        await Promise.all(participants.slice(i, i + CHUNK).map(async p => {
            const raw = p.id;

            if (raw.endsWith("@s.whatsapp.net") && isPhone(raw)) {
                if (!updated.jids.includes(raw)) {
                    try {
                        const [info] = await sock.onWhatsApp(raw).catch(() => [{}]);
                        updated.jids.push(raw);
                        if (info?.exists && info.lid && !updated.lids.includes(info.lid)) {
                            updated.lids.push(info.lid);
                            updated.twice[raw]      = info.lid;
                            updated.twice[info.lid] = raw;
                        }
                    } catch { updated.jids.push(raw); }
                }

            } else if (raw.endsWith("@lid") && !updated.lids.includes(raw)) {
                try {
                    const [info] = await sock.onWhatsApp(raw).catch(() => [{}]);
                    if (info?.exists && info.jid?.endsWith("@s.whatsapp.net")) {
                        if (!updated.jids.includes(info.jid)) updated.jids.push(info.jid);
                        updated.lids.push(raw);
                        updated.twice[raw]       = info.jid;
                        updated.twice[info.jid]  = raw;
                    } else {
                        updated.lids.push(raw);
                    }
                } catch { updated.lids.push(raw); }
            }
        }));
        if (i + CHUNK < participants.length) await wait(DELAY);
    }
    writeCache(chatId, updated);
    return updated;
}

// ── LID → phone JID عبر twice map ────────────────────────────
const resolveJid = (raw, cache) =>
    isPhone(raw) ? raw : (raw.endsWith("@lid") && cache.twice[raw]) || null;

// ── mentions مضمونة: phoneJid + rawJid (اللون الأزرق) ─────────
const mentionSet = (phoneJid, rawJid) =>
    [...new Set([phoneJid, rawJid].filter(Boolean))];

// ══════════════════════════════════════════════════════════════
//  runRound — try/finally لمنع memory leak
// ══════════════════════════════════════════════════════════════
async function runRound(sock, chatId, players, validCodes) {
    const roundStart = Date.now();
    const responded  = new Map();

    const rl = ({ messages }) => {
        const m = messages[0];
        if (!m?.message || m.key.remoteJid !== chatId) return;
        const txt     = (m.message.conversation || m.message.extendedTextMessage?.text || "").trim();
        const fromNum = numOf(m.key.participant || m.key.remoteJid);
        const matchP  = players.find(p => numOf(p) === fromNum);
        if (validCodes.includes(txt) && matchP && !responded.has(matchP)) {
            responded.set(matchP, Date.now() - roundStart);
            sock.sendMessage(chatId, { react: { text: "✅", key: m.key } }).catch(() => {});
        }
    };

    sock.ev.on("messages.upsert", rl);
    try {
        await wait(10000);
    } finally {
        sock.ev.off("messages.upsert", rl);
    }
    return responded;
}

// ══════════════════════════════════════════════════════════════
//  processElimination — 20% طرد، حماية مشرفين ودرع
// ══════════════════════════════════════════════════════════════
async function processElimination(sock, chatId, players, responded, session, cache, adminNums) {
    const canKick = p => !adminNums.has(numOf(p)) && !session.shielded.has(p);
    const didNot  = players.filter(p => !responded.has(p) && canKick(p));

    let targets = [];
    if (didNot.length > 0) {
        const kickCount = Math.max(1, Math.ceil(didNot.length * 0.2));
        targets = shuffle(didNot).slice(0, kickCount);
    } else {
        const eligible = players
            .filter(canKick)
            .map(p => ({ p, t: responded.get(p) ?? 99999 }))
            .sort((a, b) => b.t - a.t);
        if (eligible.length > 0) targets = [eligible[0].p];
    }

    const ABDUCT_MSGS = [
        j => `☄️ *تم اختطاف اللاعب:* ${display(j)}`,
        j => `👾 *تم سحب:* ${display(j)} _بسبب بطء الاستجابة_`,
        j => `🛸 *الاختطاف تم بنجاح لـ:* ${display(j)}`,
        j => `🌌 *الضحية الحالية:* ${display(j)} _غادر الكوكب_`,
    ];

    for (const target of targets) {
        await sock.groupParticipantsUpdate(chatId, [target], "remove")
            .catch(err => console.log(`[Kick]: ${err.message}`));
        const phoneJid = resolveJid(target, cache) || target;
        await sock.sendMessage(chatId, {
            text:     pick(ABDUCT_MSGS)(phoneJid),
            mentions: mentionSet(phoneJid, target),
        });
        await wait(500);
    }

    for (const p of players) {
        if (!targets.includes(p) && responded.has(p))
            session.speedLog[p].push(responded.get(p));
    }
    return targets;
}

const EVENTS    = ["normal", "normal", "normal", "blackhole", "shield"];
const activeGames = new Map();

// ══════════════════════════════════════════════════════════════
const NovaUltra = {
    command:     "غزو",
    description: "لعبة الغزو الفضائي Ultra",
    group:       true,
    elite:       "off",
    prv:         false,
    lock:        "off",
};

// ── execute تأخذ BIDS و sender من بيئة Arthur_Bot ────────────
async function execute({ sock, msg, args, BIDS, sender }) {
    const chatId = msg.key.remoteJid;

    // ── معرّفات البوت من BIDS (phone + LID) ─────────────────
    const botNum = numOf(BIDS?.pn  || sock.user?.id  || "");
    const botLid = numOf(BIDS?.lid || sock.user?.lid || "");

    // ── الأونر من global._botConfig ───────────────────────────
    const ownerNum = (global._botConfig?.owner || "213540419314").replace(/\D/g, "");

    // ── وقف اللعبة ───────────────────────────────────────────
    if (args?.[0] === "وقف") {
        if (!activeGames.has(chatId))
            return sock.sendMessage(chatId, { text: "❌ _لا توجد جولة قائمة._" });
        activeGames.get(chatId).stop = true;
        return sock.sendMessage(chatId, { react: { text: "🛑", key: msg.key } });
    }
    if (activeGames.has(chatId))
        return sock.sendMessage(chatId, { text: "⚠️ _الغزو مستمر بالفعل!_" });

    const metadata = await sock.groupMetadata(chatId).catch(() => null);
    if (!metadata) return;

    await sock.sendMessage(chatId, { text: "🛸 _جاري تحديد الأعضاء..._" });
    const cache = await buildGroupCache(sock, chatId, metadata.participants);

    // ── المشرفون ──────────────────────────────────────────────
    const adminNums = new Set(
        metadata.participants.filter(p => p.admin).map(p => numOf(p.id))
    );

    // ── النخبة — sock.getElites() هي الطريقة الأصلية في بيئتك ─
    let eliteNums = new Set();
    try {
        // getElites() يرجع lids[] أو null (elite-pro.js)
        const lids = sock.getElites ? (sock.getElites() || []) : [];
        // fallback: قراءة elite-pro.json مباشرة
        let epJids = [], epLids = [...lids.map(numOf)];
        try {
            const epPath = path.join(process.cwd(), "handlers", "elite-pro.json");
            if (fs.existsSync(epPath)) {
                const ep = JSON.parse(fs.readFileSync(epPath, "utf8"));
                epJids = (ep.jids || []).map(numOf);
                epLids = [...new Set([...epLids, ...(ep.lids || []).map(numOf)])];
            }
        } catch {}
        eliteNums = new Set([...epJids, ...epLids]);
    } catch {}

    const allRaw = metadata.participants.map(p => p.id);

    // ── فلترة اللاعبين ────────────────────────────────────────
    let players = [];
    for (const raw of allRaw) {
        const phone = resolveJid(raw, cache);
        const n     = numOf(phone || raw);

        // استثناء: البوت (phone + LID)، الأونر، المشرفون، النخبة
        if (n === botNum || n === botLid   ) continue;
        if (n === ownerNum                 ) continue;
        if (adminNums.has(n)               ) continue;
        if (eliteNums.has(n)               ) continue;

        players.push(phone || raw);
    }

    if (players.length < 2)
        return sock.sendMessage(chatId, {
            text: "❌ *العدد غير كافي!*\n_اللعبة تحتاج شخصين عاديين على الأقل._",
        });

    const session = { stop: false, round: 1, speedLog: {}, shielded: new Set(), startTime: Date.now() };
    activeGames.set(chatId, session);
    players.forEach(p => { session.speedLog[p] = []; });

    try {
        // البداية: منشن مخفي — النص بدون أرقام
        await sock.sendMessage(chatId, {
            text:
`🛸 *--- إنـذار بـغـزو فـضـائـي ---*

_تم رصد مركبات تقترب من المجموعة..._
_القوانين:_ \`أسرع من يكتب الكود ينجو، والأبطأ يطرد!\`
_📊 المشاركون:_ *${players.length}* لاعب
🛡️ _المشرفون والنخبة محميون_

⏳ _سيتم إطلاق أول كود بعد_ *15 ثانية*`,
            mentions: allRaw,
        });
        await wait(15000);

        // ══ حلقة اللعب ═══════════════════════════════════════
        while (players.length > 1 && !session.stop) {
            const eventType  = pick(EVENTS);
            let roundMsg     = "";
            let validCodes   = [];
            let shieldRound  = false;

            if (eventType === "blackhole") {
                const code = Math.floor(1000 + Math.random() * 9000).toString();
                const rev  = code.split("").reverse().join("");
                validCodes = [rev];
                roundMsg =
`🕳️ *الجولة [ ${session.round} ] — ثـقـب أسـود!*
_الناجون:_ *${players.length}*

⚠️ _الكود مقلوب! اكتبه معكوساً:_
\`${code}\` ← اكتب: \`${rev}\`

⏱️ *10 ثوانٍ فقط!*`;

            } else if (eventType === "shield") {
                validCodes = [
                    Math.floor(1000 + Math.random() * 9000).toString(),
                    Math.floor(1000 + Math.random() * 9000).toString(),
                ];
                shieldRound = true;
                roundMsg =
`🛡️ *الجولة [ ${session.round} ] — درع الحماية!*
_الناجون:_ *${players.length}*

⚡ _أسرع مستجيب يحصل على حماية من الطرد في الجولة القادمة!_
\`${validCodes[0]}\`  -  \`${validCodes[1]}\`

⏱️ *10 ثوانٍ فقط!*`;

            } else {
                validCodes = [
                    Math.floor(1000 + Math.random() * 9000).toString(),
                    Math.floor(1000 + Math.random() * 9000).toString(),
                ];
                roundMsg =
`👾 *الـجـولـة [ ${session.round} ]*
_الناجون المتبقون:_ *${players.length}*

_اكتب أحد الأكواد التالية:_
\`${validCodes[0]}\`  -  \`${validCodes[1]}\`

⏱️ *10 ثوانٍ فقط!*`;
            }

            await sock.sendMessage(chatId, { text: roundMsg });

            const responded = await runRound(sock, chatId, players, validCodes);
            if (session.stop) break;

            // الطرد — الدروع القديمة لا تزال فعّالة
            const eliminated = await processElimination(
                sock, chatId, players, responded, session, cache, adminNums
            );
            players = players.filter(p => !eliminated.includes(p));

            // مسح الدروع المستهلكة
            session.shielded.clear();

            // درع جديد بعد المسح — يحمي في الجولة القادمة
            if (shieldRound && responded.size > 0) {
                const fastest = [...responded.entries()].sort((a, b) => a[1] - b[1])[0][0];
                if (players.includes(fastest)) {
                    session.shielded.add(fastest);
                    const shPhone = resolveJid(fastest, cache) || fastest;
                    await sock.sendMessage(chatId, {
                        text:     `🛡️ *${display(shPhone)} حصل على درع الحماية للجولة القادمة!*`,
                        mentions: mentionSet(shPhone, fastest),
                    });
                }
            }

            if (players.length > 1 && !session.stop) {
                await sock.sendMessage(chatId, {
                    text: `⏳ _استعدوا للجولة التالية... (المتبقون: ${players.length})_`,
                });
                await wait(5000);
            }
            session.round++;
        }

        // ── النتائج ────────────────────────────────────────────
        if (session.stop) {
            await sock.sendMessage(chatId, { text: "🛑 *توقف الغزو بناءً على طلب القائد.*" });

        } else if (players.length === 1) {
            const winner = players[0];
            const phoneW = resolveJid(winner, cache) || winner;
            const WIN = [
                j => `🏆 *تـهـانـيـنـا!* ${display(j)} _هو الناجي الوحيد والبطل._`,
                j => `🥇 *الـبـطـل الـخـارق:* ${display(j)} _صمد أمام الغزو الفضائي._`,
            ];
            const top = Object.entries(session.speedLog)
                .map(([jid, ts]) => ({
                    jid,
                    phone: resolveJid(jid, cache) || jid,
                    avg:   ts.length ? ts.reduce((a, b) => a + b, 0) / ts.length : 99999,
                }))
                .filter(x => x.avg < 99999)
                .sort((a, b) => a.avg - b.avg)
                .slice(0, 3);

            const statsText = top.map((x, i) =>
                `${["🥇","🥈","🥉"][i]} *${display(x.phone)}* : \`${(x.avg / 1000).toFixed(2)}s\``
            ).join("\n");

            await sock.sendMessage(chatId, {
                text:     `${pick(WIN)(phoneW)}\n\n⚡ *تـرتـيـب الأسـرع:*\n${statsText || "_لا توجد بيانات_"}`,
                mentions: [...new Set([phoneW, winner, ...top.map(x => x.phone), ...top.map(x => x.jid)])],
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
