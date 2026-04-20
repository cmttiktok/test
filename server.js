const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const axios = require('axios');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);

// SỬA LỖI 502: Ép dùng websocket để mượt mà trên Render
const io = new Server(server, { 
    cors: { origin: "*" },
    transports: ['websocket'] 
});

app.use(express.json());
app.use(express.static('public')); // Để phục vụ các file giao diện

const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI).then(() => console.log("✅ MongoDB Connected"));

const BannedWord = mongoose.model('BannedWord', { word: String });
const Acronym = mongoose.model('Acronym', { key: String, value: String });
const EmojiMap = mongoose.model('EmojiMap', { icon: String, text: String });
const BotAnswer = mongoose.model('BotAnswer', { keyword: String, response: String });

// --- CÁC HÀM XỬ LÝ LOGIC (GIỮ NGUYÊN BẢN GỐC CỦA BẠN) ---
async function isBanned(name) {
    const list = await BannedWord.find();
    return list.some(b => name.toLowerCase().includes(b.word.toLowerCase()));
}

async function processText(text) {
    let t = text;
    const acrs = await Acronym.find();
    acrs.forEach(a => { t = t.split(a.key).join(a.value); });
    const emos = await EmojiMap.find();
    emos.forEach(e => { t = t.split(e.icon).join(e.text); });
    return t;
}

async function getGoogleAudio(text) {
    return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=vi&client=tw-ob`;
}

// --- KẾT NỐI TIKTOK ---
io.on('connection', (socket) => {
    let tiktok;
    let pkTimer = null;

    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username);
        
        tiktok.connect().then(() => socket.emit('status', `Đã kết nối: ${username}`)).catch(e => socket.emit('status', 'Lỗi kết nối'));

        tiktok.on('chat', async (data) => {
            if (!(await isBanned(data.nickname))) {
                const safeMsg = await processText(data.comment);
                const audio = await getGoogleAudio(`${data.nickname} nói: ${safeMsg}`);
                socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, audio });
                
                // Bot trả lời tự động
                const bots = await BotAnswer.find();
                for (const b of bots) {
                    if (data.comment.toLowerCase().includes(b.keyword.toLowerCase())) {
                        const botAudio = await getGoogleAudio(b.response);
                        socket.emit('audio-data', { type: 'bot', user: "TRỢ LÝ", comment: b.response, audio: botAudio });
                        break;
                    }
                }
            }
        });

        tiktok.on('linkMicBattle', () => {
            if (pkTimer) clearInterval(pkTimer);
            let timeLeft = 300; 
            pkTimer = setInterval(async () => {
                timeLeft--;
                if (timeLeft === 20) {
                    const audio = await getGoogleAudio("thả bông 20 giây cuối bèo ơi");
                    socket.emit('audio-data', { type: 'pk', user: "HỆ THỐNG", comment: "NHẮC PK 20S", audio });
                }
                if (timeLeft <= 0) clearInterval(pkTimer);
            }, 1000);
        });

        tiktok.on('member', async (data) => {
            const audio = await getGoogleAudio(`Chào anh ${data.nickname} ghé chơi`);
            socket.emit('audio-data', { type: 'welcome', user: "Hệ thống", comment: `${data.nickname} vào`, audio });
        });

        tiktok.on('gift', async (data) => {
            if (data.repeatEnd) {
                const audio = await getGoogleAudio(`Cảm ơn ${data.nickname} tặng ${data.giftName}`);
                socket.emit('audio-data', { type: 'gift', user: "QUÀ", comment: `${data.nickname} tặng ${data.giftName}`, audio });
            }
        });
    });

    socket.on('disconnect', () => { if (tiktok) tiktok.disconnect(); });
});

// API Quản trị giữ nguyên...
app.get('/api/words', async (req, res) => res.json((await BannedWord.find()).map(w => w.word)));
app.post('/api/words', async (req, res) => { const w = new BannedWord({word: req.body.word}); await w.save(); res.json({s:1}); });
app.delete('/api/words/:word', async (req, res) => { await BannedWord.deleteOne({word: req.params.word}); res.json({s:1}); });
app.get('/api/acronyms', async (req, res) => res.json(await Acronym.find()));
app.post('/api/acronyms', async (req, res) => { const a = new Acronym(req.body); await a.save(); res.json({s:1}); });
app.delete('/api/acronyms/:key', async (req, res) => { await Acronym.deleteOne({key: req.params.key}); res.json({s:1}); });
app.get('/api/emojis', async (req, res) => res.json(await EmojiMap.find()));
app.post('/api/emojis', async (req, res) => { const e = new EmojiMap(req.body); await e.save(); res.json({s:1}); });
app.delete('/api/emojis/:id', async (req, res) => { await EmojiMap.deleteOne({_id: req.params.id}); res.json({s:1}); });
app.get('/api/bot', async (req, res) => res.json(await BotAnswer.find()));
app.post('/api/bot', async (req, res) => { const b = new BotAnswer(req.body); await b.save(); res.json({s:1}); });
app.delete('/api/bot/:id', async (req, res) => { await BotAnswer.deleteOne({_id: req.params.id}); res.json({s:1}); });

server.listen(process.env.PORT || 3000, () => console.log('🚀 Server is running...'));
