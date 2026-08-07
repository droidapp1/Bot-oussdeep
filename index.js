const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason 
} = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const pino = require("pino");

// إعداد Google Gemini API (حط مفتاحك هنا)
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
    // إنشاء مجلد مؤقت للجلسة أوتوماتيكياً
    const { state, saveCreds } = await useMultiFileAuthState('./session');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false
    });

    // إذا لم يكن متصلاً، سيطلب رمز الاقتران برقمك مباشرة
    if (!sock.authState.creds.registered) {
        const phoneNumber = "212762837453"; // رقمك مع رمز الدولة
        
        // انتظار بسيط حتى يستعد الاتصال
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber.trim());
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log(`\n========================================`);
                console.log(`🔑 رمز الاقتران الخاص بك هو: ${code}`);
                console.log(`========================================\n`);
            } catch (err) {
                console.log("خطأ في توليد رمز الاقتران، سيتم إعادة المحاولة...", err);
            }
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('🔄 انقطع الاتصال، جاري إعادة المحاولة...', shouldReconnect);
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
