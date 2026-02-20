// ====================================
// EcoLoop Telegram Bot v4.0 — Express.js (Render)
// Все заявки с кнопками Принять/Отклонить
// Чистый plain text — без parse_mode проблем
// ====================================

const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

const TG_TOKEN = '8547995948:AAGP-JDNJowAvmTqMK04n9rNZ16519dp2C8';
const TG_CHAT  = '7682446178';
const TG_API   = `https://api.telegram.org/bot${TG_TOKEN}`;
const PORT = process.env.PORT || 3000;

const ADMINS = [7682446178];

// Хранилище
const rateLimit = new Map();
const pendingApprovals = new Map();
let approvalCounter = 0;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW = 60000;

function isRateLimited(chatId) {
  const now = Date.now();
  const hits = rateLimit.get(chatId) || [];
  const recent = hits.filter(t => now - t < RATE_LIMIT_WINDOW);
  recent.push(now);
  rateLimit.set(chatId, recent);
  return recent.length > RATE_LIMIT_MAX;
}

function isAdmin(chatId) {
  return ADMINS.includes(chatId);
}

function fmtData(data) {
  let t = '';
  for (const [k, v] of Object.entries(data)) {
    if (v) t += `${k}: ${v}\n`;
  }
  return t;
}

function ts() {
  return new Date().toLocaleString('ru-RU');
}

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Health check
app.get('/', (req, res) => {
  res.json({ bot: 'EcoLoop Bot v4.0', status: 'running', uptime: new Date().toISOString(), pending: pendingApprovals.size });
});

// ===== TELEGRAM WEBHOOK =====
app.post('/webhook', async (req, res) => {
  try {
    const u = req.body;
    console.log('Webhook:', JSON.stringify(u).substring(0, 200));
    if (u.message) await handleMessage(u);
    if (u.callback_query) await handleCallback(u.callback_query);
  } catch (err) {
    console.error('Webhook error:', err);
  }
  res.sendStatus(200);
});

// ===== API: ПРИЕМ ЗАЯВОК С САЙТА =====
app.post('/api/submit', async (req, res) => {
  try {
    const { type, data } = req.body;
    const id = ++approvalCounter;

    const labels = {
      hotel: '🏨 ЗАЯВКА ОТЕЛЯ',
      post: '📝 НОВЫЙ ПОСТ',
      callback: '📞 ОБРАТНЫЙ ЗВОНОК',
      request: '📋 НОВЫЙ ЗАПРОС',
      buyer: '👤 РЕГИСТРАЦИЯ ПОКУПАТЕЛЯ'
    };

    pendingApprovals.set(id, { type, data, timestamp: ts() });

    let text = `${labels[type] || '📩 НОВАЯ ЗАЯВКА'} — ЖДЕТ ОДОБРЕНИЯ\n`;
    text += `ID: #${id}\n\n`;
    text += fmtData(data);
    text += `\nВремя: ${ts()}`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Принять', callback_data: `approve_${type}_${id}` },
          { text: '❌ Отклонить', callback_data: `reject_${type}_${id}` }
        ]
      ]
    };

    await sendWithKeyboard(TG_CHAT, text, keyboard);
    res.json({ success: true, id });
  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== ОБРАБОТКА СООБЩЕНИЙ =====
