const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
// Увеличиваем лимит, так как коллекции могут быть тяжелыми
app.use(express.json({ limit: '50mb' })); 

// 1. Подключение к MongoDB
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://sergevavilin_db_user:6jDW62GJ0aDnIIBj@cluster0.q9aecqy.mongodb.net/Cluster0?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas'))
    .catch(err => console.error('❌ MongoDB connection error:', err));

// ==========================================
// 2. СХЕМЫ ДАННЫХ
// ==========================================

// --- Метрики юзеров ---
const MetricSchema = new mongoose.Schema({
    userId: { type: String, required: true },  // Идентификатор "папки" юзера
    dayKey: { type: String, required: true },  // Уникальный ключ дня (например, 2026-03-01)
    data: Object,                              // Сами метрики
    receivedAt: { type: Date, default: Date.now }
});
// Создаем составной индекс, чтобы у 1 юзера был 1 отчет в 1 день
MetricSchema.index({ userId: 1, dayKey: 1 }, { unique: true });
const Metric = mongoose.model('Metric', MetricSchema);

// --- Коллекции (Базы тестов) ---
const AdminCollectSchema = new mongoose.Schema({
    id: String,           // 'akush' (Нужно добавить руками в БД)
    title: String,        // 'Акушерство' (Нужно добавить руками в БД)
    description: String,  // Описание (Нужно добавить руками в БД)
    version: String,      // '1.0' (Нужно добавить руками в БД)
    filename: String,     // 'akush.goose'
    content: Buffer,      // Бинарные данные архива (BSON)
    size_bytes: Number
}, { collection: 'Admin_Collect' }); // Явно указываем твою коллекцию
const AdminCollect = mongoose.model('AdminCollect', AdminCollectSchema);


// ==========================================
// 3. API МАГАЗИНА И КОЛЛЕКЦИЙ
// ==========================================

/**
 * 1 & 2. Отдача метаданных для Стора (Имитация store.json)
 * Клиент запрашивает это, чтобы понять, что есть на сервере и что удалили.
 * Мы исключаем поле `content` (-content), чтобы не гонять мегабайты лишних данных!
 */
app.get('/api/store', async (req, res) => {
    try {
        const files = await AdminCollect.find({}, '-content');
        
        // Форматируем под тот вид, который ждет твой StoreScreen.ts
        const storeData = files.map(f => ({
            id: f.id || f.filename.split('.')[0],
            title: f.title || f.filename,
            description: f.description || '',
            file: f.filename,
            version: f.version || '1.0'
        }));
        
        res.json(storeData);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * 3. Скачивание самой коллекции (.goose архива)
 */
app.get('/api/download/:filename', async (req, res) => {
    try {
        const fileDoc = await AdminCollect.findOne({ filename: req.params.filename });
        
        if (!fileDoc || !fileDoc.content) {
            return res.status(404).json({ error: 'Коллекция не найдена на сервере' });
        }

        // Отдаем бинарный буфер прямо в HTTP-ответ. 
        // fetch().blob() на клиенте съест это идеально.
        res.set('Content-Type', 'application/octet-stream');
        res.set('Content-Disposition', `attachment; filename="${fileDoc.filename}"`);
        res.send(fileDoc.content);

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// ==========================================
// 4. API МЕТРИК
// ==========================================

app.post('/metrics/upload', async (req, res) => {
    try {
        // Теперь мы требуем userId
        const { userId, dayKey, data } = req.body;

        if (!userId || !dayKey || !data) {
            return res.status(400).json({ error: 'Missing userId, dayKey, or data fields' });
        }

        // Сохраняем в базу с привязкой к конкретному юзеру
        await Metric.findOneAndUpdate(
            { userId, dayKey },
            { data },
            { upsert: true, new: true }
        );

        console.log(`[Metrics] Saved report for user: ${userId}, day: ${dayKey}`);
        res.status(201).json({ status: 'saved' });
    } catch (e) {
        console.error('Upload error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});
