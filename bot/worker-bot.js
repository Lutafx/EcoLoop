// ====================================
// EcoLoop Telegram Bot v5.0
// Идеальные кнопки, все заявки с Принять/Отклонить
// Plain text — никаких проблем с parse_mode
// ====================================

const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

// ===== КОНФИГУРАЦИЯ =====
const TG_TOKEN = '8547995948:AAGP-JDNJowAvmTqMK04n9rNZ16519dp2C8';
const TG_CHAT  = '7682446178';
const TG_API   = `https://api.telegram.org/bot${TG_TOKEN}`;
const PORT = process.env.PORT || 3000;
const ADMINS = [7682446178];
const SITE_URL = 'https://ecoloop.pages.dev';

// ===== ХРАНИЛИЩЕ =====
const rateLimit = new Map();
const pending = new Map();
let counter = 1000;

function isSpam(chatId) {
  const now = Date.now();
  const hits = rateLimit.get(chatId) || [];
  const recent = hits.filter(t => now - t < 60000);
  recent.push(now);
  rateLimit.set(chatId, recent);
  return recent.length > 10;
}

function isAdmin(id) { return ADMINS.includes(id); }
function time() { return new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' }); }

function fmt(data) {
  if (!data || typeof data !== 'object') return '';
  let s = '';
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'string') s += `  ${k}: ${v}\n`;
  }
  return s;
}

// ===== CORS =====
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ===== HEALTH =====
app.get('/', (req, res) => {
  res.json({
    bot: 'EcoLoop v5.0',
    status: 'running',
    pending: pending.size,
    uptime: process.uptime().toFixed(0) + 's',
    time: time()
  });
});

// ===== WEBHOOK =====
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const u = req.body;
    if (u.message) await onMessage(u.message);
    if (u.callback_query) await onCallback(u.callback_query);
  } catch (err) {
    console.error('WEBHOOK ERROR:', err.message);
  }
});

