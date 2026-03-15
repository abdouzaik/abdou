// BOT Section
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

export async function handleBot(ctx, m, text) {
    const { sock, chatId, session, update, pushState, goBack, MAIN_MENU } = ctx;
    let state = session.state;
    let tmp   = session.tmp;

        if (session.state === 'BOT') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'الاسم')      { pushState('BOT', showBotMenu); await update('✏️ اكتب الاسم الجديد للبوت:\n\n🔙 *رجوع*'); session.state = 'BOT_NAME'; return; }
            if (text === 'الصورة')     { pushState('BOT', showBotMenu); await update('🖼️ ارسل الصورة الجديدة للبوت:\n\n🔙 *رجوع*'); session.state = 'BOT_PHOTO'; return; }
            if (text === 'الوصف')      { pushState('BOT', showBotMenu); await update('📝 اكتب البايو الجديد للبوت:\n\n🔙 *رجوع*'); session.state = 'BOT_STATUS'; return; }
            if (text === 'حظر')        { pushState('BOT', showBotMenu); await update('📱 منشن الشخص او اكتب رقمه للحظر:\n\n🔙 *رجوع*'); session.state = 'BOT_BLOCK'; return; }
            if (text === 'فك الحظر')   { pushState('BOT', showBotMenu); await update('📱 منشن الشخص او اكتب رقمه لفك الحظر:\n\n🔙 *رجوع*'); session.state = 'BOT_UNBLOCK'; return; }
            if (text === 'المجموعات') {
                pushState('BOT', showBotMenu);
                try {
                    const allGroups = await sock.groupFetchAllParticipating();
                    const groups = Object.values(allGroups);
                    if (!groups.length) return update('📭 البوت ليس في أي مجموعة.\n\n🔙 *رجوع*');
                    groups.sort((a, b) => (b.participants?.length || 0) - (a.participants?.length || 0));
                    const top = groups.slice(0, 10);
                    const lines = top.map((g, i) => `${i+1}. *${g.subject || '—'}*\n   👥 ${g.participants?.length || 0} عضو`).join('\n\n');
                    session.state = 'BOT_GROUPS';
                    await update(
`✧━── ❝ 𝐆𝐑𝐎𝐔𝐏𝐒 ❞ ──━✧

📊 إجمالي المجموعات: *${groups.length}*
👥 أعلى مجموعة: *${groups[0]?.subject}* (${groups[0]?.participants?.length} عضو)

${lines}

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
                } catch (e) { await update(`❌ ${e?.message}\n\n🔙 *رجوع*`); }
                return;
            }
            return;
        }

        if (session.state === 'BOT_GROUPS') {
            if (text === 'رجوع') { await goBack(); return; }
            return;
        }

        if (session.state === 'BOT_NAME') {
            if (text === 'رجوع') { await goBack(); return; }
            try {
                await sock.updateProfileName(text.trim());
                reactOk(sock, m);
                await update(`☑️ تم تغيير اسم البوت الى:\n*${text.trim()}*\n\n🔙 *رجوع*`);
            } catch (e) { await update(`❌ ${e?.message}\n\n🔙 *رجوع*`); }
            await sleep(800); await showBotMenu(); session.state = 'BOT'; return;
        }

        if (session.state === 'BOT_STATUS') {
            if (text === 'رجوع') { await goBack(); return; }
            try {
                await sock.updateProfileStatus(text.trim());
                reactOk(sock, m);
                await update(`☑️ تم تغيير وصف البوت.\n\n🔙 *رجوع*`);
            } catch (e) { await update(`❌ ${e?.message}\n\n🔙 *رجوع*`); }
            await sleep(800); await showBotMenu(); session.state = 'BOT'; return;
        }

        if (session.state === 'BOT_PHOTO') {
            if (text === 'رجوع') { await goBack(); return; }
            const ctx2   = m.message?.extendedTextMessage?.contextInfo;
            const imgMsg = m.message?.imageMessage || ctx2?.quotedMessage?.imageMessage;
            if (!imgMsg) return update('🖼️ ارسل صورة فقط (لا نص).\n\n🔙 *رجوع*');
            reactWait(sock, m);
            try {
                const target2 = m.message?.imageMessage
                    ? m
                    : { message: ctx2.quotedMessage, key: { ...m.key, id: ctx2.stanzaId, participant: ctx2.participant } };
                const buf = await downloadMediaMessage(target2, 'buffer', {});
                const botJid = getBotJid(sock);
                await sock.updateProfilePicture(botJid, buf);
                reactOk(sock, m);
                await update('☑️ تم تغيير صورة البوت.\n\n🔙 *رجوع*');
            } catch (e) { reactFail(sock, m); await update(`❌ ${e?.message}\n\n🔙 *رجوع*`); }
            await sleep(800); await showBotMenu(); session.state = 'BOT'; return;
        }

        if (session.state === 'BOT_BLOCK') {
            if (text === 'رجوع') { await goBack(); return; }
            const ctxM = m.message?.extendedTextMessage?.contextInfo;
            // منشن > رد > رقم مكتوب
            let rawT = ctxM?.mentionedJid?.[0] || ctxM?.participant;
            if (!rawT) {
                const num = text.replace(/\D/g, '');
                if (num.length >= 9) rawT = num + '@s.whatsapp.net';
            }
            if (!rawT) return update('❌ منشن الشخص او اكتب رقمه.\n\n🔙 *رجوع*');
            // LID → phone JID (updateBlockStatus يقبل phone فقط)
            let blockJid = rawT;
            if (rawT.endsWith('@lid')) {
                try {
                    const ep = readJSON(path.join(BOT_DIR, '../../handlers/elite-pro.json'), {});
                    blockJid  = (ep.twice || {})[rawT] || (normalizeJid(rawT) + '@s.whatsapp.net');
                } catch { blockJid = normalizeJid(rawT) + '@s.whatsapp.net'; }
            }
            if (!blockJid.endsWith('@s.whatsapp.net'))
                blockJid = normalizeJid(blockJid) + '@s.whatsapp.net';
            reactWait(sock, m);
            try {
                await sock.updateBlockStatus(blockJid, 'block');
                reactOk(sock, m);
                await update(`☑️ تم حظر @${normalizeJid(blockJid)}\n\n🔙 *رجوع*`);
            } catch (e) {
                reactFail(sock, m);
                console.error('[BOT_BLOCK]', e.message);
                await update(`❌ فشل الحظر: ${(e?.message||'').slice(0,100)}\n\n🔙 *رجوع*`);
            }
            await sleep(800); await showBotMenu(); session.state = 'BOT'; return;
        }

        if (session.state === 'BOT_UNBLOCK') {
            if (text === 'رجوع') { await goBack(); return; }
            const ctxM2 = m.message?.extendedTextMessage?.contextInfo;
            let rawT2 = ctxM2?.mentionedJid?.[0] || ctxM2?.participant;
            if (!rawT2) {
                const num2 = text.replace(/\D/g, '');
                if (num2.length >= 9) rawT2 = num2 + '@s.whatsapp.net';
            }
            if (!rawT2) return update('❌ منشن الشخص او اكتب رقمه.\n\n🔙 *رجوع*');
            let unblockJid = rawT2;
            if (rawT2.endsWith('@lid')) {
                try {
                    const ep2 = readJSON(path.join(BOT_DIR, '../../handlers/elite-pro.json'), {});
                    unblockJid = (ep2.twice || {})[rawT2] || (normalizeJid(rawT2) + '@s.whatsapp.net');
                } catch { unblockJid = normalizeJid(rawT2) + '@s.whatsapp.net'; }
            }
            if (!unblockJid.endsWith('@s.whatsapp.net'))
                unblockJid = normalizeJid(unblockJid) + '@s.whatsapp.net';
            reactWait(sock, m);
            try {
                await sock.updateBlockStatus(unblockJid, 'unblock');
                reactOk(sock, m);
                await update(`☑️ تم فك الحظر عن @${normalizeJid(unblockJid)}\n\n🔙 *رجوع*`);
            } catch (e) {
                reactFail(sock, m);
                console.error('[BOT_UNBLOCK]', e.message);
                await update(`❌ فشل: ${(e?.message||'').slice(0,100)}\n\n🔙 *رجوع*`);
            }
            await sleep(800); await showBotMenu(); session.state = 'BOT'; return;
        }
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