async function handleMessage(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const name = msg.from.first_name || 'Пользователь';
  const username = msg.from.username || '';
  const userId = msg.from.id;

  if (isRateLimited(chatId)) {
    await send(chatId, '⛔ Слишком много сообщений. Подождите минуту.');
    return;
  }

  // /start
  if (text === '/start') {
    await sendWithKeyboard(chatId, `🌿 Привет, ${name}!\n\nДобро пожаловать в EcoLoop — маркетплейс для перераспределения излишков отелей Казахстана.\n\nВыбери что интересует:`, {
      inline_keyboard: [
        [{ text: '🛍️ Лоты', callback_data: 'lots' }, { text: '📊 Статистика', callback_data: 'stats' }],
        [{ text: '📝 Оставить заявку', callback_data: 'request' }, { text: '💰 Цены', callback_data: 'prices' }],
        [{ text: '🏨 Для отелей', callback_data: 'forhotels' }, { text: '📞 Контакты', callback_data: 'contacts' }],
        [{ text: '🌿 О проекте', callback_data: 'about' }, { text: '❓ FAQ', callback_data: 'faq' }],
        [{ text: '🌐 Открыть сайт', url: 'https://ecoloop.pages.dev' }]
      ]
    });
    return;
  }

  // /help
  if (text === '/help') {
    await send(chatId, `📋 Команды EcoLoop Bot:\n\n/start — Главное меню\n/lots — Активные лоты\n/stats — Статистика\n/request — Оставить заявку\n/contacts — Контакты\n/about — О проекте\n/prices — Цены\n/forhotels — Для отелей\n/faq — FAQ\n/feedback — Отзыв\n\nНаписать: Заявка: [что ищете]\nОтзыв: Отзыв: [текст]\n\nСайт: ecoloop.pages.dev`);
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

  // /admin
  if (text === '/admin') {
    if (!isAdmin(chatId)) { await send(chatId, '🔒 Нет доступа.'); return; }
    const cnt = pendingApprovals.size;
    await sendWithKeyboard(chatId, `🔐 Админ-панель EcoLoop\n\nПривет, ${name}!\nОжидают одобрения: ${cnt}\n\nВыбери действие:`, {
      inline_keyboard: [
        [{ text: `📋 Ожидают (${cnt})`, callback_data: 'admin_pending' }, { text: '📊 Статистика', callback_data: 'admin_stats' }],
        [{ text: '📢 Рассылка', callback_data: 'admin_broadcast' }, { text: '⚙️ Настройки', callback_data: 'admin_settings' }]
      ]
    });
    return;
  }

  if (text === '/users') {
    if (!isAdmin(chatId)) { await send(chatId, '🔒 Нет доступа.'); return; }
    await send(chatId, '👥 Статистика пользователей доступна в Firebase Console.\nhttps://console.firebase.google.com');
    return;
  }

  if (text.startsWith('/broadcast ')) {
    if (!isAdmin(chatId)) { await send(chatId, '🔒 Нет доступа.'); return; }
    const msg = text.replace('/broadcast ', '');
    await send(chatId, `📢 Рассылка отправлена:\n\n${msg}\n\nДля реальной рассылки подключите базу пользователей.`);
    return;
  }

  // Заявка из чата
  if (text.toLowerCase().startsWith('заявка:')) {
    const id = ++approvalCounter;
    pendingApprovals.set(id, { type: 'request', data: { text, name, username, userId }, userChatId: chatId, timestamp: ts() });
    await sendWithKeyboard(TG_CHAT, `📋 ЗАЯВКА ИЗ TELEGRAM — ЖДЕТ ОДОБРЕНИЯ\nID: #${id}\n\nОт: ${name} ${username ? '(@' + username + ')' : ''}\nTG ID: ${userId}\n\n${text}\n\nВремя: ${ts()}`, {
      inline_keyboard: [[
        { text: '✅ Взять в работу', callback_data: `approve_request_${id}` },
        { text: '❌ Отклонить', callback_data: `reject_request_${id}` }
      ]]
    });
    await send(chatId, `✅ Заявка #${id} принята!\n\nВаш запрос передан менеджеру. Мы свяжемся с вами в течение 2 часов.\n\n📞 Срочно: +7 (776) 075-24-63`);
    return;
  }

  // Отзыв
  if (text.toLowerCase().startsWith('отзыв:')) {
    await send(TG_CHAT, `⭐ ОТЗЫВ из Telegram\n\nОт: ${name} ${username ? '(@' + username + ')' : ''}\n\n${text}\n\nВремя: ${ts()}`);
    await send(chatId, '🙏 Спасибо за отзыв! Мы ценим ваше мнение.');
    return;
  }

  // Жалоба
  if (text.toLowerCase().startsWith('жалоба:')) {
    const id = ++approvalCounter;
    pendingApprovals.set(id, { type: 'complaint', data: { text, name, username, userId }, userChatId: chatId, timestamp: ts() });
    await sendWithKeyboard(TG_CHAT, `🚨 ЖАЛОБА из Telegram\nID: #${id}\n\nОт: ${name} ${username ? '(@' + username + ')' : ''}\nTG ID: ${userId}\n\n${text}\n\nВремя: ${ts()}`, {
      inline_keyboard: [[
        { text: '✅ Рассмотрена', callback_data: `approve_complaint_${id}` },
        { text: '📞 Связаться', callback_data: `call_complaint_${id}` }
      ]]
    });
    await send(chatId, `📨 Жалоба #${id} принята.\nМы рассмотрим её в приоритетном порядке.\n\n📞 Горячая линия: +7 (776) 075-24-63`);
    return;
  }

  // Телефон
  if (/^\+?[78]\d{10}$/.test(text.replace(/[\s\-()]/g, ''))) {
    await send(TG_CHAT, `📞 Номер телефона из Telegram\n\n${name} ${username ? '(@' + username + ')' : ''}\n📱 ${text}\n\nВремя: ${ts()}`);
    await send(chatId, '✅ Номер получен! Менеджер перезвонит в течение часа.');
    return;
  }

  // Неизвестное
  await sendWithKeyboard(chatId, '🤔 Не понял сообщение.\n\nПопробуйте:\n- Заявка: [что ищете]\n- Отзыв: [ваш текст]\n- Отправить номер телефона\n- Или выбрать кнопку:', {
    inline_keyboard: [
      [{ text: '🛍️ Лоты', callback_data: 'lots' }, { text: '📝 Заявка', callback_data: 'request' }],
      [{ text: '📋 Меню', callback_data: 'menu' }, { text: '❓ FAQ', callback_data: 'faq' }]
    ]
  });
}

// ===== CALLBACK QUERY =====
async function handleCallback(query) {
  const chatId = query.message.chat.id;
  const data = query.callback_data;
  const msgId = query.message.message_id;

  // Обязательно ответить на callback
  try {
    await fetch(`${TG_API}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: query.id })
    });
  } catch (e) {
    console.error('answerCallback error:', e);
  }

  console.log('Callback:', data, 'from:', chatId);

  // === УНИВЕРСАЛЬНЫЙ ОБРАБОТЧИК ОДОБРЕНИЯ ===
  if (data.startsWith('approve_') || data.startsWith('reject_') || data.startsWith('call_') || data.startsWith('edit_')) {
    if (!isAdmin(chatId)) { await send(chatId, '🔒 Нет доступа.'); return; }

    const parts = data.split('_');
    const action = parts[0]; // approve, reject, call, edit
    const type = parts[1];   // hotel, post, request, complaint, callback, buyer
    const id = parseInt(parts[2]);

    const item = pendingApprovals.get(id);

    if (action === 'call') {
      if (!item) { await send(chatId, '⚠️ Заявка не найдена.'); return; }
      const contact = item.data.phone || item.data.email || item.data.contactName || 'Контакт не указан';
      await send(chatId, `📞 Контакт #${id}:\n${contact}`);
      if (item.userChatId) await send(item.userChatId, `📞 Менеджер хочет связаться с вами по заявке #${id}. Ожидайте.`);
      return;
    }

    if (action === 'edit') {
      if (!item) { await send(chatId, '⚠️ Заявка не найдена.'); return; }
      if (item.userChatId) await send(item.userChatId, `✏️ Заявка #${id} требует правок. Отредактируйте и отправьте заново.`);
      await send(chatId, `✏️ Пользователь уведомлен о правках для #${id}`);
      return;
    }

    if (!item) { await send(chatId, '⚠️ Заявка #' + id + ' не найдена или уже обработана.'); return; }

    pendingApprovals.delete(id);

    const labels = {
      hotel: '🏨 ОТЕЛЬ', post: '📝 ПОСТ', request: '📋 ЗАЯВКА',
      complaint: '🚨 ЖАЛОБА', callback: '📞 ЗВОНОК', buyer: '👤 ПОКУПАТЕЛЬ'
    };
    const label = labels[type] || '📩 ЗАЯВКА';

    if (action === 'approve') {
      await editMsg(chatId, msgId, `✅ ${label} ОДОБРЕНО\nID: #${id}\n\n${fmtData(item.data)}\n✅ Одобрено: ${ts()}\nАдмин: ${query.from.first_name}`);
      if (item.userChatId) await send(item.userChatId, `✅ Ваша заявка #${id} одобрена!`);
    } else if (action === 'reject') {
      await editMsg(chatId, msgId, `❌ ${label} ОТКЛОНЕНО\nID: #${id}\n\n${fmtData(item.data)}\n❌ Отклонено: ${ts()}\nАдмин: ${query.from.first_name}`);
      if (item.userChatId) await send(item.userChatId, `❌ Ваша заявка #${id} отклонена. Свяжитесь: +7 (776) 075-24-63`);
    }
    return;
  }

  // === АДМИН CALLBACKS ===
  if (data === 'admin_pending') {
    if (!isAdmin(chatId)) { await send(chatId, '🔒'); return; }
    if (pendingApprovals.size === 0) { await send(chatId, '✅ Нет заявок на одобрение!'); return; }
    let text = `📋 Ожидают одобрения (${pendingApprovals.size}):\n\n`;
    const icons = { hotel: '🏨', post: '📝', request: '📋', complaint: '🚨', callback: '📞', buyer: '👤' };
    for (const [id, item] of pendingApprovals) {
      text += `${icons[item.type] || '📩'} #${id} — ${item.type} — ${item.timestamp}\n`;
    }
    await send(chatId, text);
    return;
  }
  if (data === 'admin_stats') {
    if (!isAdmin(chatId)) { await send(chatId, '🔒'); return; }
    await send(chatId, `📊 Админ-статистика:\n\nБот: v4.0\nАнтиспам: ${RATE_LIMIT_MAX} msg/${RATE_LIMIT_WINDOW/1000}s\nАдминов: ${ADMINS.length}\nОжидают: ${pendingApprovals.size}\nВ кэше: ${rateLimit.size}\n\nОбновлено: ${ts()}`);
    return;
  }
  if (data === 'admin_broadcast') {
    if (!isAdmin(chatId)) { await send(chatId, '🔒'); return; }
    await send(chatId, '📢 Для рассылки отправьте:\n/broadcast Текст сообщения');
    return;
  }
  if (data === 'admin_settings') {
    if (!isAdmin(chatId)) { await send(chatId, '🔒'); return; }
    await send(chatId, `⚙️ Настройки бота:\n\nВерсия: 4.0\nАнтиспам: ${RATE_LIMIT_MAX} msg/${RATE_LIMIT_WINDOW/1000}s\nАдминов: ${ADMINS.length}\nОжидают: ${pendingApprovals.size}`);
    return;
  }

  // === ОБЫЧНЫЕ CALLBACKS ===
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
    default: console.log('Unknown callback:', data);
  }
}

