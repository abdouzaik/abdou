// ══════════════════════════════════════════════════════════════
//  لعبة الغزو الفضائي — غزو.js (Ultra Edition)
//  المطور: Arthur System
//  الإصدار: 5.1.0 (LID Fix - Phone JID Mentions)
// ══════════════════════════════════════════════════════════════

import { jidDecode } from "@whiskeysockets/baileys";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ══════════════════════════════════════════════════════════════
//  helpers
// ══════════════════════════════════════════════════════════════

const wait = ms => new Promise(r => setTimeout(r, ms));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

/** استخراج رقم نظيف من أي JID */
const normNum = jid => jid ? jid.split('@')[0].split(':')[0].replace(/\D/g, '') : '';

/** رقم هاتف صالح (7-15 خانة) — LID أطول */
const isPhone = num => num.length >= 7 && num.length <= 15;

/**
 * بناء خريطة تحويل: LID → phone JID
 * المصدر 1: elite-pro.json twice map
 * المصدر 2: participants أنفسهم (بعض الإصدارات تعطي كليهما)
 */
function buildLidMap(participants) {
    const map = new Map(); // lid@lid → phone@s.whatsapp.net

    // المصدر 1: elite-pro.json twice map
    try {
        const epPath = path.join(__dirname, '../../handlers/elite-pro.json');
        if (fs.existsSync(epPath)) {
            const ep = JSON.parse(fs.readFileSync(epPath, 'utf8'));
            const twice = ep.twice || {};
            for (const [k, v] of Object.entries(twice)) {
                if (k.endsWith('@lid') && v.endsWith('@s.whatsapp.net')) {
                    map.set(k, v);
                }
            }
        }
    } catch {}

    // المصدر 2: participants قد يحتوي على كلا الشكلين
    for (const p of participants) {
        // بعض إصدارات Baileys تضع phone JID في p.id و LID في p.lid
        if (p.lid && p.id?.endsWith('@s.whatsapp.net')) {
            map.set(p.lid, p.id);
        }
        // أو العكس
        if (p.id?.endsWith('@lid') && p.jid?.endsWith('@s.whatsapp.net')) {
            map.set(p.id, p.jid);
        }
    }

    return map;
}

/**
 * تحويل أي JID إلى phone JID صالح
 * LID → twice map → phone@s.whatsapp.net
 * phone → يُعاد كما هو
 */
function resolvePhone(jid, lidMap) {
    if (!jid) return null;
    // phone JID مباشرة
    if (jid.endsWith('@s.whatsapp.net')) {
        const num = normNum(jid);
        if (isPhone(num)) return jid;
        // رقم طويل جداً → قد يكون LID متنكر، تجاهله
        return null;
    }
    // LID → twice map
    if (jid.endsWith('@lid')) {
        const phone = lidMap.get(jid);
        if (phone) return phone;
        // fallback: استخرج الرقم وتحقق من طوله
        const num = normNum(jid);
        if (isPhone(num)) return num + '@s.whatsapp.net';
        return null;  // LID غير محلول — لا نعرض رقماً غريباً
    }
    // غيره: حاول
    const num = normNum(jid);
    if (isPhone(num)) return num + '@s.whatsapp.net';
    return null;
}

/**
 * بناء نص المنشن + مصفوفة mentions
 * يعمل مع phone JID وLID على حد سواء
 */
function buildMentions(jids, lidMap) {
    const resolved = [];
    const mentionJids = [];

    for (const jid of jids) {
        const phone = resolvePhone(jid, lidMap);
        if (phone) {
            resolved.push(`@${normNum(phone)}`);
            mentionJids.push(phone);
        } else {
            // LID غير محلول — أضفه للـ mentions array فقط (واتساب يتعامل معه)
            // لكن لا نضيف رقماً غريباً في النص
            mentionJids.push(jid);
        }
    }

    return {
        text:  resolved.join(' '),
        array: mentionJids,
    };
}

// ══════════════════════════════════════════════════════════════
//  رسائل اللعبة
// ══════════════════════════════════════════════════════════════

const ABDUCT_MSGS = [
    (num) => `☄️ *تم اختطاف اللاعب:* @${num}`,
    (num) => `👾 *تم سحب:* @${num} _بسبب بطء الاستجابة_`,
    (num) => `🛸 *الاختطاف تم بنجاح لـ:* @${num}`,
    (num) => `🌌 *الضحية الحالية:* @${num} _غادر الكوكب_`,
];

