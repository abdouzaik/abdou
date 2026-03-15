// ADMIN
import {
    sleep, react, reactWait, reactOk, reactFail, reactInput,
    normalizeJid, getBotJid, checkElite,
    resolveTarget, pinMessage,
    readJSON, writeJSON, readJSONSync, writeJSONSync, atomicWrite,
    readProt, writeProt, readStats, writeStats,
    readBanned, isBanned, addBan, removeBan,
    getAllPluginFiles, getPluginInfo, updatePluginField, findPluginByCmd,
    quickLint, checkPluginSyntax,
    isGroupAdmin, isBotGroupAdmin, getGroupAdminInfo,
    grpFile, DATA_DIR, PLUGINS_DIR, BOT_DIR, PROT_FILE, STATS_FILE,
    BAN_FILE, PLUGINS_CFG_FILE, _eliteProPath, activeSessions,
    configObj,
} from './_utils.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { loadPlugins } from '../../../handlers/plugins.js';
import path from 'path';
import fs from 'fs-extra';

export async function handleAdmin(ctx, m, text) {
    const { sock, chatId, session, update, pushState, goBack, tryAdminAction, MAIN_MENU } = ctx;
    let state = session.state;
    let tmp   = session.tmp;

        if (session.state === 'ADMIN') {
            if (text === 'رجوع')         { await goBack(); return; }
            if (text === 'الاعضاء')      { pushState('ADMIN', showAdminMenu); await showAdminMembersMenu();  session.state = 'ADMIN_MEMBERS';   return; }
            if (text === 'الرسائل')      { pushState('ADMIN', showAdminMenu); await showAdminMessagesMenu(); session.state = 'ADMIN_MESSAGES';  return; }
            if (text === 'المجموعة')     { pushState('ADMIN', showAdminMenu); await showAdminGroupMenu();    session.state = 'ADMIN_GROUP_SET'; return; }
            if (text === 'المحتوى')      { pushState('ADMIN', showAdminMenu); await showAdminContentMenu();  session.state = 'ADMIN_CONTENT';   return; }
            if (text === 'قفل المحتوى') { pushState('ADMIN', showAdminMenu); await showAdminLocksMenu();    session.state = 'ADMIN_LOCKS';     return; }
            if (text === 'الادوات')      { pushState('ADMIN', showAdminMenu); await showAdminToolsMenu();    session.state = 'ADMIN_TOOLS';     return; }
            return;
        }

        // ADMIN_MEMBERS
        if (session.state === 'ADMIN_MEMBERS') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'المشرفين') {
                try {
                    const { meta } = await getAdminPerms();
                    const admins = (meta?.participants || []).filter(p => p.admin);
                    if (!admins.length) return update('📭 لا يوجد مشرفين.\n\n🔙 *رجوع*');
                    const list = admins.map((a,i)=>`${i+1}. @${normalizeJid(a.id)} ${a.admin==='superadmin'?'🔝':''}`).join('\n');
                    await sock.sendMessage(chatId, { text: `⬆️ *المشرفون (${admins.length}):*\n\n${list}`, mentions: admins.map(a=>a.id) }, { quoted: m });
                } catch (e) { await update(`❌ ${e?.message}`); }
                return;
            }
            const memberActions = {
                'رفع مشرف':'promote', 'تنزيل مشرف':'demote',
                'طرد':'remove', 'حظر':'ban', 'الغاء حظر':'unban',
                'كتم':'mute', 'الغاء كتم':'unmute',
            };
            if (memberActions[text]) {
                session.tmp.adminAction = memberActions[text];
                const hint = text === 'كتم' ? '⏱️ كم دقيقة؟ (مثال: 30)\nثم منشن او رد' : '↩️ منشن العضو او رد على رسالته';
                await update(`${hint}\n\n🔙 *رجوع*`);
                pushState('ADMIN_MEMBERS', showAdminMembersMenu); session.state = 'ADMIN_TARGET'; return;
            }
            return;
        }

        // ADMIN_TARGET
        if (session.state === 'ADMIN_TARGET') {
            if (text === 'رجوع') { await goBack(); return; }
            const target = await resolveTarget(sock, chatId, m);
            if (!target) return update('❌ منشن العضو او رد على رسالته.');
            const action = session.tmp.adminAction;
            reactWait(sock, m);
            if (action === 'promote') {
                await tryAdminAction(() => sock.groupParticipantsUpdate(chatId, [target], 'promote'), '⬆️');
            } else if (action === 'demote') {
                await tryAdminAction(() => sock.groupParticipantsUpdate(chatId, [target], 'demote'), '⬇️');
            } else if (action === 'remove') {
                await tryAdminAction(() => sock.groupParticipantsUpdate(chatId, [target], 'remove'), '🚪');
            } else if (action === 'botban') {
                // ── بان البوت: يمنع الشخص من استخدام البوت (بدون طرد من القروب) ──
                const tNum = normalizeJid(target);
                addBan(target);
                reactOk(sock, m);
                await sock.sendMessage(chatId, {
                    text: `🚫 *تم إعطاء بان للمستخدم*
@${tNum}
_البوت سيتجاهل أوامره الآن_`,
                    mentions: [target],
                });
            } else if (action === 'botunban') {
                // ── فك بان البوت ──
                const tNum2 = normalizeJid(target);
                removeBan(target);
                reactOk(sock, m);
                await sock.sendMessage(chatId, {
                    text: `☑️ *تم إزالة البان*
@${tNum2}
_يمكن للمستخدم الآن استخدام البوت_`,
                    mentions: [target],
                });
            } else if (action === 'mute') {
                const mins = parseInt((text.match(/\d+/) || ['30'])[0]);
                await tryAdminAction(async () => {
                    await sock.groupParticipantsUpdate(chatId, [target], 'demote');
                    await sock.sendMessage(chatId, { text: `🔇 تم كتم @${normalizeJid(target)} لمدة ${mins} دقيقة`, mentions: [target] });
                    setTimeout(async () => { try { await sock.groupParticipantsUpdate(chatId, [target], 'promote'); } catch (e) { if (e?.message) console.error('[catch]', e.message); } }, mins * 60_000);
                }, '🔇');
            } else if (action === 'unmute') {
                await tryAdminAction(() => sock.groupParticipantsUpdate(chatId, [target], 'promote'), '🔊');
            }
            await sleep(600); await showAdminMembersMenu(); session.state = 'ADMIN_MEMBERS'; return;
        }

        // ADMIN_MESSAGES
        if (session.state === 'ADMIN_MESSAGES') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'تثبيت' || text === 'الغاء التثبيت') {
                const ctx2 = m.message?.extendedTextMessage?.contextInfo;
                if (!ctx2?.stanzaId) return update('↩️ رد على الرسالة اللي تبيها.');
                reactWait(sock, m);
                try {
                    const msgKey = { id: ctx2.stanzaId, participant: ctx2.participant, remoteJid: chatId };
                    if (text === 'تثبيت') {
                        await pinMessage(sock, chatId, msgKey.id, msgKey.participant, true);
                    } else {
                        await pinMessage(sock, chatId, msgKey.id, msgKey.participant, false);
                    }
                    reactOk(sock, m);
                } catch (e) {
                    reactFail(sock, m);
                    const em = e?.message || '';
                    await update(`❌ فشل: ${em.includes('admin') || em.includes('403') ? 'البوت يحتاج صلاحيات مشرف.' : em.slice(0, 100)}\n\n🔙 *رجوع*`);
                }
                return;
            }
            if (text === 'مسح') {
                const ctx2 = m.message?.extendedTextMessage?.contextInfo;
                if (!ctx2?.stanzaId) return update('↩️ رد على الرسالة اللي تبيها.');
                reactWait(sock, m);
                try {
                    await sock.sendMessage(chatId, { delete: { remoteJid: chatId, fromMe: false, id: ctx2.stanzaId, participant: ctx2.participant } });
                    reactOk(sock, m);
                } catch (e) {
                    reactFail(sock, m);
                    await update(`❌ فشل: ${(e?.message || '').slice(0, 100)}\n\n🔙 *رجوع*`);
                }
                return;
            }
            return;
        }

        // ADMIN_GROUP_SET
        if (session.state === 'ADMIN_GROUP_SET') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'وضع اسم')      { pushState('ADMIN_GROUP_SET', showAdminGroupMenu); await update('✏️ ارسل الاسم الجديد:\n\n🔙 *رجوع*'); session.state = 'ADMIN_SETNAME'; return; }
            if (text === 'وضع وصف')      { pushState('ADMIN_GROUP_SET', showAdminGroupMenu); await update('📝 ارسل الوصف الجديد:\n\n🔙 *رجوع*'); session.state = 'ADMIN_SETDESC'; return; }
            if (text === 'وضع صورة')     { pushState('ADMIN_GROUP_SET', showAdminGroupMenu); await update('🖼️ ارسل او اقتبس صورة:\n\n🔙 *رجوع*'); session.state = 'ADMIN_SETIMG'; return; }
            if (text === 'قفل المحادثة') { await tryAdminAction(() => sock.groupSettingUpdate(chatId, 'announcement'), '🔒'); return; }
            if (text === 'فتح المحادثة') { await tryAdminAction(() => sock.groupSettingUpdate(chatId, 'not_announcement'), '🔓'); return; }
            if (text === 'رابط') {
                try { const code = await sock.groupInviteCode(chatId); await update(`🔗 *رابط المجموعة:*\nhttps://chat.whatsapp.com/${code}\n\n🔙 *رجوع*`); }
                catch (e) { await update(`❌ ${e?.message}`); }
                return;
            }
            if (text === 'انضم') { pushState('ADMIN_GROUP_SET', showAdminGroupMenu); await update('🔗 ارسل رابط المجموعة:\n\n🔙 *رجوع*'); session.state = 'ADMIN_JOIN'; return; }
            if (text === 'خروج') { pushState('ADMIN_GROUP_SET', showAdminGroupMenu); await update('⚠️ تاكيد الخروج؟\nاكتب *نعم* او *رجوع*'); session.state = 'ADMIN_LEAVE'; return; }
            return;
        }

        if (session.state === 'ADMIN_SETNAME') {
            if (text === 'رجوع') { await goBack(); return; }
            reactWait(sock, m); await tryAdminAction(() => sock.groupUpdateSubject(chatId, text), '☑️');
            await sleep(800); await showAdminGroupMenu(); session.state = 'ADMIN_GROUP_SET'; return;
        }

        if (session.state === 'ADMIN_SETDESC') {
            if (text === 'رجوع') { await goBack(); return; }
            reactWait(sock, m); await tryAdminAction(() => sock.groupUpdateDescription(chatId, text), '☑️');
            await sleep(800); await showAdminGroupMenu(); session.state = 'ADMIN_GROUP_SET'; return;
        }

        if (session.state === 'ADMIN_SETIMG') {
            if (text === 'رجوع') { await goBack(); return; }
            const ctx2   = m.message?.extendedTextMessage?.contextInfo;
            const imgMsg = m.message?.imageMessage || ctx2?.quotedMessage?.imageMessage;
            if (!imgMsg) return update('🖼️ ارسل او اقتبس صورة فقط.\n\n🔙 *رجوع*');
            reactWait(sock, m);
            try {
                const target2 = m.message?.imageMessage
                    ? m
                    : { message: ctx2.quotedMessage, key: { ...m.key, id: ctx2.stanzaId, participant: ctx2.participant } };
                const buf = await downloadMediaMessage(target2, 'buffer', {});
                await tryAdminAction(() => sock.updateProfilePicture(chatId, buf), '☑️');
            } catch (e) { reactFail(sock, m); await update(`❌ ${e?.message}`); }
            await sleep(800); await showAdminGroupMenu(); session.state = 'ADMIN_GROUP_SET'; return;
        }

        if (session.state === 'ADMIN_JOIN') {
            if (text === 'رجوع') { await goBack(); return; }
            const match = text.match(/chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/i);
            if (!match) return update('❌ رابط غير صحيح.\n\n🔙 *رجوع*');
            reactWait(sock, m);
            try { await sock.groupAcceptInvite(match[1]); reactOk(sock, m); await update('☑️ تم الانضمام.'); }
            catch (e) { reactFail(sock, m); await update(`❌ ${e?.message}`); }
            await sleep(800); await showAdminGroupMenu(); session.state = 'ADMIN_GROUP_SET'; return;
        }

        if (session.state === 'ADMIN_LEAVE') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'نعم') { try { await sock.groupLeave(chatId); } catch (e) { await update(`❌ ${e?.message}`); } }
            session.state = 'ADMIN_GROUP_SET'; return;
        }

        // ADMIN_CONTENT
        if (session.state === 'ADMIN_CONTENT') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'وضع ترحيب') { pushState('ADMIN_CONTENT', showAdminContentMenu); await update('👋 اكتب رسالة الترحيب:\nاستخدم {name} للاسم و {number} للرقم\n\n🔙 *رجوع*'); session.state = 'ADMIN_SETWELCOME'; return; }
            if (text === 'ترحيب') {
                const wf = grpFile('welcome', chatId);
                if (!fs.existsSync(wf)) return update('❌ لم يُضبط ترحيب بعد.\n\nاكتب *وضع ترحيب* لضبطه.\n\n🔙 *رجوع*');
                const { text: wt } = readJSON(wf, {});
                await update(`📋 *رسالة الترحيب:*\n\n${wt}\n\nاكتب *حذف* لحذفه\n🔙 *رجوع*`);
                pushState('ADMIN_CONTENT', showAdminContentMenu); session.state = 'ADMIN_WELCOME_VIEW'; return;
            }
            if (text === 'وضع قوانين') { pushState('ADMIN_CONTENT', showAdminContentMenu); await update('📜 اكتب القوانين:\n\n🔙 *رجوع*'); session.state = 'ADMIN_SETRULES'; return; }
            if (text === 'قوانين') {
                const rf = grpFile('rules', chatId);
                if (!fs.existsSync(rf)) return update('❌ لم تُضبط قوانين بعد.\n\n🔙 *رجوع*');
                const { text: rt } = readJSON(rf, {});
                await update(`📜 *القوانين:*\n\n${rt}\n\nاكتب *حذف* لحذفها\n🔙 *رجوع*`);
                pushState('ADMIN_CONTENT', showAdminContentMenu); session.state = 'ADMIN_RULES_VIEW'; return;
            }
            if (text === 'كلمات ممنوعة') { pushState('ADMIN_CONTENT', showAdminContentMenu); await showBadwords(); session.state = 'ADMIN_BADWORDS'; return; }
            return;
        }

        if (session.state === 'ADMIN_SETWELCOME') {
            if (text === 'رجوع') { await goBack(); return; }
            writeJSON(grpFile('welcome', chatId), { text });
            reactOk(sock, m);
            await update(`☑️ تم حفظ رسالة الترحيب.\n\n🔙 *رجوع*`);
            await sleep(800); await showAdminContentMenu(); session.state = 'ADMIN_CONTENT'; return;
        }

        if (session.state === 'ADMIN_SETRULES') {
            if (text === 'رجوع') { await goBack(); return; }
            writeJSON(grpFile('rules', chatId), { text });
            reactOk(sock, m);
            await sleep(800); await showAdminContentMenu(); session.state = 'ADMIN_CONTENT'; return;
        }

        if (session.state === 'ADMIN_WELCOME_VIEW') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'حذف') { try { fs.removeSync(grpFile('welcome', chatId)); reactOk(sock, m); } catch (e) { if (e?.message) console.error('[catch]', e.message); } await sleep(400); await showAdminContentMenu(); session.state = 'ADMIN_CONTENT'; }
            return;
        }

        if (session.state === 'ADMIN_RULES_VIEW') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'حذف') { try { fs.removeSync(grpFile('rules', chatId)); reactOk(sock, m); } catch (e) { if (e?.message) console.error('[catch]', e.message); } await sleep(400); await showAdminContentMenu(); session.state = 'ADMIN_CONTENT'; }
            return;
        }

        if (session.state === 'ADMIN_BADWORDS') {
            if (text === 'رجوع') { await goBack(); return; }
            const bf = grpFile('badwords', chatId); let words = readJSON(bf, []);
            if (text.startsWith('اضافة ')) { const w = text.slice(6).trim(); if (w) { words.push(w.toLowerCase()); writeJSON(bf, words); reactOk(sock, m); } await sleep(400); await showBadwords(); return; }
            if (text.startsWith('حذف '))   { writeJSON(bf, words.filter(x => x !== text.slice(4).trim())); reactOk(sock, m); await sleep(400); await showBadwords(); return; }
            return;
        }

        // ADMIN_LOCKS
        if (session.state === 'ADMIN_LOCKS') {
            if (text === 'رجوع') { await goBack(); return; }
            const LOCK_MAP = {
                'قفل الروابط': 'antiLink',
                'قفل الصور':   'images',
                'قفل الفيديو': 'videos',
                'قفل البوتات': 'bots',
            };
            if (LOCK_MAP[text]) {
                const p = readProt();
                p[LOCK_MAP[text]] = p[LOCK_MAP[text]] === 'on' ? 'off' : 'on';
                writeProt(p);
                reactOk(sock, m);
                await sleep(500); await showAdminLocksMenu(); return;
            }
            return;
        }

        // ADMIN_TOOLS
        if (session.state === 'ADMIN_TOOLS') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'معلومات') {
                try {
                    const { meta } = await getAdminPerms();
                    if (!meta) return update('❌ تعذر جلب المعلومات.\n\n🔙 *رجوع*');
                    await update(
`📊 *معلومات المجموعة:*

📌 *الاسم:* ${meta.subject}
👥 *الاعضاء:* ${meta.participants.length}
🆔 *الID:* ${chatId.split('@')[0]}
📅 *تاريخ الانشاء:* ${new Date(meta.creation * 1000).toLocaleDateString('ar')}

🔙 *رجوع*`);
                } catch (e) { await update(`❌ ${e?.message}`); }
                return;
            }
            if (text === 'اذاعة') { pushState('ADMIN_TOOLS', showAdminToolsMenu); await update('📢 اكتب رسالة الإذاعة:\n\n🔙 *رجوع*'); session.state = 'ADMIN_BROADCAST'; return; }
            if (text === 'تحديث') {
                reactWait(sock, m);
                try { await loadPlugins(); reactOk(sock, m); await update('☑️ تم تحديث الاوامر.\n\n🔙 *رجوع*'); }
                catch (e) { reactFail(sock, m); await update(`❌ ${e?.message}`); }
                return;
            }
            return;
        }

        if (session.state === 'ADMIN_BROADCAST') {
            if (text === 'رجوع') { await goBack(); return; }
            reactWait(sock, m);
            try {
                const chats = await sock.groupFetchAllParticipating();
                let sent = 0;
                for (const gid of Object.keys(chats)) { try { await sock.sendMessage(gid, { text }); sent++; } catch (e) { if (e?.message) console.error('[catch]', e.message); } await sleep(500); }
                reactOk(sock, m); await update(`☑️ الإرسال لـ ${sent} مجموعة.`);
            } catch (e) { await update(`❌ ${e?.message}`); }
            await sleep(1000); await showAdminToolsMenu(); session.state = 'ADMIN_TOOLS'; return;
        }


        // ══════════════════════════════════════════════════
        // BOT — إدارة حساب البوت
        // ══════════════════════════════════════════════════
}

