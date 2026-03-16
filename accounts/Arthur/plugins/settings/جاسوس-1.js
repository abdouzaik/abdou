
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
function getTopPoints(n = 5) {
    const all = readPoints();
    return Object.entries(all)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n);
}

// نقاط كل حدث
const PTS = {
    CITIZEN_SURVIVES:   1,  // مواطن نجا من جولة
    CITIZEN_VOTES_SPY:  2,  // مواطن صوّت على الجاسوس الصحيح
    SPY_SURVIVES:       3,  // جاسوس نجا (لم يُكتشف)
    SPY_GUESSES_WORD:   4,  // جاسوس خمّن الكلمة
};

//  قاعدة بيانات الأنمي

const ANIME_DB = [
    { word: "لوفي",    question: "قرصان يحلم بالحرية، أكل فاكهة مطاطية، وعلامته المميزة قبعة قش.. من هو؟" },
    { word: "ناروتو",  question: "نينجا منبوذ في البداية، حلمه يصير هوكاجي، وداخله وحش بذيول كثيرة.. من هو؟" },
    { word: "زورو",    question: "سياف يستخدم 3 سيوف، شعره أخضر، ودايماً يضيع طريقه حتى لو المكان قدامه.. من هو؟" },
    { word: "إيتاتشي", question: "ضحى بعشيرته لأجل القرية، يمتلك شارينغان مرعبة، وهو أخ ساسكي الأكبر.. من هو؟" },
    { word: "كونان",   question: "متحري ذكي تقلص جسده بسبب عصابة سوداء، وين ما يروح تصير جريمة.. من هو؟" },
    { word: "غوكو",    question: "من عرق السايان، يحب الأكل والقتال، وتحوله الشهير شعره يصير ذهبي.. من هو؟" },
    { word: "ليفاي",   question: "أقوى جندي في البشرية، قصير القامة، مهووس بالنظافة ويقطع العمالقة.. من هو؟" },
    { word: "إيرين",   question: "كان يحلم برؤية ما وراء الجدران، تحول لعملاق، وطالب بالحرية بطريقة مرعبة.. من هو؟" },
    { word: "كانيكي",  question: "طالب جامعي تحول لنصف غول، شعره تحول للأبيض وأصبح يحب أكل اللحم.. من هو؟" },
    { word: "كيلوا",   question: "من عائلة قتلة مأجورين، صديق غون المفضل، ويستخدم البرق في قتاله.. من هو؟" },
    { word: "سايتاما", question: "بطل خارق يهزم أي عدو بضربة واحدة، وأكبر مشاكله الملل والصلع.. من هو؟" },
    { word: "لايت",    question: "طالب عبقري وجد مفكرة تقتل الناس بكتابة أسمائهم، يلقب بـ كيرا.. من هو؟" },
    { word: "إل",      question: "أعظم متحري في العالم، يحب الحلويات، ويجلس بطريقة غريبة دايماً.. من هو؟" },
    { word: "سانجي",   question: "طباخ طاقم قبعة القش، يستخدم أرجله في القتال، ولا يضرب النساء أبداً.. من هو؟" },
    { word: "تانجيرو", question: "صياد شيطين يحمل أخته في صندوق على ظهره، ويستخدم تنفس الماء.. من هو؟" },
    { word: "ميكا",    question: "من هجوم العمالقة، قوية جداً ودائماً تلبس وشاحاً أحمر أعطاه لها إيرين.. من هي؟" },
    { word: "غون",     question: "طفل صياد يبحث عن والده، سلاحه المفضل صنارة الصيد، وبريء جداً.. من هو؟" },
    { word: "ايزن",    question: "كان قائد فرقة في بليتش، خان الجميع، وخطته كانت مرسومة منذ مئات السنين.. من هو؟" },
    { word: "مادارا",  question: "أسطورة الأوتشيها، أعلن حرب النينجا العظمى، وطلب من الجميع الرقص.. من هو؟" },
    { word: "كاشي",   question: "النينجا النسخ، دايماً يغطي عينه وقناعه ما ينزل، ويحب قراءة روايات معينة.. من هو؟" },
];
const usedWords = new Set(); // نتجنب تكرار الكلمة في نفس اللعبة