// ===== КОНТЕНТ =====
async function sendMenu(chatId) {
  await sendWithKeyboard(chatId, '📋 Главное меню:', {
    inline_keyboard: [
      [{ text: '🛍️ Лоты', callback_data: 'lots' }, { text: '📊 Статистика', callback_data: 'stats' }],
      [{ text: '📝 Заявка', callback_data: 'request' }, { text: '💰 Цены', callback_data: 'prices' }],
      [{ text: '🏨 Для отелей', callback_data: 'forhotels' }, { text: '📞 Контакты', callback_data: 'contacts' }],
      [{ text: '🌿 О проекте', callback_data: 'about' }, { text: '❓ FAQ', callback_data: 'faq' }]
    ]
  });
}

async function sendLots(chatId) {
  await sendWithKeyboard(chatId, `🛍️ Активные лоты сегодня:\n\n1. 🍽️ Magic Box от Rixos Almaty\n   500 тг (вместо 1500) — скидка 67%\n   5 кг выпечки. Самовывоз до 21:30\n\n2. ♻️ Пластиковая тара от Hilton\n   200 тг (вместо 600) — скидка 67%\n   50 кг бутылок. Самовывоз до 18:00\n\n3. 👕 Постельное от Marriott\n   150 тг (вместо 450) — скидка 67%\n   20 комплектов. Самовывоз до 20:00\n\nВыбери категорию:`, {
    inline_keyboard: [
      [{ text: '🍽️ Еда', callback_data: 'lots_food' }, { text: '👕 Текстиль', callback_data: 'lots_textile' }, { text: '♻️ Пластик', callback_data: 'lots_plastic' }],
      [{ text: '◀️ Назад', callback_data: 'menu' }]
    ]
  });
}