export async function showAdminMenu() {
        await update(
`✧━── ❝ 𝐀𝐃𝐌𝐈𝐍 ❞ ──━✧

✦ *الاعضاء*
\`👥 رفع وطرد وحظر وكتم\`

✦ *الرسائل*
\`📌 تثبيت ومسح الرسائل\`

✦ *المجموعة*
\`⚙️ اسم ووصف وصورة وإعدادات\`

✦ *المحتوى*
\`👋 ترحيب وقوانين وكلمات ممنوعة\`

✦ *قفل المحتوى*
\`🔒 منع انواع معينة من المحتوى\`

✦ *الادوات*
\`🤖 اذاعة ومعلومات وتحديث\`

🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

export async function showAdminMembersMenu() {
        await update(
`✧━── ❝ 𝐌𝐄𝐌𝐁𝐄𝐑𝐒 ❞ ──━✧

✦ *رفع مشرف*
\`⬆️ رد على رسالته أو منشنه لترقيته\`

✦ *تنزيل مشرف*
\`⬇️ رد على رسالته أو منشنه لإزالة صلاحياته\`

✦ *المشرفين*
\`📋 عرض قائمة المشرفين الحاليين\`

✦ *طرد*
\`🚪 رد على رسالته أو منشنه لطرده من القروب\`

✦ *بان*
\`🚫 منع العضو من استخدام البوت نهائياً\`

✦ *فك بان*
\`☑️ إلغاء البان والسماح له باستخدام البوت\`

✦ *كتم*
\`🔇 اكتب المدة بالدقائق ثم منشن أو رد\`

✦ *الغاء كتم*
\`🔊 رد على رسالته أو منشنه\`

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

export async function showAdminMessagesMenu() {
        await update(
`✧━── ❝ 𝐌𝐄𝐒𝐒𝐀𝐆𝐄𝐒 ❞ ──━✧

✦ *تثبيت*
\`📌 رد على الرسالة لتثبيتها في القروب\`

✦ *الغاء التثبيت*
\`📌 رد على الرسالة لإلغاء تثبيتها\`

✦ *مسح*
\`🗑️ رد على الرسالة لحذفها نهائياً\`

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

export async function showAdminGroupMenu() {
        await update(
`✧━── ❝ 𝐆𝐑𝐎𝐔𝐏 ❞ ──━✧

✦ *وضع اسم*
\`✏️ تغيير اسم المجموعة\`

✦ *وضع وصف*
\`📝 تغيير وصف المجموعة\`

✦ *وضع صورة*
\`🖼️ ارسل أو اقتبس صورة لتغيير صورة القروب\`

✦ *قفل المحادثة*
\`🔒 منع الأعضاء من الكتابة\`

✦ *فتح المحادثة*
\`🔓 السماح للأعضاء بالكتابة\`

✦ *رابط*
\`🔗 الحصول على رابط دعوة المجموعة\`

✦ *انضم*
\`☑️ الانضمام لمجموعة عبر رابط\`

✦ *خروج*
\`🚪 مغادرة هذه المجموعة\`

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

export async function showAdminContentMenu() {
        await update(
`✧━── ❝ 𝐂𝐎𝐍𝐓𝐄𝐍𝐓 ❞ ──━✧

✦ *وضع ترحيب*
\`👋 اكتب رسالة الترحيب — استخدم {name} للاسم و {number} للرقم\`

✦ *ترحيب*
\`📋 عرض رسالة الترحيب الحالية أو حذفها\`

✦ *وضع قوانين*
\`📜 اكتب قوانين المجموعة\`

✦ *قوانين*
\`📋 عرض قوانين المجموعة أو حذفها\`

✦ *كلمات ممنوعة*
\`🚫 إدارة قائمة الكلمات المحظورة\`

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

export async function showAdminLocksMenu() {
        const p = readProt(), s = k => p[k]==='on'?'🔒 مفعّل':'🔓 معطّل';
        await update(
`✧━── ❝ 𝐋𝐎𝐂𝐊𝐒 ❞ ──━✧

✦ *قفل الروابط* — ${s('antiLink')}
\`🔗 اضغط لتغيير حالة قفل الروابط\`

✦ *قفل الصور* — ${s('images')}
\`🖼️ اضغط لتغيير حالة قفل الصور\`

✦ *قفل الفيديو* — ${s('videos')}
\`🎬 اضغط لتغيير حالة قفل الفيديو\`

✦ *قفل البوتات* — ${s('bots')}
\`🤖 اضغط لتغيير حالة قفل البوتات\`

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

export async function showAdminToolsMenu() {
        await update(
`✧━── ❝ 𝐓𝐎𝐎𝐋𝐒 ❞ ──━✧

✦ *معلومات*
\`ℹ️ عرض معلومات المجموعة وإحصاءاتها\`

✦ *اذاعة*
\`📢 إرسال رسالة لجميع المجموعات\`

✦ *تحديث*
\`🔄 إعادة تحميل جميع الأوامر\`

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

export async function showBadwords() {
        const bf = grpFile('badwords', chatId);
        const words = readJSON(bf, []);
        const list  = words.length ? words.map((w,i)=>`${i+1}. ${w}`).join('\n') : 'لا يوجد كلمات';
        await update(
`✧━── ❝ 𝐁𝐀𝐃𝐖𝐎𝐑𝐃𝐒 ❞ ──━✧

*الكلمات الممنوعة 🚫:*
${list}

✦ *اضافة [كلمة]*
✦ *حذف [كلمة]*

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }


export async function showBotMenu() {
        const botJid = getBotJid(sock);
        let name = sock.user?.name || '—';
        await update(
`✧━── ❝ 𝐁𝐎𝐓 ❞ ──━✧

🤖 *${name}*

✦ *الاسم*
\`✏️ تغيير اسم البوت\`

✦ *الصورة*
\`🖼️ تغيير صورة البوت\`

✦ *الوصف*
\`📝 تغيير بايو البوت\`

✦ *حظر*
\`🔒 حظر شخص (block)\`

✦ *فك الحظر*
\`🔓 فك الحظر عن شخص\`

✦ *المجموعات*
\`📊 عرض المجموعات واحصاءاتها\`

🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }
