// ─── Protection + Handlers ───
import {
    sleep, react, reactWait, reactOk, reactFail, reactInput,
    normalizeJid, getBotJid, checkElite,
    resolveTarget, pinMessage,
    readJSON, writeJSON, readJSONSync, writeJSONSync, atomicWrite,
    readProt, writeProt, readStats, writeStats,
    readBanned, isBanned, addBan, removeBan, reloadBanCache,
    getAllPluginFiles, getPluginInfo, updatePluginField, findPluginByCmd,
    quickLint, checkPluginSyntax,
    isGroupAdmin, isBotGroupAdmin, getGroupAdminInfo,
    grpFile, DATA_DIR, PLUGINS_DIR, BOT_DIR, PROT_FILE, STATS_FILE,
    BAN_FILE, PLUGINS_CFG_FILE, _eliteProPath,
    activeSessions, MAIN_MENU,
    registerDeleteListener, registerWelcomeListener, isRateLimited,
    configObj,
} from './_utils.js';
import { loadPlugins } from '../../../handlers/plugins.js';
import path from 'path';
import fs from 'fs-extra';

async function protectionHandler(sock, msg) {
    try {
        registerDeleteListener(sock);
        registerWelcomeListener(sock);
        registerBanListener(sock);
        cacheMessage(msg);

        const prot    = readProt();
        const chatId  = msg.key.remoteJid;
        const isGroup = chatId.endsWith('@g.us');

        // ☑️ FIX-4: اكتشاف الحذف عبر protocolMessage أيضاً (belt & suspenders)
        if (msg.message?.protocolMessage?.type === 0) {
            const deletedKey = msg.message.protocolMessage.key;
            if (deletedKey && prot.antiDelete === 'on' && !msg.key.fromMe) {
                await antiDeleteHandler(sock, [deletedKey]);
            }
            return;
        }

        // ☑️ FIX-3: استخراج النص من كل أنواع الرسائل
        const text = getAllMsgText(msg);

        // ── antiPrivate — مبني على مضاد-الخاص.js ──
        if (prot.antiPrivate === 'on' && !isGroup && !msg.key.fromMe) {
            const senderNum   = normalizeJid(chatId);
            const cooldownKey = senderNum;
            const now         = Date.now();
            if ((_pvtCooldown.get(cooldownKey) || 0) > now) return;
            _pvtCooldown.set(cooldownKey, now + 60_000);

            const warnText =
`❍━═━═━═━═━═━═━❍
❍⇇ ممنوع الكلام في الخاص
❍
❍⇇ تم حظرك تلقائياً
❍⇇ مضاد الخاص مفعّل
❍━═━═━═━═━═━═━❍`;

            try {
                await sock.sendMessage(chatId, { text: warnText }, { quoted: msg });
                await sleep(2000); // ← 2 ثانية لضمان وصول الرسالة قبل الحظر
            } catch (e) { if (e?.message) console.error('[catch]', e.message); }

            // حظر مع fallback (مضاد-الخاص.js يجرب 'block' ثم true)
            try { await sock.updateBlockStatus(chatId, 'block'); }
            catch {
                try { await sock.updateBlockStatus(chatId, true); }
                catch (e) { console.error('[antiPrivate] فشل الحظر:', e.message); }
            }

            // إشعار الأونر (من config — ليس sock.user)
            try {
                const ownerNum = normalizeJid(global._botConfig?.owner || '');
                const ownerJid = ownerNum ? ownerNum + '@s.whatsapp.net' : null;
                if (ownerJid && ownerJid !== chatId) {
                    await sock.sendMessage(ownerJid, {
                        text: `🔒 *مضاد الخاص*\nتم حظر شخص\nالرقم: wa.me/${senderNum}`,
                    });
                }
            } catch (e) { if (e?.message) console.error('[catch]', e.message); }
            return;
        }

        // ── antiCrash ──
        if (prot.antiCrash === 'on' && isGroup) {
            for (const p of CRASH_PATTERNS) {
                if (p.test(text)) {
                    try { await sock.sendMessage(chatId, { delete: msg.key }); } catch (e) { if (e?.message) console.error('[catch]', e.message); }
                    return;
                }
            }
        }

        // ── antiLink — حذف + تحذير 3 مرات ثم طرد ──
        if (prot.antiLink === 'on' && isGroup && hasLink(text)) {
            if (!msg.key.fromMe) {
                const senderRaw = msg.key.participant || '';
                const { isAdmin } = await getGroupAdminInfo(sock, chatId, senderRaw);
                if (!isAdmin) {
                    try {
                        await sock.sendMessage(chatId, { delete: msg.key });
                    } catch (e) {
                        await sock.sendMessage(chatId, {
                            text: `⚠️ @${normalizeJid(senderRaw)} ممنوع نشر الروابط\n❌ البوت يحتاج صلاحيات مشرف للحذف`,
                            mentions: [senderRaw],
                        }).catch(() => {});
                        return;
                    }
                    if (!prot.linkWarns)           prot.linkWarns = {};
                    if (!prot.linkWarns[chatId])   prot.linkWarns[chatId] = {};
                    prot.linkWarns[chatId][senderRaw] = (prot.linkWarns[chatId][senderRaw] || 0) + 1;
                    const w = prot.linkWarns[chatId][senderRaw];
                    if (w >= 3) {
                        prot.linkWarns[chatId][senderRaw] = 0;
                        writeProt(prot);
                        await sock.sendMessage(chatId, {
                            text: `⛔ @${normalizeJid(senderRaw)} تم طرده بسبب نشر الروابط (3/3)`,
                            mentions: [senderRaw],
                        });
                        try { await sock.groupParticipantsUpdate(chatId, [senderRaw], 'remove'); } catch (e) { if (e?.message) console.error('[catch]', e.message); }
                    } else {
                        writeProt(prot);
                        await sock.sendMessage(chatId, {
                            text: `⚠️ @${normalizeJid(senderRaw)} تحذير ${w}/3 — ممنوع نشر الروابط`,
                            mentions: [senderRaw],
                        });
                    }
                }
            }
        }


        // ── antiInsult ──
        if (prot.antiInsult === 'on') {
            if (containsInsult(text)) {
                try { await sock.sendMessage(chatId, { delete: msg.key }); } catch (e) { if (e?.message) console.error('[catch]', e.message); }
                if (isGroup && !msg.key.fromMe) {
                    const senderRaw = msg.key.participant || '';
                    const isAdmin   = await isGroupAdmin(sock, chatId, senderRaw);
                    if (!isAdmin) {
                        if (!prot.insultWarns)          prot.insultWarns = {};
                        if (!prot.insultWarns[chatId])  prot.insultWarns[chatId] = {};
                        prot.insultWarns[chatId][senderRaw] = (prot.insultWarns[chatId][senderRaw] || 0) + 1;
                        const w = prot.insultWarns[chatId][senderRaw];
                        if (w >= 3) {
                            prot.insultWarns[chatId][senderRaw] = 0;
                            writeProt(prot);
                            await sock.sendMessage(chatId, {
                                text: `⛔ @${normalizeJid(senderRaw)} تم طرده بسبب الشتائم (3/3)`,
                                mentions: [senderRaw],
                            });
                            try { await sock.groupParticipantsUpdate(chatId, [senderRaw], 'remove'); } catch (e) { if (e?.message) console.error('[catch]', e.message); }
                        } else {
                            writeProt(prot);
                            await sock.sendMessage(chatId, {
                                text: `⚠️ @${normalizeJid(senderRaw)} تحذير ${w}/3 — ممنوع الشتم`,
                                mentions: [senderRaw],
                            });
                        }
                    }
                }
                return;
            }
        }



        // ── قفل الصور — try delete immediately ──
        if (prot.images === 'on' && isGroup && !msg.key.fromMe && msg.message?.imageMessage) {
            try { await sock.sendMessage(chatId, { delete: msg.key }); } catch (e) { if (e?.message) console.error('[catch]', e.message); }
        }

        // ── قفل الفيديو ──
        if (prot.videos === 'on' && isGroup && !msg.key.fromMe && msg.message?.videoMessage) {
            try { await sock.sendMessage(chatId, { delete: msg.key }); } catch (e) { if (e?.message) console.error('[catch]', e.message); }
        }

        // ── قفل البوتات ──
        if (prot.bots === 'on' && isGroup && !msg.key.fromMe) {
            const m2 = msg.message;
            const botMsg = m2?.buttonsMessage || m2?.listMessage ||
                           m2?.templateMessage || m2?.interactiveMessage;
            if (botMsg) { try { await sock.sendMessage(chatId, { delete: msg.key }); } catch (e) { if (e?.message) console.error('[catch]', e.message); } }
        }

    } catch (e) { console.error('[protectionHandler]', e.message); }
}
protectionHandler._src = 'protection_system';

