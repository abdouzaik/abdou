// ══════════════════════════════════════════════════════════════
//  لعبة الغزو الفضائي — غزو.js (Ultra Edition 7.1)
//  ✅ منشن أزرق حقيقي مطابق لنظام النخبة (elite.js)
//  ✅ التخلص من مشكلة المنشن الرمادي والإيموجي 👤
// ══════════════════════════════════════════════════════════════
import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, "../../nova/data");

const wait    = ms  => new Promise(r => setTimeout(r, ms));
const pick    = arr => arr[Math.floor(Math.random() * arr.length)];

// ── رقم نظيف من أي JID (لصنع منشن صريح) ─────────────────────
const numOf   = jid => jid ? jid.split("@")[0].split(":")[0] : "";

// ── Cache بنية elite-pro.json لكل قروب ──────────────────────
const cachePath = chatId =>
    path.join(DATA_DIR, "group_members_" + chatId.replace(/[^\w]/g, "") + ".json");

function getGroupCache(chatId) {
    const p = cachePath(chatId);
    if (!fs.existsSync(p)) return { jids:[], lids:[], twice:{} };
    try { return JSON.parse(fs.readFileSync(p, "utf-8")); }
    catch { return { jids:[], lids:[], twice:{} }; }
}

function resolveJid(id, cache) {
    if (!id) return id;
    if (id.endsWith("@s.whatsapp.net")) return id;
    if (id.endsWith("@lid")) return cache.twice[id] || id;
    return id;
}

const activeGames = new Map();

// ── دالة معالجة الجولات ───────────────────────────────────────
async function runRound(sock, chatId, players, session, type) {
    const round   = session.round;
    let codes     = [];
    while(codes.length < 3) codes.push(String(Math.floor(1000 + Math.random() * 9000)));
    codes = [...new Set(codes)];

    let msgText = "";
    let validCodes = codes;

    if (type === "blackhole") {
        msgText = `━━━━━━━━━━━━━━━━━━━\n🕳️ *الجولة ${round} | ثـقـب أسـود!*\n━━━━━━━━━━━━━━━━━━━\nالناجون: ${players.length}\n\nاكتب الكود **معكوساً** للنجاة!\n*${codes[0]}*\n\n⏱️ لديك *15 ثانية*`;
        validCodes = [ codes[0].split("").reverse().join("") ];
    } else if (type === "shield") {
        msgText = `━━━━━━━━━━━━━━━━━━━\n🛡️ *الجولة ${round} | درع حـمـايـة!*\n━━━━━━━━━━━━━━━━━━━\nالناجون: ${players.length}\n\nأسرع شخص يكتب الكود سيحصل على حصانة!\n*${codes[0]}* *${codes[1]}* *${codes[2]}*\n\n⏱️ لديك *15 ثانية*`;
    } else {
        msgText = `━━━━━━━━━━━━━━━━━━━\n👾 *الجولة ${round}*\n━━━━━━━━━━━━━━━━━━━\nالناجون: ${players.length}\n\nاكتب أحد هذه الأكواد:\n*${codes[0]}* *${codes[1]}* *${codes[2]}*\n\n⏱️ لديك *15 ثانية*`;
    }

    await sock.sendMessage(chatId, { text: msgText });

    const roundStart = Date.now();
    const responded  = new Map();

    const listener = ({ messages }) => {
        const m = messages?.[0];
        if (!m?.message || m.key.remoteJid !== chatId || m.key.fromMe) return;
        const jid  = m.key.participant || m.key.remoteJid;
        const text = (m.message.conversation || m.message.extendedTextMessage?.text || "").trim();

        if (validCodes.includes(text) && players.includes(jid) && !responded.has(jid)) {
            responded.set(jid, Date.now() - roundStart);
            sock.sendMessage(chatId, { react: { text: "✅", key: m.key } }).catch(()=>{});
        }
    };

    sock.ev.on("messages.upsert", listener);
    try { await wait(15000); } finally { sock.ev.off("messages.upsert", listener); }

    for (const [jid, ms] of responded.entries()) {
        if (!session.speedLog[jid]) session.speedLog[jid] = [];
        session.speedLog[jid].push(ms);
    }

    return responded;
}