async function sendLotsFood(chatId) {
  await sendWithKeyboard(chatId, '🍽️ Еда — активные лоты:\n\n1. Magic Box от Rixos Almaty\n   500 тг — 5 кг выпечки — до 21:30\n\n2. Бизнес-ланч от Hilton Astana\n   700 тг — 3 порции — до 15:00\n\n3. Молочка от Holiday Inn\n   400 тг — 2 кг — до 19:00\n\nВсе товары прошли контроль качества', {
    inline_keyboard: [[{ text: '📝 Оставить заявку', callback_data: 'request' }], [{ text: '◀️ Все лоты', callback_data: 'lots' }]]
  });
}

async function sendLotsTextile(chatId) {
  await sendWithKeyboard(chatId, '👕 Текстиль — активные лоты:\n\n1. Постельное от Marriott — 150 тг — 20 шт\n2. Полотенца от Rixos — 100 тг — 50 шт\n3. Униформа от Hilton — 200 тг — 15 шт', {
    inline_keyboard: [[{ text: '📝 Оставить заявку', callback_data: 'request' }], [{ text: '◀️ Все лоты', callback_data: 'lots' }]]
  });
}

async function sendLotsPlastic(chatId) {
  await sendWithKeyboard(chatId, '♻️ Пластик и вторсырье:\n\n1. Пластик от Hilton — 200 тг — 50 кг\n2. Картон от Rixos — 80 тг — 30 кг\n3. Стекло от Marriott — 120 тг — 100 шт', {
    inline_keyboard: [[{ text: '📝 Оставить заявку', callback_data: 'request' }], [{ text: '◀️ Все лоты', callback_data: 'lots' }]]
  });
}