// ===== API: ЗАЯВКИ С САЙТА =====
app.post('/api/submit', async (req, res) => {
  try {
    const { type, data } = req.body;
    if (!type || !data) return res.status(400).json({ error: 'type and data required' });

    const id = ++counter;
    pending.set(id, { type, data, time: time() });

    const icons = {
      hotel: '🏨', post: '📝', callback: '📞',
      request: '📋', buyer: '👤', vacancy: '💼'
    };
    const names = {
      hotel: 'РЕГИСТРАЦИЯ ОТЕЛЯ',
      post: 'НОВЫЙ ПОСТ',
      callback: 'ОБРАТНЫЙ ЗВОНОК',
      request: 'НОВЫЙ ЗАПРОС',
      buyer: 'РЕГИСТРАЦИЯ ПОКУПАТЕЛЯ',
      vacancy: 'ОТКЛИК НА ВАКАНСИЮ'
    };

    const icon = icons[type] || '📩';
    const name = names[type] || 'НОВАЯ ЗАЯВКА';

    let text = `${icon} ${name}\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `ID: #${id}\n\n`;
    text += fmt(data);
    text += `\nВремя: ${time()}`;

    const kb = {
      inline_keyboard: [
        [
          { text: '✅ Принять', callback_data: `ok_${type}_${id}` },
          { text: '❌ Отклонить', callback_data: `no_${type}_${id}` }
        ],
        [
          { text: '📞 Связаться', callback_data: `call_${id}` },
          { text: '📋 Подробнее', callback_data: `info_${id}` }
        ]
      ]
    };

    await sendKB(TG_CHAT, text, kb);
    console.log(`NEW #${id}: ${type}`);
    res.json({ success: true, id });

  } catch (err) {
    console.error('SUBMIT ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===== СООБЩЕНИЯ =====
async function onMessage(msg) {
  if (!msg.text) return;
  const cid = msg.chat.id;
  const txt = msg.text.trim();
  const name = msg.from.first_name || 'User';
  const uname = msg.from.username ? '@' + msg.from.username : '';
  const uid = msg.from.id;

  if (isSpam(cid)) {
    await send(cid, '⛔ Подождите минуту. Слишком много сообщений.');
    return;
  }

  // === КОМАНДЫ ===
  if (txt === '/start') {
    await sendKB(cid,
      `🌿 Привет, ${name}!\n\n` +
      `Добро пожаловать в EcoLoop — маркетплейс для перераспределения излишков отелей Казахстана.\n\n` +
      `Скидки до 70% на еду, текстиль и вторсырье от лучших отелей.\n\n` +
      `Выбери раздел:`,
      { inline_keyboard: [
        [{ text: '🛍️ Лоты', callback_data: 'c_lots' }, { text: '📊 Статистика', callback_data: 'c_stats' }],
        [{ text: '📝 Заявка', callback_data: 'c_request' }, { text: '💰 Цены', callback_data: 'c_prices' }],
        [{ text: '🏨 Для отелей', callback_data: 'c_hotels' }, { text: '📞 Контакты', callback_data: 'c_contacts' }],
        [{ text: '🌿 О проекте', callback_data: 'c_about' }, { text: '❓ FAQ', callback_data: 'c_faq' }],
        [{ text: '🌐 Открыть сайт', url: SITE_URL }]
      ]}
    );
    return;
  }

  if (txt === '/help') {
    await send(cid,
      '📋 Команды:\n\n' +
      '/start — Главное меню\n' +
      '/lots — Лоты\n' +
      '/stats — Статистика\n' +
      '/request — Заявка\n' +
      '/contacts — Контакты\n' +
      '/about — О проекте\n' +
      '/prices — Цены\n' +
      '/hotels — Для отелей\n' +
      '/faq — FAQ\n' +
      '/feedback — Отзыв\n\n' +
      'Или напишите:\n' +
      '  Заявка: что ищете\n' +
      '  Отзыв: ваш текст\n' +
      '  Жалоба: описание'
    );
    return;
  }

  if (txt === '/lots') { await showLots(cid); return; }
  if (txt === '/stats') { await showStats(cid); return; }
  if (txt === '/request') { await showRequest(cid); return; }
  if (txt === '/contacts') { await showContacts(cid); return; }
  if (txt === '/about') { await showAbout(cid); return; }
  if (txt === '/prices') { await showPrices(cid); return; }
  if (txt === '/hotels' || txt === '/forhotels') { await showHotels(cid); return; }
  if (txt === '/faq') { await showFAQ(cid); return; }
  if (txt === '/feedback') { await showFeedback(cid); return; }

  // /admin
  if (txt === '/admin') {
    if (!isAdmin(cid)) { await send(cid, '🔒 Нет доступа'); return; }
    await sendKB(cid,
      `🔐 АДМИН-ПАНЕЛЬ\n━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Привет, ${name}!\n` +
      `Ожидают: ${pending.size}\n` +
      `Бот: v5.0\n` +
      `Время: ${time()}`,
      { inline_keyboard: [
        [{ text: `📋 Ожидают (${pending.size})`, callback_data: 'a_pending' }],
        [{ text: '📊 Статистика', callback_data: 'a_stats' }, { text: '⚙️ Настройки', callback_data: 'a_settings' }],
        [{ text: '📢 Рассылка', callback_data: 'a_broadcast' }]
      ]}
    );
    return;
  }

  if (txt.startsWith('/broadcast ')) {
    if (!isAdmin(cid)) { await send(cid, '🔒 Нет доступа'); return; }
    const m = txt.slice(11);
    await send(cid, '📢 Текст рассылки:\n\n' + m + '\n\n(Для реальной рассылки подключите базу)');
    return;
  }

  // Заявка из чата
  if (txt.toLowerCase().startsWith('заявка:')) {
    const id = ++counter;
    pending.set(id, {
      type: 'request',
      data: { text: txt, name, username: uname, userId: uid },
      userChatId: cid,
      time: time()
    });
    await sendKB(TG_CHAT,
      `📋 ЗАЯВКА ИЗ TELEGRAM\n━━━━━━━━━━━━━━━━━━━━\n` +
      `ID: #${id}\n\n` +
      `От: ${name} ${uname}\n` +
      `TG ID: ${uid}\n\n` +
      `${txt}\n\n` +
      `Время: ${time()}`,
      { inline_keyboard: [[
        { text: '✅ Принять', callback_data: `ok_request_${id}` },
        { text: '❌ Отклонить', callback_data: `no_request_${id}` }
      ], [
        { text: '📞 Связаться', callback_data: `call_${id}` }
      ]]}
    );
    await send(cid, `✅ Заявка #${id} отправлена!\nМенеджер свяжется в течение 2 часов.\n\n📞 Срочно: +7 (776) 075-24-63`);
    return;
  }

  // Отзыв
  if (txt.toLowerCase().startsWith('отзыв:')) {
    await send(TG_CHAT, `⭐ ОТЗЫВ\n━━━━━━━━━━━━━━━━━━━━\nОт: ${name} ${uname}\n\n${txt}\n\nВремя: ${time()}`);
    await send(cid, '🙏 Спасибо за отзыв!');
    return;
  }

  // Жалоба
  if (txt.toLowerCase().startsWith('жалоба:')) {
    const id = ++counter;
    pending.set(id, {
      type: 'complaint',
      data: { text: txt, name, username: uname, userId: uid },
      userChatId: cid,
      time: time()
    });
    await sendKB(TG_CHAT,
      `🚨 ЖАЛОБА\n━━━━━━━━━━━━━━━━━━━━\n` +
      `ID: #${id}\n\n` +
      `От: ${name} ${uname}\n\n${txt}\n\n` +
      `Время: ${time()}`,
      { inline_keyboard: [[
        { text: '✅ Рассмотрена', callback_data: `ok_complaint_${id}` },
        { text: '📞 Связаться', callback_data: `call_${id}` }
      ]]}
    );
    await send(cid, `📨 Жалоба #${id} принята.\n📞 Горячая линия: +7 (776) 075-24-63`);
    return;
  }

  // Телефон
  if (/^\+?[78]\d{10}$/.test(txt.replace(/[\s\-()]/g, ''))) {
    await send(TG_CHAT, `📞 НОМЕР ТЕЛЕФОНА\n━━━━━━━━━━━━━━━━━━━━\n${name} ${uname}\n📱 ${txt}\n\nВремя: ${time()}`);
    await send(cid, '✅ Номер получен! Менеджер перезвонит в течение часа.');
    return;
  }

  // Неизвестное
  await sendKB(cid,
    '🤔 Не понял.\n\nПопробуйте:\n  Заявка: что ищете\n  Отзыв: текст\n  Или выберите:',
    { inline_keyboard: [
      [{ text: '🛍️ Лоты', callback_data: 'c_lots' }, { text: '📝 Заявка', callback_data: 'c_request' }],
      [{ text: '📋 Меню', callback_data: 'c_menu' }, { text: '❓ FAQ', callback_data: 'c_faq' }]
    ]}
  );
}

// ===== CALLBACK QUERY =====
async function onCallback(q) {
  const cid = q.message.chat.id;
  const mid = q.message.message_id;
  const d = q.callback_data;

  // ОБЯЗАТЕЛЬНО ответить на callback — иначе крутит loading
  await answer(q.id);

  console.log('CB:', d, 'from:', cid);

  // === ОДОБРЕНИЕ / ОТКЛОНЕНИЕ ===
  if (d.startsWith('ok_') || d.startsWith('no_')) {
    if (!isAdmin(cid)) { await send(cid, '🔒 Нет доступа'); return; }

    const parts = d.split('_');
    const action = parts[0]; // ok или no
    const type = parts[1];
    const id = parseInt(parts[2]);
    const item = pending.get(id);

    if (!item) {
      await send(cid, '⚠️ Заявка #' + id + ' не найдена или уже обработана.');
      return;
    }

    pending.delete(id);

    const icons = {
      hotel: '🏨', post: '📝', request: '📋',
      complaint: '🚨', callback: '📞', buyer: '👤', vacancy: '💼'
    };
    const icon = icons[type] || '📩';

    if (action === 'ok') {
      await editMsg(cid, mid,
        `${icon} ОДОБРЕНО ✅\n━━━━━━━━━━━━━━━━━━━━\n` +
        `ID: #${id}\n\n` +
        fmt(item.data) +
        `\nОдобрено: ${time()}\nАдмин: ${q.from.first_name}`
      );
      if (item.userChatId) {
        await send(item.userChatId, `✅ Ваша заявка #${id} одобрена!`);
      }
    } else {
      await editMsg(cid, mid,
        `${icon} ОТКЛОНЕНО ❌\n━━━━━━━━━━━━━━━━━━━━\n` +
        `ID: #${id}\n\n` +
        fmt(item.data) +
        `\nОтклонено: ${time()}\nАдмин: ${q.from.first_name}`
      );
      if (item.userChatId) {
        await send(item.userChatId, `❌ Заявка #${id} отклонена.\n📞 Свяжитесь: +7 (776) 075-24-63`);
      }
    }
    return;
  }

  // === СВЯЗАТЬСЯ ===
  if (d.startsWith('call_')) {
    if (!isAdmin(cid)) { await send(cid, '🔒'); return; }
    const id = parseInt(d.replace('call_', ''));
    const item = pending.get(id);
    if (!item) { await send(cid, '⚠️ Не найдено.'); return; }
    const contact = item.data.phone || item.data.email || item.data.contactName || item.data.name || 'Не указан';
    await send(cid, `📞 Контакт заявки #${id}:\n${contact}`);
    if (item.userChatId) {
      await send(item.userChatId, `📞 Менеджер EcoLoop хочет связаться с вами. Ожидайте.`);
    }
    return;
  }

  // === ПОДРОБНЕЕ ===
  if (d.startsWith('info_')) {
    if (!isAdmin(cid)) { await send(cid, '🔒'); return; }
    const id = parseInt(d.replace('info_', ''));
    const item = pending.get(id);
    if (!item) { await send(cid, '⚠️ Не найдено.'); return; }
    let text = `📋 ПОДРОБНО #${id}\n━━━━━━━━━━━━━━━━━━━━\n`;
    text += `Тип: ${item.type}\n`;
    text += `Время: ${item.time}\n\n`;
    text += fmt(item.data);
    await send(cid, text);
    return;
  }

  // === АДМИН ===
  if (d === 'a_pending') {
    if (!isAdmin(cid)) { await send(cid, '🔒'); return; }
    if (pending.size === 0) { await send(cid, '✅ Нет заявок!'); return; }
    const icons = { hotel: '🏨', post: '📝', request: '📋', complaint: '🚨', callback: '📞', buyer: '👤', vacancy: '💼' };
    let text = `📋 ОЖИДАЮТ (${pending.size})\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    for (const [id, item] of pending) {
      text += `${icons[item.type] || '📩'} #${id} — ${item.type} — ${item.time}\n`;
    }
    await send(cid, text);
    return;
  }

  if (d === 'a_stats') {
    if (!isAdmin(cid)) { await send(cid, '🔒'); return; }
    await send(cid,
      `📊 СТАТИСТИКА БОТА\n━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Версия: 5.0\n` +
      `Ожидают: ${pending.size}\n` +
      `Всего заявок: ${counter - 1000}\n` +
      `Админов: ${ADMINS.length}\n` +
      `Антиспам: 10 msg/min\n` +
      `Uptime: ${Math.floor(process.uptime())}s\n\n` +
      `Обновлено: ${time()}`
    );
    return;
  }

  if (d === 'a_broadcast') {
    if (!isAdmin(cid)) { await send(cid, '🔒'); return; }
    await send(cid, '📢 Для рассылки отправьте:\n/broadcast Текст сообщения');
    return;
  }

  if (d === 'a_settings') {
    if (!isAdmin(cid)) { await send(cid, '🔒'); return; }
    await send(cid,
      `⚙️ НАСТРОЙКИ\n━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Бот: v5.0\n` +
      `Админ: ${TG_CHAT}\n` +
      `Антиспам: 10/мин\n` +
      `Сайт: ${SITE_URL}\n\n` +
      `Для изменений — обновите код бота.`
    );
    return;
  }

  // === НАВИГАЦИЯ ===
  if (d === 'c_menu') { await showMenu(cid); return; }
  if (d === 'c_lots') { await showLots(cid); return; }
  if (d === 'c_stats') { await showStats(cid); return; }
  if (d === 'c_request') { await showRequest(cid); return; }
  if (d === 'c_contacts') { await showContacts(cid); return; }
  if (d === 'c_about') { await showAbout(cid); return; }
  if (d === 'c_prices') { await showPrices(cid); return; }
  if (d === 'c_hotels') { await showHotels(cid); return; }
  if (d === 'c_faq') { await showFAQ(cid); return; }
  if (d === 'c_feedback') { await showFeedback(cid); return; }
  if (d === 'c_food') { await showFood(cid); return; }
  if (d === 'c_textile') { await showTextile(cid); return; }
  if (d === 'c_plastic') { await showPlastic(cid); return; }

  console.log('Unknown CB:', d);
}

// ===== КОНТЕНТ =====
async function showMenu(cid) {
  await sendKB(cid, '📋 Главное меню:', { inline_keyboard: [
    [{ text: '🛍️ Лоты', callback_data: 'c_lots' }, { text: '📊 Статистика', callback_data: 'c_stats' }],
    [{ text: '📝 Заявка', callback_data: 'c_request' }, { text: '💰 Цены', callback_data: 'c_prices' }],
    [{ text: '🏨 Для отелей', callback_data: 'c_hotels' }, { text: '📞 Контакты', callback_data: 'c_contacts' }],
    [{ text: '🌿 О проекте', callback_data: 'c_about' }, { text: '❓ FAQ', callback_data: 'c_faq' }]
  ]});
}

async function showLots(cid) {
  await sendKB(cid,
    '🛍️ ЛОТЫ СЕГОДНЯ\n━━━━━━━━━━━━━━━━━━━━\n\n' +
    '1. 🍽️ Magic Box от Rixos Almaty\n   500 тг (было 1500) — скидка 67%\n   5 кг выпечки. До 21:30\n\n' +
    '2. ♻️ Пластиковая тара от Hilton\n   200 тг (было 600) — скидка 67%\n   50 кг. До 18:00\n\n' +
    '3. 👕 Постельное от Marriott\n   150 тг (было 450) — скидка 67%\n   20 комплектов. До 20:00',
    { inline_keyboard: [
      [{ text: '🍽️ Еда', callback_data: 'c_food' }, { text: '👕 Текстиль', callback_data: 'c_textile' }, { text: '♻️ Пластик', callback_data: 'c_plastic' }],
      [{ text: '📝 Оставить заявку', callback_data: 'c_request' }],
      [{ text: '◀️ Меню', callback_data: 'c_menu' }]
    ]}
  );
}

async function showFood(cid) {
  await sendKB(cid,
    '🍽️ ЕДА\n━━━━━━━━━━━━━━━━━━━━\n\n' +
    '1. Magic Box от Rixos — 500 тг — 5 кг выпечки\n' +
    '2. Бизнес-ланч от Hilton — 700 тг — 3 порции\n' +
    '3. Молочка от Holiday Inn — 400 тг — 2 кг\n\n' +
    'Контроль качества пройден.',
    { inline_keyboard: [
      [{ text: '📝 Заявка', callback_data: 'c_request' }],
      [{ text: '◀️ Лоты', callback_data: 'c_lots' }]
    ]}
  );
}

async function showTextile(cid) {
  await sendKB(cid,
    '👕 ТЕКСТИЛЬ\n━━━━━━━━━━━━━━━━━━━━\n\n' +
    '1. Постельное от Marriott — 150 тг — 20 шт\n' +
    '2. Полотенца от Rixos — 100 тг — 50 шт\n' +
    '3. Униформа от Hilton — 200 тг — 15 шт',
    { inline_keyboard: [
      [{ text: '📝 Заявка', callback_data: 'c_request' }],
      [{ text: '◀️ Лоты', callback_data: 'c_lots' }]
    ]}
  );
}

async function showPlastic(cid) {
  await sendKB(cid,
    '♻️ ПЛАСТИК И ВТОРСЫРЬЕ\n━━━━━━━━━━━━━━━━━━━━\n\n' +
    '1. Пластик от Hilton — 200 тг — 50 кг\n' +
    '2. Картон от Rixos — 80 тг — 30 кг\n' +
    '3. Стекло от Marriott — 120 тг — 100 шт',
    { inline_keyboard: [
      [{ text: '📝 Заявка', callback_data: 'c_request' }],
      [{ text: '◀️ Лоты', callback_data: 'c_lots' }]
    ]}
  );
}

async function showStats(cid) {
  await sendKB(cid,
    '📊 СТАТИСТИКА ECOLOOP\n━━━━━━━━━━━━━━━━━━━━\n\n' +
    'Оборот: 532,000 тг\n' +
    'Отелей: 10+\n' +
    'Лотов продано: 47\n' +
    'Сокращено отходов: 1,250 кг\n' +
    'Покупателей: 120+\n' +
    'Рейтинг: 4.8/5\n' +
    'Рост за неделю: +18%',
    { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'c_menu' }]] }
  );
}

