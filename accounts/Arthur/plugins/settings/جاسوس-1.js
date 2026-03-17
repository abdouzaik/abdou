
import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(process.cwd(), "nova", "data");

const wait  = ms  => new Promise(r => setTimeout(r, ms));
const numOf = jid => jid ? jid.split("@")[0].split(":")[0] : "";
const isPhone = jid => { const n = numOf(jid); return n.length >= 7 && n.length <= 13; };
const display = jid => `@${numOf(jid)}`;

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

const cachePath = chatId =>
    path.join(DATA_DIR, "group_members_" + chatId.replace(/[^\w]/g, "_") + ".json");

const readCache = chatId => {
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

const mentionSet = (phoneJid, rawJid) =>
    [...new Set([phoneJid, rawJid].filter(Boolean))];


//  النقاط — محفوظة في JSON

const POINTS_FILE = path.join(DATA_DIR, "spy_points.json");

function readPoints() {
    try {
        return fs.existsSync(POINTS_FILE)
            ? JSON.parse(fs.readFileSync(POINTS_FILE, "utf8"))
            : {};
    } catch { return {}; }
}
function addPoints(jid, pts) {
    const all = readPoints();
    const key = numOf(jid);
    all[key] = (all[key] || 0) + pts;
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(POINTS_FILE, JSON.stringify(all, null, 2), "utf8");
    } catch {}
    return all[key];
}
function getRank(pts) {
    if (pts >= 51) return "🌟 أسطورة الأنمي";
    if (pts >= 21) return "⚔️ صياد محترف";
    return "🥷 نينجا مبتدئ";
}

function getTopPoints(n = 5) {
    const all = readPoints();
    return Object.entries(all)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([num, pts]) => [num, pts, getRank(pts)]);
}

// نقاط كل حدث
const PTS = {
    CITIZEN_SURVIVES:   1,  // مواطن نجا من جولة
    CITIZEN_VOTES_SPY:  2,  // مواطن صوّت على الجاسوس الصحيح
    SPY_SURVIVES:       3,  // جاسوس نجا (لم يُكتشف)
    SPY_GUESSES_WORD:   4,  // جاسوس خمّن الكلمة
};

//  قاعدة بيانات الأماكن — ألغاز وصفية غامضة

const LOCATIONS_DB = [
    { word: "مستشفى",   question: "رائحة المطهرات تملأ الهواء، أصوات أجهزة غريبة لا تتوقف، والكل هنا إما ينتظر خبراً أو يخشاه.. أين أنت؟" },
    { word: "مطار",     question: "حقائب تجري، لغات مختلطة، وساعات على الجدران تشير لمدن لا تعرف بعضها.. أين أنت؟" },
    { word: "سجن",      question: "القضبان الحديدية تُحكم إغلاقها عند الغروب، والوقت هنا لا يمشي — بل يزحف.. أين أنت؟" },
    { word: "غابة",     question: "الأشجار تحجب السماء، الأصوات لا تُعرف مصادرها، والطريق يبدو متشابهاً في كل الاتجاهات.. أين أنت؟" },
    { word: "عرس",      question: "الموسيقى صاخبة، الملابس فاخرة، والجميع يبتسم لكن نصفهم لا يعرف نصف الحضور.. أين أنت؟" },
    { word: "مقبرة",    question: "الصمت هنا ثقيل من نوع مختلف، الأحجار تحمل تواريخ، والزائرون يتكلمون بصوت خافت.. أين أنت؟" },
    { word: "مطعم",     question: "روائح متضاربة، أصوات صحون، وطاولات تخفي محادثات يريد أصحابها ألا يسمعها أحد.. أين أنت؟" },
    { word: "قاعة محكمة", question: "شخص يقف وحيداً أمام الجميع، والكلمات هنا تحمل ثقل السنوات.. أين أنت؟" },
    { word: "ملعب",     question: "آلاف الأصوات تصرخ باسم واحد، الأرض مرسوم عليها خطوط بيضاء، والجميع ينظر في اتجاه واحد.. أين أنت؟" },
    { word: "مختبر",    question: "أنابيب وأرقام وأشياء لا تعرف اسمها، كل خطأ هنا قد لا يُمحى.. أين أنت؟" },
    { word: "فندق",     question: "أبواب متطابقة بلا نهاية، غرباء يتقاسمون الممرات، وكل واحد يحمل سر إقامته.. أين أنت؟" },
    { word: "بنك",      question: "أبواب فولاذية، كاميرات في كل زاوية، والصمت هنا من نوع مختلف عن الهدوء.. أين أنت؟" },
    { word: "ميناء",    question: "السفن ضخمة والبضائع مجهولة، الضباب يغطي ما تبقى من أفق، والبحر لا يسأل عن هويتك.. أين أنت؟" },
    { word: "قطار",     question: "النوافذ تمرر مناظر لا تتوقف، المقاعد تجمع غرباء لساعات، ثم تفرقهم إلى الأبد.. أين أنت؟" },
    { word: "جامعة",    question: "أفكار تتصادم في كل ممر، كتب ثقيلة وأسئلة أثقل، وكل شخص يبحث عن إجابة مختلفة.. أين أنت؟" },
    { word: "كازينو",   question: "الأضواء لا تنطفئ والوقت لا معنى له، الجميع يراهن على شيء — بعضهم على المال وبعضهم على أكثر.. أين أنت؟" },
    { word: "سفارة",    question: "الأعلام تشير لأماكن بعيدة، الجوازات تفتح أحياناً والأبواب لا تُفتح دائماً.. أين أنت؟" },
    { word: "مخزن سري", question: "لا نوافذ ولا لافتات، البضاعة هنا ليست للبيع في أي سوق معروف.. أين أنت؟" },
    { word: "سيرك",     question: "المهرجون يخفون وجوههم والبهجة تبدو أحياناً حزينة من كثب، والجميع يشاهد لكن لا أحد يفهم كل شيء.. أين أنت؟" },
    { word: "منجم",     question: "الظلام يبدأ من بضعة أمتار تحتك، الجدران تضيق والهواء يثقل، والذهب لا يكشف عن نفسه بسهولة.. أين أنت؟" },
];

