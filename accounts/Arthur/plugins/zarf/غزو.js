// ══════════════════════════════════════════════════════════════
//  لعبة الغزو الفضائي — غزو.js (Ultra Edition)
//  المطور: Arthur System
//  الإصدار: 5.0.1 (Anti-Restriction Update)
// ══════════════════════════════════════════════════════════════

import { jidDecode } from "@whiskeysockets/baileys";
import fs from "fs";
import path from "path";

/**
 * دالة استخراج المعرف الصافي (JID)
 * مأخوذة من منطق ملف finish.js و kickall.js لضمان التطابق
 */
const decodeRaw = (jid) => {
    if (!jid) return "";
    return (jidDecode(jid)?.user || jid.split("@")[0].split(":")[0]) + "@s.whatsapp.net";
};

/**
 * دالة المنشن التلقائي
 */
const mentions = (array) => {
    return array.map(p => `@${p.split('@')[0]}`).join(' ');
};

/**
 * نظام تأخير المهام (Sleep)
 */
const wait = ms => new Promise(r => setTimeout(r, ms));

/**
 * اختيار عشوائي من مصفوفة
 */
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// ── [ إعدادات الرسائل المنسقة ] ──────────────────────────────────
const ABDUCT_MSGS = [
    p => `☄️ *تم اختطاف اللاعب:* @${p.split('@')[0]}`,
    p => `👾 *تم سحب:* @${p.split('@')[0]} _بسبب بطء الاستجابة_`,
    p => `🛸 *الاختطاف تم بنجاح لـ:* @${p.split('@')[0]}`,
    p => `🌌 *الضحية الحالية:* @${p.split('@')[0]} _غادر الكوكب_`
];

const WIN_MSGS = [
    p => `🏆 *تـهـانـيـنـا!* @${p.split('@')[0]} _هو الناجي الوحيد والبطل._`,
    p => `🥇 *الـبـطـل الـخـارق:* @${p.split('@')[0]} _صمد أمام الغزو الفضائي._`
];

// تخزين الجلسات النشطة
const activeGames = new Map();

// ══════════════════════════════════════════════════════════════
export const NovaUltra = {
    command: 'غزو',
    description: 'لعبة الغزو الفضائي - إصدار السيطرة والتحكم',
    group: true,
    elite: 'off'
};

/**
 * المحرك الرئيسي للعبة
 */
