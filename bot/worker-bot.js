// ====================================
// EcoLoop Telegram Bot v3.0 — Express.js (Render)
// Одобрения отелей/постов + inline кнопки + антиспам
// ====================================

const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

const TG_TOKEN = '8547995948:AAGP-JDNJowAvmTqMK04n9rNZ16519dp2C8';
const TG_CHAT  = '7682446178';
const TG_API   = `https://api.telegram.org/bot${TG_TOKEN}`;
const PORT = process.env.PORT || 3000;

// ===== АДМИНЫ (только эти chat_id могут использовать /admin команды) =====
const ADMINS = [
  7682446178,  // Маликов Алихан (основной)
];

// ===== ХРАНИЛИЩЕ (в памяти) =====
const rateLimit = new Map();
const pendingApprovals = new Map();
let approvalCounter = 0;

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW = 60000;

function isRateLimited(chatId) {
  const now = Date.now();
  const userHits = rateLimit.get(chatId) || [];
  const recent = userHits.filter(t => now - t < RATE_LIMIT_WINDOW);
  recent.push(now);
  rateLimit.set(chatId, recent);
  return recent.length > RATE_LIMIT_MAX;
}

function isAdmin(chatId) {
  return ADMINS.includes(chatId);
}

// ===== CORS =====
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ===== HEALTH CHECK (UptimeRobot) =====
app.get('/', (req, res) => {
  res.json({
    bot: 'EcoLoop Bot v3.0',
    status: 'running',
    uptime: new Date().toISOString(),
    pending: pendingApprovals.size
  });
});

// ===== TELEGRAM WEBHOOK =====
app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    if (update.message) await handleMessage(update);
    if (update.callback_query) await handleCallback(update.callback_query);
    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(200);
  }
});

// ===== ПРИЁМ ЗАЯВОК С САЙТА =====
app.post('/api/submit', async (req, res) => {
  try {
    const { type, data } = req.body;
    const id = ++approvalCounter;

    if (type === 'hotel') {
      pendingApprovals.set(id, { type: 'hotel', data, timestamp: new Date().toISOString() });

      let text = `🏨 *НОВАЯ ЗАЯВКА ОТЕЛЯ — ЖДЁТ ОДОБРЕНИЯ*\n🆔 #${id}\n\n`;
      for (const [key, value] of Object.entries(data)) {
        if (value) text += `*${key}:* ${value}\n`;
      }
      text += `\n🕐 ${new Date().toLocaleString('ru-RU')}`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '✅ Одобрить', callback_data: `approve_hotel_${id}` },
            { text: '❌ Отклонить', callback_data: `reject_hotel_${id}` }
          ],
          [{ text: '📞 Позвонить', callback_data: `call_hotel_${id}` }]
        ]
      };
      await sendMessageWithKeyboard(TG_CHAT, text, keyboard);
      res.json({ success: true, message: 'Заявка отправлена на рассмотрение' });

    } else if (type === 'post') {
      pendingApprovals.set(id, { type: 'post', data, timestamp: new Date().toISOString() });

      let text = `📝 *НОВЫЙ ПОСТ — ЖДЁТ МОДЕРАЦИИ*\n🆔 #${id}\n\n`;
      for (const [key, value] of Object.entries(data)) {
        if (value) text += `*${key}:* ${value}\n`;
      }
      text += `\n🕐 ${new Date().toLocaleString('ru-RU')}`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '✅ Опубликовать', callback_data: `approve_post_${id}` },
            { text: '❌ Отклонить', callback_data: `reject_post_${id}` }
          ],
          [{ text: '✏️ Запросить правки', callback_data: `edit_post_${id}` }]
        ]
      };
      await sendMessageWithKeyboard(TG_CHAT, text, keyboard);
      res.json({ success: true, message: 'Пост отправлен на модерацию' });

    } else {
      const labels = { callback: '📞 Обратный звонок', request: '📋 Новый запрос', buyer: '👤 Регистрация покупателя' };
      let text = `${labels[type] || '📩 Новая заявка'}\n\n`;
      for (const [key, value] of Object.entries(data)) {
        if (value) text += `*${key}:* ${value}\n`;
      }
      text += `\n🕐 ${new Date().toLocaleString('ru-RU')}`;
      await sendMessage(TG_CHAT, text);
      res.json({ success: true });
    }
  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== ОБРАБОТКА СООБЩЕНИЙ =====
