const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { google } = require('googleapis');
const dayjs = require('dayjs');
require('dotenv').config();

// ===== CONFIG =====
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'finance';

// ===== GOOGLE AUTH =====
const auth = new google.auth.GoogleAuth({
  keyFile: 'credentials.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

// ===== WHATSAPP =====
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './session'
  }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

client.on('qr', qr => qrcode.generate(qr, { small: true }));
client.on('ready', () => console.log('✅ Bot Ready!'));

// ===== ENSURE SHEET EXISTS =====
async function ensureSheetExists() {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
  });

  const exists = res.data.sheets.some(
    s => s.properties.title === SHEET_NAME
  );

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          addSheet: { properties: { title: SHEET_NAME } }
        }]
      }
    });

    // Add header
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:E1`,
      valueInputOption: 'RAW',
      resource: {
        values: [['Date', 'Type', 'Amount', 'Category', 'Note']]
      }
    });

    console.log('📄 Sheet created!');
  }
}

// ===== CATEGORY DETECTION =====
function detectCategory(text) {
  text = text.toLowerCase();

  if (text.match(/makan|jajan|kopi|food|drink/)) return 'food';
  if (text.match(/bensin|transport|ojek|grab|gojek/)) return 'transport';
  if (text.match(/gaji|salary|income|bonus/)) return 'income';
  if (text.match(/listrik|air|internet/)) return 'utilities';

  return 'other';
}

// ===== PARSE AMOUNT =====
function parseAmount(text) {
  text = text.toLowerCase();

  // 5rb → 5000
  let rb = text.match(/(\d+)\s?rb/);
  if (rb) return parseInt(rb[1]) * 1000;

  // 3jt → 3000000
  let jt = text.match(/(\d+)\s?jt/);
  if (jt) return parseInt(jt[1]) * 1000000;

  // 30000
  let num = text.match(/\d+/);
  if (num) return parseInt(num[0]);

  return null;
}

// ===== SAVE =====
async function saveTransaction(type, amount, category, note) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:E`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[
        dayjs().format('YYYY-MM-DD'),
        type,
        amount,
        category,
        note
      ]]
    }
  });
}

// ===== GET DATA =====
async function getAllData() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:E`,
  });

  return res.data.values || [];
}

// ===== BALANCE =====
function calculateBalance(data) {
  let total = 0;

  data.slice(1).forEach(row => {
    if (row[1] === 'income') total += parseInt(row[2]);
    if (row[1] === 'expense') total -= parseInt(row[2]);
  });

  return total;
}

// ===== HANDLER =====
client.on('message_create', async msg => {
  try {
    if (msg.fromMe) return;

    const text = msg.body.toLowerCase().trim();
    console.log('📩', text);

    if (text === 'ping') return msg.reply('pong');

    if (text === 'balance') {
      const data = await getAllData();
      return msg.reply(`💰 Balance: ${calculateBalance(data)}`);
    }

    // ===== SMART PARSE =====
    const amount = parseAmount(text);

    if (amount) {
      const isIncome = text.match(/gaji|salary|income|bonus/);

      const type = isIncome ? 'income' : 'expense';
      const category = detectCategory(text);

      await saveTransaction(type, amount, category, text);

      return msg.reply(
        `✅ Saved\n` +
        `💰 ${type}: ${amount}\n` +
        `🏷️ ${category}\n` +
        `📝 ${text}`
      );
    }

    if (text === 'help') {
      return msg.reply(
`Try:
jajan 5rb
bensin 30k
gaji 3jt
balance`
      );
    }

  } catch (err) {
    console.error(err);
    msg.reply('⚠️ Error');
  }
});

// ===== START =====
(async () => {
  await ensureSheetExists();
  client.initialize();
})();