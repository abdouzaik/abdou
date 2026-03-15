// ══════════════════════════════════════════════════════════════
//  لعبة الغزو الفضائي — غزو.js (Ultra Edition 6.1)
//  Refactored: DRY loop, return-based elimination, Fisher-Yates
// ══════════════════════════════════════════════════════════════
import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, "../../nova/data");

const wait  = ms  => new Promise(r => setTimeout(r, ms));
const pick  = arr => arr[Math.floor(Math.random() * arr.length)];
const numOf = jid => jid ? jid.split("@")[0].split(":")[0] : "";
const isPhone = jid => { const n = numOf(jid); return n.length >= 7 && n.length <= 13; };
const display = jid => isPhone(jid) ? `@${numOf(jid)}` : "👤";

// Fisher-Yates shuffle — عشوائية حقيقية بدون إحيائية
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ── Cache بنية elite-pro.json لكل قروب ──────────────────────
const cachePath = chatId =>
    path.join(DATA_DIR, "group_members_" + chatId.replace(/[^\w]/g,"_") + ".json");

const readCache = chatId => {
    try {
        const p = cachePath(chatId);
        return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p,"utf8")) : { jids:[], lids:[], twice:{} };
    } catch { return { jids:[], lids:[], twice:{} }; }
};
const writeCache = (chatId, d) => {
    try { fs.mkdirSync(DATA_DIR,{recursive:true}); fs.writeFileSync(cachePath(chatId),JSON.stringify(d,null,2),"utf8"); } catch {}
};

// Chunks للـ onWhatsApp — 10 طلبات/100ms لتفادي rate-limit
async function buildGroupCache(sock, chatId, participants) {
    const cache   = readCache(chatId);
    const updated = { jids:[...cache.jids], lids:[...cache.lids], twice:{...cache.twice} };
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
                            updated.twice[raw] = info.lid;
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
                        updated.twice[raw] = info.jid;
                        updated.twice[info.jid] = raw;
                    } else { updated.lids.push(raw); }
                } catch { updated.lids.push(raw); }
            }
        }));
        if (i + CHUNK < participants.length) await wait(DELAY);
    }
    writeCache(chatId, updated);
    return updated;
}

const resolveJid = (raw, cache) =>
    isPhone(raw) ? raw : (raw.endsWith("@lid") && cache.twice[raw]) || null;

/**
 * processElimination — يُرجع مصفوفة المطرودين (return-based, no side effects)
 * - يحمي المشرفين وأصحاب الدرع
 * - 20% من غير المجاوبين (بحد أدنى 1)
 * - لو الكل أجاب: أبطأ لاعب غير محمي
 * ملاحظة: لو الباقون الوحيدون هم مشرفون لن يُطرد أحد (اللعبة مستمرة)
 */
async function processElimination(sock, chatId, players, responded, session, cache, adminNums) {
    const canKick = p => !adminNums.has(numOf(p)) && !session.shielded.has(p);

    const didNot = players.filter(p => !responded.has(p) && canKick(p));

    let targets = [];
    if (didNot.length > 0) {
        const kickCount = Math.max(1, Math.ceil(didNot.length * 0.2));
        targets = shuffle(didNot).slice(0, kickCount);
    } else {
        // الكل أجاب أو كلهم محميون — أبطأ لاعب قابل للطرد
        const eligible = players
            .filter(canKick)
            .map(p => ({ p, t: responded.get(p) ?? 99999 }))
            .sort((a,b) => b.t - a.t);
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
            mentions: [...new Set([phoneJid, target])],
        });
        await wait(500);
    }

    // تحديث speedLog للناجين فقط
    for (const p of players) {
        if (!targets.includes(p) && responded.has(p))
            session.speedLog[p].push(responded.get(p));
    }

    return targets; // ← return مباشر بدون side effects
}

/**
 * runRound — دالة موحدة لتسجيل الردود
 * تُرجع Map<player, responseTime>
 * الكود الصحيح يُمرَّر كـ validCodes[]
 */
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
    await wait(10000);
    sock.ev.off("messages.upsert", rl);
    return responded;
}