async function handleMessage(update) {
  const msg = update.message;
  if (!msg.text) return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const name = msg.from.first_name || 'Пользователь';
  const username = msg.from.username || '';
  const userId = msg.from.id;

  // Антиспам
  if (isRateLimited(chatId)) {
    await sendMessage(chatId, '⛔ Слишком много сообщений. Подождите минуту.');
    return;
  }

  // ===== ПУБЛИЧНЫЕ КОМАНДЫ =====

  if (text === '/start') {
    const keyboard = {
      inline_keyboard: [
        [
          { text: '🛍️ Лоты', callback_data: 'lots' },
          { text: '📊 Статистика', callback_data: 'stats' }
        ],
        [
          { text: '📝 Оставить заявку', callback_data: 'request' },
          { text: '💰 Цены', callback_data: 'prices' }
        ],
        [
          { text: '🏨 Для отелей', callback_data: 'forhotels' },
          { text: '📞 Контакты', callback_data: 'contacts' }
        ],
        [
          { text: '🌿 О проекте', callback_data: 'about' },
          { text: '❓ FAQ', callback_data: 'faq' }
        ],
        [
          { text: '🌐 Открыть сайт', url: 'https://ecoloop.pages.dev' }
        ]
      ]
    };
    await sendMessageWithKeyboard(chatId, `🌿 *Привет, ${name}!*

Добро пожаловать в *EcoLoop* — маркетплейс для перераспределения излишков отелей Казахстана.

Выбери что интересует:`, keyboard);
    return;
  }

  if (text === '/help') {
    const msg = `📋 *Команды EcoLoop Bot:*

👤 *Для всех:*
/start — Главное меню с кнопками
/lots — Активные лоты со скидками
/stats — Статистика платформы
/request — Оставить заявку
/contacts — Связаться с менеджером
/about — О проекте EcoLoop
/prices — Как формируются цены
/forhotels — Информация для отелей
/faq — Частые вопросы
/feedback — Оставить отзыв

📝 Написать: _Заявка: [что ищете]_
⭐ Отзыв: _Отзыв: [ваш текст]_

🔗 Сайт: ecoloop.pages.dev`;
    await sendMessage(chatId, msg);
    return;
  }

  if (text === '/lots') { await sendLots(chatId); return; }
  if (text === '/stats') { await sendStats(chatId); return; }
  if (text === '/request') { await sendRequest(chatId); return; }
  if (text === '/contacts') { await sendContacts(chatId); return; }
  if (text === '/about') { await sendAbout(chatId); return; }
  if (text === '/prices') { await sendPrices(chatId); return; }
  if (text === '/forhotels') { await sendForHotels(chatId); return; }
  if (text === '/faq') { await sendFAQ(chatId); return; }
  if (text === '/feedback') { await sendFeedbackPrompt(chatId); return; }

  // ===== АДМИН-КОМАНДЫ (ЗАЩИЩЕНЫ) =====

  if (text === '/admin') {
    if (!isAdmin(chatId)) {
      await sendMessage(chatId, '🔒 У вас нет доступа к админ-панели.');
      return;
    }
    const pendingCount = pendingApprovals.size;
    const keyboard = {
      inline_keyboard: [
        [
          { text: `� Ожидают (${pendingCount})`, callback_data: 'admin_pending' },
          { text: '� Статистика', callback_data: 'admin_stats' }
        ],
        [
          { text: '📢 Рассылка', callback_data: 'admin_broadcast' },
          { text: '⚙️ Настройки', callback_data: 'admin_settings' }
        ]
      ]
    };
    await sendMessageWithKeyboard(chatId, `🔐 *Админ-панель EcoLoop*\n\n👋 Привет, ${name}!\n📋 Ожидают одобрения: *${pendingCount}*\n\nВыбери действие:`, keyboard);
    return;
  }

  if (text === '/users') {
    if (!isAdmin(chatId)) {
      await sendMessage(chatId, '🔒 Нет доступа.');
      return;
    }
    await sendMessage(chatId, `👥 *Пользователи:*\n\nСтатистика пользователей доступна в Firebase Console.\n🔗 https://console.firebase.google.com`);
    return;
  }

  // Рассылка: /broadcast Текст сообщения
  if (text.startsWith('/broadcast ')) {
    if (!isAdmin(chatId)) {
      await sendMessage(chatId, '🔒 Нет доступа.');
      return;
    }
    const broadcastText = text.replace('/broadcast ', '');
    await sendMessage(chatId, `📢 *Рассылка отправлена:*\n\n${broadcastText}\n\n_Для реальной рассылки подключите базу пользователей._`);
    return;
  }

  // ===== ОБРАБОТКА ТЕКСТА =====

  // Заявка
  if (text.toLowerCase().startsWith('заявка:')) {
    const id = ++approvalCounter;
    pendingApprovals.set(id, { type: 'request', data: { text, name, username, userId }, userChatId: chatId, timestamp: new Date().toISOString() });

    const adminText = `📋 *Новая заявка из Telegram!*\n🆔 #${id}\n\n👤 *От:* ${name} ${username ? '(@' + username + ')' : ''}\n🆔 *ID:* ${userId}\n\n${text}\n\n🕐 ${new Date().toLocaleString('ru-RU')}`;
    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Взять в работу', callback_data: `approve_request_${id}` },
          { text: '❌ Отклонить', callback_data: `reject_request_${id}` }
        ]
      ]
    };
    await sendMessageWithKeyboard(TG_CHAT, adminText, keyboard);
    await sendMessage(chatId, `✅ *Заявка #${id} принята!*\n\nВаш запрос передан менеджеру. Мы свяжемся с вами в течение 2 часов.\n\n📞 Срочный вопрос: +7 (776) 075-24-63`);
    return;
  }

  // Отзыв
  if (text.toLowerCase().startsWith('отзыв:')) {
    const adminText = `⭐ *Новый отзыв из Telegram!*\n\n👤 *От:* ${name} ${username ? '(@' + username + ')' : ''}\n\n${text}\n\n🕐 ${new Date().toLocaleString('ru-RU')}`;
    await sendMessage(TG_CHAT, adminText);
    await sendMessage(chatId, `🙏 *Спасибо за отзыв!*\n\nМы ценим ваше мнение и используем его для улучшения сервиса.`);
    return;
  }

  // Жалоба
  if (text.toLowerCase().startsWith('жалоба:')) {
    const id = ++approvalCounter;
    pendingApprovals.set(id, { type: 'complaint', data: { text, name, username, userId }, userChatId: chatId, timestamp: new Date().toISOString() });

    const adminText = `🚨 *ЖАЛОБА из Telegram!*\n🆔 #${id}\n\n👤 *От:* ${name} ${username ? '(@' + username + ')' : ''}\n🆔 *ID:* ${userId}\n\n${text}\n\n🕐 ${new Date().toLocaleString('ru-RU')}`;
    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Рассмотрена', callback_data: `approve_complaint_${id}` },
          { text: '📞 Связаться', callback_data: `call_complaint_${id}` }
        ]
      ]
    };
    await sendMessageWithKeyboard(TG_CHAT, adminText, keyboard);
    await sendMessage(chatId, `📨 *Жалоба #${id} принята.*\n\nМы рассмотрим её в приоритетном порядке и свяжемся с вами.\n\n📞 Горячая линия: +7 (776) 075-24-63`);
    return;
  }

  // Телефонный номер — автозаявка
  if (/^\+?[78]\s?\d{3}\s?\d{3}\s?\d{2}\s?\d{2}$/.test(text.replace(/[\s\-()]/g, ''))) {
    const adminText = `📞 *Номер телефона из Telegram!*

👤 ${name} ${username ? '(@' + username + ')' : ''}
📱 ${text}

🕐 ${new Date().toLocaleString('ru-RU')}`;
    await sendMessage(TG_CHAT, adminText);
    await sendMessage(chatId, `✅ Номер получен! Менеджер перезвонит в течение часа.`);
    return;
  }

  // Неизвестное сообщение
  const keyboard = {
    inline_keyboard: [
      [
        { text: '🛍️ Лоты', callback_data: 'lots' },
        { text: '📝 Заявка', callback_data: 'request' }
      ],
      [
        { text: '📋 Меню', callback_data: 'menu' },
        { text: '❓ FAQ', callback_data: 'faq' }
      ]
    ]
  };
  await sendMessageWithKeyboard(chatId, `🤔 Не понял сообщение.

Попробуйте:
• Написать _Заявка: [что ищете]_
• Написать _Отзыв: [ваш текст]_
• Отправить номер телефона
• Или выбрать кнопку:`, keyboard);
}