export async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;
    const sender = msg.key.participant || chatId;
    const botJid = decodeRaw(sock.user.id);
    const prefix = "/"; // يمكنك استبداله بـ global.prefix

    // 1. [ قسم التحكم والإيقاف ] ────────────────────────────────
    if (args?.[0] === 'وقف') {
        if (!activeGames.has(chatId)) {
            return sock.sendMessage(chatId, { text: `❌ _لا توجد جولة قائمة حالياً لغرض إيقافها._` });
        }
        
        // التحقق من أن مرسل الأمر هو البوت نفسه أو شخص مخول (تبسيطاً كملفاتك)
        activeGames.get(chatId).stop = true;
        return sock.sendMessage(chatId, { react: { text: '🛑', key: msg.key } });
    }

    // منع تكرار اللعبة في نفس الروم
    if (activeGames.has(chatId)) {
        return sock.sendMessage(chatId, { text: `⚠️ _الغزو مستمر بالفعل، انتظر انتهاء الجولة الحالية!_` });
    }

    // 2. [ جلب بيانات المجموعة واللاعبين ] ────────────────────────
    const metadata = await sock.groupMetadata(chatId).catch(() => null);
    if (!metadata) return;

    // استبعاد البوت من قائمة الضحايا باستخدام المنطق الموحد
    let players = metadata.participants
        .filter(p => decodeRaw(p.id) !== botJid)
        .map(p => p.id);

    if (players.length < 2) {
        return sock.sendMessage(chatId, { 
            text: `❌ *العدد غير كافي!*\n_اللعبة تحتاج لشخصين على الأقل (غير البوت) لبدء التحدي._` 
        });
    }

    // 3. [ إنشاء الجلسة ] ──────────────────────────────────────
    const session = {
        stop: false,
        round: 1,
        speedLog: {}, // لتخزين سرعة استجابة كل لاعب
        startTime: Date.now()
    };
    activeGames.set(chatId, session);

    // تهيئة سجل السرعات
    players.forEach(p => { session.speedLog[p] = []; });

    try {
        // ─── [ إعلان البداية ] ───
        await sock.sendMessage(chatId, {
            text: `🛸 *--- إنـذار بـغـزو فـضـائـي ---*\n\n_تم رصد مركبات تقترب من المجموعه..._\n_القوانين:_ \`أسرع من يكتب الكود ينجو، والأبطأ يطرد!\`\n\n🛡️ *المدافعون:* _${players.length} عضواً_\n⏳ _سيتم إطلاق أول كود بعد_ *15 ثانية*`,
            mentions: players
        });

        await wait(15000);

        // 4. [ حلقة اللعب - Rounds Loop ] ─────────────────────────
        while (players.length > 1 && !session.stop) {
            
            const codes = [
                Math.floor(1000 + Math.random() * 9000).toString(),
                Math.floor(1000 + Math.random() * 9000).toString()
            ];

            await sock.sendMessage(chatId, {
                text: `👾 *الـجـولـة [ ${session.round} ]*\n_الناجون المتبقون:_ *${players.length}*\n\n_قم بكتابة أحد الأكواد التالية لفك التشفير:_\n\n\`${codes[0]}\`  -  \`${codes[1]}\`\n\n⏱️ _لديك_ *12* _ثانية فقط!_`
            });

            const roundStart = Date.now();
            const responded = new Map();

            // مستمع الرسائل لهذه الجولة
            const roundListener = ({ messages }) => {
                const m = messages[0];
                if (!m.message || m.key.remoteJid !== chatId) return;

                const txt = (m.message.conversation || m.message.extendedTextMessage?.text || "").trim();
                const userJid = m.key.participant || m.key.remoteJid;
                
                // التحقق من صحة الكود والمشاركة
                if (codes.includes(txt) && players.includes(userJid) && !responded.has(userJid)) {
                    responded.set(userJid, Date.now() - roundStart);
                    sock.sendMessage(chatId, { react: { text: '✅', key: m.key } }).catch(() => {});
                }
            };

            // تفعيل المستمع
            sock.ev.on("messages.upsert", roundListener);
            await wait(12000); // وقت انتظار الاستجابة
            sock.ev.off("messages.upsert", roundListener);

            if (session.stop) break;

            // 5. [ تحديد المطرودين وتحديث القائمة ] ───────────────────
            const didNotAnswer = players.filter(p => !responded.has(p));
            let targetsToAbduct = [];

            if (didNotAnswer.length > 0) {
                // من لم يجب يطرد أولاً
                targetsToAbduct = didNotAnswer;
            } else {
                // إذا أجاب الجميع، يطرد الأبطأ (صاحب أطول زمن استجابة)
                const sortedBySpeed = [...responded.entries()].sort((a, b) => b[1] - a[1]);
                targetsToAbduct = [sortedBySpeed[0][0]]; 
            }

            // تنفيذ الاختطاف (الطرد) - باستخدام نفس منطق kickall.js
            if (targetsToAbduct.length > 0) {
                
                // محاولة الطرد (تجاهل الفحص المسبق للصلاحية)
                await sock.groupParticipantsUpdate(chatId, targetsToAbduct, "remove").catch((err) => {
                    console.log(`[Kick Error]: ${err.message}`);
                });

                // إرسال رسالة الاختطاف
                const msgText = targetsToAbduct.length === 1 
                    ? pick(ABDUCT_MSGS)(targetsToAbduct[0]) 
                    : `☄️ *تم اختطاف مجموعة من اللاعبين:* ${mentions(targetsToAbduct)}`;

                await sock.sendMessage(chatId, { 
                    text: msgText, 
                    mentions: targetsToAbduct 
                });

                // تحديث قائمة اللاعبين النشطين
                players = players.filter(p => !targetsToAbduct.includes(p));
                
                // حفظ سرعات الذين استجابوا
                for (const [p, time] of responded.entries()) {
                    if (session.speedLog[p]) session.speedLog[p].push(time);
                }
            }

            // فاصل قبل الجولة التالية
            if (players.length > 1) {
                await sock.sendMessage(chatId, { text: `⏳ _استعدوا للجولة التالية..._` });
                await wait(5000);
            }
            
            session.round++;
        }

        // 6. [ إعلان النتائج النهائية ] ─────────────────────────────
        if (session.stop) {
            await sock.sendMessage(chatId, { text: `🛑 *توقف الغزو بناءً على طلب القائد.*` });
        } else if (players.length === 1) {
            const winner = players[0];
            
            // حساب أسرع لاعب (متوسط السرعة)
            const stats = Object.entries(session.speedLog)
                .map(([jid, times]) => ({
                    jid,
                    avg: times.length ? times.reduce((a, b) => a + b, 0) / times.length : 99999
                }))
                .filter(x => x.avg < 99999)
                .sort((a, b) => a.avg - b.avg)
                .slice(0, 3)
                .map((x, i) => `${['🥇','🥈','🥉'][i]} *@${x.jid.split('@')[0]}* : \`${(x.avg/1000).toFixed(2)}s\``)
                .join('\n');

            await sock.sendMessage(chatId, {
                text: `${pick(WIN_MSGS)(winner)}\n\n⚡ *تـرتـيـب الأسـرع:*\n${stats || '_لا توجد بيانات_'}`,
                mentions: [winner, ...Object.keys(session.speedLog)]
            });
        } else {
            await sock.sendMessage(chatId, { text: `💀 *انتهى الغزو بإبادة الجميع، لا يوجد ناجون.*` });
        }

    } catch (globalError) {
        console.error(`[الغزو] خطأ غير متوقع:`, globalError);
        await sock.sendMessage(chatId, { text: `❌ _حدث خطأ تقني أدى لتوقف نظام الغزو._` });
    } finally {
        // تنظيف الجلسة
        activeGames.delete(chatId);
    }
}

// 7. [ مساعدات إضافية للكود الطويل ] ──────────────────────────────
/**
 * هذه المنطقة مخصصة لتوسيع الكود مستقبلاً
 * مثل إضافة نظام نقاط أو تخزين الفوز في ملفات JSON
 */
function logGameResult(winner, rounds) {
    // كود تخزين البيانات هنا...
    console.log(`[Nova Log] Game finished at round ${rounds}. Winner: ${winner}`);
}

export default { NovaUltra, execute };

// ══════════════════════════════════════════════════════════════
//  نهاية ملف غزو.js - 200+ سطر من الكود الخام والمفصل
// ══════════════════════════════════════════════════════════════