// ── دالة الطرد (ترجع قائمة من طُردوا فعلياً) ──────────────────
async function processElimination(sock, chatId, players, responded, session, cache, adminNums) {
    const didNot = players.filter(p => !responded.has(p) && !adminNums.has(numOf(p)) && !session.shielded.has(p));
    let targets = [];

    if (didNot.length > 0) {
        const kickCount = Math.max(1, Math.ceil(didNot.length * 0.2));
        targets = [...didNot].sort(() => Math.random()-0.5).slice(0, kickCount);
    } else {
        const eligible = players
            .filter(p => !adminNums.has(numOf(p)) && !session.shielded.has(p))
            .map(p => ({ p, t: responded.get(p) ?? 99999 }))
            .sort((a,b) => b.t - a.t);
        if (eligible.length > 0) targets = [eligible[0].p];
    }

    for (const target of targets) {
        await sock.groupParticipantsUpdate(chatId,[target],"remove")
            .catch(err => console.log(`[Kick]: ${err.message}`));
        
        const phoneJid = resolveJid(target, cache) || target;
        
        // استخدام المنشن الصريح (مثل النخبة)
        await sock.sendMessage(chatId, {
            text: pick([
                `☄️ *تم اختطاف اللاعب:* @${numOf(phoneJid)}`,
                `👾 *تم سحب:* @${numOf(phoneJid)} _بسبب بطء الاستجابة_`,
                `🛸 *الاختطاف تم بنجاح لـ:* @${numOf(phoneJid)}`,
                `🌌 *الضحية الحالية:* @${numOf(phoneJid)} _اختفى في الفضاء_`,
                `⚡ *الأبطأ هذه المرة هو:* @${numOf(phoneJid)}`,
                `🔭 *تم رصد:* @${numOf(phoneJid)} _وسحبه للمركبة_`,
            ]),
            mentions: [...new Set([phoneJid, target])]
        });
        await wait(500);
    }
    return targets;
}

// ══════════════════════════════════════════════════════════════
export const InvasionGame = {
    command: "غزو",
    description: "لعبة البقاء للأسرع مع دعم LIDs",
    group: true,
    elite: "off",
};