async function showRequest(cid) {
  await sendKB(cid,
    '📝 ОСТАВИТЬ ЗАЯВКУ\n━━━━━━━━━━━━━━━━━━━━\n\n' +
    'Напишите в формате:\n\n' +
    'Заявка: Выпечка и хлеб, 10 кг,\n' +
    'район Бостандыкский,\n' +
    'тел: +7 777 123 4567\n\n' +
    'Или просто отправьте номер — мы перезвоним!',
    { inline_keyboard: [
      [{ text: '🌐 На сайте', url: SITE_URL }],
      [{ text: '◀️ Меню', callback_data: 'c_menu' }]
    ]}
  );
}

async function showContacts(cid) {
  await sendKB(cid,
    '📞 КОНТАКТЫ\n━━━━━━━━━━━━━━━━━━━━\n\n' +
    'Менеджер:\n' +
    '  📱 +7 (776) 075-24-63\n' +
    '  📧 info@ecoloop.kz\n\n' +
    'Время работы:\n' +
    '  Пн-Пт: 9:00 - 18:00\n' +
    '  Сб: 10:00 - 15:00\n\n' +
    'Алматы, Казахстан',
    { inline_keyboard: [
      [{ text: '💬 Менеджер', url: 'https://t.me/ecoloop_manager' }],
      [{ text: '🌐 Сайт', url: SITE_URL }],
      [{ text: '◀️ Меню', callback_data: 'c_menu' }]
    ]}
  );
}

