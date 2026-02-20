# EcoLoop — Полный гайд по деплою

---

## 1. GitHub — заливка проекта

### 1.1. Подготовка файлов

Структура для заливки:
```
EcoLoop/
├── index.html          ← переименованный index-full.html
├── README.md
├── DEPLOY-GUIDE.md
├── .gitignore
├── firebase.json       ← (создадим в п.3)
└── functions/          ← (создадим в п.3)
    ├── index.js
    └── package.json
```

### 1.2. Переименуй главный файл
```powershell
cd C:\Users\malik\CascadeProjects\EcoLoop
copy index-full.html index.html
```

### 1.3. Создай .gitignore
```
node_modules/
.firebase/
.env
functions/node_modules/
```

### 1.4. Залей на GitHub
```powershell
# Если Git ещё не установлен — скачай: https://git-scm.com/downloads

cd C:\Users\malik\CascadeProjects\EcoLoop

git init
git add .
git commit -m "Initial commit: EcoLoop platform"

# Создай репозиторий на https://github.com/new → имя: EcoLoop → НЕ добавляй README
# Затем:

git remote add origin https://github.com/ТВОЙ_USERNAME/EcoLoop.git
git branch -M main
git push -u origin main
```

> После push ты увидишь свой код на `github.com/ТВОЙ_USERNAME/EcoLoop`

---

## 2. Telegram-бот — полная настройка

### 2.1. Создание бота

1. Открой Telegram → найди **@BotFather**
2. Отправь: `/newbot`
3. Введи имя бота: `EcoLoop Notifications`
4. Введи username бота: `ecoloop_notify_bot` (должен быть уникальным)
5. **BotFather вернёт токен** — скопируй его, выглядит так:
   ```
   7123456789:AAH1bGciOiJIUzI1NiJ9abc123def456
   ```

### 2.2. Получение Chat ID

1. Открой своего бота в Telegram → нажми **Start**
2. Отправь ему любое сообщение, например: `hello`
3. Открой в браузере:
   ```
   https://api.telegram.org/bot<ТВОЙ_ТОКЕН>/getUpdates
   ```
4. В JSON-ответе найди `"chat": {"id": 123456789}` — это твой **CHAT_ID**

### 2.3. Вставь токены в код

Открой `index.html` (бывший `index-full.html`), найди функцию `sendToTelegram` и замени:

```javascript
const TG_BOT_TOKEN = '7123456789:XXXXXXXXXXXXXXXXXXXXXXX'; // ← твой токен
const TG_CHAT_ID = '123456789';                            // ← твой chat id
```

### 2.4. Проверка

Открой `index.html` в браузере → заполни форму обратного звонка или форму отеля → после отправки в Telegram-боте должно прийти сообщение.

> **Важно:** Для продакшена `sendToTelegram` лучше вызывать через Firebase Cloud Function (см. п.3), а не напрямую из браузера — иначе токен бота будет виден в DevTools.

---

## 3. Firebase — бэкенд (Firestore + Functions)

### 3.1. Установка Firebase CLI

```powershell
# Установи Node.js если нет: https://nodejs.org/ (LTS версия)

npm install -g firebase-tools
firebase login
```

### 3.2. Создание проекта Firebase

1. Перейди на https://console.firebase.google.com/
2. Нажми **"Add project"** → имя: `ecoloop-platform`
3. Отключи Google Analytics (не нужен пока)
4. Создай проект

### 3.3. Включи Firestore

1. В Firebase Console → **Build** → **Firestore Database**
2. Нажми **"Create database"**
3. Выбери **"Start in test mode"** (потом закроешь правила)
4. Выбери регион: `europe-west1` (ближайший к KZ)

### 3.4. Инициализация в проекте

```powershell
cd C:\Users\malik\CascadeProjects\EcoLoop
firebase init
```

Выбери:
- [x] **Firestore** — для базы данных
- [x] **Functions** — для серверных функций
- [x] **Hosting** — для хостинга (опционально, мы используем Cloudflare)

Настройки:
- Project: выбери `ecoloop-platform`
- Firestore Rules: нажми Enter (по умолчанию)
- Functions language: **JavaScript**
- ESLint: **No**
- Install dependencies: **Yes**

### 3.5. Cloud Function для Telegram-бота

Замени содержимое `functions/index.js`:

```javascript
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

admin.initializeApp();
const db = admin.firestore();

// Конфиг — задай через: firebase functions:config:set telegram.token="XXX" telegram.chat="YYY"
const TG_TOKEN = functions.config().telegram?.token || "PLACEHOLDER";
const TG_CHAT  = functions.config().telegram?.chat  || "PLACEHOLDER";

// API endpoint: принимает заявки и шлёт в Telegram
exports.submitForm = functions.https.onRequest(async (req, res) => {
  // CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { type, data } = req.body;

    // Сохраняем в Firestore
    await db.collection("submissions").add({
      type,
      data,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Формируем сообщение
    let text = `📩 *Новая заявка: ${type}*\n\n`;
    for (const [key, value] of Object.entries(data)) {
      text += `*${key}:* ${value}\n`;
    }

    // Отправляем в Telegram
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TG_CHAT,
        text,
        parse_mode: "Markdown",
      }),
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
});
```

### 3.6. Установи зависимости functions

```powershell
cd C:\Users\malik\CascadeProjects\EcoLoop\functions
npm install node-fetch@2
```

> Используем `node-fetch@2` — версия 3 требует ESM.

### 3.7. Задай конфиг Telegram

```powershell
cd C:\Users\malik\CascadeProjects\EcoLoop
firebase functions:config:set telegram.token="7123456789:XXXXXXX" telegram.chat="123456789"
```

### 3.8. Деплой functions

```powershell
firebase deploy --only functions
```

После деплоя Firebase покажет URL:
```
https://us-central1-ecoloop-platform.cloudfunctions.net/submitForm
```

### 3.9. Обнови sendToTelegram в index.html

Замени текущую функцию `sendToTelegram` на:

```javascript
async function sendToTelegram(type, data) {
  try {
    const res = await fetch('https://us-central1-ecoloop-platform.cloudfunctions.net/submitForm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, data })
    });
    const result = await res.json();
    console.log('✅ Заявка отправлена:', result);
  } catch (err) {
    console.error('❌ Ошибка отправки:', err);
  }
}
```

> Теперь токен бота не виден в браузере — он хранится в Firebase Config.

---

## 4. Cloudflare Pages — хостинг фронтенда

### 4.1. Подключение

1. Зайди на https://dash.cloudflare.com/ → зарегистрируйся (бесплатно)
2. В левом меню: **Workers & Pages** → **Create**
3. Выбери вкладку **Pages** → **Connect to Git**
4. Авторизуй GitHub → выбери репозиторий `EcoLoop`

### 4.2. Настройка билда

- **Production branch:** `main`
- **Build command:** *(оставь пустым)*
- **Build output directory:** `/` *(корень, т.к. у нас просто index.html)*

> Cloudflare Pages отлично работает со статическими HTML — билд не нужен.

### 4.3. Деплой

Нажми **"Save and Deploy"** — Cloudflare заберёт код с GitHub и задеплоит.

Через 1-2 минуты сайт будет доступен по адресу:
```
https://ecoloop.pages.dev
```

### 4.4. Свой домен (опционально)

1. В настройках проекта → **Custom domains**
2. Добавь свой домен, например: `ecoloop.kz`
3. Cloudflare покажет DNS-записи — добавь их у своего регистратора
4. SSL сертификат выдаётся автоматически

### 4.5. Auto-deploy

Каждый `git push` в `main` автоматически обновит сайт на Cloudflare Pages.

```powershell
# Внёс изменения → коммит → push → сайт обновился
git add .
git commit -m "update: новая фича"
git push
```

---

## 5. PayBox.money — песочница для оплаты (Казахстан)

### 5.1. Регистрация

1. Перейди на https://paybox.money/
2. Нажми **"Подключиться"** / **"Регистрация"**
3. Укажи данные компании (для теста можно ИП)
4. После регистрации получишь доступ в **личный кабинет продавца**

### 5.2. Sandbox (тестовый режим)

1. В личном кабинете PayBox → **Настройки** → **Тестовый режим**
2. Включи **Sandbox**
3. Скопируй:
   - **Merchant ID** (например: `123456`)
   - **Secret Key** (например: `abcdef123456`)

### 5.3. Тестовые карты PayBox

| Карта              | Результат       |
|--------------------|-----------------|
| 4111 1111 1111 1111 | Успешная оплата |
| 4000 0000 0000 0002 | Отказ           |
| Срок: любой будущий | CVV: 123        |

### 5.4. Cloud Function для инициализации оплаты

Добавь в `functions/index.js`:

```javascript
const crypto = require("crypto");

const PB_MERCHANT_ID = functions.config().paybox?.merchant || "PLACEHOLDER";
const PB_SECRET_KEY  = functions.config().paybox?.secret  || "PLACEHOLDER";

// Генерация подписи PayBox
function makePayboxSignature(params, secretKey) {
  const sorted = Object.keys(params).sort();
  const str = sorted.map(k => params[k]).join(";");
  const sigStr = "payment.php;" + str + ";" + secretKey;
  return crypto.createHash("md5").update(sigStr).digest("hex");
}

exports.createPayment = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }

  const { amount, description, orderId, userEmail } = req.body;

  const params = {
    pg_merchant_id: PB_MERCHANT_ID,
    pg_amount: amount,
    pg_description: description,
    pg_order_id: orderId,
    pg_user_contact_email: userEmail || "",
    pg_salt: crypto.randomBytes(8).toString("hex"),
    pg_testing_mode: "1",  // ← 1 = sandbox, убери для продакшена
    pg_result_url: "https://us-central1-ecoloop-platform.cloudfunctions.net/payboxResult",
    pg_success_url: "https://ecoloop.pages.dev/?payment=success",
    pg_failure_url: "https://ecoloop.pages.dev/?payment=fail",
  };

  params.pg_sig = makePayboxSignature(params, PB_SECRET_KEY);

  // Формируем URL
  const qs = new URLSearchParams(params).toString();
  const paymentUrl = `https://api.paybox.money/payment.php?${qs}`;

  // Сохраняем заказ в Firestore
  await db.collection("orders").doc(orderId).set({
    amount,
    description,
    status: "pending",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  res.json({ paymentUrl });
});

// Webhook от PayBox — подтверждение оплаты
exports.payboxResult = functions.https.onRequest(async (req, res) => {
  const { pg_order_id, pg_result } = req.body;

  if (pg_result === "1") {
    await db.collection("orders").doc(pg_order_id).update({
      status: "paid",
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Уведомление в Telegram
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TG_CHAT,
        text: `💰 *Оплата получена!*\nЗаказ: ${pg_order_id}`,
        parse_mode: "Markdown",
      }),
    });
  }

  res.send("OK");
});
```

### 5.5. Задай конфиг PayBox

```powershell
firebase functions:config:set paybox.merchant="123456" paybox.secret="abcdef123456"
firebase deploy --only functions
```

### 5.6. Вызов оплаты из фронтенда

В `index.html` — замени симуляцию оплаты в `LotDetail` на:

```javascript
async function handlePayment(lot) {
  const orderId = 'ORD-' + Date.now();
  const res = await fetch('https://us-central1-ecoloop-platform.cloudfunctions.net/createPayment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: lot.price,
      description: `EcoLoop: ${lot.title}`,
      orderId: orderId,
    })
  });
  const { paymentUrl } = await res.json();
  window.location.href = paymentUrl; // Редирект на страницу оплаты PayBox
}
```

---

## Порядок действий (чеклист)

| # | Шаг | Команда / Действие |
|---|------|-------------------|
| 1 | Переименуй файл | `copy index-full.html index.html` |
| 2 | Создай GitHub репо | github.com/new → `EcoLoop` |
| 3 | git init + push | См. п.1.4 |
| 4 | Создай TG бота | @BotFather → `/newbot` |
| 5 | Получи Chat ID | `api.telegram.org/bot.../getUpdates` |
| 6 | Вставь токены | В `sendToTelegram` в index.html |
| 7 | Firebase проект | console.firebase.google.com |
| 8 | firebase init | Firestore + Functions + Hosting |
| 9 | Напиши functions | `functions/index.js` (из п.3.5) |
| 10 | firebase deploy | `firebase deploy --only functions` |
| 11 | Замени sendToTelegram | На fetch к Cloud Function URL |
| 12 | Cloudflare Pages | dash.cloudflare.com → Connect Git |
| 13 | PayBox регистрация | paybox.money → sandbox mode |
| 14 | Добавь createPayment | В functions + задай config |
| 15 | Тест оплаты | Карта 4111 1111 1111 1111 |

---

## Бесплатные лимиты

| Сервис | Бесплатно |
|--------|-----------|
| **GitHub** | Безлимит для публичных репо |
| **Cloudflare Pages** | 500 деплоев/мес, безлимит трафик |
| **Firebase Firestore** | 50K чтений/день, 20K записей/день |
| **Firebase Functions** | 2M вызовов/мес |
| **Telegram Bot API** | Полностью бесплатно |
| **PayBox Sandbox** | Бесплатно для тестов |

> Для MVP и первых 100-500 пользователей этого хватит с запасом.