// ── أنواع الأحداث العشوائية ──────────────────────────────────
// 60% عادية، 20% ثقب أسود، 20% درع
const EVENTS = ["normal","normal","normal","blackhole","shield"];

const activeGames = new Map();

// ══════════════════════════════════════════════════════════════
export const NovaUltra = {
    command: "غزو", description: "لعبة الغزو الفضائي Ultra",
    group: true, elite: "off",
};

export async function execute({ sock, msg, args }) {
    const chatId   = msg.key.remoteJid;
    const botNum   = numOf(sock.user?.id || "");
    const ownerNum = (global._botConfig?.owner || "213540419314").replace(/\D/g,"");

    if (args?.[0] === "وقف") {
        if (!activeGames.has(chatId)) return sock.sendMessage(chatId,{text:"❌ _لا توجد جولة قائمة._"});
        activeGames.get(chatId).stop = true;
        return sock.sendMessage(chatId,{react:{text:"🛑",key:msg.key}});
    }
    if (activeGames.has(chatId)) return sock.sendMessage(chatId,{text:"⚠️ _الغزو مستمر بالفعل!_"});

    const metadata = await sock.groupMetadata(chatId).catch(() => null);
    if (!metadata) return;

    await sock.sendMessage(chatId,{text:"🛸 _جاري تحديد الأعضاء..._"});
    const cache = await buildGroupCache(sock, chatId, metadata.participants);

    const adminNums = new Set(
        metadata.participants.filter(p => p.admin).map(p => numOf(p.id))
    );

    let elitesList = [];
    try { if (typeof sock.getEliteList==="function") elitesList = await sock.getEliteList()||[]; } catch {}

    const allRaw = metadata.participants.map(p => p.id);

    let players = [];
    for (const raw of allRaw) {
        const phone = resolveJid(raw, cache);
        const n = numOf(phone || raw);
        if (n===botNum || n===ownerNum || elitesList.some(e=>numOf(e)===n)) continue;
        players.push(phone || raw);
    }

    if (players.length < 2)
        return sock.sendMessage(chatId,{text:"❌ *العدد غير كافي!*\n_اللعبة تحتاج شخصين على الأقل._"});

    const session = { stop:false, round:1, speedLog:{}, shielded:new Set(), startTime:Date.now() };
    activeGames.set(chatId, session);
    players.forEach(p => { session.speedLog[p] = []; });

    try {
        // البداية: منشن مخفي للجميع
        await sock.sendMessage(chatId, {
            text:
`🛸 *--- إنـذار بـغـزو فـضـائـي ---*

_تم رصد مركبات تقترب من المجموعة..._
_القوانين:_ \`أسرع من يكتب الكود ينجو، والأبطأ يطرد!\`
_📊 المشاركون:_ *${players.length}* لاعب
🛡️ _المشرفون محميون من الطرد_

⏳ _سيتم إطلاق أول كود بعد_ *15 ثانية*`,
            mentions: allRaw,
        });
        await wait(15000);

        // ══ حلقة اللعب الموحدة ═══════════════════════════════
        while (players.length > 1 && !session.stop) {
            const eventType = pick(EVENTS);

            // ── بناء رسالة الجولة + تحديد الأكواد الصحيحة ────
            let roundMsg = "";
            let validCodes = [];
            let shieldRound = false;

            if (eventType === "blackhole") {
                const code = Math.floor(1000+Math.random()*9000).toString();
                const rev  = code.split("").reverse().join("");
                validCodes = [rev];
                roundMsg =
`🕳️ *الجولة [ ${session.round} ] — ثـقـب أسـود!*
_الناجون:_ *${players.length}*

⚠️ _الكود المعروض مقلوب! اكتبه معكوساً:_
\`${code}\` ← اكتب: \`${rev}\`

⏱️ *10 ثوانٍ فقط!*`;

            } else if (eventType === "shield") {
                validCodes = [
                    Math.floor(1000+Math.random()*9000).toString(),
                    Math.floor(1000+Math.random()*9000).toString(),
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
                    Math.floor(1000+Math.random()*9000).toString(),
                    Math.floor(1000+Math.random()*9000).toString(),
                ];
                roundMsg =
`👾 *الـجـولـة [ ${session.round} ]*
_الناجون المتبقون:_ *${players.length}*

_اكتب أحد الأكواد التالية:_
\`${validCodes[0]}\`  -  \`${validCodes[1]}\`

⏱️ *10 ثوانٍ فقط!*`;
            }

            await sock.sendMessage(chatId, { text: roundMsg });

            // ── تسجيل الردود (موحد لجميع الأنواع) ─────────────
            const responded = await runRound(sock, chatId, players, validCodes);
            if (session.stop) break;

            // ── الطرد: يعمل أولاً والدروع القديمة لا تزال فعّالة ────
            const eliminated = await processElimination(
                sock, chatId, players, responded, session, cache, adminNums
            );
            players = players.filter(p => !eliminated.includes(p));

            // ── مسح الدروع القديمة بعد الطرد (استُهلكت الآن) ────
            session.shielded.clear();

            // ── درع جديد: يُعطى بعد المسح → يحمي في الجولة القادمة ──
            if (shieldRound && responded.size > 0) {
                const fastest = [...responded.entries()].sort((a,b) => a[1]-b[1])[0][0];
                // تأكد أنه لا يزال في اللعبة
                if (players.includes(fastest)) {
                    session.shielded.add(fastest);
                    const shPhone = resolveJid(fastest, cache) || fastest;
                    await sock.sendMessage(chatId, {
                        text:     `🛡️ *${display(shPhone)} حصل على درع الحماية للجولة القادمة!*`,
                        mentions: [...new Set([shPhone, fastest])],
                    });
                }
            }

            if (players.length > 1 && !session.stop) {
                await sock.sendMessage(chatId,{
                    text:`⏳ _استعدوا للجولة التالية... (المتبقون: ${players.length})_`,
                });
                await wait(5000);
            }
            session.round++;
        }

        // النتائج
        if (session.stop) {
            await sock.sendMessage(chatId,{text:"🛑 *توقف الغزو بناءً على طلب القائد.*"});
        } else if (players.length === 1) {
            const winner  = players[0];
            const phoneW  = resolveJid(winner, cache) || winner;
            const WIN = [
                j => `🏆 *تـهـانـيـنـا!* ${display(j)} _هو الناجي الوحيد والبطل._`,
                j => `🥇 *الـبـطـل الـخـارق:* ${display(j)} _صمد أمام الغزو الفضائي._`,
            ];
            const top = Object.entries(session.speedLog)
                .map(([jid,ts])=>({ jid, phone:resolveJid(jid,cache)||jid, avg:ts.length?ts.reduce((a,b)=>a+b,0)/ts.length:99999 }))
                .filter(x=>x.avg<99999).sort((a,b)=>a.avg-b.avg).slice(0,3);
            const statsText = top.map((x,i)=>
                `${["🥇","🥈","🥉"][i]} *${display(x.phone)}* : \`${(x.avg/1000).toFixed(2)}s\``
            ).join("\n");
            await sock.sendMessage(chatId,{
                text:`${pick(WIN)(phoneW)}\n\n⚡ *تـرتـيـب الأسـرع:*\n${statsText||"_لا توجد بيانات_"}`,
                mentions:[...new Set([phoneW, winner, ...top.map(x=>x.phone), ...top.map(x=>x.jid)])],
            });
        } else {
            await sock.sendMessage(chatId,{text:"💀 *انتهى الغزو بإبادة الجميع.*"});
        }

    } catch(err) {
        console.error("[الغزو] خطأ:", err);
        await sock.sendMessage(chatId,{text:"❌ _خطأ تقني أدى لتوقف الغزو._"});
    } finally {
        activeGames.delete(chatId);
    }
}

export default { NovaUltra, execute };