const WIN_MSGS = [
    (num) => `🏆 *تـهـانـيـنـا!* @${num} _هو الناجي الوحيد والبطل._`,
    (num) => `🥇 *الـبـطـل الـخـارق:* @${num} _صمد أمام الغزو الفضائي._`,
];

// ══════════════════════════════════════════════════════════════
//  جلسات اللعب
// ══════════════════════════════════════════════════════════════
const activeGames = new Map();

// ══════════════════════════════════════════════════════════════
export const NovaUltra = {
    command:     'غزو',
    description: 'لعبة الغزو الفضائي - إصدار السيطرة والتحكم',
    group:       true,
    elite:       'off',
};

// ══════════════════════════════════════════════════════════════
export async function execute({ sock, msg, args }) {
    const chatId   = msg.key.remoteJid;
    const sender   = msg.key.participant || chatId;
    const botNum   = normNum(sock.user?.id || '');
    const ownerNum = (global._botConfig?.owner || '213540419314').replace(/\D/g, '');

    // ── وقف اللعبة ──────────────────────────────────────────
    if (args?.[0] === 'وقف') {
        if (!activeGames.has(chatId))
            return sock.sendMessage(chatId, { text: `❌ _لا توجد جولة قائمة حالياً._` });
        activeGames.get(chatId).stop = true;
        return sock.sendMessage(chatId, { react: { text: '🛑', key: msg.key } });
    }

    if (activeGames.has(chatId))
        return sock.sendMessage(chatId, { text: `⚠️ _الغزو مستمر بالفعل، انتظر انتهاء الجولة الحالية!_` });

    // ── جلب بيانات المجموعة ──────────────────────────────────
    const metadata = await sock.groupMetadata(chatId).catch(() => null);
    if (!metadata) return;

    // بناء خريطة LID → phone
    const lidMap = buildLidMap(metadata.participants);

    // ── بناء قائمة اللاعبين ──────────────────────────────────
    let elitesList = [];
    try {
        if (typeof sock.getEliteList === 'function')
            elitesList = (await sock.getEliteList()) || [];
    } catch {}

    // resolve كل participant لـ phone JID
    const allPhoneJids = [];
    for (const p of metadata.participants) {
        const phone = resolvePhone(p.id, lidMap) || resolvePhone(p.lid, lidMap);
        if (phone) allPhoneJids.push(phone);
    }

    let players = [];
    for (const phone of allPhoneJids) {
        const num = normNum(phone);
        const isBot    = num === botNum;
        const isOwner  = num === ownerNum;
        const isElite  = elitesList.some(e => normNum(e) === num);
        if (!isBot && !isOwner && !isElite) players.push(phone);
    }

    if (players.length < 2)
        return sock.sendMessage(chatId, {
            text: `❌ *العدد غير كافي!*\n_اللعبة تحتاج لشخصين عاديين على الأقل._`,
        });

    // ── إنشاء الجلسة ─────────────────────────────────────────
    const session = { stop: false, round: 1, speedLog: {}, startTime: Date.now() };
    activeGames.set(chatId, session);
    players.forEach(p => { session.speedLog[p] = []; });

    try {
        // إعلان البداية
        const startMentions = buildMentions(allPhoneJids, lidMap);
        await sock.sendMessage(chatId, {
            text:
`🛸 *--- إنـذار بـغـزو فـضـائـي ---*

_تم رصد مركبات تقترب من المجموعة..._
_القوانين:_ \`أسرع من يكتب الكود ينجو، والأبطأ يطرد!\`
_المشاركون:_ ${startMentions.text}

⏳ _سيتم إطلاق أول كود بعد_ *15 ثانية*`,
            mentions: startMentions.array,
        });

        await wait(15000);

        // ── حلقة اللعب ──────────────────────────────────────
        while (players.length > 1 && !session.stop) {
            const codes = [
                Math.floor(1000 + Math.random() * 9000).toString(),
                Math.floor(1000 + Math.random() * 9000).toString(),
            ];

            await sock.sendMessage(chatId, {
                text:
`👾 *الـجـولـة [ ${session.round} ]*
_الناجون المتبقون:_ *${players.length}*

_قم بكتابة أحد الأكواد التالية:_
\`${codes[0]}\`  -  \`${codes[1]}\`

⏱️ _لديك_ *10* _ثوانٍ فقط!_`,
            });

            const roundStart = Date.now();
            const responded  = new Map();

            const roundListener = ({ messages }) => {
                const m = messages[0];
                if (!m?.message || m.key.remoteJid !== chatId) return;
                const txt     = (m.message.conversation || m.message.extendedTextMessage?.text || '').trim();
                const rawJid  = m.key.participant || m.key.remoteJid;
                const userPhone = resolvePhone(rawJid, lidMap);
                if (!userPhone) return;
                if (codes.includes(txt) && !responded.has(userPhone)) {
                    responded.set(userPhone, Date.now() - roundStart);
                    sock.sendMessage(chatId, { react: { text: '✅', key: m.key } }).catch(() => {});
                }
            };

            sock.ev.on('messages.upsert', roundListener);
            await wait(10000);
            sock.ev.off('messages.upsert', roundListener);

            if (session.stop) break;

            // تحديد المطرود
            const didNotAnswer = players.filter(p => !responded.has(p));
            let targetsToAbduct = [];

            if (didNotAnswer.length > 0) {
                targetsToAbduct = [pick(didNotAnswer)];
            } else {
                const sorted = players
                    .map(p => ({ jid: p, time: responded.get(p) }))
                    .sort((a, b) => b.time - a.time);
                targetsToAbduct = [sorted[0].jid];
            }

            if (targetsToAbduct.length > 0) {
                // طرد
                await sock.groupParticipantsUpdate(chatId, targetsToAbduct, 'remove')
                    .catch(err => console.log(`[Kick Error]: ${err.message}`));

                // رسالة الاختطاف مع منشن صحيح
                const targetPhone = targetsToAbduct[0];
                const targetNum   = normNum(targetPhone);
                const msgText     = pick(ABDUCT_MSGS)(targetNum);

                await sock.sendMessage(chatId, {
                    text:     msgText,
                    mentions: [targetPhone],
                });

                // تحديث قائمة اللاعبين
                players = players.filter(p => !targetsToAbduct.includes(p));

                for (const p of players) {
                    if (responded.has(p)) session.speedLog[p].push(responded.get(p));
                }
            }

            if (players.length > 1) {
                await sock.sendMessage(chatId, { text: `⏳ _استعدوا للجولة التالية..._` });
                await wait(5000);
            }

            session.round++;
        }

        // ── النتائج النهائية ──────────────────────────────────
        if (session.stop) {
            await sock.sendMessage(chatId, { text: `🛑 *توقف الغزو بناءً على طلب القائد.*` });

        } else if (players.length === 1) {
            const winner    = players[0];
            const winnerNum = normNum(winner);

            const statEntries = Object.entries(session.speedLog)
                .map(([jid, times]) => ({
                    jid,
                    num: normNum(jid),
                    avg: times.length ? times.reduce((a, b) => a + b, 0) / times.length : 99999,
                }))
                .filter(x => x.avg < 99999)
                .sort((a, b) => a.avg - b.avg)
                .slice(0, 3);

            const statsText = statEntries
                .map((x, i) => `${['🥇','🥈','🥉'][i]} *@${x.num}* : \`${(x.avg / 1000).toFixed(2)}s\``)
                .join('\n');

            const allMentions = [winner, ...statEntries.map(x => x.jid)]
                .filter((v, i, a) => a.indexOf(v) === i); // dedup

            await sock.sendMessage(chatId, {
                text: `${pick(WIN_MSGS)(winnerNum)}\n\n⚡ *تـرتـيـب الأسـرع:*\n${statsText || '_لا توجد بيانات_'}`,
                mentions: allMentions,
            });

        } else {
            await sock.sendMessage(chatId, { text: `💀 *انتهى الغزو بإبادة الجميع، لا يوجد ناجون.*` });
        }

    } catch (err) {
        console.error('[الغزو] خطأ غير متوقع:', err);
        await sock.sendMessage(chatId, { text: `❌ _حدث خطأ تقني أدى لتوقف نظام الغزو._` });
    } finally {
        activeGames.delete(chatId);
    }
}

export default { NovaUltra, execute };