// ══════════════════════════════════════════════════════════════
//  ☑️ FIX-4: antiDeleteHandler — يعرض النوع + المحتوى + منشن
// ══════════════════════════════════════════════════════════════
async function antiDeleteHandler(sock, keys) {
    try {
        if (readProt().antiDelete !== 'on') return;
        for (const key of keys) {
            try {
                // تجاهل حذف رسائل البوت نفسه
                if (key.fromMe) continue;

                const cached = messageCache.get(key.id);
                const chatId = key.remoteJid;
                const sender = key.participant || key.remoteJid;

                if (!chatId || !sender) continue;

                // بناء رسالة الإشعار
                const senderMention = sender.includes('@') ? sender : sender + '@s.whatsapp.net';
                let notice = `🗑️ *تم حذف رسالة!*\n`;
                notice += `👤 @${normalizeJid(senderMention)}`;

                if (cached) {
                    notice += `\n📌 *النوع:* ${cached.type}`;
                    if (cached.text && cached.text.trim()) {
                        // اقتصار على 500 حرف
                        const preview = cached.text.trim().slice(0, 500);
                        notice += `\n💬 *المحتوى:*\n${preview}${cached.text.length > 500 ? '...' : ''}`;
                    }
                } else {
                    // إذا لم تكن في الكاش (رسالة قديمة قبل تشغيل البوت)
                    notice += `\n📌 *النوع:* رسالة قديمة`;
                }

                await sock.sendMessage(chatId, {
                    text: notice,
                    mentions: [senderMention],
                });
            } catch (e) { if (e?.message) console.error('[catch]', e.message); }
        }
    } catch (e) { console.error('[antiDeleteHandler]', e.message); }
}
antiDeleteHandler._src = 'antiDelete_system';

// ══════════════════════════════════════════════════════════════
//  statsAutoHandler
// ══════════════════════════════════════════════════════════════
async function statsAutoHandler(sock, msg) {
    if (msg._botBanned) return;  // مبند — تجاهل
    try {
        const pfx  = global._botConfig?.prefix || '.';
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        if (!text.startsWith(pfx)) return;
        const cmd = text.slice(pfx.length).split(/\s+/)[0]?.toLowerCase();
        if (!cmd) return;

        // ── نستخدم msg.sender.pn (phone JID من messages.js) لو متاح
        // وإلا نحاول نحوّل الـ LID لرقم عبر normalizeJid
        const senderRaw = msg.sender?.pn          // phone JID الصحيح (من messages.js)
                       || msg.key.participant
                       || msg.key.remoteJid;
        if (!senderRaw) return;

        // نضمن أن المفتاح المحفوظ دائماً phone JID وليس LID
        const sender = senderRaw.endsWith('@s.whatsapp.net')
            ? senderRaw
            : normalizeJid(senderRaw) + '@s.whatsapp.net';

        const stats = readStats();
        stats.total = (stats.total || 0) + 1;
        stats.commands[cmd] = (stats.commands[cmd] || 0) + 1;
        stats.users[sender] = (stats.users[sender] || 0) + 1;
        writeStats(stats);
    } catch (e) { console.error('[statsHandler]', e.message); }
}
statsAutoHandler._src = 'stats_system';

// ══════════════════════════════════════════════════════════════
//  slash command handler — /امر مباشر
//  يعمل في أي وقت داخل جلسة أو خارجها بأولوية عليا
//
//  الأوامر:
//  /رفع /تنزيل /طرد /حظر /فك حظر /كتم /فك كتم /مشرفين
//  /مسح /تثبيت /فك تثبيت
//  /قفل /فتح /رابط /انضم /خروج /اسم /وصف /معلومات
//  /ترحيب [نص|عرض|حذف]   /قوانين [نص|عرض|حذف]
//  /نخبة [اضف|ازل|عرض|مسح]
//  /انتي كراش  /انتي لينكات  /انتي حذف  /انتي سب  /انتي خاص  /view once
//  /قفل روابط  /قفل صور  /قفل فيديو  /قفل بوتات
//  /تحميل /تحميل صوت /تحديث /مسح كاش /اذاعة /احصاءات /تغيير اسم
//  /؟  /مساعدة
// ══════════════════════════════════════════════════════════════

const SLASH = '/';

const _SLASH_PROT = {
    'انتي كراش':   'antiCrash',
    'انتي لينكات': 'antiLink',
    'انتي حذف':    'antiDelete',
    'انتي سب':     'antiInsult',
    'view once':   'antiViewOnce',
    'انتي خاص':    'antiPrivate',
};

const _SLASH_LOCK = {
    'قفل روابط': 'antiLink',
    'قفل صور':   'images',
    'قفل فيديو': 'videos',
    'قفل بوتات': 'bots',
};

