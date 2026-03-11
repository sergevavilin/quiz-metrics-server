const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); 

// 1. Подключение к MongoDB
const MONGO_URI = process.env.MONGO_URI; 

if (!MONGO_URI) {
    console.error("❌ КРИТИЧЕСКАЯ ОШИБКА: Переменная MONGO_URI не задана в настройках сервера!");
    process.exit(1);
}

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas'))
    .catch(err => console.error('❌ MongoDB connection error:', err));

// ==========================================
// 2. СХЕМЫ ДАННЫХ (Collections)
// ==========================================

// --- 1. Коллекция Метрик (User_Metrics) ---
const MetricSchema = new mongoose.Schema({
    userId: { type: String, required: true },  
    date: { type: String, required: true },    // "2026-03-03"
    dayKey: { type: String, required: true },  // "UUID_DATE"
    sessions: Array,                           // Массив сессий из твоего DailyReport
    isNewUser: { type: Boolean, default: false }, // Флаг регистрации
    receivedAt: { type: Date, default: Date.now }
}, { collection: 'metrics' });

MetricSchema.index({ dayKey: 1 }, { unique: true });
const Metric = mongoose.model('Metric', MetricSchema);

// --- 2. Коллекция Репортов (Reports) ---
const ReportSchema = new mongoose.Schema({
    userId: String,
    date: String,
    category: String,      // typo, wrong_answer, bug и т.д.
    text: String,          // Текст сообщения юзера
    context: Object,       // Сюда автоматически упадут screen, collectionId, questionId
    status: { type: String, default: 'new' }, 
    receivedAt: { type: Date, default: Date.now }
}, { collection: 'Report' }); // <-- Без 's', как мы и договаривались
const Report = mongoose.model('Report', ReportSchema);

// --- 3. Коллекция Стора (Store_Collect) ---
const AdminCollectSchema = new mongoose.Schema({
    id: String,
    title: String,
    description: String,
    version: String,
    filename: String,
    amount_q: Number, // <--- ДОБАВИЛИ ЭТО ПОЛЕ
    content: Buffer, 
    size_bytes: Number
}, { collection: 'Store_Collect' });
const AdminCollect = mongoose.model('Admin_Collect', AdminCollectSchema);

// --- 4. Коллекция Бета-тестеров (BetaTesters) ---
const BetaTesterSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    joinedAt: { type: Date, default: Date.now }
}, { collection: 'BetaTesters' });
const BetaTester = mongoose.model('BetaTester', BetaTesterSchema);
// ==========================================
// 3. API МЕТРИК И РЕГИСТРАЦИИ
// ==========================================

/**
 * Регистрация "Первого контакта"
 */
app.post('/metrics/register', async (req, res) => {
    try {
        const { userId, date } = req.body;
        
        // Создаем запись-"пустышку", которая помечает юзера как активного
        await Metric.findOneAndUpdate(
            { dayKey: `reg_${userId}` }, 
            { userId, date, isNewUser: true },
            { upsert: true }
        );

        console.log(`[Auth] New user registered: ${userId}`);
        res.status(201).json({ status: 'registered' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Загрузка дневного отчета (UUID_DATE.json)
 */
app.post('/metrics/upload', async (req, res) => {
    try {
        const { dayKey, userId, date, sessions } = req.body;

        await Metric.findOneAndUpdate(
            { dayKey },
            { userId, date, sessions, isNewUser: false },
            { upsert: true, new: true }
        );

        console.log(`[Metrics] Snapshot saved: ${dayKey}`);
        res.status(200).json({ status: 'ok' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// 4. API РЕПОРТОВ (Жалоб)
// ==========================================

app.post('/api/report', async (req, res) => {
    try {
        const reportData = req.body;
        const newReport = new Report(reportData);
        await newReport.save();

        console.log(`[Report] New issue from ${reportData.userId} on ${reportData.screen}`);
        res.status(201).json({ status: 'received' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// ==========================================
// 5. API МАГАЗИНА
// ==========================================

app.get('/api/store', async (req, res) => {
    try {
        const files = await AdminCollect.find({}, '-content');
        const storeData = files.map(f => ({
            id: f.id || f.filename.split('.')[0],
            title: f.title || f.filename,
            description: f.description || '',
            file: f.filename,
            version: f.version || '1.0',
            amount_q: f.amount_q || 0 // <--- ТЕПЕРЬ СЕРВЕР ОТДАЕТ ЭТУ ЦИФРУ ГУСЮ
        }));
        res.json(storeData);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/download/:filename', async (req, res) => {
    try {
        const fileDoc = await AdminCollect.findOne({ filename: req.params.filename });
        if (!fileDoc) return res.status(404).send('Not found');
        res.set('Content-Type', 'application/octet-stream');
        res.send(fileDoc.content);
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// ==========================================
// 6. API НОВОСТЕЙ И РАССЫЛОК
// ==========================================

// Отдача правильной новости
app.get('/api/news/latest', async (req, res) => {
    try {
        const userId = req.query.userId;
        if (!userId) return res.status(400).json({ error: "userId required" });

        // 1. Проверяем, есть ли юзер в списке тестеров
        const isTester = await BetaTester.findOne({ userId });

        if (isTester) {
            // ИНДИВИДУАЛЬНАЯ (Чувак уже дал почту)

            // ВАРИАНТ А: Ссылки еще нет (Апрель, ждем апрува от Google)
            // Идеально - вообще ничего не присылать, чтобы не спамить юзера пустыми окнами каждый день.
             return res.json(null); 

            // ВАРИАНТ Б: Ссылка появилась (Май, Гусь в Google Play)
            /*return res.json({
                id: 'v2_beta_ready', 
                title: '✅ Гусь в Google Play!',
                description: 'Спасибо за ожидание! Ваша почта добавлена в список тестеров. Скачайте официальную бету по ссылке ниже.',
                isForm: false, // <--- ВОТ ОНО! Прячем поле ввода почты
                link: 'https://play.google.com/apps/testing/com.goose.learn' // <--- Даем ссылку
            });*/
            
        } else {
            return res.json(null);
            // МАССОВАЯ (Чувак еще не дал почту)
            /*return res.json({
                id: 'global_update_v1', 
                title: 'ГЛОБАЛЬНОЕ ОБНОВЛЕНИЕ',
                description: 'Гусь готовится к вылету в Google Play! Нам нужны 20 верных тестеров для прохождения модерации.',
                isForm: true // <--- Явно говорим: "Рисуй инпут для почты!"
            });*/
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}); // <--- ВОТ ЭТА СКОБКА БЫЛА ПРОПУЩЕНА!

// Сохранение почты от юзера
app.post('/api/news/subscribe', async (req, res) => {
    try {
        const { newsId, userId, email } = req.body;
        
        // Используем upsert: если юзера нет - создаем, если есть - обновляем почту
        await BetaTester.findOneAndUpdate(
            { userId: userId },
            { email: email, joinedAt: new Date() },
            { upsert: true }
        );

        console.log(`[Beta] New tester recorded: ${email} (User: ${userId})`);
        res.status(200).json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 GooseServer v0.1 running on ${PORT}`));

app.get('/api/ping', (req, res) => {
    res.status(200).send('🪿 Honk! Server is awake.');
});