const usedWords = new Set();

function pickWord() {
    const available = LOCATIONS_DB.filter(e => !usedWords.has(e.word));
    if (!available.length) usedWords.clear();
    const entry = available[Math.floor(Math.random() * available.length)];
    usedWords.add(entry.word);
    return entry;
}

// ══════════════════════════════════════════════════════════════
//  مستمع مشترك — يُرجع Map<playerJid, responseTime>
// ══════════════════════════════════════════════════════════════
async function listenRound(sock, chatId, players, validFn, durationMs) {
    const start    = Date.now();
    const recorded = new Map();

    const rl = ({ messages }) => {
        const m = messages[0];
        if (!m?.message || m.key.remoteJid !== chatId) return;
        const rawFrom = m.key.participant || m.key.remoteJid;
        const fromNum = numOf(rawFrom);
        const matchP  = players.find(p => numOf(p) === fromNum);
        if (!matchP || recorded.has(matchP)) return;

        const result = validFn(m, matchP);
        if (result !== null) {
            recorded.set(matchP, { time: Date.now() - start, data: result });
            sock.sendMessage(chatId, {
                react: { text: result ? "✅" : "❌", key: m.key }
            }).catch(() => {});
        }
    };

    sock.ev.on("messages.upsert", rl);
    try { await wait(durationMs); }
    finally { sock.ev.off("messages.upsert", rl); }
    return recorded;
}

// ══════════════════════════════════════════════════════════════
//  مرحلة الجواب (15 ثانية) — كتابة الكلمة + تلميح بعد 7 ثوانٍ
// ══════════════════════════════════════════════════════════════
async function phaseAnswer(sock, chatId, players, secretWord) {
    const start    = Date.now();
    const recorded = new Map();
    let   hintSent = false;

    const rl = ({ messages }) => {
        const m = messages[0];
        if (!m?.message || m.key.remoteJid !== chatId) return;
        const rawFrom = m.key.participant || m.key.remoteJid;
        const fromNum = numOf(rawFrom);
        const matchP  = players.find(p => numOf(p) === fromNum);
        if (!matchP || recorded.has(matchP)) return;

        const txt = (m.message.conversation || m.message.extendedTextMessage?.text || "")
            .trim().toLowerCase();
        let result = null;
        if (txt === secretWord) result = true;
        else if (txt.length > 1) result = false;

        if (result !== null) {
            recorded.set(matchP, { time: Date.now() - start, data: result });
            // ✅ فقط للصحيح — لا نكشف ❌ فوراً حتى لا يعرف الجاسوس من أخطأ
            if (result === true) {
                sock.sendMessage(chatId, {
                    react: { text: "✅", key: m.key }
                }).catch(() => {});
            }
        }
    };

    sock.ev.on("messages.upsert", rl);

    // تلميح بعد 7 ثوانٍ — أول حرف من الكلمة السرية
    const hintTimer = setTimeout(async () => {
        if (hintSent) return;
        hintSent = true;
        const hint = secretWord.charAt(0).toUpperCase();
        await sock.sendMessage(chatId, {
            text: `💡 *تلميح:* المكان يبدأ بحرف ➜ *${hint}*`,
        }).catch(() => {});
    }, 7000);

    try { await wait(15000); }
    finally {
        clearTimeout(hintTimer);
        sock.ev.off("messages.upsert", rl);
    }
    return recorded;
}