// ===== INLINE КНОПКИ =====
async function handleCallback(query) {
  const chatId = query.message.chat.id;
  const data = query.callback_data;
  const msgId = query.message.message_id;

  await fetch(`${TG_API}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: query.id })
  });

  // ===== ОДОБРЕНИЕ ОТЕЛЯ =====
  if (data.startsWith('approve_hotel_')) {
    if (!isAdmin(chatId)) { await sendMessage(chatId, '🔒'); return; }
    const id = parseInt(data.replace('approve_hotel_', ''));
    const item = pendingApprovals.get(id);
    if (!item) { await sendMessage(chatId, '⚠️ Заявка не найдена или уже обработана.'); return; }
    pendingApprovals.delete(id);
    await editMessage(chatId, msgId, `✅ *ОТЕЛЬ ОДОБРЕН* 🆔 #${id}\n\n${formatData(item.data)}\n\n✅ Одобрено: ${new Date().toLocaleString('ru-RU')}\n👤 Админ: ${query.from.first_name}`);
    await sendMessage(chatId, `📧 Отправьте подтверждение отелю:\n${item.data.email || item.data.phone || 'Контакт не указан'}`);
    return;
  }
  if (data.startsWith('reject_hotel_')) {
    if (!isAdmin(chatId)) { await sendMessage(chatId, '🔒'); return; }
    const id = parseInt(data.replace('reject_hotel_', ''));
    const item = pendingApprovals.get(id);
    if (!item) { await sendMessage(chatId, '⚠️ Заявка не найдена или уже обработана.'); return; }
    pendingApprovals.delete(id);
    await editMessage(chatId, msgId, `❌ *ОТЕЛЬ ОТКЛОНЁН* 🆔 #${id}\n\n${formatData(item.data)}\n\n❌ Отклонено: ${new Date().toLocaleString('ru-RU')}\n👤 Админ: ${query.from.first_name}`);
    return;
  }
  if (data.startsWith('call_hotel_')) {
    if (!isAdmin(chatId)) { await sendMessage(chatId, '🔒'); return; }
    const id = parseInt(data.replace('call_hotel_', ''));
    const item = pendingApprovals.get(id);
    if (!item) { await sendMessage(chatId, '⚠️ Заявка не найдена.'); return; }
    await sendMessage(chatId, `📞 Контакт отеля #${id}:\n${item.data.phone || item.data.email || 'Контакт не указан'}`);
    return;
  }

  // ===== ОДОБРЕНИЕ ПОСТА =====
  if (data.startsWith('approve_post_')) {
    if (!isAdmin(chatId)) { await sendMessage(chatId, '🔒'); return; }
    const id = parseInt(data.replace('approve_post_', ''));
    const item = pendingApprovals.get(id);
    if (!item) { await sendMessage(chatId, '⚠️ Пост не найден или уже обработан.'); return; }
    pendingApprovals.delete(id);
    await editMessage(chatId, msgId, `✅ *ПОСТ ОПУБЛИКОВАН* 🆔 #${id}\n\n${formatData(item.data)}\n\n✅ Опубликовано: ${new Date().toLocaleString('ru-RU')}\n👤 Админ: ${query.from.first_name}`);
    if (item.userChatId) await sendMessage(item.userChatId, `✅ *Ваш пост #${id} одобрен и опубликован!*`);
    return;
  }
  if (data.startsWith('reject_post_')) {
    if (!isAdmin(chatId)) { await sendMessage(chatId, '🔒'); return; }
    const id = parseInt(data.replace('reject_post_', ''));
    const item = pendingApprovals.get(id);
    if (!item) { await sendMessage(chatId, '⚠️ Пост не найден или уже обработан.'); return; }
    pendingApprovals.delete(id);
    await editMessage(chatId, msgId, `❌ *ПОСТ ОТКЛОНЁН* 🆔 #${id}\n\n${formatData(item.data)}\n\n❌ Отклонено: ${new Date().toLocaleString('ru-RU')}`);
    if (item.userChatId) await sendMessage(item.userChatId, `❌ *Ваш пост #${id} отклонён.* Попробуйте изменить и отправить заново.`);
    return;
  }
  if (data.startsWith('edit_post_')) {
    if (!isAdmin(chatId)) { await sendMessage(chatId, '🔒'); return; }
    const id = parseInt(data.replace('edit_post_', ''));
    const item = pendingApprovals.get(id);
    if (!item) { await sendMessage(chatId, '⚠️ Пост не найден.'); return; }
    if (item.userChatId) await sendMessage(item.userChatId, `✏️ *Пост #${id} требует правок.* Отредактируйте и отправьте заново.`);
    await sendMessage(chatId, `✏️ Пользователь уведомлён о необходимости правок для поста #${id}`);
    return;
  }

  // ===== ОДОБРЕНИЕ ЗАЯВКИ =====
  if (data.startsWith('approve_request_')) {
    if (!isAdmin(chatId)) { await sendMessage(chatId, '🔒'); return; }
    const id = parseInt(data.replace('approve_request_', ''));
    const item = pendingApprovals.get(id);
    if (!item) { await sendMessage(chatId, '⚠️ Заявка не найдена.'); return; }
    pendingApprovals.delete(id);
    await editMessage(chatId, msgId, `✅ *ЗАЯВКА В РАБОТЕ* 🆔 #${id}\n\n${formatData(item.data)}\n\n✅ Взято: ${new Date().toLocaleString('ru-RU')}\n👤 Менеджер: ${query.from.first_name}`);
    if (item.userChatId) await sendMessage(item.userChatId, `✅ *Заявка #${id} принята в работу!* Менеджер скоро свяжется с вами. 📞`);
    return;
  }
  if (data.startsWith('reject_request_')) {
    if (!isAdmin(chatId)) { await sendMessage(chatId, '🔒'); return; }
    const id = parseInt(data.replace('reject_request_', ''));
    const item = pendingApprovals.get(id);
    if (!item) { await sendMessage(chatId, '⚠️ Заявка не найдена.'); return; }
    pendingApprovals.delete(id);
    await editMessage(chatId, msgId, `❌ *ЗАЯВКА ОТКЛОНЕНА* 🆔 #${id}\n\n${formatData(item.data)}\n\n❌ Отклонено: ${new Date().toLocaleString('ru-RU')}`);
    if (item.userChatId) await sendMessage(item.userChatId, `❌ *Заявка #${id} отклонена.* Свяжитесь: +7 (776) 075-24-63`);
    return;
  }

  // ===== ЖАЛОБА =====
  if (data.startsWith('approve_complaint_')) {
    if (!isAdmin(chatId)) { await sendMessage(chatId, '🔒'); return; }
    const id = parseInt(data.replace('approve_complaint_', ''));
    const item = pendingApprovals.get(id);
    if (!item) { await sendMessage(chatId, '⚠️ Жалоба не найдена.'); return; }
    pendingApprovals.delete(id);
    await editMessage(chatId, msgId, `✅ *ЖАЛОБА РАССМОТРЕНА* 🆔 #${id}\n\n${formatData(item.data)}\n\n✅ Рассмотрена: ${new Date().toLocaleString('ru-RU')}`);
    if (item.userChatId) await sendMessage(item.userChatId, `✅ *Жалоба #${id} рассмотрена.* Спасибо за обращение.`);
    return;
  }
  if (data.startsWith('call_complaint_')) {
    if (!isAdmin(chatId)) { await sendMessage(chatId, '🔒'); return; }
    const id = parseInt(data.replace('call_complaint_', ''));
    const item = pendingApprovals.get(id);
    if (!item) { await sendMessage(chatId, '⚠️ Жалоба не найдена.'); return; }
    if (item.userChatId) {
      await sendMessage(item.userChatId, `📞 *Менеджер хочет связаться с вами по жалобе #${id}.* Ожидайте звонок.`);
      await sendMessage(chatId, `📞 Пользователь уведомлён. Chat ID: ${item.userChatId}`);
    }
    return;
  }

  // ===== АДМИН CALLBACK =====
  if (data === 'admin_pending') {
    if (!isAdmin(chatId)) { await sendMessage(chatId, '🔒'); return; }
    if (pendingApprovals.size === 0) { await sendMessage(chatId, '✅ Нет заявок на одобрение!'); return; }
    let text = `📋 *Ожидают одобрения (${pendingApprovals.size}):*\n\n`;
    for (const [id, item] of pendingApprovals) {
      const icons = { hotel: '🏨', post: '📝', request: '📋', complaint: '🚨' };
      text += `${icons[item.type] || '📩'} #${id} — ${item.type} — ${item.timestamp}\n`;
    }
    await sendMessage(chatId, text);
    return;
  }
  if (data === 'admin_stats') {
    if (!isAdmin(chatId)) { await sendMessage(chatId, '🔒'); return; }
    await sendAdminStats(chatId);
    return;
  }
  if (data === 'admin_broadcast') {
    if (!isAdmin(chatId)) { await sendMessage(chatId, '🔒'); return; }
    await sendMessage(chatId, '📢 Для рассылки отправьте:\n`/broadcast Текст сообщения`');
    return;
  }
  if (data === 'admin_settings') {
    if (!isAdmin(chatId)) { await sendMessage(chatId, '🔒'); return; }
    await sendMessage(chatId, `⚙️ *Настройки бота:*\n\n• Версия: 3.0\n• Антиспам: ${RATE_LIMIT_MAX} сообщений / ${RATE_LIMIT_WINDOW/1000}с\n• Админов: ${ADMINS.length}\n• Ожидают: ${pendingApprovals.size}`);
    return;
  }

  // ===== ОБЫЧНЫЕ CALLBACK =====
  switch (data) {
    case 'menu': await sendMenu(chatId); break;
    case 'lots': await sendLots(chatId); break;
    case 'stats': await sendStats(chatId); break;
    case 'request': await sendRequest(chatId); break;
    case 'contacts': await sendContacts(chatId); break;
    case 'about': await sendAbout(chatId); break;
    case 'prices': await sendPrices(chatId); break;
    case 'forhotels': await sendForHotels(chatId); break;
    case 'faq': await sendFAQ(chatId); break;
    case 'feedback': await sendFeedbackPrompt(chatId); break;
    case 'lots_food': await sendLotsFood(chatId); break;
    case 'lots_textile': await sendLotsTextile(chatId); break;
    case 'lots_plastic': await sendLotsPlastic(chatId); break;
  }
}