async function sendStats(chatId) {
  await sendWithKeyboard(chatId, `📊 Статистика EcoLoop:\n\nОборот: 532,000 тг\nОтелей: 10+\nЛотов продано: 47\nСокращено отходов: 1,250 кг\nПокупателей: 120+\nРейтинг: 4.8/5\nРост за неделю: +18%\n\n${new Date().toLocaleDateString('ru-RU')}`, {
    inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'menu' }]]
  });
}

async function sendRequest(chatId) {
  await sendWithKeyboard(chatId, '📝 Оставить заявку:\n\nНапиши в формате:\nЗаявка: Выпечка и хлеб\nОбъем: 10 кг\nРайон: Бостандыкский\nТелефон: +7 777 123 4567\n\nИли просто отправь номер телефона — мы перезвоним!', {
    inline_keyboard: [[{ text: '🌐 Оформить на сайте', url: 'https://ecoloop.pages.dev' }], [{ text: '◀️ Назад', callback_data: 'menu' }]]
  });
}

async function sendContacts(chatId) {
  await sendWithKeyboard(chatId, '📞 Контакты EcoLoop:\n\nМенеджер:\n📱 +7 (776) 075-24-63\n📧 info@ecoloop.kz\n\nВремя работы:\nПн-Пт: 9:00-18:00\nСб: 10:00-15:00\n\nАлматы, Казахстан', {
    inline_keyboard: [
      [{ text: '💬 Написать менеджеру', url: 'https://t.me/ecoloop_manager' }],
      [{ text: '🌐 Сайт', url: 'https://ecoloop.pages.dev' }],
      [{ text: '◀️ Назад', callback_data: 'menu' }]
    ]
  });
}

async function sendAbout(chatId) {
  await sendWithKeyboard(chatId, '🌿 О проекте EcoLoop\n\nПервый в Казахстане маркетплейс для перераспределения излишков от отелей.\n\nПроблема: 40% еды в отелях выбрасывается.\n\nРешение: Скидка 50-70% для покупателей + монетизация для отелей.\n\nРезультаты:\n- 1,250+ кг отходов сокращено\n- 47+ лотов продано\n- 10+ отелей-партнеров\n- 4.8 рейтинг', {
    inline_keyboard: [
      [{ text: '🏨 Подключить отель', callback_data: 'forhotels' }],
      [{ text: '🛍️ Купить лот', callback_data: 'lots' }],
      [{ text: '◀️ Назад', callback_data: 'menu' }]
    ]
  });
}