// ══════════════════════════════════════════════════════════════
//  مرحلة التصويت (30 ثانية) — عبر الخاص (DM) سري
// ══════════════════════════════════════════════════════════════
async function phaseVote(sock, chatId, voters, allPlayers, cache) {
    const votes = new Map(); // voter → nominatedJid

    // إرسال تعليمات التصويت لكل ناخب في الخاص
    for (const voter of voters) {
        const phone = resolveJid(voter, cache) || voter;
        const playerList = allPlayers
            .filter(p => numOf(p) !== numOf(voter))
            .map((p, i) => {
                const ph = resolveJid(p, cache) || p;
                return `${i + 1}. @${numOf(ph)}`;
            })
            .join("\n");
        await sock.sendMessage(phone,
`🗳️ *وقت التصويت السري!*

📋 *اللاعبون:*
${playerList}

✍️ *اكتب رقم أو اسم من تشك أنه الجاسوس*
_لديك 30 ثانية — لن يعرف أحد تصويتك_`
        ).catch(() => {});
        await wait(100);
    }

    const pendingNums = new Set(voters.map(v => numOf(resolveJid(v, cache) || v)));

    const rl = ({ messages }) => {
        const m = messages[0];
        if (!m?.message) return;
        const jid = m.key.remoteJid;
        // رسالة خاصة فقط
        if (!jid || jid.includes("@g.us") || jid.includes("@broadcast") || m.key.fromMe) return;

        const senderNum = numOf(jid);
        if (!pendingNums.has(senderNum)) return;

        const voter = voters.find(v => numOf(resolveJid(v, cache) || v) === senderNum);
        if (!voter || votes.has(voter)) return;

        const txt = (m.message.conversation || m.message.extendedTextMessage?.text || "").trim();
        if (!txt) return;

        // بحث عن اللاعب بالرقم أو الاسم الجزئي
        const txtLow = txt.toLowerCase();
        const byIndex = /^\d+$/.test(txt)
            ? allPlayers.filter(p => numOf(p) !== numOf(voter))[parseInt(txt) - 1]
            : null;
        const byName = allPlayers.find(p => {
            const ph = resolveJid(p, cache) || p;
            return numOf(ph).includes(txtLow) || txtLow.includes(numOf(ph).slice(-4));
        });

        const nominated = byIndex || byName;
        if (!nominated || numOf(nominated) === numOf(voter)) return;

        votes.set(voter, nominated);
        sock.sendMessage(jid, { text: "✅ *تم تسجيل صوتك بسرية!*" }).catch(() => {});
    };

    sock.ev.on("messages.upsert", rl);
    try { await wait(30000); }
    finally { sock.ev.off("messages.upsert", rl); }
    return votes;
}

// ══════════════════════════════════════════════════════════════
//  حساب نتيجة التصويت
// ══════════════════════════════════════════════════════════════
function countVotes(votes, candidates) {
    const tally = new Map();
    for (const nominated of votes.values()) {
        const n = numOf(nominated);
        tally.set(n, (tally.get(n) || 0) + 1);
    }
    // أكثر مُرشَّح
    let max = 0, winner = null;
    for (const [num, count] of tally) {
        if (count > max) { max = count; winner = num; }
    }
    // resolve winner num → full jid
    const winnerJid = winner
        ? candidates.find(p => numOf(p) === winner)
        : null;
    return { winnerJid, tally, max };
}

const activeGames = new Map();
// وضع كل مجموعة: "اقصاء" (خروج من اللعبة فقط) | "طرد" (طرد من المجموعة)
const groupMode = new Map(); // chatId → "اقصاء" | "طرد"
const getMode   = chatId => groupMode.get(chatId) || "طرد";

// ══════════════════════════════════════════════════════════════
const NovaUltra = {
    command:     "جاسوس",
    description: "كاشف الجاسوس — أنمي | جولات + تصويت + نقاط",
    group:       true,
    elite:       "off",
    prv:         false,
    lock:        "off",
};