// ===== КОНТЕНТ ФУНКЦИИ =====

async function sendMenu(chatId) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: '🛍️ Лоты', callback_data: 'lots' },
        { text: '📊 Статистика', callback_data: 'stats' }
      ],
      [
        { text: '📝 Заявка', callback_data: 'request' },
        { text: '💰 Цены', callback_data: 'prices' }
      ],
      [
        { text: '🏨 Для отелей', callback_data: 'forhotels' },
        { text: '📞 Контакты', callback_data: 'contacts' }
      ],
      [
        { text: '🌿 О проекте', callback_data: 'about' },
        { text: '❓ FAQ', callback_data: 'faq' }
      ]
    ]
  };
  await sendMessageWithKeyboard(chatId, '📋 *Главное меню:*', keyboard);
}

async function sendLots(chatId) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: '🍽️ Еда', callback_data: 'lots_food' },
        { text: '👕 Текстиль', callback_data: 'lots_textile' },
        { text: '♻️ Пластик', callback_data: 'lots_plastic' }
      ],
      [{ text: '◀️ Назад', callback_data: 'menu' }]
    ]
  };
  await sendMessageWithKeyboard(chatId, `🛍️ *Активные лоты сегодня:*

1️⃣ 🍽️ *Magic Box от Rixos Almaty*
   💰 ₸500 (вместо ₸1,500) — *скидка 67%*
   📦 5 кг выпечки и кондитерских
   📍 Центральный район
   ⏰ Самовывоз до 21:30

2️⃣ ♻️ *Пластиковая тара от Hilton*
   💰 ₸200 (вместо ₸600) — *скидка 67%*
   📦 50 кг чистых бутылок
   📍 Медеуский район
   ⏰ Самовывоз до 18:00

3️⃣ 👕 *Постельное бельё от Marriott*
   💰 ₸150 (вместо ₸450) — *скидка 67%*
   📦 20 комплектов
   📍 Алмалинский район
   ⏰ Самовывоз до 20:00

Выбери категорию:`, keyboard);
}