async function showAbout(cid) {
  await sendKB(cid,
    '🌿 О ПРОЕКТЕ\n━━━━━━━━━━━━━━━━━━━━\n\n' +
    'EcoLoop — первый в Казахстане маркетплейс для перераспределения излишков от отелей.\n\n' +
    'Проблема: 40% еды в отелях выбрасывается.\n\n' +
    'Решение: Скидка 50-70% для покупателей + монетизация для отелей.\n\n' +
    'Результаты:\n' +
    '  1,250+ кг отходов сокращено\n' +
    '  47+ лотов продано\n' +
    '  10+ отелей-партнеров\n' +
    '  4.8 рейтинг',
    { inline_keyboard: [
      [{ text: '🏨 Подключить отель', callback_data: 'c_hotels' }],
      [{ text: '🛍️ Купить лот', callback_data: 'c_lots' }],
      [{ text: '◀️ Меню', callback_data: 'c_menu' }]
    ]}
  );
}

async function showPrices(cid) {
  await sendKB(cid,
    '💰 ЦЕНЫ\n━━━━━━━━━━━━━━━━━━━━\n\n' +
    'Скидка 50-70% от розничной.\n\n' +
    '🍽️ Выпечка 5 кг: 500 тг (розница 1,500)\n' +
    '♻️ Пластик 50 кг: 200 тг (розница 600)\n' +
    '👕 Текстиль 20 шт: 150 тг (розница 450)\n\n' +
    'Оплата: Kaspi / Visa / MC\n' +
    'Самовывоз — бесплатно',
    { inline_keyboard: [
      [{ text: '🛍️ Лоты', callback_data: 'c_lots' }],
      [{ text: '◀️ Меню', callback_data: 'c_menu' }]
    ]}
  );
}