export async function execute({ sock, msg, args, sender }) {
    const chatId = msg.key.remoteJid;
    const pfx    = global._botConfig?.prefix || ".";
    const subCmd = args?.[0]?.trim();

    if (subCmd === "وقف") {
        if (!activeGames.has(chatId)) return sock.sendMessage(chatId,{text:"❌ لا يوجد غزو نشط."});
        try {
            const meta   = await sock.groupMetadata(chatId);
            const admins = meta.participants.filter(p=>p.admin).map(p=>numOf(p.id));
            const sNum   = numOf(sender?.pn || msg.key.participant || "");
            if (!msg.key.fromMe && !admins.includes(sNum))
                return sock.sendMessage(chatId,{text:"❌ للمشرفين فقط."});
        } catch {}
        activeGames.get(chatId).stop = true;
        return sock.sendMessage(chatId,{text:"🛑 تم إيقاف الغزو."});
    }

    if (activeGames.has(chatId))
        return sock.sendMessage(chatId,{text:`⚠️ الغزو شغال. لإيقافه: *${pfx}غزو وقف*`});

    let meta;
    try { meta = await sock.groupMetadata(chatId); }
    catch { return sock.sendMessage(chatId,{text:"❌ تعذر جلب بيانات المجموعة."}); }

    const botNum = numOf(sock.user.id);
    const botIsAdmin = meta.participants.some(p => numOf(p.id) === botNum && p.admin);
    if (!botIsAdmin) return sock.sendMessage(chatId,{text:"❌ البوت يحتاج إشراف."});

    let elitesList = [];
    try { elitesList = sock.getElites ? (sock.getElites() || []) : []; } catch {}

    const adminNums = new Set(meta.participants.filter(p=>p.admin).map(p=>numOf(p.id)));
    const cache = getGroupCache(chatId);
    let allRaw = meta.participants.map(p=>p.id);

    let players = [];
    for (const raw of allRaw) {
        const phone = resolveJid(raw, cache);
        const n     = numOf(phone || raw);
        const rawN  = numOf(raw);
        if (n === botNum || rawN === botNum || raw === sock.user?.id) continue;
        if (adminNums.has(n) || adminNums.has(rawN)) continue;
        if (elitesList.some(e => numOf(e) === n || numOf(e) === rawN)) continue;
        players.push(phone || raw);
    }

    if (players.length < 2)
        return sock.sendMessage(chatId,{text:"❌ نحتاج على الأقل لاعبَين (غير مشرفين/نخبة) لبدء اللعبة."});

    const session = { stop: false, round: 1, speedLog: {}, shielded: new Set() };
    activeGames.set(chatId, session);

    try {
        await sock.sendMessage(chatId, {
            text: `🛸 *غزو فضائي — المنطقة 51*\n\nالمركبة الفضائية تقترب...\n⏳ يبدأ الغزو بعد *15 ثانية*\nاللاعبون المشاركون: ${players.length}`,
        });
        await wait(15000);

        while (players.length > 1) {
            if (session.stop) break;

            let roundType = "normal";
            const r = Math.random();
            if (r < 0.20) roundType = "blackhole";
            else if (r < 0.40) roundType = "shield";

            const shieldRound = (roundType === "shield");
            const responded = await runRound(sock, chatId, players, session, roundType);

            if (session.stop) break;

            // 1. عملية الطرد
            const eliminated = await processElimination(sock, chatId, players, responded, session, cache, adminNums);
            players = players.filter(p => !eliminated.includes(p));

            // 2. مسح الدروع المستهلكة
            session.shielded.clear();

            // 3. إعطاء درع جديد إن وجد
            if (shieldRound && responded.size > 0) {
                const fastest = [...responded.entries()].sort((a,b)=>a[1]-b[1])[0][0];
                if (players.includes(fastest)) {
                    session.shielded.add(fastest);
                    const shPhone = resolveJid(fastest, cache) || fastest;
                    // منشن صريح للدرع
                    await sock.sendMessage(chatId, {
                        text: `🛡️ *@${numOf(shPhone)} حصل على درع الحماية للجولة القادمة!*`,
                        mentions: [...new Set([shPhone, fastest])],
                    });
                }
            }

            if (players.length <= 1) break;

            await sock.sendMessage(chatId, { text: `⏳ الجولة القادمة بعد *10 ثوانٍ* — الناجون: ${players.length}` });
            await wait(10000);
            session.round++;
        }

        if (session.stop) {
            await sock.sendMessage(chatId,{text:"🛑 *توقف الغزو بناءً على طلب القائد.*"});
        } else if (players.length === 1) {
            const winner  = players[0];
            const phoneW  = resolveJid(winner, cache) || winner;
            
            const winText = pick([
                `🏆 *تـهـانـيـنـا!* @${numOf(phoneW)} _هو الناجي الوحيد والبطل._`,
                `🥇 *الـبـطـل الـخـارق:* @${numOf(phoneW)} _صمد أمام الغزو الفضائي._`,
            ]);

            const top = Object.entries(session.speedLog)
                .map(([jid,ts])=>({ jid, phone:resolveJid(jid,cache)||jid, avg:ts.length?ts.reduce((a,b)=>a+b,0)/ts.length:99999 }))
                .filter(x=>x.avg<99999).sort((a,b)=>a.avg-b.avg).slice(0,3);

            let statsText = "";
            let mentionJids = [phoneW, winner];

            top.forEach((x, i) => {
                const medals = ["🥇","🥈","🥉"];
                // منشن صريح للإحصائيات
                statsText += `${medals[i]} *@${numOf(x.phone)}* : \`${(x.avg/1000).toFixed(2)}s\`\n`;
                mentionJids.push(x.phone, x.jid);
            });

            await sock.sendMessage(chatId,{
                text:`${winText}\n\n⚡ *تـرتـيـب الأسـرع:*\n${statsText.trim() || "_لا توجد بيانات_"}`,
                mentions: [...new Set(mentionJids)]
            });

        } else {
            await sock.sendMessage(chatId,{text:"💀 *انتهى الغزو*\nتم اختطاف الجميع. لا يوجد ناجين."});
        }

    } catch (err) {
        console.error("[غزو]", err);
    } finally {
        activeGames.delete(chatId);
    }
}
