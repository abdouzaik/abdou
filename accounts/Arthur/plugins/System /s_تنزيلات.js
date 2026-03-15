// DL Section
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
import { loadPlugins } from '../../handlers/plugins.js';
import path from 'path';
import fs from 'fs-extra';
import { ytmp41, ytapi, savefrom, tikwm, getYtdlpBin, ytdlpDownload,
         searchPinterest, downloadImageBuffer, downloadPinterestImage,
         getPinCookies } from './_downloads.js';

export async function handleDl(ctx, m, text) {
    const { sock, chatId, session, update, pushState, goBack, MAIN_MENU } = ctx;
    let state = session.state;
    let tmp   = session.tmp;

        if (session.state === 'DL_MENU') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'فيديو' || text === 'صوت') {
                session.tmp.dlMode = text === 'فيديو' ? 'video' : 'audio';
                await update(`${text==='فيديو'?'🎬':'🎵'} ارسل الرابط:\n\n🔙 *رجوع*`);
                pushState('DL_MENU', showDlMenu); session.state = 'DL_WAIT'; return;
            }
            if (text === 'بحث تيك') {
                pushState('DL_MENU', showDlMenu);
                await update(
`✧━── ❝ 𝐓𝐈𝐊𝐓𝐎𝐊 ❞ ──━✧

🔍 اكتب كلمة البحث:
مثال: \`funny cats\`

سيتم إرسال *نتيجتين* 🎵

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
                session.state = 'TT_SEARCH'; return;
            }
            if (text === 'بنترست') {
                pushState('DL_MENU', showDlMenu);
                await update(
`✧━── ❝ 𝐏𝐈𝐍𝐓𝐄𝐑𝐄𝐒𝐓 ❞ ──━✧

🔍 اكتب كلمة البحث بالإنجليزي:
مثال: \`Arthur\`، \`DJN\`، \`nature\`

سيتم إرسال *14 صورة* مطابقة 📸

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
                session.state = 'PIN_SEARCH'; return;
            }
            const url = extractUrl(text);
            if (url) { await handleDownload(url, false, m); await sleep(1000); await showDlMenu(); return; }
            return;
        }

        if (session.state === 'PIN_SEARCH') {
            if (text === 'رجوع') { await goBack(); return; }
            const query = text.trim();
            if (!query || query.length < 1) return update('❌ اكتب كلمة بحث.');
            reactWait(sock, m);
            await update(`🔍 *جاري البحث عن "${query}" في Pinterest...*`);
            try {
                const images = await searchPinterest(query, 14);
                if (!images.length) {
                    await update(`❌ ما لقينا صور لـ "${query}"\nجرب كلمة أخرى.\n\n🔙 *رجوع*`);
                    return;
                }
                await update(`📸 *وجدنا ${images.length} صورة — جاري التحميل...*`);

                // حمّل كل الصور أولاً
                const buffers = [];
                for (const pin of images) {
                    try { buffers.push({ buf: await downloadImageBuffer(pin.url), title: pin.title || '' }); }
                    catch { /* تجاهل الصور الفاشلة */ }
                }

                // أرسل كـ media group (ألبوم) — كل 5 صور دفعة
                const BATCH = 7;
                let sent = 0;
                for (let i = 0; i < buffers.length; i += BATCH) {
                    const batch = buffers.slice(i, i + BATCH);
                    // أرسل الأولى في الدفعة كـ image عادية مع كابشن يوضح العدد
                    const first = batch[0];
                    await sock.sendMessage(chatId, {
                        image:   first.buf,
                        caption: `📌 *${query}* — صورة ${i+1}${batch.length > 1 ? `-${i+batch.length}` : ''}/${buffers.length}${first.title ? '\n' + first.title : ''}`,
                    });
                    sent++;
                    await sleep(200);
                    // أرسل الباقي بدون كابشن
                    for (let j = 1; j < batch.length; j++) {
                        try {
                            await sock.sendMessage(chatId, { image: batch[j].buf });
                            sent++;
                            await sleep(150);
                        } catch (e) { if (e?.message) console.error('[catch]', e.message); }
                    }
                    await sleep(350); // pause between batches
                }

                reactOk(sock, m);
                await update(
`☑️ *تم إرسال ${sent}/${buffers.length} صورة*

🔍 ابحث مجدداً أو:
🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
            } catch (e) {
                reactFail(sock, m);
                await update(`❌ فشل البحث: ${(e?.message || '').slice(0,100)}\n\n🔙 *رجوع*`);
            }
            return;
        }

        if (session.state === 'TT_SEARCH') {
            if (text === 'رجوع') { await goBack(); return; }
            const query = text.trim();
            if (!query) return update('❌ اكتب كلمة بحث.\n\n🔙 *رجوع*');
            reactWait(sock, m);
            await update(`🔍 *جاري البحث عن "${query}" في تيك توك...*`);
            try {
                const results = await tikwm.search(query, 2);
                if (!results.length) {
                    await update(`❌ ما لقينا نتائج لـ "${query}"\nجرب كلمة أخرى.\n\n🔙 *رجوع*`);
                    return;
                }
                for (const v of results) {
                    await sock.sendMessage(chatId, {
                        video:    { url: v.videoHD },
                        caption:  `🎵 ${v.author ? '@' + v.author + ' — ' : ''}${v.title || 'TikTok'}`,
                        mimetype: 'video/mp4',
                    }, { quoted: m });
                    await sleep(500);
                }
                reactOk(sock, m);
                await update(
`☑️ *تم إرسال ${results.length} نتيجة*

🔍 ابحث مجدداً أو:
🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
            } catch (e) {
                reactFail(sock, m);
                await update(`❌ فشل البحث: ${(e?.message || '').slice(0, 80)}\n\n🔙 *رجوع*`);
            }
            return;
        }

        if (session.state === 'DL_WAIT') {
            if (text === 'رجوع') { await goBack(); return; }
            const url = extractUrl(text) || (text.startsWith('http') ? text : null);
            if (!url) return update('❌ الرابط غير صحيح.\n\n🔙 *رجوع*');
            await handleDownload(url, session.tmp.dlMode === 'audio', m);
            await sleep(1500); await showDlMenu(); session.state = 'DL_MENU'; return;
        }

        // ══════════════════════════════════════════════════
        // STATS
        // ══════════════════════════════════════════════════
}

export async function showDlMenu() {
        await update(
`✧━── ❝ 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃 ❞ ──━✧

✦ *فيديو*
\`🎬 تنزيل كفيديو MP4\`

✦ *صوت*
\`🎵 تنزيل كصوت MP3\`

✦ *بحث تيك*
\`🎵 بحث تيك توك — نتيجتين\`

✦ *بنترست*
\`📌 بحث وإرسال صور\`

*او ارسل رابط مباشرة*

المصادر:
يوتيوب | انستقرام | تيك توك
فيسبوك | تويتر | ساوند

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

export async function handleDownload(ctx, url, audioOnly, m) {
    const { sock, chatId, update } = ctx;
        const platform = detectPlatform(url) || 'رابط';
        const icon     = audioOnly ? '🎵' : '🎬';
        const userKey  = ctx.msg?.key?.participant || chatId;

        // ── حد لكل مستخدم: تنزيل واحد في نفس الوقت ──
        if (_dlPerUser.has(userKey)) {
            reactWait(sock, m);
            await update(`⏳ *طلبك السابق لم ينتهِ بعد*\nانتظر حتى ينتهي ثم أعد المحاولة.\n\n🔙 *رجوع*`);
            return;
        }

        // ── حد عام: 3 تنزيلات متزامنة ──
        if (_dlActive >= DL_MAX_CONCURRENT) {
            reactWait(sock, m);
            await update(`⏳ *البوت مشغول بـ ${_dlActive} تنزيل*\nانتظر قليلاً وأعد المحاولة.\n\n🔙 *رجوع*`);
            return;
        }

        reactWait(sock, m);
        await update(`${icon} *جاري تحميل ${platform}...*\nقد يأخذ بضع ثوانٍ.`);

        // ── Pinterest: scraper مباشر ──
        if (!audioOnly && (url.includes('pinterest.com') || url.includes('pin.it'))) {
            try {
                const imgUrl = await downloadPinterestImage(url);
                if (imgUrl) {
                    const imgBuf = await downloadImageBuffer(imgUrl);
                    await sock.sendMessage(chatId, { image: imgBuf, caption: '📌 Pinterest' }, { quoted: m });
                    reactOk(sock, m);
                    await update('☑️ *تم!*\n\n🔙 *رجوع*');
                    return;
                }
            } catch (e) { console.error('[Pinterest]', e.message); }
            await update('❌ فشل جلب الصورة من Pinterest.\n\n🔙 *رجوع*');
            return;
        }

        _dlActive++;
        _dlPerUser.add(userKey);
        try {
            const isYT = url.includes('youtube.com') || url.includes('youtu.be');
            const isIG = url.includes('instagram.com') || url.includes('instagr.am');
            const isTT = url.includes('tiktok.com') || url.includes('vt.tiktok') || url.includes('vm.tiktok');

            // ══════════════════════════════════════
            // يوتيوب: API للمعلومات + Cobalt للتحميل → yt-dlp fallback
            // (رابط التحميل من API يتطلب Premium → نستعمله للـ thumbnail فقط)
            // ══════════════════════════════════════
            if (isYT) {
                // ── جلب المعلومات والـ thumbnail من yts (مجاني دائماً) ──
                let videoInfo = null;
                if (yts) {
                    try {
                        const search   = await yts(url);
                        const vidMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|live\/|embed\/))([a-zA-Z0-9_-]{11})/);
                        videoInfo = vidMatch
                            ? search.videos?.find(v => v.videoId === vidMatch[1]) || search.all?.[0]
                            : search.all?.[0];
                    } catch (e) { if (e?.message) console.error('[catch]', e.message); }
                }

                // ── إرسال thumbnail + معلومات ──
                if (videoInfo) {
                    try {
                        const thumbBuf = await downloadImageBuffer(videoInfo.image || videoInfo.thumbnail).catch(() => null);
                        const views    = (videoInfo.views || 0).toLocaleString('ar');
                        const canal    = videoInfo.author?.name || videoInfo.author || 'غير معروف';
                        const caption  =
`${audioOnly ? '🎵' : '🎬'} *${videoInfo.title || 'يوتيوب'}*

📺 *القناة:* ${canal}
⏱️ *المدة:* ${videoInfo.timestamp || videoInfo.duration || '؟'}
👁️ *المشاهدات:* ${views}
📅 *النشر:* ${videoInfo.ago || '؟'}
🔗 ${videoInfo.url || url}

⏳ _جاري التحميل..._`;
                        if (thumbBuf) await sock.sendMessage(chatId, { image: thumbBuf, caption }, { quoted: m });
                    } catch (e) { if (e?.message) console.error('[catch]', e.message); }
                }

                const title = videoInfo?.title || 'يوتيوب';

                // ── تحميل بـ youtube-mp41 (RapidAPI) ──
                const apiResult = audioOnly
                    ? await ytmp41.audio(url).catch(() => null)
                    : await ytmp41.video(url, '480').catch(() => null);

                if (apiResult?.url) {
                    try {
                        const buf = await downloadImageBuffer(apiResult.url);
                        if (audioOnly) {
                            await sock.sendMessage(chatId, {
                                audio:    buf,
                                mimetype: 'audio/mpeg',
                                ptt:      false,
                                fileName: `${title}.mp3`,
                            }, { quoted: m });
                        } else {
                            const sz = buf.length;
                            // > 70MB → مستند بدل فيديو
                            if (sz > 70 * 1024 * 1024) {
                                await sock.sendMessage(chatId, {
                                    document: buf,
                                    mimetype: 'video/mp4',
                                    fileName: `${title}.mp4`,
                                    caption:  `📎 *${title}*\n📦 الحجم: ${(sz/1024/1024).toFixed(1)}MB`,
                                }, { quoted: m });
                            } else {
                                await sock.sendMessage(chatId, {
                                    video:   buf,
                                    caption: `🎬 *${title}*`,
                                }, { quoted: m });
                            }
                        }
                        reactOk(sock, m);
                        await update(`☑️ *تم التحميل!*\n\n🔙 *رجوع*`);
                        return;
                    } catch (e) {
                        console.error('[ytmp41] فشل الإرسال:', e.message);
                        /* fallthrough to yt-dlp */
                    }
                }

                // ── الصوت: yt-dlp فقط (أجودة) ──
                if (audioOnly) {
                    try {
                        const { filePath: ytFp, cleanup: ytClean } = await ytdlpDownload(url, { audio: true });
                        const ytBuf = await fs.promises.readFile(ytFp); ytClean();
                        await sock.sendMessage(chatId, {
                            audio: ytBuf, mimetype: 'audio/mpeg', ptt: false,
                            fileName: `${title}.mp3`,
                        }, { quoted: m });
                        reactOk(sock, m);
                        await update(`☑️ *تم التحميل!*\n\n🔙 *رجوع*`);
                        return;
                    } catch (e) {
                        reactFail(sock, m);
                        await update(`❌ *فشل تحميل الصوت*\n${(e?.message || '').slice(0, 100)}\n\n🔙 *رجوع*`);
                        return;
                    }
                }

                // ── فيديو: yt-dlp fallback ──
                try {
                    const { filePath: ytFp, ext: ytExt, cleanup: ytClean } = await ytdlpDownload(url, { audio: false });
                    const ytSize = fs.statSync(ytFp).size;
                    const ytBuf  = await fs.promises.readFile(ytFp); ytClean();
                    if (ytSize > 70 * 1024 * 1024) {
                        await sock.sendMessage(chatId, {
                            document: ytBuf, mimetype: 'video/mp4',
                            fileName: `${title}.mp4`,
                            caption:  `📎 ${title} — ${(ytSize/1024/1024).toFixed(1)}MB`,
                        }, { quoted: m });
                    } else {
                        await sock.sendMessage(chatId, { video: ytBuf, caption: `🎬 *${title}*` }, { quoted: m });
                    }
                    reactOk(sock, m);
                    await update(`☑️ *تم التحميل!*\n\n🔙 *رجوع*`);
                    return;
                } catch (e) {
                    reactFail(sock, m);
                    await update(`❌ *فشل تحميل يوتيوب*\n${(e?.message || '').slice(0, 100)}\n\n🔙 *رجوع*`);
                    return;
                }
            }
            // ══════════════════════════════════════
            // انستقرام: savefrom → yt-dlp
            // ══════════════════════════════════════
            if (isIG && !audioOnly) {
                // ── الطريقة 1: RapidAPI (أسرع) ──
                const rapidResult = await instaRapid.reels(url).catch(() => null);
                if (rapidResult?.url) {
                    try {
                        await sock.sendMessage(chatId, {
                            video:    { url: rapidResult.url },
                            caption:  `📸 *انستقرام*`,
                            mimetype: 'video/mp4',
                        }, { quoted: m });
                        reactOk(sock, m);
                        await update(`☑️ *تم التحميل!*\n\n🔙 *رجوع*`);
                        return;
                    } catch { /* fallthrough */ }
                }
                // ── الطريقة 2: savefrom ──
                const sfResult = await savefrom.instagram(url).catch(() => null);
                if (sfResult?.url) {
                    try {
                        let buf, isVideo;
                        if (axios) {
                            const resp = await axios.get(sfResult.url, {
                                responseType: 'arraybuffer',
                                timeout:      55_000,
                                headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://en.savefrom.net/' },
                                maxRedirects: 5,
                            });
                            buf     = Buffer.from(resp.data);
                            const ct = (resp.headers['content-type'] || '').toLowerCase();
                            isVideo = ct.includes('video') || sfResult.url.includes('.mp4') || (!ct.includes('image'));
                        } else {
                            buf     = await downloadImageBuffer(sfResult.url);
                            isVideo = sfResult.url.includes('.mp4') || !sfResult.url.match(/\.(?:jpg|jpeg|png|webp|gif)/i);
                        }
                        if (isVideo) {
                            await sock.sendMessage(chatId, { video: buf, caption: `📸 *انستقرام*`, mimetype: 'video/mp4' }, { quoted: m });
                        } else {
                            await sock.sendMessage(chatId, { image: buf, caption: `📸 *انستقرام*` }, { quoted: m });
                        }
                        reactOk(sock, m);
                        await update(`☑️ *تم التحميل!*\n\n🔙 *رجوع*`);
                        return;
                    } catch (e) {
                        console.error('[IG savefrom]', e.message);
                        /* fallthrough to yt-dlp */
                    }
                }
            }

            // ══════════════════════════════════════
            // تيك توك: tikwm مباشر (URL بدون buffer)
            // ══════════════════════════════════════
            if (isTT) {
                if (audioOnly) {
                    // الصوت فقط: yt-dlp (أجودة)
                    try {
                        const { filePath: ttFp, ext: ttExt, cleanup: ttClean } = await ytdlpDownload(url, { audio: true });
                        const ttBuf = await fs.promises.readFile(ttFp); ttClean();
                        await sock.sendMessage(chatId, {
                            audio: ttBuf, mimetype: 'audio/mpeg', ptt: false,
                            fileName: 'tiktok_audio.mp3',
                        }, { quoted: m });
                        reactOk(sock, m);
                        await update(`☑️ *تم التحميل!*\n\n🔙 *رجوع*`);
                        return;
                    } catch { /* fallthrough */ }
                } else {
                    const ttResult = await tikwm.download(url).catch(() => null);
                    if (ttResult) {
                        const caption = `🎵 ${ttResult.author ? '@' + ttResult.author + ' — ' : ''}${ttResult.title || 'TikTok'}`;
                        try {
                            // Slideshow (images)
                            if (ttResult.images?.length) {
                                for (const imgUrl of ttResult.images.slice(0, 10)) {
                                    await sock.sendMessage(chatId, { image: { url: imgUrl }, caption }, { quoted: m });
                                    await sleep(300);
                                }
                                if (ttResult.audio) {
                                    await sock.sendMessage(chatId, {
                                        audio: { url: ttResult.audio }, mimetype: 'audio/mp4',
                                    }, { quoted: m });
                                }
                                reactOk(sock, m);
                                await update(`☑️ *تم التحميل!*\n\n🔙 *رجوع*`);
                                return;
                            }
                            // فيديو عادي — URL مباشر (بدون تحميل Buffer كامل)
                            const videoUrl = ttResult.videoHD || ttResult.video;
                            if (videoUrl) {
                                await sock.sendMessage(chatId, {
                                    video:   { url: videoUrl },
                                    caption,
                                    mimetype: 'video/mp4',
                                }, { quoted: m });
                                reactOk(sock, m);
                                await update(`☑️ *تم التحميل!*\n\n🔙 *رجوع*`);
                                return;
                            }
                        } catch { /* fallthrough to yt-dlp */ }
                    }
                }
            }

            // ── yt-dlp: باقي المنصات أو fallback ──
            const { filePath, ext, cleanup } = await ytdlpDownload(url, { audio: audioOnly });
            const fileSize = fs.statSync(filePath).size;
            const isVideo  = ['mp4','mkv','webm','mov','avi'].includes(ext);
            const isAudio  = ['mp3','m4a','ogg','aac','opus','wav'].includes(ext);
            const isImage  = ['jpg','jpeg','png','webp','gif'].includes(ext);

            if (fileSize > 150 * 1024 * 1024) {
                cleanup();
                return update('❌ الملف أكبر من 150MB.\n\n🔙 *رجوع*');
            }

            const buffer = await fs.promises.readFile(filePath); cleanup();

            if (isVideo && fileSize > 70 * 1024 * 1024) {
                await sock.sendMessage(chatId, {
                    document: buffer, mimetype: 'video/mp4',
                    fileName: `${platform}_video.mp4`,
                    caption: `📎 ${platform} — ${(fileSize/1024/1024).toFixed(1)}MB`,
                }, { quoted: m });
            } else if (isVideo) {
                await sock.sendMessage(chatId, { video: buffer, caption: `${icon} ${platform}` }, { quoted: m });
            } else if (isAudio) {
                await sock.sendMessage(chatId, { audio: buffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: m });
            } else if (isImage) {
                await sock.sendMessage(chatId, { image: buffer, caption: `${icon} ${platform}` }, { quoted: m });
            } else {
                await sock.sendMessage(chatId, {
                    document: buffer, mimetype: 'application/octet-stream',
                    fileName: path.basename(filePath), caption: `${icon} ${platform}`,
                }, { quoted: m });
            }
            reactOk(sock, m);
            await update(`☑️ *تم التحميل!*\n\n🔙 *رجوع*`);
        } catch (e) {
            reactFail(sock, m);
            const errText = e?.message || '';
            let hint = '';
            if (errText.includes('غير مثبت') || errText.includes('yt-dlp'))
                hint = '\n💡 شغّل: `pip install -U yt-dlp`';
            else if (errText.includes('معدل الطلبات') || errText.includes('429'))
                hint = '\n⏳ حاول بعد دقيقتين.';
            else if (errText.includes('خاص') || errText.toLowerCase().includes('private') || errText.includes('login'))
                hint = '\n🔒 المحتوى خاص.';
            else if (errText.includes('Unsupported URL') || errText.includes('not supported'))
                hint = '\n🔗 الرابط غير مدعوم.';
            else if (errText.includes('محذوف') || errText.includes('unavailable'))
                hint = '\n🗑️ المحتوى غير متاح.';
            await update(`❌ *فشل التحميل*\n${errText.slice(0, 120)}${hint}\n\n🔙 *رجوع*`);
        } finally {
            _dlActive--;
            _dlPerUser.delete(userKey);
        }
}