async function showHotels(cid) {
  await sendKB(cid,
    '🏨 ДЛЯ ОТЕЛЕЙ\n━━━━━━━━━━━━━━━━━━━━\n\n' +
    'Подключение за 3 дня:\n' +
    '1. Заявка на сайте\n' +
    '2. Проверка БИН + документов\n' +
    '3. Договор через ЭЦП\n' +
    '4. Онбординг + обучение\n\n' +
    'Условия:\n' +
    '  Комиссия: 10% от сделки\n' +
    '  Выплаты: еженедельно\n' +
    '  Мин. объем: нет\n\n' +
    'Обязательно:\n' +
    '  Наименование ИП\n' +
    '  БИН организации',
    { inline_keyboard: [
      [{ text: '📝 Подать заявку', url: SITE_URL }],
      [{ text: '📞 Позвонить', callback_data: 'c_contacts' }],
      [{ text: '◀️ Меню', callback_data: 'c_menu' }]
    ]}
  );
}

async function showFAQ(cid) {
  await sendKB(cid,
    '❓ FAQ\n━━━━━━━━━━━━━━━━━━━━\n\n' +
    'В: Безопасно ли покупать еду?\n' +
    'О: Да. Контроль качества. Срок годности мин. 6ч.\n\n' +
    'В: Как оплатить?\n' +
    'О: Kaspi / Visa / MC.\n\n' +
    'В: Можно вернуть?\n' +
    'О: Да, в течение 2 часов.\n\n' +
    'В: Как часто лоты?\n' +
    'О: Каждый день. Пик: 14:00-20:00.\n\n' +
    'В: Подключение отеля стоит?\n' +
    'О: Бесплатно. Комиссия 10% с продаж.\n\n' +
    'В: Работаете за пределами Алматы?\n' +
    'О: Алматы и Астана.',
    { inline_keyboard: [
      [{ text: '📝 Вопрос', callback_data: 'c_request' }, { text: '📞 Позвонить', callback_data: 'c_contacts' }],
      [{ text: '◀️ Меню', callback_data: 'c_menu' }]
    ]}
  );
}