async function sendPrices(chatId) {
  await sendWithKeyboard(chatId, '💰 Как формируются цены:\n\nСкидка 50-70% от розничной цены.\n\nПримеры:\n🍽️ Выпечка 5 кг: 500 тг (розница 1,500)\n♻️ Пластик 50 кг: 200 тг (розница 600)\n👕 Текстиль 20 шт: 150 тг (розница 450)\n\nОплата: Kaspi / Visa / MC\nСамовывоз — бесплатно', {
    inline_keyboard: [[{ text: '🛍️ Смотреть лоты', callback_data: 'lots' }], [{ text: '◀️ Назад', callback_data: 'menu' }]]
  });
}

async function sendForHotels(chatId) {
  await sendWithKeyboard(chatId, '🏨 Для отелей и ресторанов:\n\nПодключение за 3 дня:\n1. Заявка на сайте\n2. Проверка БИН + документов\n3. Договор через ЭЦП\n4. Онбординг + обучение\n\nУсловия:\n- Комиссия: 10% от сделки\n- Выплаты: еженедельно\n- Минимальный объем: нет\n\nВы получите: монетизацию списаний, ESG-отчетность, личного менеджера', {
    inline_keyboard: [
      [{ text: '📝 Подать заявку', url: 'https://ecoloop.pages.dev' }],
      [{ text: '📞 Позвонить менеджеру', callback_data: 'contacts' }],
      [{ text: '◀️ Назад', callback_data: 'menu' }]
    ]
  });
}

async function sendFAQ(chatId) {
  await sendWithKeyboard(chatId, '❓ Частые вопросы:\n\nQ: Безопасно ли покупать еду?\nA: Да, все проходит контроль. Срок годности мин. 6 часов.\n\nQ: Как оплатить?\nA: Kaspi перевод или карта Visa/MC.\n\nQ: Можно вернуть?\nA: Да, в течение 2 часов.\n\nQ: Как часто лоты?\nA: Каждый день. Пик: 14:00-20:00.\n\nQ: Подключение отеля стоит?\nA: Бесплатно. Комиссия 10% только с продаж.\n\nQ: Работаете за пределами Алматы?\nA: Пока Алматы и Астана.', {
    inline_keyboard: [
      [{ text: '📝 Оставить вопрос', callback_data: 'request' }],
      [{ text: '📞 Позвонить', callback_data: 'contacts' }],
      [{ text: '◀️ Назад', callback_data: 'menu' }]
    ]
  });
}

async function sendFeedbackPrompt(chatId) {
  await sendWithKeyboard(chatId, '⭐ Обратная связь:\n\nНапиши в любом формате:\nОтзыв: Отличный сервис!\n\nИли:\nЖалоба: Описание проблемы\n\nМы читаем каждый отзыв!', {
    inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'menu' }]]
  });
}

// ===== ОТПРАВКА (без parse_mode — 100% стабильно) =====
async function send(chatId, text) {
  try {
    const r = await fetch(`${TG_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
    });
    const j = await r.json();
    if (!j.ok) console.error('send err:', j);
    return j;
  } catch (e) { console.error('send fetch err:', e); }
}

async function sendWithKeyboard(chatId, text, keyboard) {
  try {
    const r = await fetch(`${TG_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true, reply_markup: keyboard })
    });
    const j = await r.json();
    if (!j.ok) console.error('sendKB err:', j);
    return j;
  } catch (e) { console.error('sendKB fetch err:', e); }
}

async function editMsg(chatId, messageId, text) {
  try {
    const r = await fetch(`${TG_API}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, disable_web_page_preview: true })
    });
    const j = await r.json();
    if (!j.ok) console.error('edit err:', j);
    return j;
  } catch (e) { console.error('edit fetch err:', e); }
}

// ===== ЗАПУСК =====
app.listen(PORT, () => {
  console.log(`🤖 EcoLoop Bot v4.0 on port ${PORT}`);
  console.log(`📡 Webhook: /webhook`);
  console.log(`📋 API: /api/submit`);
  console.log(`🏥 Health: /`);
});
