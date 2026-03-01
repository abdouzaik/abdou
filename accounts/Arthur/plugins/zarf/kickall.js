import { jidDecode } from "@whiskeysockets/baileys";

import { addKicked } from "../../nova/dataUtils.js"; 

export let zarfConfig = {
  reaction: {
    status: `on`,
    emoji: `⚡`
  },
  group: {
    status: `on`,
    descStatus: `on`,
    newSubject: `𝚊𝚋𝚍𝚘𝚞 𝚒𝚜 𝚑𝚎𝚛𝚎 ❀`,
    newDescription: `*𝑵𝒐 𝒕𝒉𝒓𝒐𝒏𝒆 𝒘𝒂𝒔 𝒈𝒊𝒗𝒆𝒏 𝒕𝒐 𝒎𝒆—𝑰 𝒔𝒎𝒊𝒕𝒉𝒆𝒅 𝒎𝒚 𝒐𝒘𝒏. 𝑻𝒉𝒆 𝒔𝒕𝒐𝒓𝒎 𝒅𝒐𝒆𝒔 𝒏𝒐𝒕 𝒇𝒐𝒓𝒄𝒆 𝒎𝒆; 𝑰 𝒂𝒎 𝒕𝒉𝒆 𝒔𝒕𝒐𝒓𝒎 𝒕𝒉𝒆𝒚 𝒇𝒆𝒂𝒓.______*`
  },
  mention: {
    status: `on`,
    text: `*𝐴𝑟𝑡ℎ𝑢𝑟 𝑖𝑠 𝑏𝑎𝑐𝑘*`
  },
  finalMessage: {
    status: `on`,
    text: `*┆⌁ 𝑨𝑹𝑻𝑯𝑼𝑹 𝑾𝑨𝑺 𝑯𝑬𝑹𝑬 🍁 ⌁┆*\n\n *𝑴𝒚 𝒔𝒕𝒆𝒑𝒔 𝒅𝒐 𝒏𝒐𝒕 𝒆𝒄𝒉𝒐—𝒕𝒉𝒆𝒚 𝒄𝒐𝒎𝒎𝒂𝒏𝒅. 𝑾𝒉𝒆𝒓𝒆 𝑰 𝒘𝒂𝒍𝒌, 𝒅𝒐𝒖𝒃𝒕 𝒅𝒊𝒆𝒔, 𝒂𝒏𝒅 𝒑𝒐𝒘𝒆𝒓 𝒓𝒊𝒔𝒆𝒔 𝒘𝒊𝒕𝒉 𝒆𝒗𝒆𝒓𝒚 𝒃𝒓𝒆𝒂𝒕𝒉 𝑰 𝒕𝒂𝒌𝒆.* \n\n> *_⟫ 𝑨𝒓𝒄𝒉𝒊𝒗𝒆 𝑺𝒉𝒆𝒆𝒕 ┆ 🍷𝑨𝑹𝑻𝑯𝑼𝑹お ⟪_*  \n*~〔 ◜ https://chat.whatsapp.com/FVN1S1V1KgC7C7SMvZ4zle ◞ 〕~*\n\n> *_⟫ 𝑺𝒊𝒍𝒆𝒏𝒕 𝑯𝒂𝒍𝒍 ┆ 🐉 𝑨𝑹𝑻𝑯𝑼𝑹お ⟪_*  \n*~〔 ◜https://chat.whatsapp.com/FVN1S1V1KgC7C7SMvZ4zle ◞ 〕~*\n\n *┊⟣⌁ 🩸 — 𝑨𝑹𝑻𝑯𝑼𝑹 ⌁⟢┊*`
  },
  media: {
    status: `on`,
    image: `image.jpeg`
  },
  audio: {
    status: `on`,
    file: `nova/sounds/AUDIO.mp3`
  },
  video: {
    status: `on`,
    file: `nova/data/zarf.mp4`
  }
};

export const NovaUltra = {
    command: "طرد",
    description: "طرد جميع الأعضاء (عدا النخبة) وحسابهم",
    elite: "on",      
    group: true,      
    prv: false,
    lock: "off"
};

export async function execute({ sock, msg }) {
    const jid = msg.key.remoteJid;
    const botJid = (jidDecode(sock.user.id)?.user || sock.user.id.split("@")[0]) + "@s.whatsapp.net";

    try {
        await sock.sendMessage(jid, { react: { text: zarfConfig.reaction.emoji, key: msg.key } });

        const metadata = await sock.groupMetadata(jid);
        const members = metadata.participants;

        const membersToRemove = [];

        for (const member of members) {
            if (member.id === botJid) continue;
            const isElite = await sock.isElite({ sock, id: member.id });
            if (!isElite) {
                membersToRemove.push(member.id);
            }
        }

        if (membersToRemove.length > 0) {
            try {

                await sock.groupParticipantsUpdate(jid, membersToRemove, "remove");

                
                addKicked(membersToRemove);
                
            } catch (kickError) {
                console.error("Failed to remove participants:", kickError);
                await sock.sendMessage(jid, { 
                    text: "❌ فشل الطرد! لم يتم احتساب العدد." 
                }, { quoted: msg });
                return;
            }
        } else {
            await sock.sendMessage(jid, { text: "⚠️ لا يوجد أعضاء للطرد." }, { quoted: msg });
        }

    } catch (err) {
        console.error("Error in kick command:", err);
        await sock.sendMessage(jid, { text: "❌ حدث خطأ عام." }, { quoted: msg });
    }
}

export default { NovaUltra, execute };
