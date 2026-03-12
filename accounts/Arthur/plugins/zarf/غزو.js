export const InvasionGame = {
    command: 'غزو',
    description: 'لعبة الغزو الفضائي (البقاء للأسرع - Area 51)',
    elite: 'off',
    group: true,
    prv: false,
    lock: 'off'
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// لمنع تشغيل اللعبة مرتين في نفس المجموعة
const activeGames = new Set();

export async function execute({ sock, msg }) {
    const chatId = msg.key.remoteJid;

    if (activeGames.has(chatId)) {
        return await sock.sendMessage(chatId, { text: '⚠️ `هناك غزو فضائي قائم بالفعل في هذه المجموعة!`' }, { quoted: msg });
    }

    // التحقق من صلاحيات البوت (لكي يستطيع الطرد)
    const meta = await sock.groupMetadata(chatId);
    const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    const botIsAdmin = meta.participants.some(p => p.id === botId && p.admin);

    if (!botIsAdmin) {
        return await sock.sendMessage(chatId, { text: '❌ `البوت يحتاج إلى صلاحية "مشرف" لكي يتمكن من اختطاف (طرد) اللاعبين!`' }, { quoted: msg });
    }

    activeGames.add(chatId);

    try {
        // تجهيز قائمة بكل الأعضاء كـ "لاعبين محتملين" (باستثناء البوت والمشرفين تفادياً للمشاكل)
        let activePlayers = meta.participants
            .filter(p => !p.admin && p.id !== botId)
            .map(p => p.id);

        if (activePlayers.length < 2) {
            activeGames.delete(chatId);
            return await sock.sendMessage(chatId, { text: '❌ `عدد الأعضاء غير كافي لبدء الغزو!`' });
        }

        // 1. إرسال الشرح والمنشن الجماعي
        const instructions = 
`👽 *تحذير: غزو فضائي! المنطقة 51* 🛸

الكائنات الفضائية تهاجم المجموعة! للنجاة من الاختطاف، سيقوم البوت بإرسال **3 أرقام عشوائية**.
يجب عليك أن تكتب **أحد هذه الأرقام** بأسرع ما يمكن!

قواعد البقاء 🩸:
- في **الجولة الأولى**: أي شخص لا يكتب رقماً سيتم اختطافه (طرده)!
- في **الجولات القادمة**: أبطأ شخص يكتب الرقم سيتم اختطافه!

⏳ *المركبة الفضائية تقترب... سيبدأ الغزو بعد 40 ثانية! استعدوا!*`;

        await sock.sendMessage(chatId, { text: instructions, mentions: activePlayers });

        // 2. الانتظار 40 ثانية
        await sleep(40000);

        let round = 1;
        let gameRunning = true;

        // 3. حلقة الجولات
        while (gameRunning && activePlayers.length > 1) {
            // توليد 3 أرقام عشوائية
            const n1 = Math.floor(100 + Math.random() * 900).toString();
            const n2 = Math.floor(100 + Math.random() * 900).toString();
            const n3 = Math.floor(100 + Math.random() * 900).toString();
            const validNumbers = [n1, n2, n3];

            const roundMsg = 
`🛸 *الجولة ${round} بدأت!*

اكتب أحد الأرقام التالية للنجاة فوراً:
\`${n1}\` | \`${n2}\` | \`${n3}\`

⏱️ لديك 15 ثانية!`;

            await sock.sendMessage(chatId, { text: roundMsg });

            let safePlayersThisRound = [];

            // مراقب الرسائل للجولة الحالية
            const roundListener = async ({ messages }) => {
                const m = messages[0];
                if (!m?.message || m.key.remoteJid !== chatId || m.key.fromMe) return;

                const sender = m.key.participant || m.key.remoteJid;
                const text = (m.message.conversation || m.message.extendedTextMessage?.text || '').trim();

                // إذا أرسل أحد الأرقام وكان من ضمن اللاعبين الأحياء ولم ينجُ بعد في هذه الجولة
                if (validNumbers.includes(text) && activePlayers.includes(sender) && !safePlayersThisRound.includes(sender)) {
                    safePlayersThisRound.push(sender);
                    await sock.sendMessage(chatId, { react: { text: '✅', key: m.key } });
                }
            };

            sock.ev.on('messages.upsert', roundListener);

            // انتظار 15 ثانية (مدة الجولة)
            await sleep(15000);

            // إيقاف المراقب
            sock.ev.off('messages.upsert', roundListener);

            // تقييم النتيجة وتحديد المختطفين
            let kidnapped = [];

            if (round === 1) {
                // الجولة الأولى: كل من لم يكتب الرقم يتم طرده
                kidnapped = activePlayers.filter(p => !safePlayersThisRound.includes(p));
            } else {
                // الجولات المتقدمة: البقاء للأسرع، أبطأ شخص (آخر شخص في مصفوفة الناجين) يُطرد، بالإضافة لأي شخص لم يجاوب
                const didNotAnswer = activePlayers.filter(p => !safePlayersThisRound.includes(p));
                if (didNotAnswer.length > 0) {
                    kidnapped = didNotAnswer; // طرد من لم يتفاعل
                } else if (safePlayersThisRound.length > 0) {
                    // إذا الكل جاوب، اطرد أبطأ واحد (الذي دخل المصفوفة أخيراً)
                    kidnapped = [safePlayersThisRound[safePlayersThisRound.length - 1]];
                }
            }

            // تنفيذ الاختطاف (الطرد)
            if (kidnapped.length > 0) {
                // فلترة من هم أدمنز احتياطياً لعدم تعطل البوت
                const finalKidnapped = kidnapped.filter(p => p !== botId);
                
                if (finalKidnapped.length > 0) {
                    try {
                        await sock.groupParticipantsUpdate(chatId, finalKidnapped, 'remove');
                        await sock.sendMessage(chatId, { 
                            text: `🩸 *تم اختطاف (طرد) ${finalKidnapped.length} عضو!* الفضاء لا يرحم الضعفاء.`,
                            mentions: finalKidnapped 
                        });
                    } catch (e) {
                        console.log('خطأ في الطرد: ', e);
                    }
                }

                // تحديث قائمة الأحياء
                activePlayers = activePlayers.filter(p => !finalKidnapped.includes(p));
            } else {
                await sock.sendMessage(chatId, { text: '✨ `نجا الجميع في هذه الجولة... لكن هل سيصمدون في القادمة؟`' });
            }

            // إنهاء اللعبة إذا بقي شخص واحد أو لم يبق أحد
            if (activePlayers.length === 1) {
                await sock.sendMessage(chatId, { 
                    text: `🏆 *انتهى الغزو!*\n\nالناجي الوحيد الذي استطاع هزيمة الفضائيين هو: @${activePlayers[0].split('@')[0]} 🎉`,
                    mentions: [activePlayers[0]]
                });
                gameRunning = false;
            } else if (activePlayers.length === 0) {
                await sock.sendMessage(chatId, { text: '💀 *انتهى الغزو!*\n\nلقد تم اختطاف الجميع بنجاح... لا يوجد ناجين.' });
                gameRunning = false;
            } else {
                // استراحة بين الجولات
                await sock.sendMessage(chatId, { text: `⏳ \`تبدأ الجولة القادمة بعد 15 ثانية... (عدد الناجين: ${activePlayers.length})\`` });
                await sleep(15000);
                round++;
            }
        }

    } catch (err) {
        await sock.sendMessage(chatId, { text: '❌ `حدث خطأ تقني في المركبة الفضائية (توقفت اللعبة).`' });
    } finally {
        activeGames.delete(chatId);
    }
}