async function showFeedback(cid) {
  await sendKB(cid,
    '⭐ ОБРАТНАЯ СВЯЗЬ\n━━━━━━━━━━━━━━━━━━━━\n\n' +
    'Напишите в любом формате:\n\n' +
    '  Отзыв: Отличный сервис!\n' +
    '  Жалоба: Описание проблемы\n\n' +
    'Мы читаем каждый отзыв!',
    { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'c_menu' }]] }
  );
}

// ===== TELEGRAM API =====
async function send(chatId, text) {
  try {
    const r = await fetch(`${TG_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    const j = await r.json();
    if (!j.ok) console.error('SEND ERR:', JSON.stringify(j).substring(0, 200));
    return j;
  } catch (e) {
    console.error('SEND FETCH ERR:', e.message);
  }
}

async function sendKB(chatId, text, kb) {
  try {
    const r = await fetch(`${TG_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, reply_markup: kb })
    });
    const j = await r.json();
    if (!j.ok) console.error('SENDKB ERR:', JSON.stringify(j).substring(0, 200));
    return j;
  } catch (e) {
    console.error('SENDKB FETCH ERR:', e.message);
  }
}

async function editMsg(chatId, msgId, text) {
  try {
    const r = await fetch(`${TG_API}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: msgId, text })
    });
    const j = await r.json();
    if (!j.ok) console.error('EDIT ERR:', JSON.stringify(j).substring(0, 200));
    return j;
  } catch (e) {
    console.error('EDIT FETCH ERR:', e.message);
  }
}

async function answer(callbackId) {
  try {
    await fetch(`${TG_API}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackId })
    });
  } catch (e) {
    console.error('ANSWER ERR:', e.message);
  }
}

// ===== СТАРТ =====
app.listen(PORT, () => {
  console.log('');
  console.log('====================================');
  console.log('  EcoLoop Bot v5.0');
  console.log('  Port: ' + PORT);
  console.log('  Webhook: POST /webhook');
  console.log('  API: POST /api/submit');
  console.log('  Health: GET /');
  console.log('  Time: ' + time());
  console.log('====================================');
  console.log('');
});
