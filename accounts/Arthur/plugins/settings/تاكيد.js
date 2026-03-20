// ══════════════════════════════════════════════════════════════
//  تاكد.js — فحص الأرقام المبندة في المجموعات
//  متوافق مع بنية نظام الجلسات (NOVA)
// ══════════════════════════════════════════════════════════════

// ── دوال التفاعل المساعدة ──
const react = (sock, msg, e) =>
    sock.sendMessage(msg.key.remoteJid, { react: { text: e, key: msg.key } }).catch(() => {});
const reactWait = (sock, msg) => react(sock, msg, '🕒');
const reactOk   = (sock, msg) => react(sock, msg, '☑️');
const reactFail = (sock, msg) => react(sock, msg, '✖️');

const normalizeJid = jid => {
    if (!jid) return '';
    return jid.split('@')[0].split(':')[0];
};

const CheckBannedPlugin = {
    command: 'تاكد', 
    description: 'فحص واستخراج الأرقام المبندة/المحذوفة في المجموعة',
    elite: 'on',
    group: true, // يعمل في المجموعات فقط
    prv: false,
    lock: 'off',
};

async function execute({ sock, msg }) {
    const chatId = msg.key.remoteJid;
    
    // التأكد أن الأمر يُنفذ في مجموعة
    if (!chatId.endsWith('@g.us')) {
        reactFail(sock, msg);
        return sock.sendMessage(chatId, { text: '❌ هذا الأمر يعمل في المجموعات فقط.' }, { quoted: msg });
    }

    reactWait(sock, msg);

    try {
        // 1. جلب بيانات المجموعة وأعضائها
        const groupMetadata = await sock.groupMetadata(chatId);
        const participants = groupMetadata.participants;
        const total = participants.length;

        if (total === 0) {
            reactFail(sock, msg);
            return sock.sendMessage(chatId, { text: '❌ لم أتمكن من جلب أعضاء المجموعة.' }, { quoted: msg });
        }

        // 2. إرسال رسالة "حالة التقدم" التي سيتم تعديلها لاحقاً
        let statusMsg = await sock.sendMessage(chatId, { 
            text: `⏳ *بدء فحص الأرقام المبندة...*\nالعدد الإجمالي: ${total} عضو\n\n_يرجى الانتظار، قد تستغرق العملية بضع دقائق لحماية البوت من الحظر._`
        }, { quoted: msg });

        const bannedUsers = [];

        // 3. حلقة الفحص (Loop)
        for (let i = 0; i < total; i++) {
            const jid = participants[i].id;
            
            try {
                // الفحص عبر سيرفرات واتساب
                // إذا كان الرقم شغال سيرد بمصفوفة، إذا كان مبند/محذوف سيرد بمصفوفة فارغة
                const [result] = await sock.onWhatsApp(jid);
                
                if (!result || !result.exists) {
                    bannedUsers.push(jid);
                }
            } catch (err) {
                // في حال فشل فحص رقم معين، نتجاهله ونكمل
            }

            // 4. تحديث رسالة التقدم كل 10 أعضاء (لتجنب حظر التعديل المفرط)
            if ((i + 1) % 10 === 0 || i === total - 1) {
                await sock.sendMessage(chatId, { 
                    edit: statusMsg.key, 
                    text: `⏳ *جارِ فحص الأعضاء...* [ ${i + 1} / ${total} ]\nالأرقام المبندة المكتشفة حتى الآن: ${bannedUsers.length}` 
                });
            }

            // ⚠️ [مهم جداً] تأخير زمني 1.5 ثانية لحماية البوت من حظر الـ Spam
            await new Promise(r => setTimeout(r, 1500));
        }

        // 5. إعداد النتيجة النهائية
        if (bannedUsers.length === 0) {
            reactOk(sock, msg);
            await sock.sendMessage(chatId, { 
                edit: statusMsg.key,
                text: `✅ *اكتمل الفحص!*\nالمجموعة نظيفة تماماً، لا يوجد أي أرقام مبندة أو محذوفة.` 
            });
        } else {
            reactOk(sock, msg);
            
            // تجهيز المنشنات
            let reportText = `🚨 *تقرير الأرقام المبندة*\nتم فحص ${total} عضو، واكتشاف ${bannedUsers.length} حساب مبند/محذوف:\n\n`;
            
            bannedUsers.forEach((jid, index) => {
                reportText += `${index + 1}. @${normalizeJid(jid)}\n`;
            });

            reportText += `\n_يمكن للمشرفين الآن إزالة هذه الأرقام._`;

            // إرسال التقرير النهائي كرسالة جديدة لضمان عمل المنشن
            await sock.sendMessage(chatId, { 
                text: reportText, 
                mentions: bannedUsers 
            }, { quoted: msg });
            
            // تعديل رسالة الحالة لإنهاء الفحص
            await sock.sendMessage(chatId, { 
                edit: statusMsg.key,
                text: `☑️ *انتهى الفحص.* تم العثور على ${bannedUsers.length} رقم مبند (انظر التقرير أدناه).` 
            });
        }

    } catch (error) {
        reactFail(sock, msg);
        await sock.sendMessage(chatId, { text: '❌ حدث خطأ أثناء فحص المجموعة.' }, { quoted: msg });
    }
}

export default { ...CheckBannedPlugin, execute };
