const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason 
} = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const pino = require("pino");
const fs = require('fs');

const API_KEY = "YOUR_GEMINI_API_KEY"; 
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

async function getAIResponse(prompt) {
    try {
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (error) {
        return "عذراً، حدث خطأ أثناء الاتصال بالذكاء الاصطناعي.";
    }
}

async function startBot() {
    const sessionPath = './session';
    if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false
    });

    if (!sock.authState.creds.registered) {
        // تأكد أن هذا هو رقمك الصحيح تماماً مع رمز الدولة بدون فراغات زائدة
        const phoneNumber = "212762837453"; 
        
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log(`\n========================================`);
                console.log(`🔑 رمز الاقتران الجديد هو: ${code}`);
                console.log(`========================================\n`);
            } catch (err) {
                console.log("خطأ في توليد رمز الاقتران:", err);
            }
        }, 5000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ تم اتصال البوت بالواتساب بنجاح!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const from = msg.key.remoteJid;
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

            if (text === '!menu' || text === '!help') {
                const menuText = `🤖 *أوامر البوت:* \n\n` +
                                `📋 \`!menu\` - عرض القائمة\n` +
                                `⚡ \`!ping\` - فحص العمل\n` +
                                `🤖 \`!ai [سؤالك]\``;
                await sock.sendMessage(from, { text: menuText });
            }
            else if (text === '!ping') {
                await sock.sendMessage(from, { text: '⚡ البوت شغال بنجاح!' });
            }
            else if (text.startsWith('!ai ')) {
                const prompt = text.replace('!ai ', '');
                await sock.sendMessage(from, { text: '⏳ جاري التفكير...' });
                const aiReply = await getAIResponse(prompt);
                await sock.sendMessage(from, { text: aiReply });
            }
        }
    });
}

startBot();