async function sendLotsFood(chatId) {
  const keyboard = {
    inline_keyboard: [
      [{ text: '📝 Оставить заявку', callback_data: 'request' }],
      [{ text: '◀️ Все лоты', callback_data: 'lots' }]
    ]
  };
  await sendMessageWithKeyboard(chatId, `🍽️ *Еда — активные лоты:*

1️⃣ *Magic Box от Rixos Almaty*
   💰 ₸500 • 5 кг выпечки
   ⏰ до 21:30 • 📍 Центральный

2️⃣ *Бизнес-ланч от Hilton Astana*
   💰 ₸700 • 3 порции
   ⏰ до 15:00 • 📍 Есильский

3️⃣ *Молочная продукция от Holiday Inn*
   💰 ₸400 • 2 кг
   ⏰ до 19:00 • 📍 Бостандыкский

_Все товары прошли контроль качества_`, keyboard);
}

async function sendLotsTextile(chatId) {
  const keyboard = {
    inline_keyboard: [
      [{ text: '📝 Оставить заявку', callback_data: 'request' }],
      [{ text: '◀️ Все лоты', callback_data: 'lots' }]
    ]
  };
  await sendMessageWithKeyboard(chatId, `👕 *Текстиль — активные лоты:*

1️⃣ *Постельное бельё от Marriott*
   💰 ₸150 • 20 комплектов
   📍 Алмалинский • Состояние: хорошее

2️⃣ *Полотенца от Rixos*
   💰 ₸100 • 50 шт
   📍 Центральный • Хлопок 100%

3️⃣ *Униформа от Hilton*
   💰 ₸200 • 15 комплектов
   📍 Медеуский • S-XL размеры`, keyboard);
}

