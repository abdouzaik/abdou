// ══════════════════════════════════════════════════════════════
//  لعبة الغزو الفضائي — غزو.js
// ══════════════════════════════════════════════════════════════

/**
 * دالة تطهير المعرفات لضمان مطابقة رقم البوت حتى مع وجود معرفات الأجهزة
 */
const normalizeJid = (jid) => {
    if (!jid) return '';
    return jid.split(':')[0].split('@')[0].replace(/\D/g, '');
};

/**
 * التحقق من رتبة البوت داخل المجموعة
 */
async function getBotAdminStatus(sock, chatId) {
    try {
        const meta = await sock.groupMetadata(chatId);
        const botNum = normalizeJid(sock.user.id);
        const entry = meta.participants.find(p => normalizeJid(p.id) === botNum);
        return {
            meta,
            botNum: botNum + '@s.whatsapp.net',
            isAdmin: !!(entry?.admin === 'admin' || entry?.admin === 'superadmin'),
        };
    } catch { 
        return { meta: null, botNum: '', isAdmin: false }; 
    }
}

/**
 * التحقق من رتبة المرسل
 */
function isSenderAdmin(meta, senderJid) {
    const sNum = normalizeJid(senderJid);
    return meta.participants.some(
        p => normalizeJid(p.id) === sNum && (p.admin === 'admin' || p.admin === 'superadmin')
    );
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function genCodes(n = 3) {
    const s = new Set();
    while (s.size < n) s.add(String(Math.floor(1000 + Math.random() * 9000)));
    return [...s];
}

const activeGames = new Map();

// ══════════════════════════════════════════════════════════════
export const NovaUltra = {
    command: 'غزو',
    description: 'لعبة الغزو - البقاء للأسرع',
    elite: 'off',
    group: true,
    prv: false,
    lock: 'off'
};

export async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;
    const pfx = global._botConfig?.prefix || '.';
    const subCmd = args?.[0]?.trim();

    // ── أمر الإيقاف ──
    if (subCmd === 'وقف') {
        if (!activeGames.has(chatId)) return sock.sendMessage(chatId, { text: `❌ _لا توجد لعبة قائمة._` });
        
        const { meta } = await getBotAdminStatus(sock, chatId);
        const senderJid = msg.key.participant || msg.key.remoteJid;
        
        if (!msg.key.fromMe && meta && !isSenderAdmin(meta, senderJid))
            return sock.sendMessage(chatId, { text: `❌ *هذا الأمر للمشرفين فقط.*` });
            
        activeGames.get(chatId).stop = true;
        return sock.sendMessage(chatId, { react: { text: '🛑', key: msg.key } });
    }

    if (activeGames.has(chatId))
        return sock.sendMessage(chatId, { text: `⚠️ _اللعبة مستمرة بالفعل._` });

    // ── فحص الصلاحيات ──
    const { meta, botNum, isAdmin } = await getBotAdminStatus(sock, chatId);
    
    if (!meta) return sock.sendMessage(chatId, { text: `❌ _خطأ في جلب بيانات المجموعة._` });
    if (!isAdmin) return sock.sendMessage(chatId, { text: `❌ *البوت يحتاج صلاحية مشرف لتشغيل اللعبة.*` });

    let activePlayers = meta.participants
        .filter(p => normalizeJid(p.id) !== normalizeJid(botNum))
        .map(p => normalizeJid(p.id) + '@s.whatsapp.net');

    if (activePlayers.length < 2)
        return sock.sendMessage(chatId, { text: `❌ _مطلوب لاعبين اثنين على الأقل._` });

    const session = { stop: false, round: 1 };
    activeGames.set(chatId, session);
    const speedLog = {};
    activePlayers.forEach(p => { speedLog[p] = []; });

    try {
        await sock.sendMessage(chatId, {
            text: `🛸 *--- بدأت اللعبة ---*\n\n_اكتب الكود بأسرع ما يمكن لتجنب الاختطاف._\n\n⏳ _تبدأ الجولة الأولى بعد_ *20 ثانية*`,
            mentions: activePlayers
        });

        await sleep(20000);

        while (activePlayers.length > 1) {
            if (session.stop) break;

            const codes = genCodes(3);
            const ROUND_T = 15;

            await sock.sendMessage(chatId, {
                text: `👾 *الجولة [ ${session.round} ]*\n_اللاعبين المتبقين:_ *${activePlayers.length}*\n\n_اكتب أحد الأكواد التالية:_\n\n\`${codes[0]}\`  -  \`${codes[1]}\`  -  \`${codes[2]}\``
            });

            const roundStart = Date.now();
            const responded = new Map();

            const roundListener = ({ messages }) => {
                const m = messages?.[0];
                if (!m?.message || m.key.remoteJid !== chatId || m.key.fromMe) return;
                
                const jid = normalizeJid(m.key.participant || m.key.remoteJid) + '@s.whatsapp.net';
                const text = (m.message.conversation || m.message.extendedTextMessage?.text || '').trim();
                
                if (codes.includes(text) && activePlayers.includes(jid) && !responded.has(jid)) {
                    responded.set(jid, Date.now() - roundStart);
                    sock.sendMessage(chatId, { react: { text: '✅', key: m.key } });
                }
            };

            sock.ev.on('messages.upsert', roundListener);
            await sleep(ROUND_T * 1000);
            sock.ev.off('messages.upsert', roundListener);

            if (session.stop) break;

            const didNotAnswer = activePlayers.filter(p => !responded.has(p));
            let toKick = [];

            if (didNotAnswer.length > 0) {
                toKick = didNotAnswer;
            } else {
                const sorted = [...responded.entries()].sort((a, b) => b[1] - a[1]);
                toKick = [sorted[0][0]];
            }

            if (toKick.length > 0) {
                // تنفيذ الطرد
                for (const jid of toKick) {
                    await sock.groupParticipantsUpdate(chatId, [jid], 'remove').catch(() => {});
                }

                const kickNames = toKick.map(p => `@${normalizeJid(p)}`).join(' ');
                await sock.sendMessage(chatId, { 
                    text: `☄️ *تم اختطاف اللاعب:* ${kickNames}`, 
                    mentions: toKick 
                });
                
                activePlayers = activePlayers.filter(p => !toKick.includes(p));
            } else {
                await sock.sendMessage(chatId, { text: `✅ _نجا الجميع في هذه الجولة._` });
            }

            if (activePlayers.length <= 1) break;
            await sleep(5000);
            session.round++;
        }

        if (activePlayers.length === 1) {
            const winner = activePlayers[0];
            await sock.sendMessage(chatId, {
                text: `🏆 *انتهت اللعبة*\n\n_الفائز هو:_ *@${normalizeJid(winner)}*`,
                mentions: [winner]
            });
        }

    } catch (err) {
        console.error(err);
    } finally {
        activeGames.delete(chatId);
    }
}

export default { NovaUltra, execute };