const SLASH_HELP =
`✧━── ❝ 𝐒𝐋𝐀𝐒𝐇 𝐂𝐌𝐃𝐒 ❞ ──━✧

*👥 الأعضاء:*
\`/رفع\` \`/تنزيل\` \`/طرد\`
\`/بان\` \`/فك بان\` \`/محظورين\`
\`/كتم [دقائق]\` \`/فك كتم\` \`/مشرفين\`

*💬 الرسائل:*
\`/مسح\` \`/تثبيت\` \`/فك تثبيت\`

*⚙️ المجموعة:*
\`/قفل\` \`/فتح\` \`/رابط\`
\`/انضم [رابط]\` \`/خروج\`
\`/اسم [نص]\` \`/وصف [نص]\` \`/معلومات\`
\`/صورة\` (رد على صورة — يغير صورة المجموعة)

*📋 المحتوى:*
\`/ترحيب [نص]\` \`/ترحيب عرض\` \`/ترحيب حذف\`
\`/قوانين [نص]\` \`/قوانين عرض\` \`/قوانين حذف\`
\`/كلمات عرض\` \`/كلمات اضف [كلمة]\` \`/كلمات حذف [كلمة]\`

*♦️ النخبة:*
\`/نخبة اضف\` \`/نخبة ازل\` \`/نخبة عرض\` \`/نخبة مسح\`

*🛡️ الحماية (toggle):*
\`/انتي كراش\` \`/انتي لينكات\` \`/انتي حذف\`
\`/انتي سب\` \`/انتي خاص\` \`/view once\`

*🔒 قفل المحتوى (toggle):*
\`/قفل روابط\` \`/قفل صور\` \`/قفل فيديو\` \`/قفل بوتات\`

*🤖 البوت:*
\`/اسم بوت [اسم]\` \`/وصف بوت [نص]\`
\`/صورة بوت\` (رد على صورة)
\`/بلوك [رقم/منشن]\` \`/فك بلوك [رقم/منشن]\`
\`/مجموعاتي\` \`/خاص\`

*🔧 أدوات:*
\`/تحميل [رابط]\` \`/تحميل صوت [رابط]\`
\`/تحديث\` \`/مسح كاش\`
\`/اذاعة [نص]\` \`/احصاءات\`
\`/تغيير اسم [قديم] [جديد]\`

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`;

// تأكيدات معلقة (خروج / مسح نخبة)
const _slashPending = new Map();