async function sendLotsPlastic(chatId) {
  const keyboard = {
    inline_keyboard: [
      [{ text: '📝 Оставить заявку', callback_data: 'request' }],
      [{ text: '◀️ Все лоты', callback_data: 'lots' }]
    ]
  };
  await sendMessageWithKeyboard(chatId, `♻️ *Пластик и вторсырьё:*

1️⃣ *Пластиковая тара от Hilton*
   💰 ₸200 • 50 кг
   📍 Медеуский • Чистые, отсортированы

2️⃣ *Картон и упаковка от Rixos*
   💰 ₸80 • 30 кг
   📍 Центральный • Спрессованы

3️⃣ *Стеклянные бутылки от Marriott*
   💰 ₸120 • 100 шт
   📍 Алмалинский • Целые, промытые`, keyboard);
}

async function sendStats(chatId) {
  const keyboard = {
    inline_keyboard: [
      [{ text: '◀️ Назад', callback_data: 'menu' }]
    ]
  };
  await sendMessageWithKeyboard(chatId, `📊 *Статистика EcoLoop:*

💰 Общий оборот: *₸532,000*
🏨 Подключено отелей: *10+*
🛍️ Продано лотов: *47*
♻️ Сокращено отходов: *1,250 кг*
👥 Активных покупателей: *120+*
⭐ Средний рейтинг: *4.8/5*

📈 Рост за неделю: *+18%*
📅 ${new Date().toLocaleDateString('ru-RU')}`, keyboard);
}