function pickWord() {
    const available = ANIME_DB.filter(e => !usedWords.has(e.word));
    if (!available.length) usedWords.clear(); // أعد الدورة
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
//  مرحلة الجواب (15 ثانية) — كتابة الكلمة
// ══════════════════════════════════════════════════════════════
async function phaseAnswer(sock, chatId, players, secretWord) {
    return listenRound(sock, chatId, players,
        (m) => {
            const txt = (m.message.conversation || m.message.extendedTextMessage?.text || "")
                .trim().toLowerCase();
            if (txt === secretWord) return true;   // صحيح
            if (txt.length > 1)    return false;   // خطأ (تجاهل رسائل قصيرة جداً)
            return null;  // لا نسجل
        },
        15000
    );
}

// ══════════════════════════════════════════════════════════════
//  مرحلة التصويت (30 ثانية) — منشن الجاسوس المشتبه
// ══════════════════════════════════════════════════════════════
async function phaseVote(sock, chatId, voters, allPlayers, cache) {
    // votes: Map<voter, nominatedJid>
    const votes = new Map();

    const rl = ({ messages }) => {
        const m = messages[0];
        if (!m?.message || m.key.remoteJid !== chatId) return;
        const rawFrom = m.key.participant || m.key.remoteJid;
        const fromNum = numOf(rawFrom);
        const voter   = voters.find(p => numOf(p) === fromNum);
        if (!voter || votes.has(voter)) return;

        // استخراج أول منشن في الرسالة
        const ctx       = m.message.extendedTextMessage?.contextInfo;
        const mentioned = ctx?.mentionedJid?.[0];
        if (!mentioned) return;

        // resolve LID → phone
        const mentionedPhone = resolveJid(mentioned, cache) || mentioned;
        const mentionedNum   = numOf(mentionedPhone);

        // تأكد أن المُشار إليه من اللاعبين
        const nominated = allPlayers.find(p => numOf(p) === mentionedNum);
        if (!nominated) return;

        votes.set(voter, nominated);
        sock.sendMessage(chatId, {
            react: { text: "🗳️", key: m.key }
        }).catch(() => {});
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

const activeGames   = new Map();
const LARGE_GROUP   = 25;  // حد المجموعة الكبيرة — يُفعَّل نظام .شارك
const pendingSignup = new Map(); // chatId → { players: Set, timeout, cache }

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
        const list = top.map(([num, pts], i) =>
            `${["🥇","🥈","🥉"][i] || `${i+1}.`} \`${num}\` — *${pts} نقطة*`
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
    if (activeGames.has(chatId))
        return sock.sendMessage(chatId, { text: "⚠️ _لعبة نشطة بالفعل!_" });

    // ── .شارك — تسجيل في فترة الانتظار ─────────────────────
    if (args?.[0] === "شارك") {
        const signup = pendingSignup.get(chatId);
        if (!signup) return; // ما في تسجيل مفتوح

        const senderRaw = msg.key.participant || chatId;
        const phone     = resolveJid(senderRaw, signup.cache) || senderRaw;
        const n         = numOf(phone || senderRaw);

        // استثناء البوت والمشرفين والنخبة
        const meta = await sock.groupMetadata(chatId).catch(() => null);
        if (!meta) return;
        const admNums = new Set(meta.participants.filter(p => p.admin).map(p => numOf(p.id)));
        if (n === botNum || n === botLid || n === ownerNum) return;
        if (admNums.has(n)) return;

        if (!signup.players.has(phone || senderRaw)) {
            signup.players.add(phone || senderRaw);
            await sock.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
        }
        return;
    }

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
    //  مجموعة كبيرة → فترة تسجيل بـ .شارك (60 ثانية)
    // ══════════════════════════════════════════════════════════
    let finalPlayers;

    if (basePlayers.length >= LARGE_GROUP) {
        // افتح باب التسجيل
        pendingSignup.set(chatId, { players: new Set(), cache });

        await sock.sendMessage(chatId, {
            text:
`🕵️ *━━━ كاشف الجاسوس ━━━*

👥 *المجموعة كبيرة (${basePlayers.length} شخص)*
⚠️ _لحماية البوت، التسجيل يدوي_

📝 *اكتب* \`.شارك\` *خلال 60 ثانية للمشاركة!*
🛑 اكتب \`.جاسوس وقف\` للإلغاء`,
            mentions: allRaw,
        });

        await wait(60000);

        const signup = pendingSignup.get(chatId);
        pendingSignup.delete(chatId);

        if (!signup || signup.players.size < 3) {
            return sock.sendMessage(chatId, {
                text: "❌ *لم يسجّل كافي اللاعبين (الحد الأدنى 3)*\n_أُلغيت اللعبة._",
            });
        }

        finalPlayers = [...signup.players];
        await sock.sendMessage(chatId, {
            text: `✅ *سجّل ${finalPlayers.length} لاعب — تبدأ اللعبة الآن!*`,
        });
        await wait(2000);

    } else {
        // مجموعة صغيرة → الكل يدخل تلقائياً
        finalPlayers = [...basePlayers];
    }

    // ── جلسة اللعبة ──────────────────────────────────────────
    const game = { stop: false, round: 0, players: finalPlayers };
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

            // ── توزيع الأدوار بالخاص ─────────────────────────
            for (const p of citizens) {
                await sock.sendMessage(p,
`🏘️ *الجولة ${game.round} — أنتَ مواطن أبرار!*

🔑 *كلمة السر:* _${entry.word}_
📌 _في المجموعة: اكتب الكلمة للنجاة_
🗳️ _ثم مَنشِن من تشك أنه الجاسوس في التصويت!_`
                ).catch(() => {});
                await wait(150);
            }
            for (const p of spies) {
                await sock.sendMessage(p,
`🕵️ *الجولة ${game.round} — أنتَ الجاسوس المندَس!*

⚠️ _لا تملك الكلمة — راقب وخمّن بسرعة!_
💡 _خمّن الكلمة أولاً لتنجو، وإلا ستُكشف في التصويت!_`
                ).catch(() => {});
                await wait(150);
            }

            await wait(1500);

            // ── إعلان اللغز في المجموعة ──────────────────────
            const playerMentions = players.map(p => display(p)).join(" ");
            await sock.sendMessage(chatId, {
                text:
`🎯 *━━━ كاشف الجاسوس | الجولة ${game.round} ━━━*

🧩 *اللغز:*
_${entry.question}_

👥 *المشاركون (${players.length}):*
${playerMentions}

🕵️ *الجواسيس:* ${spyCount} مندَس بينكم!
⏱️ *15 ثانية — اكتبوا الكلمة!*`,
                mentions: allRaw,
            });

            // ── مرحلة الجواب (15 ثانية) ──────────────────────
            const answerMap = await phaseAnswer(sock, chatId, players, secretWord);
            if (game.stop) break;

            // هل الجاسوس خمّن؟
            let spyGuessedFirst = null;
            for (const [spy] of [...answerMap.entries()]) {
                if (spies.has(spy) && answerMap.get(spy)?.data === true) {
                    spyGuessedFirst = spy;
                    break;
                }
            }

            // ── مرحلة التصويت (30 ثانية) ─────────────────────
            await sock.sendMessage(chatId, {
                text:
`🗳️ *وقت التصويت! — 30 ثانية*

📌 *منشِن* الشخص الذي تعتقد أنه الجاسوس!
_كل لاعب يملك صوتاً واحداً فقط._`,
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
`😱 *الجاسوس خمّن الكلمة وفاز بالجولة!*

🕵️ *الجاسوس:* ${display(spyPh)} _نجا (+${PTS.SPY_GUESSES_WORD} نقاط)_
🔑 _الكلمة كانت:_ *${entry.word}*`;

                if (slowCitizen) {
                    kicked.push(slowCitizen);
                    const scPh = resolveJid(slowCitizen, cache) || slowCitizen;
                    roundMsg += `\n⚡ *${display(scPh)} طُرد — كان الأبطأ في الإجابة!*`;
                }

            } else if (votedOut && spies.has(votedOut)) {
                // التصويت كشف الجاسوس ✓
                kicked.push(votedOut);
                const spyPh = resolveJid(votedOut, cache) || votedOut;

                roundMsg =
`✅ *المواطنون كشفوا الجاسوس!*

🕵️ *الجاسوس كان:* ${display(spyPh)} _طُرد!_
🔑 _الكلمة كانت:_ *${entry.word}*`;

                // نقاط لمن صوّت صح
                for (const [voter, nominated] of votes.entries()) {
                    if (numOf(nominated) === numOf(votedOut)) {
                        const newPts = addPoints(voter, PTS.CITIZEN_VOTES_SPY);
                        const vPh = resolveJid(voter, cache) || voter;
                        roundMsg += `\n🎯 ${display(vPh)} صوّت صح _(+${PTS.CITIZEN_VOTES_SPY} نقاط | المجموع: ${newPts})_`;
                    }
                }

            } else if (votedOut) {
                // التصويت وقع على مواطن بريء — الجاسوس ينجو
                kicked.push(votedOut);
                const innocentPh = resolveJid(votedOut, cache) || votedOut;
                const spyList    = [...spies].map(s => {
                    const ph = resolveJid(s, cache)||s;
                    return display(ph);
                }).join(" ");
                const spyJids = [...spies].flatMap(s => mentionSet(resolveJid(s,cache)||s, s));

                // الجاسوس ينجو بالجولة
                for (const spy of spies) addPoints(spy, PTS.SPY_SURVIVES);

                roundMsg =
`😈 *الجاسوس نجا!*

💀 *طُرد بريء:* ${display(innocentPh)} _(مواطن!)_
🕵️ *الجاسوس كان:* ${spyList} _(+${PTS.SPY_SURVIVES} نقاط)_
🔑 _الكلمة كانت:_ *${entry.word}*`;

            } else {
                // ما صوّت أحد — لا طرد هذه الجولة
                const spyList = [...spies].map(s => display(resolveJid(s,cache)||s)).join(" ");
                roundMsg =
`🤷 *لم يُدلِ أحد بصوته!*

🔑 _الكلمة كانت:_ *${entry.word}*
🕵️ _الجاسوس كان:_ ${spyList}`;
            }

            // نقاط المواطنين الناجين
            const survivingCitizens = citizens.filter(p => !kicked.includes(p));
            for (const p of survivingCitizens) {
                addPoints(p, PTS.CITIZEN_SURVIVES);
            }
            roundMsg += `\n\n🏅 _المواطنون الناجون (+${PTS.CITIZEN_SURVIVES} نقطة لكل منهم)_`;

            // إرسال النتيجة
            const resultMentions = [...new Set([
                ...kicked.flatMap(k => mentionSet(resolveJid(k,cache)||k, k)),
                ...[...spies].flatMap(s => mentionSet(resolveJid(s,cache)||s, s)),
            ])];
            await sock.sendMessage(chatId, { text: roundMsg, mentions: resultMentions });

            // طرد المُقصَين
            for (const target of kicked) {
                await sock.groupParticipantsUpdate(chatId, [target], "remove").catch(() => {});
                await wait(400);
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
                ? finalTop.map(([num, pts], i) =>
                    `${["🥇","🥈","🥉"][i]||`${i+1}.`} \`${num}\` — *${pts} نقطة*`
                  ).join("\n")
                : "_لا توجد نقاط_";

            await sock.sendMessage(chatId, {
                text:
`🏁 *انتهت لعبة كاشف الجاسوس!*
_إجمالي الجولات:_ *${game.round}*

🏆 *أعلى النقاط:*
${topText}`,
            });
        } else {
            await sock.sendMessage(chatId, { text: "🛑 *توقفت اللعبة.*" });
        }

    } catch (err) {
        console.error("[جاسوس] خطأ:", err);
        await sock.sendMessage(chatId, { text: "❌ _خطأ تقني أدى لتوقف اللعبة._" });
    } finally {
        activeGames.delete(chatId);
    }
}

export default { NovaUltra, execute };