// ══════════════════════════════════════════════════════════════
async function execute({ sock, msg, args, BIDS, sender }) {
    const chatId   = msg.key.remoteJid;
    const botNum   = numOf(BIDS?.pn  || sock.user?.id  || "");
    const botLid   = numOf(BIDS?.lid || sock.user?.lid || "");
    const ownerNum = (global._botConfig?.owner || "213540419314").replace(/\D/g, "");

    // ── عرض النقاط ───────────────────────────────────────────
    if (args?.[0] === "نقاط") {
        const top = getTopPoints(10);
        if (!top.length) return sock.sendMessage(chatId, { text: "📊 _لا توجد نقاط بعد._" });
        const list = top.map(([num, pts, rank], i) =>
            `${["🥇","🥈","🥉"][i] || `${i+1}.`} \`${num}\` — *${pts} نقطة* — ${rank}`
        ).join("\n");
        return sock.sendMessage(chatId, { text: `🏆 *لوحة المتصدرين — كاشف الجاسوس:*\n\n${list}` });
    }

    // ── وقف اللعبة ──────────────────────────────────────────
    if (args?.[0] === "وقف") {
        if (!activeGames.has(chatId))
            return sock.sendMessage(chatId, { text: "❌ _لا توجد لعبة نشطة._" });
        activeGames.get(chatId).stop = true;
        return sock.sendMessage(chatId, { react: { text: "🛑", key: msg.key } });
    }

    // ── تحويل النظام (طرد ↔ إقصاء) ─────────────────────────
    if (args?.[0] === "تحويل") {
        const current = getMode(chatId);
        const next    = current === "طرد" ? "اقصاء" : "طرد";
        groupMode.set(chatId, next);

        const msgs = {
            "طرد": {
                emoji: "🚪",
                title: "نظام الطرد مفعّل",
                desc:  "الخاسر سيُطرد من المجموعة فعلياً!",
                warn:  "⚠️ _تأكد أن البوت مشرف قبل بدء اللعبة._",
            },
            "اقصاء": {
                emoji: "🏳️",
                title: "نظام الإقصاء مفعّل",
                desc:  "الخاسر يخرج من اللعبة فقط — يبقى في المجموعة.",
                warn:  "✅ _لا يحتاج البوت صلاحية طرد._",
            },
        };
        const m = msgs[next];
        return sock.sendMessage(chatId, {
            text:
`${m.emoji} *تم التحويل!*

🔄 *النظام الحالي:* ${next === "طرد" ? "🚪 طرد" : "🏳️ إقصاء"}
📌 *${m.title}*
_${m.desc}_

${m.warn}`,
        });
    }
    if (activeGames.has(chatId))
        return sock.sendMessage(chatId, { text: "⚠️ _لعبة نشطة بالفعل!_" });

    const metadata = await sock.groupMetadata(chatId).catch(() => null);
    if (!metadata) return;

    await sock.sendMessage(chatId, { text: "🔍 _جاري تحديد المشاركين..._" });
    const cache = await buildGroupCache(sock, chatId, metadata.participants);

    const adminNums = new Set(
        metadata.participants.filter(p => p.admin).map(p => numOf(p.id))
    );

    let eliteNums = new Set();
    try {
        const lids = sock.getElites ? (sock.getElites() || []) : [];
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

    let basePlayers = [];
    for (const raw of allRaw) {
        const phone = resolveJid(raw, cache);
        const n = numOf(phone || raw);
        if (n === botNum || n === botLid) continue;
        if (n === ownerNum)               continue;
        if (adminNums.has(n))             continue;
        if (eliteNums.has(n))             continue;
        basePlayers.push(phone || raw);
    }

    if (basePlayers.length < 3)
        return sock.sendMessage(chatId, {
            text: "❌ *العدد غير كافٍ!*\n_اللعبة تحتاج 3 أشخاص على الأقل._",
        });

    // ══════════════════════════════════════════════════════════
    //  مرحلة التأكيد — إرسال خاص لكل مشارك محتمل
    //  يرد بـ "نعم" خلال 60 ثانية للانضمام
    // ══════════════════════════════════════════════════════════
    const groupName = metadata.subject || "المجموعة";

    // إعلان في المجموعة
    const confirmMentions = basePlayers.map(p => resolveJid(p, cache) || p);
    await sock.sendMessage(chatId, {
        text:
`🕵️ *━━━ كاشف الجاسوس ━━━*

📨 _جاري إرسال دعوة خاصة لكل شخص..._
✅ *ردّ بـ* \`نعم\` *في الخاص خلال 60 ثانية للانضمام!*

👥 *المدعوون (${basePlayers.length}):*
${basePlayers.map(p => display(resolveJid(p,cache)||p)).join(" ")}`,
        mentions: confirmMentions,
    });

    // إرسال الدعوة الخاصة لكل شخص
    for (const p of basePlayers) {
        const phone = resolveJid(p, cache) || p;
        await sock.sendMessage(phone,
`🎮 *دعوة للعبة الجاسوس*

📍 *المجموعة:* _${groupName}_
🕵️ _لعبة كاشف الجاسوس — أنمي_

✅ رد بـ *نعم* خلال 60 ثانية للانضمام!
❌ تجاهل الرسالة إذا لا تريد المشاركة.`
        ).catch(() => {});
        await wait(120);
    }

    // استماع للردود في الخاص — 60 ثانية
    const confirmed = new Set();
    const pendingSet = new Set(basePlayers.map(p => numOf(resolveJid(p,cache)||p)));

    const dmListener = ({ messages }) => {
        const m = messages[0];
        if (!m?.message) return;
        // رسالة خاصة (ليست من مجموعة)
        const jid = m.key.remoteJid;
        if (!jid || jid.includes("@g.us") || jid.includes("@broadcast")) return;
        if (m.key.fromMe) return;

        const senderNum = numOf(jid);
        if (!pendingSet.has(senderNum)) return;

        const txt = (
            m.message.conversation ||
            m.message.extendedTextMessage?.text || ""
        ).trim();

        if (/^نعم$/i.test(txt)) {
            // ابحث عن الـ jid الكامل في basePlayers
            const full = basePlayers.find(p => numOf(resolveJid(p,cache)||p) === senderNum);
            if (full && !confirmed.has(full)) {
                confirmed.add(full);
                sock.sendMessage(jid, { text: "✅ *تم تسجيلك! انتظر بدء اللعبة.*" }).catch(() => {});
            }
        }
    };

    sock.ev.on("messages.upsert", dmListener);
    await wait(60000);
    sock.ev.off("messages.upsert", dmListener);

    const finalPlayers = [...confirmed];

    if (finalPlayers.length < 3) {
        return sock.sendMessage(chatId, {
            text: `❌ *لم يؤكد كافي اللاعبين* _(${finalPlayers.length}/3 حد أدنى)_\n_أُلغيت اللعبة._`,
        });
    }

    await sock.sendMessage(chatId, {
        text:
`✅ *${finalPlayers.length} لاعب أكّد مشاركته!*

${finalPlayers.map(p => display(resolveJid(p,cache)||p)).join(" ")}

${game.mode === "طرد" ? "🚪 *النظام: طرد* — الخاسر يُطرد من المجموعة!" : "🏳️ *النظام: إقصاء* — الخاسر يخرج من اللعبة فقط"}
⏳ _تبدأ اللعبة خلال 5 ثوانٍ..._`,
        mentions: finalPlayers.map(p => resolveJid(p,cache)||p),
    });
    await wait(5000);

    // ── جلسة اللعبة ──────────────────────────────────────────
    const game = {
        stop: false, round: 0, players: finalPlayers,
        mode: getMode(chatId),
        deadPlayers: [],          // الأموات يبقون في المجموعة كمراقبين
        spyWins:  new Map(),      // jid → عدد مرات النجاة
        detectiveWins: new Map(), // jid → عدد مرات الكشف
    };
    activeGames.set(chatId, game);
    usedWords.clear();

    try {
        // ══════════════════════════════════════════════════════
        //  حلقة الجولات
        // ══════════════════════════════════════════════════════
        while (game.players.length >= 3 && !game.stop) {
            game.round++;
            const entry      = pickWord();
            const secretWord = entry.word.trim().toLowerCase();
            const players    = [...game.players];

            // 20% جواسيس
            const shuffled = shuffle(players);
            const spyCount = Math.max(1, Math.ceil(players.length * 0.2));
            const spies    = new Set(shuffled.slice(0, spyCount));
            const citizens = shuffled.slice(spyCount);

            // ── توزيع الأدوار بالخاص (بدون الكلمة — فقط الدور) ────
            for (const p of citizens) {
                const ph = resolveJid(p, cache) || p;
                await sock.sendMessage(ph,
`🏘️ *الجولة ${game.round} — أنتَ مواطن أبرار!*

⏳ _انتظر... الكلمة ستصلك فور طرح السؤال!_
🗳️ _بعدها صوّت في الخاص على من تشك أنه الجاسوس!_`
                ).catch(() => {});
                await wait(150);
            }

            const spyList = [...spies];
            for (const p of spyList) {
                const ph = resolveJid(p, cache) || p;
                const otherSpies = spyList
                    .filter(s => numOf(s) !== numOf(p))
                    .map(s => `@${numOf(resolveJid(s,cache)||s)}`)
                    .join("، ");
                const conspiracy = spyList.length > 1
                    ? `\n🤝 *رفاقك الجواسيس:* ${otherSpies}\n💬 _ابدأ رسالتك بكلمة *رسالة* لتصل لهم سراً!_`
                    : "";
                await sock.sendMessage(ph,
`🕵️ *الجولة ${game.round} — أنتَ الجاسوس المندَس!*

⚠️ _لا تملك الكلمة — راقب وخمّن بسرعة!_
💡 _خمّن الكلمة أولاً لتنجو، وإلا ستُكشف في التصويت!_${conspiracy}`
                ).catch(() => {});
                await wait(150);
            }

            // ── مستمع تآمر الجواسيس (طوال الجولة) ──────────────
            const conspiracyNums = new Set(spyList.map(s => numOf(resolveJid(s,cache)||s)));
            const conspiracyListener = ({ messages }) => {
                const m = messages[0];
                if (!m?.message) return;
                const jid = m.key.remoteJid;
                if (!jid || jid.includes("@g.us") || m.key.fromMe) return;
                const senderNum = numOf(jid);
                if (!conspiracyNums.has(senderNum)) return;
                const txt = (m.message.conversation || m.message.extendedTextMessage?.text || "").trim();
                if (!txt.startsWith("رسالة")) return;
                const content = txt.replace(/^رسالة\s*/i, "").trim();
                if (!content) return;
                for (const s of spyList) {
                    if (numOf(resolveJid(s,cache)||s) === senderNum) continue;
                    const ph = resolveJid(s, cache) || s;
                    sock.sendMessage(ph,
                        `🕵️ *رسالة سرية من رفيق الجاسوس:*\n_${content}_`
                    ).catch(() => {});
                }
            };
            if (spyList.length > 1) sock.ev.on("messages.upsert", conspiracyListener);

            await wait(1500);

            // ── إعلان بداية الجولة — 15 ثانية قبل السؤال ────
            const playerMentions = players.map(p => display(p)).join(" ");
            await sock.sendMessage(chatId, {
                text:
`🎯 *━━━ كاشف الجاسوس | الجولة ${game.round} ━━━*

👥 *المشاركون (${players.length}):*
${playerMentions}

🕵️ *الجواسيس:* ${spyCount} مندَس بينكم!
⏳ *السؤال يُطرح خلال 15 ثانية — استعد!*`,
                mentions: allRaw,
            });

            await wait(15000);
            if (game.stop) break;

            // ── إرسال الكلمة للمواطنين فور طرح السؤال ────────
            for (const p of citizens) {
                const ph = resolveJid(p, cache) || p;
                await sock.sendMessage(ph,
`🔑 *كلمة السر — الجولة ${game.round}:*

📝 *${entry.word}*

⏱️ _اكتبها الآن في المجموعة قبل 15 ثانية!_`
                ).catch(() => {});
                await wait(100);
            }

            // ── إعلان اللغز في المجموعة ──────────────────────
            await sock.sendMessage(chatId, {
                text:
`🧩 *اللغز — الجولة ${game.round}:*

_${entry.question}_

⏱️ *15 ثانية — اكتبوا الكلمة!*`,
                mentions: allRaw,
            });

            // ── مرحلة الجواب (15 ثانية) ──────────────────────
            const answerMap = await phaseAnswer(sock, chatId, players, secretWord);
            if (spyList.length > 1) sock.ev.off("messages.upsert", conspiracyListener);
            if (game.stop) break;

            // هل الجاسوس خمّن؟
            let spyGuessedFirst = null;
            for (const [spy] of [...answerMap.entries()]) {
                if (spies.has(spy) && answerMap.get(spy)?.data === true) {
                    spyGuessedFirst = spy;
                    break;
                }
            }

            // ── مرحلة النقاش (30 ثانية) ───────────────────────
            await sock.sendMessage(chatId, {
                text:
`🗣️ *بدأ وقت النقاش! — 30 ثانية*

تبادلوا الاتهامات وحاولوا كشف الجاسوس قبل بدء التصويت السري.
🔍 _من يتصرف بشكل مريب؟ من إجاباته كانت غامضة؟_`,
            });
            await wait(30000);
            if (game.stop) break;

            // ── مرحلة التصويت (30 ثانية) ─────────────────────
            await sock.sendMessage(chatId, {
                text:
`🗳️ *وقت التصويت السري! — 30 ثانية*

📨 _ستصلك رسالة خاصة — اكتب رقم أو اسم من تشك أنه الجاسوس!_
🔒 _لن يعرف أحد صوتك._`,
            });

            const votes = await phaseVote(sock, chatId, players, players, cache);
            if (game.stop) break;

            // نتيجة التصويت
            const { winnerJid: votedOut, tally } = countVotes(votes, players);

            // ── ملخص التصويت ──────────────────────────────────
            let voteSummary = "";
            for (const [num, count] of [...tally.entries()].sort((a,b)=>b[1]-a[1])) {
                const p = players.find(pl => numOf(pl) === num);
                if (p) voteSummary += `${display(p)}: *${count}* صوت\n`;
            }
            if (voteSummary) {
                await sock.sendMessage(chatId, {
                    text: `📊 *نتائج التصويت:*\n${voteSummary}`,
                    mentions: players.map(p => { const ph = resolveJid(p, cache)||p; return ph; }),
                });
                await wait(1500);
            }

            // ══════════════════════════════════════════════════
            //  حساب النتائج
            // ══════════════════════════════════════════════════
            const kicked = [];
            let roundMsg = "";

            if (spyGuessedFirst) {
                // الجاسوس خمّن الكلمة → ينجو + أبطأ مواطن يُطرد
                const slowCitizen = citizens
                    .filter(p => answerMap.get(p)?.data === true)
                    .sort((a,b) => (answerMap.get(b)?.time||99999) - (answerMap.get(a)?.time||99999))[0]
                    || citizens[citizens.length - 1];

                const spyPh = resolveJid(spyGuessedFirst, cache) || spyGuessedFirst;
                addPoints(spyGuessedFirst, PTS.SPY_GUESSES_WORD);

                roundMsg =
`😱 *الجاسوس خمّن المكان وفاز بالجولة!*

🕵️ *الجاسوس:* ${display(spyPh)} _نجا (+${PTS.SPY_GUESSES_WORD} نقاط)_
📍 _المكان كان:_ *${entry.word}*`;

                if (slowCitizen) {
                    kicked.push(slowCitizen);
                    const scPh = resolveJid(slowCitizen, cache) || slowCitizen;
                    roundMsg += `\n⚡ *${display(scPh)} أُعدم — كان الأبطأ في الإجابة!*`;
                }

            } else if (votedOut && spies.has(votedOut)) {
                kicked.push(votedOut);
                const spyPh = resolveJid(votedOut, cache) || votedOut;

                roundMsg =
`✅ *المحققون كشفوا الجاسوس!*

🕵️ *الجاسوس كان:* ${display(spyPh)} _أُعدم!_
📍 _المكان كان:_ *${entry.word}*`;

                for (const [voter, nominated] of votes.entries()) {
                    if (numOf(nominated) === numOf(votedOut)) {
                        const newPts = addPoints(voter, PTS.CITIZEN_VOTES_SPY);
                        const vPh = resolveJid(voter, cache) || voter;
                        roundMsg += `\n🎯 ${display(vPh)} كشف الجاسوس _(+${PTS.CITIZEN_VOTES_SPY} نقاط | المجموع: ${newPts})_`;
                        // تتبع المحققين
                        game.detectiveWins.set(numOf(voter), (game.detectiveWins.get(numOf(voter)) || 0) + 1);
                    }
                }

            } else if (votedOut) {
                kicked.push(votedOut);
                const innocentPh = resolveJid(votedOut, cache) || votedOut;
                const spyListDisplay = [...spies].map(s => display(resolveJid(s,cache)||s)).join(" ");
                const spyJids = [...spies].flatMap(s => mentionSet(resolveJid(s,cache)||s, s));

                for (const spy of spies) {
                    addPoints(spy, PTS.SPY_SURVIVES);
                    // تتبع نجاة الجواسيس
                    game.spyWins.set(numOf(spy), (game.spyWins.get(numOf(spy)) || 0) + 1);
                }

                roundMsg =
`😈 *الجاسوس نجا!*

💀 *أُعدم بريء:* ${display(innocentPh)} _(محقق!)_
🕵️ *الجاسوس كان:* ${spyListDisplay} _(+${PTS.SPY_SURVIVES} نقاط)_
📍 _المكان كان:_ *${entry.word}*`;

            } else {
                // ما صوّت أحد — لا طرد هذه الجولة
                const spyList = [...spies].map(s => display(resolveJid(s,cache)||s)).join(" ");
                roundMsg =
`🤷 *لم يُدلِ أحد بصوته!*

📍 _المكان كان:_ *${entry.word}*
🕵️ _الجاسوس كان:_ ${spyList}`;
            }

            // نقاط المواطنين الناجين
            const survivingCitizens = citizens.filter(p => !kicked.includes(p));
            for (const p of survivingCitizens) {
                addPoints(p, PTS.CITIZEN_SURVIVES);
            }
            roundMsg += `\n\n🏅 _المحققون الناجون (+${PTS.CITIZEN_SURVIVES} نقطة لكل منهم)_`;

            // إرسال النتيجة
            const resultMentions = [...new Set([
                ...kicked.flatMap(k => mentionSet(resolveJid(k,cache)||k, k)),
                ...[...spies].flatMap(s => mentionSet(resolveJid(s,cache)||s, s)),
            ])];
            await sock.sendMessage(chatId, { text: roundMsg, mentions: resultMentions });

            // ── إضافة المُقصَين لـ deadPlayers وإبلاغهم ──────
            for (const target of kicked) {
                game.deadPlayers.push(target);
                const tPh   = resolveJid(target, cache) || target;
                const tName = display(tPh);

                if (game.mode === "طرد") {
                    // طرد فعلي من المجموعة
                    await sock.sendMessage(chatId, {
                        text: `🚪 *تم طرد ${tName} من المجموعة!*`,
                        mentions: [tPh],
                    });
                    await sock.groupParticipantsUpdate(chatId, [tPh], "remove").catch(() => {});
                    await sock.sendMessage(tPh,
                        `🚪 *تم طردك من المجموعة!*\n_خسرت في لعبة تحقيق المافيا._`
                    ).catch(() => {});
                } else {
                    // إقصاء — يبقى في المجموعة كمراقب
                    await sock.sendMessage(chatId, {
                        text: `💀 *تم إعدام المتهم ${tName}!*\n_سيبقى في المجموعة كمراقب صامت._`,
                        mentions: [tPh],
                    });
                    await sock.sendMessage(tPh,
                        `⚰️ *لقد تم إعدامك في لعبة تحقيق المافيا!*\n_يمكنك البقاء في المجموعة ومشاهدة اللعبة لكنك لا تستطيع التصويت أو الإجابة._`
                    ).catch(() => {});
                }
                await wait(500);
            }

            // تحديث قائمة اللاعبين للجولة التالية
            game.players = game.players.filter(p => !kicked.includes(p));

            if (game.players.length >= 3 && !game.stop) {
                await wait(2000);
                await sock.sendMessage(chatId, {
                    text: `⏭️ *جولة جديدة تبدأ خلال 10 ثوانٍ... (المتبقون: ${game.players.length})*`,
                });
                await wait(10000);
            }
        }

        // ══════════════════════════════════════════════════════
        //  نهاية اللعبة
        // ══════════════════════════════════════════════════════
        if (!game.stop) {
            const finalTop = getTopPoints(5);
            const topText  = finalTop.length
                ? finalTop.map(([num, pts, rank], i) =>
                    `${["🥇","🥈","🥉"][i]||`${i+1}.`} \`${num}\` — *${pts} نقطة* — ${rank}`
                  ).join("\n")
                : "_لا توجد نقاط_";

            // أفضل المحققين
            const topDetectives = [...game.detectiveWins.entries()]
                .sort((a, b) => b[1] - a[1]).slice(0, 3);
            const detectiveText = topDetectives.length
                ? topDetectives.map(([num, wins], i) =>
                    `${["🥇","🥈","🥉"][i]||`${i+1}.`} \`${num}\` — كشف *${wins}* جاسوس`
                  ).join("\n")
                : "_لا يوجد_";

            // أفضل الجواسيس
            const topSpies = [...game.spyWins.entries()]
                .sort((a, b) => b[1] - a[1]).slice(0, 3);
            const spyText = topSpies.length
                ? topSpies.map(([num, wins], i) =>
                    `${["🥇","🥈","🥉"][i]||`${i+1}.`} \`${num}\` — نجا *${wins}* مرة`
                  ).join("\n")
                : "_لا يوجد_";

            await sock.sendMessage(chatId, {
                text:
`🏁 *انتهى تحقيق المافيا!*
_إجمالي الجولات:_ *${game.round}*
_الضحايا:_ *${game.deadPlayers.length}* لاعب

🔍 *أفضل المحققين — كاشفو الجواسيس:*
${detectiveText}

🕵️ *أذكى الجواسيس — الناجون بالتمويه:*
${spyText}

🏆 *أعلى النقاط الكلية:*
${topText}`,
            });
        } else {
            await sock.sendMessage(chatId, { text: "🛑 *توقف التحقيق.*" });
        }

    } catch (err) {
        console.error("[جاسوس] خطأ:", err);
        await sock.sendMessage(chatId, { text: "❌ _خطأ تقني أدى لتوقف اللعبة._" });
    } finally {
        activeGames.delete(chatId);
    }
}

export default { NovaUltra, execute };