async function sendRequest(chatId) {
  const keyboard = {
    inline_keyboard: [
      [{ text: '🌐 Оформить на сайте', url: 'https://ecoloop.pages.dev' }],
      [{ text: '◀️ Назад', callback_data: 'menu' }]
    ]
  };
  await sendMessageWithKeyboard(chatId, `📝 *Оставить заявку:*

Напиши в формате:

\`Заявка: Выпечка и хлеб
Объём: 10 кг
Район: Бостандыкский
Телефон: +7 777 123 4567\`

Или просто отправь *номер телефона* — мы перезвоним!`, keyboard);
}

async function sendContacts(chatId) {
  const keyboard = {
    inline_keyboard: [
      [{ text: '💬 Написать менеджеру', url: 'https://t.me/ecoloop_manager' }],
      [{ text: '🌐 Сайт', url: 'https://ecoloop.pages.dev' }],
      [{ text: '◀️ Назад', callback_data: 'menu' }]
    ]
  };
  await sendMessageWithKeyboard(chatId, `📞 *Контакты EcoLoop:*

👨‍💼 *Менеджер:*
📱 +7 (776) 075-24-63
📧 info@ecoloop.kz

🕐 *Время работы:*
Пн-Пт: 9:00 — 18:00
Сб: 10:00 — 15:00

📍 Алматы, Казахстан`, keyboard);
}

async function sendAbout(chatId) {
  const keyboard = {
    inline_keyboard: [
      [{ text: '🏨 Подключить отель', callback_data: 'forhotels' }],
      [{ text: '🛍️ Купить лот', callback_data: 'lots' }],
      [{ text: '◀️ Назад', callback_data: 'menu' }]
    ]
  };
  await sendMessageWithKeyboard(chatId, `🌿 *О проекте EcoLoop*

Первый в Казахстане маркетплейс для перераспределения излишков от отелей.

🎯 *Проблема:*
40% еды в отелях выбрасывается.
Текстиль и пластик — на свалку.

💡 *Решение:*
Скидка 50-70% для покупателей.
Монетизация для отелей.

🏆 *Результаты:*
• 1,250+ кг отходов сокращено
• 47+ лотов продано
• 10+ отелей-партнёров
• ⭐ 4.8 рейтинг`, keyboard);
}

async function sendPrices(chatId) {
  const keyboard = {
    inline_keyboard: [
      [{ text: '🛍️ Смотреть лоты', callback_data: 'lots' }],
      [{ text: '◀️ Назад', callback_data: 'menu' }]
    ]
  };
  await sendMessageWithKeyboard(chatId, `💰 *Как формируются цены:*

Скидка *50-70%* от розничной цены.

📊 *Примеры:*
🍽️ Выпечка 5 кг: *₸500* (розница ₸1,500)
♻️ Пластик 50 кг: *₸200* (розница ₸600)
👕 Текстиль 20 шт: *₸150* (розница ₸450)

💳 *Оплата:*
• Kaspi перевод
• Банковская карта (Visa/MC)

📦 *Самовывоз* из отеля — бесплатно`, keyboard);
}