async function slashCommandHandler(sock, msg) {
    if (msg._botBanned) return;  // مبند — تجاهل
    try {
        const raw = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const text = raw.trim();
        if (!text.startsWith(SLASH)) return;

        const chatId    = msg.key.remoteJid;
        const isGroup   = chatId.endsWith('@g.us');
        const senderRaw = msg.key.participant || chatId;

        // ── فحص النخبة — دالة مشتركة ──
        if (!(await checkElite(sock, msg))) return;

        const body      = text.slice(SLASH.length).trim();
        const parts     = body.split(/\s+/);
        const cmd       = parts[0] || '';
        const twoWord   = parts.slice(0, 2).join(' ');
        const threeWord = parts.slice(0, 3).join(' ');
        const rest      = parts.slice(1).join(' ').trim();
        const rest2     = parts.slice(2).join(' ').trim();

        const reply  = t => sock.sendMessage(chatId, { text: t }, { quoted: msg }).catch(() => {});
        const replyM = (t, mentions) => sock.sendMessage(chatId, { text: t, mentions }, { quoted: msg }).catch(() => {});

        // صلاحيات مجموعة مع LID
        const getPerms = async () => {
            if (!isGroup) return { isGroup: false, isAdmin: false, isBotAdmin: false, meta: null };
            try {
                const meta      = await sock.groupMetadata(chatId);
                const senderNum = normalizeJid(senderRaw);
                const botNum    = normalizeJid(getBotJid(sock));
                const adminNums = new Set(
                    meta.participants
                        .filter(p => p.admin)
                        .flatMap(p => [normalizeJid(p.id), normalizeJid(p.lid || '')])
                        .filter(Boolean)
                );
                return {
                    meta,
                    isGroup:    true,
                    isAdmin:    msg.key.fromMe || adminNums.has(senderNum),
                    isBotAdmin: adminNums.has(botNum),
                };
            } catch { return { isGroup: true, isAdmin: false, isBotAdmin: false, meta: null }; }
        };

        const tryDo = async (fn, emoji = '☑️') => {
            try { await fn(); react(sock, msg, emoji); return true; }
            catch (e) {
                const { isGroup: ig, isAdmin, isBotAdmin } = await getPerms();
                if (!ig)         { await reply('❌ هذا الامر للمجموعات فقط.'); return false; }
                if (!isBotAdmin) { await reply('❌ البوت ليس مشرفاً.'); return false; }
                if (!isAdmin)    { await reply('❌ انت لست مشرفاً.'); return false; }
                await reply('❌ فشل: ' + (e?.message || e));
                return false;
            }
        };

        // resolveTarget يدعم منشن/رد/رقم مكتوب
        const resolveSlashTarget = async () => {
            const t = await resolveTarget(sock, chatId, msg);
            if (t) return t;
            const num = rest.replace(/\D/g, '');
            if (num.length >= 9) {
                try {
                    const check = await sock.onWhatsApp(num + '@s.whatsapp.net');
                    if (check?.[0]?.exists) return check[0].jid;
                    return num + '@s.whatsapp.net';
                } catch { return num + '@s.whatsapp.net'; }
            }
            return null;
        };

        // resolvePhoneJid — يحوّل أي JID (حتى LID) لـ phone@s.whatsapp.net
        // مطلوب لـ updateBlockStatus الذي يقبل phone فقط
        const resolvePhoneJid = async (rawJid) => {
            if (!rawJid) return null;
            // phone مباشرة
            if (rawJid.endsWith('@s.whatsapp.net')) return rawJid;
            // LID → twice map أولاً
            try {
                const _ep = JSON.parse(fs.readFileSync(path.join(BOT_DIR, '../../handlers/elite-pro.json'), 'utf8'));
                const mapped = (_ep.twice || {})[rawJid];
                if (mapped && mapped.endsWith('@s.whatsapp.net')) return mapped;
            } catch {}
            // sock.onWhatsApp للتحقق
            const num = normalizeJid(rawJid);
            if (num.length >= 7) {
                try {
                    const check = await sock.onWhatsApp(num + '@s.whatsapp.net');
                    if (check?.[0]?.exists) return check[0].jid;
                } catch {}
                return num + '@s.whatsapp.net';
            }
            return null;
        };

        // ══════════════════════════════════════════════════
        // /؟  /مساعدة
        // ══════════════════════════════════════════════════
        if (cmd === '؟' || cmd === 'مساعدة') {
            await reply(SLASH_HELP);
            return;
        }

        // ══════════════════════════════════════════════════
        // إدارة الأعضاء
        // ══════════════════════════════════════════════════
        if (cmd === 'رفع') {
            const target = await resolveSlashTarget();
            if (!target) return reply('↩️ منشن العضو أو رد على رسالته أو اكتب رقمه.');
            await tryDo(() => sock.groupParticipantsUpdate(chatId, [target], 'promote'), '⬆️');
            return;
        }

        if (cmd === 'تنزيل' && !rest.startsWith('http')) {
            const target = await resolveSlashTarget();
            if (!target) return reply('↩️ منشن العضو أو رد على رسالته أو اكتب رقمه.');
            await tryDo(() => sock.groupParticipantsUpdate(chatId, [target], 'demote'), '⬇️');
            return;
        }

        if (cmd === 'طرد') {
            const target = await resolveSlashTarget();
            if (!target) return reply('↩️ منشن العضو أو رد على رسالته أو اكتب رقمه.');
            await tryDo(() => sock.groupParticipantsUpdate(chatId, [target], 'remove'), '🚪');
            return;
        }

        if (cmd === 'حظر') {
            const target = await resolveSlashTarget();
            if (!target) return reply('↩️ منشن العضو أو رد على رسالته أو اكتب رقمه.');
            await tryDo(async () => {
                await sock.groupParticipantsUpdate(chatId, [target], 'remove');
                const bans = readJSON(grpFile('bans', chatId), []);
                const tN = normalizeJid(target);
                if (!bans.some(b => normalizeJid(b) === tN)) { bans.push(target); writeJSON(grpFile('bans', chatId), bans); }
                await replyM('⛔ تم حظر @' + tN + ' من المجموعة', [target]);
            }, '🔨');
            return;
        }

        if (twoWord === 'فك حظر') {
            const target = await resolveSlashTarget();
            if (!target) return reply('↩️ منشن العضو أو اكتب رقمه.');
            const tN2 = normalizeJid(target);
            const bf  = grpFile('bans', chatId);
            writeJSON(bf, readJSON(bf, []).filter(b => normalizeJid(b) !== tN2));
            reactOk(sock, msg);
            await replyM('☑️ تم رفع الحظر عن @' + tN2, [target]);
            return;
        }

        // /بان — بان البوت
        if (cmd === 'بان') {
            const target = await resolveSlashTarget();
            if (!target) return reply('↩️ منشن الشخص أو رد على رسالته أو اكتب رقمه.');
            addBan(target);
            reactOk(sock, msg);
            await replyM('🚫 *تم إعطاء بان*\n@' + normalizeJid(target) + '\n_البوت سيتجاهل أوامره الآن_', [target]);
            return;
        }

        // /فك بان
        if (twoWord === 'فك بان') {
            const target = await resolveSlashTarget();
            if (!target) return reply('↩️ منشن الشخص أو رد على رسالته أو اكتب رقمه.');
            removeBan(target);
            reactOk(sock, msg);
            await replyM('☑️ *تم إزالة البان*\n@' + normalizeJid(target) + '\n_يمكنه الآن استخدام البوت_', [target]);
            return;
        }

        // /محظورين — عرض قائمة المبندين
        if (cmd === 'محظورين') {
            const banned = readBanned();
            if (!banned.length) return reply('📭 لا يوجد أحد في القائمة السوداء.');
            const list = banned.map((j, i) => (i+1) + '. @' + normalizeJid(j)).join('\n');
            await replyM(
                '🚫 *قائمة البان (' + banned.length + '):*\n\n' + list,
                banned.filter(j => j.endsWith('@s.whatsapp.net'))
            );
            return;
        }

        if (cmd === 'كتم') {
            const target = await resolveSlashTarget();
            if (!target) return reply('↩️ منشن العضو أو رد على رسالته.\nمثال: /كتم 30 ثم منشن');
            const mins = parseInt(rest.replace(/\D/g, '') || '30') || 30;
            await tryDo(async () => {
                await sock.groupParticipantsUpdate(chatId, [target], 'demote');
                await replyM('🔇 تم كتم @' + normalizeJid(target) + ' لمدة ' + mins + ' دقيقة', [target]);
                setTimeout(async () => {
                    try { await sock.groupParticipantsUpdate(chatId, [target], 'promote'); } catch (e) { if (e?.message) console.error('[catch]', e.message); }
                }, mins * 60_000);
            }, '🔇');
            return;
        }

        if (twoWord === 'فك كتم') {
            const target = await resolveSlashTarget();
            if (!target) return reply('↩️ منشن العضو أو رد على رسالته.');
            await tryDo(() => sock.groupParticipantsUpdate(chatId, [target], 'promote'), '🔊');
            return;
        }

        if (cmd === 'مشرفين') {
            try {
                const { meta } = await getPerms();
                if (!meta) return reply('❌ تعذر جلب البيانات.');
                const admins = meta.participants.filter(p => p.admin);
                if (!admins.length) return reply('📭 لا يوجد مشرفين.');
                const list = admins.map((a, i) =>
                    (i+1) + '. @' + normalizeJid(a.id) + (a.admin === 'superadmin' ? ' 🔝' : '')
                ).join('\n');
                await replyM('⬆️ *المشرفون (' + admins.length + '):*\n\n' + list, admins.map(a => a.id));
            } catch (e) { await reply('❌ ' + e?.message); }
            return;
        }

        // ══════════════════════════════════════════════════
        // الرسائل
        // ══════════════════════════════════════════════════
        if (cmd === 'مسح' && !rest) {
            const ctx = msg.message?.extendedTextMessage?.contextInfo;
            if (!ctx?.stanzaId) return reply('↩️ رد على الرسالة اللي تبي تمسحها.');
            await tryDo(() => sock.sendMessage(chatId, { delete: {
                remoteJid: chatId, id: ctx.stanzaId,
                participant: ctx.participant, fromMe: false,
            }}), '🗑️');
            return;
        }

        if (cmd === 'تثبيت') {
            const ctx = msg.message?.extendedTextMessage?.contextInfo;
            if (!ctx?.stanzaId) return reply('↩️ رد على الرسالة اللي تبي تثبتها.');
            reactWait(sock, msg);
            try {
                await pinMessage(sock, chatId, ctx.stanzaId, ctx.participant, true);
                reactOk(sock, msg);
            } catch (e) {
                reactFail(sock, msg);
                await reply('❌ ' + (e?.message?.includes('admin') ? 'البوت يحتاج صلاحيات مشرف.' : (e?.message || 'فشل').slice(0,100)));
            }
            return;
        }

        if (twoWord === 'فك تثبيت') {
            const ctx = msg.message?.extendedTextMessage?.contextInfo;
            if (!ctx?.stanzaId) return reply('↩️ رد على الرسالة المثبتة.');
            reactWait(sock, msg);
            try {
                await pinMessage(sock, chatId, ctx.stanzaId, ctx.participant, false);
                reactOk(sock, msg);
            } catch (e) { reactFail(sock, msg); await reply('❌ ' + (e?.message || '').slice(0,100)); }
            return;
        }

        // ══════════════════════════════════════════════════
        // إعدادات المجموعة
        // ══════════════════════════════════════════════════
        if (cmd === 'قفل' && !rest) {
            await tryDo(() => sock.groupSettingUpdate(chatId, 'announcement'), '🔒');
            return;
        }

        if (cmd === 'فتح' && !rest) {
            await tryDo(() => sock.groupSettingUpdate(chatId, 'not_announcement'), '🔓');
            return;
        }

        if (cmd === 'رابط') {
            try {
                const code = await sock.groupInviteCode(chatId);
                await reply('🔗 *رابط المجموعة:*\nhttps://chat.whatsapp.com/' + code);
            } catch (e) { await reply('❌ ' + e?.message); }
            return;
        }

        if (cmd === 'انضم' && rest) {
            const match = rest.match(/chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/i);
            if (!match) return reply('❌ رابط غير صحيح.\nمثال: /انضم https://chat.whatsapp.com/XXX');
            reactWait(sock, msg);
            try { await sock.groupAcceptInvite(match[1]); reactOk(sock, msg); await reply('☑️ تم الانضمام.'); }
            catch (e) { reactFail(sock, msg); await reply('❌ ' + e?.message); }
            return;
        }

        // /خروج مع تأكيد
        if (cmd === 'خروج') {
            const pk = 'leave_' + chatId;
            if (_slashPending.get(pk)) {
                _slashPending.delete(pk);
                try { await sock.groupLeave(chatId); reactOk(sock, msg); }
                catch (e) { await reply('❌ ' + e?.message); }
            } else {
                _slashPending.set(pk, true);
                setTimeout(() => _slashPending.delete(pk), 15_000);
                await reply('⚠️ تأكيد الخروج؟\nاكتب /خروج مرة ثانية خلال 15 ثانية.');
            }
            return;
        }

        if (cmd === 'اسم' && rest) {
            reactWait(sock, msg);
            await tryDo(() => sock.groupUpdateSubject(chatId, rest), '☑️');
            return;
        }

        if (cmd === 'وصف' && rest) {
            reactWait(sock, msg);
            await tryDo(() => sock.groupUpdateDescription(chatId, rest), '☑️');
            return;
        }

        if (cmd === 'معلومات') {
            try {
                const { meta } = await getPerms();
                if (!meta) return reply('❌ تعذر جلب المعلومات.');
                await reply(
                    '📊 *معلومات المجموعة:*\n\n' +
                    '📌 *الاسم:* ' + meta.subject + '\n' +
                    '👥 *الأعضاء:* ' + meta.participants.length + '\n' +
                    '🔝 *المشرفون:* ' + meta.participants.filter(p => p.admin).length + '\n' +
                    '🆔 *ID:* ' + chatId.split('@')[0] + '\n' +
                    '📅 *الإنشاء:* ' + new Date(meta.creation * 1000).toLocaleDateString('ar')
                );
            } catch (e) { await reply('❌ ' + e?.message); }
            return;
        }

        // ══════════════════════════════════════════════════
        // المحتوى — ترحيب وقوانين
        // ══════════════════════════════════════════════════
        if (cmd === 'ترحيب') {
            const wf = grpFile('welcome', chatId);
            if (rest === 'عرض') {
                if (!fs.existsSync(wf)) return reply('❌ لم يُضبط ترحيب بعد.');
                const { text: wt } = readJSON(wf, {});
                return reply('📋 *رسالة الترحيب:*\n\n' + wt);
            }
            if (rest === 'حذف') {
                try { fs.removeSync(wf); reactOk(sock, msg); await reply('☑️ تم حذف رسالة الترحيب.'); }
                catch (e) { await reply('❌ ' + e?.message); }
                return;
            }
            if (rest) {
                writeJSON(wf, { text: rest });
                reactOk(sock, msg);
                await reply('☑️ تم حفظ رسالة الترحيب.\nاستخدم {name} للاسم و {number} للرقم.');
                return;
            }
            return reply('📖 الاستخدام:\n/ترحيب [نص]  — ضبط\n/ترحيب عرض  — عرض\n/ترحيب حذف  — حذف');
        }

        if (cmd === 'قوانين') {
            const rf = grpFile('rules', chatId);
            if (rest === 'عرض') {
                if (!fs.existsSync(rf)) return reply('❌ لم تُضبط قوانين بعد.');
                const { text: rt } = readJSON(rf, {});
                return reply('📜 *قوانين المجموعة:*\n\n' + rt);
            }
            if (rest === 'حذف') {
                try { fs.removeSync(rf); reactOk(sock, msg); await reply('☑️ تم حذف القوانين.'); }
                catch (e) { await reply('❌ ' + e?.message); }
                return;
            }
            if (rest) {
                writeJSON(rf, { text: rest });
                reactOk(sock, msg);
                await reply('☑️ تم حفظ القوانين.');
                return;
            }
            return reply('📖 الاستخدام:\n/قوانين [نص]  — ضبط\n/قوانين عرض  — عرض\n/قوانين حذف  — حذف');
        }

        // ══════════════════════════════════════════════════
        // إدارة النخبة
        // ══════════════════════════════════════════════════
        if (cmd === 'نخبة') {
            const ctx = msg.message?.extendedTextMessage?.contextInfo;

            if (rest === 'عرض') {
                try {
                    const elites = sock.getElites?.() || [];
                    if (!elites.length) return reply('📋 قائمة النخبة فارغة.');
                    const list = elites.map((id, i) => (i+1) + '. @' + normalizeJid(id)).join('\n');
                    await replyM('♦️ *قائمة النخبة (' + elites.length + '):*\n\n' + list, elites);
                } catch (e) { await reply('❌ ' + e?.message); }
                return;
            }

            if (rest === 'مسح') {
                const pk = 'elite_clear_' + senderRaw;
                if (_slashPending.get(pk)) {
                    _slashPending.delete(pk);
                    try { await sock.eliteReset?.({ sock }); reactOk(sock, msg); await reply('☑️ تم مسح قائمة النخبة.'); }
                    catch (e) { await reply('❌ ' + e?.message); }
                } else {
                    _slashPending.set(pk, true);
                    setTimeout(() => _slashPending.delete(pk), 15_000);
                    await reply('⚠️ تأكيد مسح قائمة النخبة؟\nاكتب /نخبة مسح مرة ثانية خلال 15 ثانية.');
                }
                return;
            }

            const isAdd = rest.startsWith('اضف');
            const isRem = rest.startsWith('ازل');
            if (isAdd || isRem) {
                let ids = ctx?.mentionedJid?.length ? ctx.mentionedJid
                        : ctx?.participant ? [ctx.participant]
                        : [];
                if (!ids.length) {
                    const num = rest2.replace(/\D/g, '');
                    if (num.length >= 9) {
                        try {
                            const check = await sock.onWhatsApp(num + '@s.whatsapp.net');
                            ids = [check?.[0]?.jid || num + '@s.whatsapp.net'];
                        } catch { ids = [num + '@s.whatsapp.net']; }
                    }
                }
                if (!ids.length) return reply('↩️ منشن الشخص أو رد على رسالته أو اكتب رقمه.');
                try {
                    if (isAdd) {
                        const res = await sock.addElite({ sock, ids });
                        let out = '*إضافة النخبة*\n\n';
                        if (res?.success?.length) out += '☑️ ' + res.success.map(u => '@' + normalizeJid(u.id)).join(', ') + ' تمت الإضافة\n';
                        if (res?.fail?.length)    out += '⚠️ ' + res.fail.map(u => '@' + normalizeJid(u.id) + ' (' + (u.error === 'exist_already' ? 'موجود مسبقاً' : u.error) + ')').join(', ');
                        await reply(out.trim());
                    } else {
                        const res = await sock.rmElite({ sock, ids });
                        let out = '*إزالة النخبة*\n\n';
                        if (res?.success?.length) out += '☑️ ' + res.success.map(u => '@' + normalizeJid(u.id)).join(', ') + ' تمت الإزالة\n';
                        if (res?.fail?.length)    out += '⚠️ ' + res.fail.map(u => '@' + normalizeJid(u.id) + ' (' + (u.error === 'not_exist' ? 'ليس نخبة أصلاً' : u.error) + ')').join(', ');
                        await reply(out.trim());
                    }
                } catch (e) { await reply('❌ ' + e?.message); }
                return;
            }

            return reply('📖 الاستخدام:\n/نخبة اضف  /نخبة ازل  /نخبة عرض  /نخبة مسح');
        }

        // ══════════════════════════════════════════════════
        // الحماية — toggle
        // ══════════════════════════════════════════════════
        const protKey = _SLASH_PROT[twoWord] || _SLASH_PROT[cmd];
        if (protKey) {
            const p = readProt();
            p[protKey] = p[protKey] === 'on' ? 'off' : 'on';
            writeProt(p);
            reactOk(sock, msg);
            await reply((p[protKey] === 'on' ? '☑️ شُغِّل' : '⛔ أُوقف') + ': *' + (twoWord || cmd) + '*');
            return;
        }

        // قفل المحتوى — toggle
        const lockKey = _SLASH_LOCK[twoWord];
        if (lockKey) {
            const p = readProt();
            p[lockKey] = p[lockKey] === 'on' ? 'off' : 'on';
            writeProt(p);
            reactOk(sock, msg);
            await reply((p[lockKey] === 'on' ? '🔒 شُغِّل' : '🔓 أُوقف') + ': *' + twoWord + '*');
            return;
        }

        // ══════════════════════════════════════════════════
        // أدوات
        // ══════════════════════════════════════════════════

        // /تحميل [رابط]  |  /تحميل صوت [رابط]
        if (cmd === 'تحميل') {
            const audioMode = rest.startsWith('صوت');
            const urlRaw    = audioMode ? parts.slice(2).join(' ').trim() : rest;
            const url       = urlRaw.match(/https?:\/\/[^\s]+/i)?.[0] ||
                              (urlRaw.startsWith('http') ? urlRaw : null);
            if (!url) return reply('📖 الاستخدام:\n/تحميل [رابط]\n/تحميل صوت [رابط]');
            const icon     = audioMode ? '🎵' : '🎬';
            const platform = detectPlatform(url) || 'رابط';
            reactWait(sock, msg);
            const stMsg = await sock.sendMessage(chatId,
                { text: icon + ' *جاري تحميل ' + platform + '...*' }, { quoted: msg });
            const upd = t => sock.sendMessage(chatId, { text: t, edit: stMsg.key }).catch(() => {});
            try {
                const { filePath, ext, cleanup } = await ytdlpDownload(url, { audio: audioMode });
                const fileSize = fs.statSync(filePath).size;
                const isVideo  = ['mp4','mkv','webm','mov','avi'].includes(ext);
                const isAudio  = ['mp3','m4a','ogg','aac','opus','wav'].includes(ext);
                const isImage  = ['jpg','jpeg','png','webp','gif'].includes(ext);
                if (fileSize > 150 * 1024 * 1024) { cleanup(); return upd('❌ الملف أكبر من 150MB.'); }
                const buffer = await fs.promises.readFile(filePath); cleanup();
                if (isVideo && fileSize > 70 * 1024 * 1024) {
                    await sock.sendMessage(chatId, {
                        document: buffer, mimetype: 'video/mp4',
                        fileName: platform + '_video.mp4',
                        caption: '📎 ' + platform + ' — مستند (' + (fileSize/1024/1024).toFixed(1) + 'MB)',
                    }, { quoted: msg });
                } else if (isVideo) {
                    await sock.sendMessage(chatId, { video: buffer, caption: icon + ' ' + platform }, { quoted: msg });
                } else if (isAudio) {
                    await sock.sendMessage(chatId, { audio: buffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                } else if (isImage) {
                    await sock.sendMessage(chatId, { image: buffer, caption: icon + ' ' + platform }, { quoted: msg });
                } else {
                    await sock.sendMessage(chatId, {
                        document: buffer, mimetype: 'application/octet-stream',
                        fileName: path.basename(filePath), caption: icon + ' ' + platform,
                    }, { quoted: msg });
                }
                reactOk(sock, msg); await upd('☑️ *تم التحميل!*');
            } catch (e) {
                reactFail(sock, msg);
                const em = e?.message || '';
                let hint = '';
                if (em.includes('غير مثبت') || em.includes('yt-dlp'))
                    hint = '\n💡 pip install -U yt-dlp';
                else if (em.includes('معدل الطلبات') || em.includes('429'))
                    hint = '\n⏳ حاول بعد دقيقتين.';
                else if (em.includes('خاص') || em.toLowerCase().includes('private'))
                    hint = '\n🔒 المحتوى خاص.';
                else if (em.includes('Unsupported URL'))
                    hint = '\n🔗 الرابط غير مدعوم.';
                await upd('❌ *فشل:*\n' + em.slice(0, 120) + hint);
            }
            return;
        }

        if (cmd === 'تحديث') {
            reactWait(sock, msg);
            try { await loadPlugins(); reactOk(sock, msg); await reply('☑️ تم تحديث الاوامر.'); }
            catch (e) { reactFail(sock, msg); await reply('❌ ' + e?.message); }
            return;
        }

        if (twoWord === 'مسح كاش') {
            reactWait(sock, msg);
            try {
                if (global._pluginsCache) global._pluginsCache = {};
                await loadPlugins().catch(() => {});
                reactOk(sock, msg); await reply('☑️ تم مسح الكاش.');
            } catch (e) { reactFail(sock, msg); await reply('❌ ' + e?.message); }
            return;
        }

        if (cmd === 'اذاعة' && rest) {
            reactWait(sock, msg);
            try {
                const chats = await sock.groupFetchAllParticipating();
                let sent = 0;
                for (const gid of Object.keys(chats)) {
                    try { await sock.sendMessage(gid, { text: rest }); sent++; } catch (e) { if (e?.message) console.error('[catch]', e.message); }
                    await sleep(500);
                }
                reactOk(sock, msg);
                await reply('☑️ تم الارسال لـ ' + sent + ' مجموعة.');
            } catch (e) { await reply('❌ ' + e?.message); }
            return;
        }

        if (cmd === 'احصاءات' || cmd === 'إحصاءات') {
            const s       = readStats();
            const topCmds = Object.entries(s.commands || {})
                .sort((a, b) => b[1] - a[1]).slice(0, 5)
                .map(([k, v], i) => (i+1) + '. ' + k + ': *' + v + '*').join('\n') || 'لا يوجد';
            const up = process.uptime();
            const h  = Math.floor(up/3600), mm = Math.floor((up%3600)/60), ss = Math.floor(up%60);
            await reply(
                '✧━── ❝ 𝐒𝐓𝐀𝐓𝐒 ❞ ──━✧\n\n' +
                '📨 الاوامر: *' + (s.total||0) + '*\n' +
                '⏱️ التشغيل: *' + h + 'h ' + mm + 'm ' + ss + 's*\n\n' +
                '🏆 *اكثر الاوامر:*\n' + topCmds + '\n\n' +
                '✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧'
            );
            return;
        }

        if (twoWord === 'تغيير اسم') {
            const oldName = parts[2];
            const newName = parts.slice(3).join(' ').trim();
            if (!oldName || !newName)
                return reply('📖 الاستخدام:\n/تغيير اسم [الامر_الحالي] [الاسم_الجديد]');
            reactWait(sock, msg);
            const fp = await findPluginByCmd(oldName);
            if (!fp) return reply('❌ ما وجدت أمر باسم: *' + oldName + '*');
            try {
                updatePluginField(fp, 'command', newName);
                await loadPlugins().catch(() => {});
                reactOk(sock, msg);
                await reply('☑️ تم تغيير: *' + oldName + '* ➔ *' + newName + '*');
            } catch (e) { reactFail(sock, msg); await reply('❌ ' + e?.message); }
            return;
        }

        // ══════════════════════════════════════════════════
        // أوامر البوت — تغيير الاسم والصورة والوصف
        // ══════════════════════════════════════════════════

        // /اسم بوت [الاسم الجديد]
        if (twoWord === 'اسم بوت') {
            if (!rest2) return reply('📖 الاستخدام: /اسم بوت [الاسم الجديد]');
            reactWait(sock, msg);
            try {
                await sock.updateProfileName(rest2.trim());
                reactOk(sock, msg);
                await reply('☑️ تم تغيير اسم البوت إلى: *' + rest2.trim() + '*');
            } catch (e) { reactFail(sock, msg); await reply('❌ ' + e?.message); }
            return;
        }

        // /وصف بوت [النص]
        if (twoWord === 'وصف بوت') {
            if (!rest2) return reply('📖 الاستخدام: /وصف بوت [النص]');
            reactWait(sock, msg);
            try {
                await sock.updateProfileStatus(rest2.trim());
                reactOk(sock, msg);
                await reply('☑️ تم تغيير وصف البوت.');
            } catch (e) { reactFail(sock, msg); await reply('❌ ' + e?.message); }
            return;
        }

        // /صورة بوت — رد على صورة لتغيير صورة البوت
        if (twoWord === 'صورة بوت') {
            const ctx2   = msg.message?.extendedTextMessage?.contextInfo;
            const imgMsg = msg.message?.imageMessage || ctx2?.quotedMessage?.imageMessage;
            if (!imgMsg) return reply('↩️ رد على صورة مع كتابة /صورة بوت');
            reactWait(sock, msg);
            try {
                const target2 = msg.message?.imageMessage
                    ? msg
                    : { message: ctx2.quotedMessage, key: { ...msg.key, id: ctx2.stanzaId, participant: ctx2.participant } };
                const buf = await downloadMediaMessage(target2, 'buffer', {});
                await sock.updateProfilePicture(getBotJid(sock), buf);
                reactOk(sock, msg);
                await reply('☑️ تم تغيير صورة البوت.');
            } catch (e) { reactFail(sock, msg); await reply('❌ ' + e?.message); }
            return;
        }

        // /صورة — تغيير صورة المجموعة (رد على صورة)
        if (cmd === 'صورة' && !rest) {
            const ctx2   = msg.message?.extendedTextMessage?.contextInfo;
            const imgMsg = msg.message?.imageMessage || ctx2?.quotedMessage?.imageMessage;
            if (!imgMsg) return reply('↩️ رد على صورة لتغيير صورة المجموعة.\nأو: /صورة بوت لتغيير صورة البوت.');
            reactWait(sock, msg);
            try {
                const target2 = msg.message?.imageMessage
                    ? msg
                    : { message: ctx2.quotedMessage, key: { ...msg.key, id: ctx2.stanzaId, participant: ctx2.participant } };
                const buf = await downloadMediaMessage(target2, 'buffer', {});
                await tryDo(() => sock.updateProfilePicture(chatId, buf), '☑️');
            } catch (e) { reactFail(sock, msg); await reply('❌ ' + e?.message); }
            return;
        }

        // /بلوك [رقم/منشن/رد] — حظر حساب واتساب
        if (cmd === 'بلوك') {
            const rawT = await resolveSlashTarget();
            if (!rawT) return reply('↩️ منشن الشخص أو رد على رسالته أو اكتب رقمه.');
            reactWait(sock, msg);
            const phoneJid = await resolvePhoneJid(rawT);
            if (!phoneJid) return reply('❌ تعذر تحديد رقم الهاتف.');
            try {
                await sock.updateBlockStatus(phoneJid, 'block');
                reactOk(sock, msg);
                await reply('🔒 تم حظر @' + normalizeJid(phoneJid) + ' من حساب البوت.');
            } catch (e) {
                reactFail(sock, msg);
                console.error('[/بلوك]', e.message);
                await reply('❌ فشل الحظر: ' + (e?.message || '').slice(0, 100));
            }
            return;
        }

        // /فك بلوك [رقم/منشن/رد]
        if (cmd === 'فك' && rest.startsWith('بلوك') || twoWord === 'فك بلوك' || cmd === 'فك-بلوك') {
            const rawT2 = await resolveSlashTarget();
            if (!rawT2) return reply('↩️ منشن الشخص أو رد على رسالته أو اكتب رقمه.');
            reactWait(sock, msg);
            const phoneJid2 = await resolvePhoneJid(rawT2);
            if (!phoneJid2) return reply('❌ تعذر تحديد رقم الهاتف.');
            try {
                await sock.updateBlockStatus(phoneJid2, 'unblock');
                reactOk(sock, msg);
                await reply('🔓 تم فك الحظر عن @' + normalizeJid(phoneJid2));
            } catch (e) {
                reactFail(sock, msg);
                await reply('❌ فشل: ' + (e?.message || '').slice(0, 100));
            }
            return;
        }

        // /كلمات عرض | /كلمات اضف [كلمة] | /كلمات حذف [كلمة]
        if (cmd === 'كلمات') {
            if (!isGroup) return reply('❌ هذا الامر للمجموعات فقط.');
            const bf = grpFile('badwords', chatId);
            let words = readJSON(bf, []);
            if (rest === 'عرض' || !rest) {
                const list = words.length ? words.map((w,i) => (i+1) + '. ' + w).join('\n') : 'لا يوجد كلمات ممنوعة.';
                return reply('🚫 *الكلمات الممنوعة:*\n\n' + list);
            }
            if (rest.startsWith('اضف ') || rest.startsWith('اضافة ')) {
                const w = rest.split(' ').slice(1).join(' ').trim().toLowerCase();
                if (!w) return reply('↩️ اكتب الكلمة: /كلمات اضف [كلمة]');
                if (!words.includes(w)) { words.push(w); writeJSON(bf, words); reactOk(sock, msg); }
                return reply('☑️ تمت الإضافة: ' + w);
            }
            if (rest.startsWith('حذف ') || rest.startsWith('ازل ')) {
                const w = rest.split(' ').slice(1).join(' ').trim().toLowerCase();
                if (!w) return reply('↩️ اكتب الكلمة: /كلمات حذف [كلمة]');
                writeJSON(bf, words.filter(x => x !== w));
                reactOk(sock, msg);
                return reply('☑️ تم الحذف: ' + w);
            }
            return reply('📖 الاستخدام:\n/كلمات عرض\n/كلمات اضف [كلمة]\n/كلمات حذف [كلمة]');
        }

        // /مجموعاتي — إحصاءات المجموعات
        if (cmd === 'مجموعاتي') {
            reactWait(sock, msg);
            try {
                const allGroups = await sock.groupFetchAllParticipating();
                const groups = Object.values(allGroups);
                if (!groups.length) return reply('📭 البوت ليس في أي مجموعة حالياً.');
                groups.sort((a, b) => (b.participants?.length || 0) - (a.participants?.length || 0));
                const totalMembers = groups.reduce((s, g) => s + (g.participants?.length || 0), 0);
                const top5 = groups.slice(0, 5).map((g, i) =>
                    (i+1) + '. *' + (g.subject || '—') + '* — ' + (g.participants?.length || 0) + ' عضو'
                ).join('\n');
                await reply(
                    '✧━── ❝ 𝐆𝐑𝐎𝐔𝐏𝐒 ❞ ──━✧\n\n' +
                    '📊 المجموعات: *' + groups.length + '*\n' +
                    '👥 إجمالي الأعضاء: *' + totalMembers + '*\n' +
                    '🏆 أكبر مجموعة: *' + (groups[0]?.subject || '—') + '* (' + (groups[0]?.participants?.length || 0) + ' عضو)\n\n' +
                    '*أعلى 5 مجموعات:*\n' + top5
                );
            } catch (e) { await reply('❌ ' + e?.message); }
            return;
        }

        // /خاص — إحصاءات الرسائل الخاصة (الغير مقروءة)
        if (cmd === 'خاص') {
            try {
                const store = sock.store;
                let pvtTotal = 0, pvtUnread = 0;
                if (store?.chats) {
                    const all = typeof store.chats.all === 'function'
                        ? store.chats.all()
                        : Object.values(store.chats);
                    for (const chat of all) {
                        const id = chat.id || '';
                        if (id.endsWith('@g.us') || id.includes('broadcast') || id.includes('status')) continue;
                        pvtTotal++;
                        if ((chat.unreadCount || 0) > 0) pvtUnread++;
                    }
                }
                await reply(
                    '📱 *إحصاءات الخاص:*\n\n' +
                    '💬 المحادثات الخاصة: *' + pvtTotal + '*\n' +
                    '📬 غير مقروءة: *' + pvtUnread + '*\n' +
                    '📖 مقروءة: *' + (pvtTotal - pvtUnread) + '*'
                );
            } catch (e) { await reply('❌ تعذر جلب بيانات المحادثات: ' + e?.message); }
            return;
        }

    } catch (e) { if (e?.message) console.error('[catch]', e.message); }
}
slashCommandHandler._src = 'slash_system';

// ══════════════════════════════════════════════════════════════
//  bannedUsersHandler — middleware: تجاهل المبندين تماماً
//  يعمل أول شيء قبل أي معالجة أخرى

async function bannedUsersHandler(sock, msg) {
    if (msg.key.fromMe) return;                          // البوت نفسه ← لا نتجاهله
    const senderJid = msg.key.participant || msg.key.remoteJid;
    if (!senderJid) return;
    if (isBanned(senderJid)) {
        // لا نرد، لا نعالج — صمت تام
        // نضع علامة على الـ msg حتى تعرف باقي الـ handlers تتجاهله
        msg._botBanned = true;
    }
}
bannedUsersHandler._src = 'ban_middleware';

// تسجيل الـ handlers
if (!global.featureHandlers) global.featureHandlers = [];
global.featureHandlers = global.featureHandlers.filter(
    h => !['ban_middleware','protection_system','stats_system','antiDelete_system','slash_system'].includes(h._src)
);
// bannedUsersHandler يجب أن يكون الأول دائماً
global.featureHandlers.push(bannedUsersHandler, protectionHandler, statsAutoHandler, antiDeleteHandler, slashCommandHandler);

export { protectionHandler, antiDeleteHandler, statsAutoHandler, slashCommandHandler, bannedUsersHandler };