async function sendForHotels(chatId) {
  const keyboard = {
    inline_keyboard: [
      [{ text: '📝 Подать заявку на сайте', url: 'https://ecoloop.pages.dev' }],
      [{ text: '📞 Позвонить менеджеру', callback_data: 'contacts' }],
      [{ text: '◀️ Назад', callback_data: 'menu' }]
    ]
  };
  await sendMessageWithKeyboard(chatId, `🏨 *Для отелей и ресторанов:*

*Подключение за 3 дня:*
1️⃣ Заявка на сайте
2️⃣ Проверка БИН + документов
3️⃣ Договор через ЭЦП
4️⃣ Онбординг + обучение

💰 *Условия:*
• Комиссия: *10%* от сделки
• Выплаты: еженедельно
• Минимальный объём: нет

📈 *Что получите:*
• Монетизация списаний
• ESG-отчётность
• Личный менеджер
• Аналитика в кабинете
• Публикация в рейтинге эко-отелей`, keyboard);
}

async function sendFAQ(chatId) {
  const keyboard = {
    inline_keyboard: [
      [{ text: '📝 Оставить вопрос', callback_data: 'request' }],
      [{ text: '📞 Позвонить', callback_data: 'contacts' }],
      [{ text: '◀️ Назад', callback_data: 'menu' }]
    ]
  };
  await sendMessageWithKeyboard(chatId, `❓ *Частые вопросы:*

*Q: Безопасно ли покупать еду?*
A: Да. Все продукты проходят контроль. Срок годности минимум 6 часов.

*Q: Как оплатить?*
A: Kaspi перевод или карта Visa/MC прямо на сайте.

*Q: Можно ли вернуть товар?*
A: Да, в течение 2 часов после покупки при несоответствии описанию.

*Q: Как часто появляются лоты?*
A: Каждый день. Максимум лотов — с 14:00 до 20:00.

*Q: Я отель — сколько стоит подключение?*
A: Бесплатно. Комиссия 10% только с продаж.

*Q: Работаете за пределами Алматы?*
A: Пока только Алматы и Астана. Расширяемся!`, keyboard);
}

async function sendFeedbackPrompt(chatId) {
  const keyboard = {
    inline_keyboard: [
      [{ text: '◀️ Назад', callback_data: 'menu' }]
    ]
  };
  await sendMessageWithKeyboard(chatId, `⭐ *Обратная связь:*

Напиши в любом формате:

_Отзыв: Отличный сервис! Купил Magic Box — всё свежее._

Или:

_Жалоба: Описание проблемы_

Мы читаем каждый отзыв!`, keyboard);
}

async function sendAdminStats(chatId) {
  await sendMessage(chatId, `📊 *Админ-статистика:*\n\n🤖 *Бот:*\n• Версия: 3.0\n• Антиспам: ${RATE_LIMIT_MAX} msg/${RATE_LIMIT_WINDOW/1000}s\n• Админов: ${ADMINS.length}\n• Ожидают одобрения: ${pendingApprovals.size}\n• Активных в кэше: ${rateLimit.size}\n\n📅 Обновлено: ${new Date().toLocaleString('ru-RU')}\n\n📋 Firebase Console:\n🔗 https://console.firebase.google.com`);
}

// ===== УТИЛИТЫ =====

function formatData(data) {
  let text = '';
  for (const [key, value] of Object.entries(data)) {
    if (value) text += `*${key}:* ${value}\n`;
  }
  return text;
}

// ===== ОТПРАВКА СООБЩЕНИЙ =====
async function sendMessage(chatId, text) {
  await fetch(`${TG_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    })
  });
}

async function sendMessageWithKeyboard(chatId, text, keyboard) {
  await fetch(`${TG_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: keyboard
    })
  });
}

async function editMessage(chatId, messageId, text) {
  await fetch(`${TG_API}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    })
  });
}

// ===== ЗАПУСК СЕРВЕРА =====
app.listen(PORT, () => {
  console.log(`🤖 EcoLoop Bot v3.0 запущен на порту ${PORT}`);
  console.log(`📡 Webhook: /webhook`);
  console.log(`📋 API: /api/submit`);
  console.log(`🏥 Health: /`);
});
