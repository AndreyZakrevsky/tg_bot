import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import path from 'path';
import { fileURLToPath } from 'url';
import ccxt from 'ccxt';
import LocalSession from 'telegraf-session-local';
import { DateTime } from 'luxon';
import i18next from 'i18next';
import Backend from 'i18next-fs-backend';

// Конфігурація i18next
i18next.use(Backend).init({
    fallbackLng: 'en',
    preload: ['en', 'vi'],
    backend: {
        loadPath: './locales/{{lng}}/translation.json',
    },
});

const localSessionConfig = {
    database: 'session.json',
    format: {
        serialize: (obj) => JSON.stringify(obj, null, 2),
        deserialize: (str) => JSON.parse(str),
    },
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VND_PRICE = 25700;
const MAX_CHECKING_DURATION = 180000;
const CHECK_INTERVAL = 5000;

class BotHandler {
    constructor(tg_token, exchanges) {
        if (!tg_token) return;

        this.bot = new Telegraf(tg_token);
        this.bot.use(new LocalSession(localSessionConfig).middleware());

        this.exchanges = exchanges;
        this.currentExchange = null;
        this.binance = null;
        this.bybit = null;
        this.gate = null;
        this.sessionFreezed = false;
        this.price = VND_PRICE;

        this._setup();
        this._setupExchanges();
    }

    // Модифіковані відповіді з використанням i18next
    async _startSession(ctx, userInput) {
        this.sessionFreezed = true;
        const convertedValue = this._roundUpSecondDecimal(Number(userInput) / (this.price || VND_PRICE));
        const filePath = path.join(__dirname, 'assets', `${this.currentExchange}.jpg`);
        const t = i18next.getFixedT(ctx.from.language_code || 'en'); // Визначення мови користувача

        await ctx.reply(t('enteredAmount', { userInput, convertedValue }));
        await ctx.replyWithPhoto({ source: filePath });
        await ctx.reply(t('sessionStarted', { convertedValue, time: Math.floor(MAX_CHECKING_DURATION / 60000) }));

        this._setDailyBalances(ctx, userInput);

        this._checkBalance(ctx);
    }

    _setDailyBalances(ctx, value) {
        if (!ctx?.session?.balances) this._initDailyBalances(ctx);

        const time = DateTime.now().setZone('Asia/Ho_Chi_Minh').toLocaleString(DateTime.DATETIME_FULL).replace(' GMT+7', '');

        ctx.session.balances[this.currentExchange].transactions.push({
            amount: value,
            time,
        });
    }

    async _setupExchanges() {
        this.binance = new ccxt.binance({
            apiKey: process.env.BINANCE_API_KEY,
            secret: process.env.BINANCE_API_SECRET,
        });

        this.gate = new ccxt.gate({
            apiKey: process.env.GATE_API_KEY,
            secret: process.env.GATE_API_SECRET,
        });

        this.bybit = new ccxt.bybit({
            apiKey: process.env.BYBIT_API_KEY,
            secret: process.env.BYBIT_API_SECRET,
        });
    }

    _setup() {
        this.bot.command('start', async (ctx) => {
            const t = i18next.getFixedT(ctx.from.language_code || 'en');
            await ctx.reply(t('welcome', { botName: ctx.botInfo.first_name }));
            this._printMenu(ctx);
        });

        this.bot.command('menu', (ctx) => this._printMenu(ctx));
        this.bot.command('clear_balances', (ctx) => this._initDailyBalances(ctx));
        this.bot.command('get_balance', (ctx) => this._checkDailyBalancePrivate(ctx));
        this.bot.command('set', async (ctx) => {
            const text = ctx.message.text;
            const params = text.split(' ').slice(1);
            const { vnd = null } = params.reduce((acc, param) => {
                const [key, value] = param.split('=');
                acc[key] = value;
                return acc;
            }, {});

            if (vnd) this._setVndValue(ctx, vnd);
        });

        this.bot.action(/SELECT_/, async (ctx) => {
            const value = ctx.callbackQuery?.data?.replace('SELECT_', '');
            if (!value) return ctx.reply('Invalid action.');
            this._handleAction(value, ctx);
        });

        this.bot.on('text', (ctx) => {
            const userInput = this._toNormalNumber(ctx?.message?.text);

            if (this.sessionFreezed)
                return ctx.reply(
                    i18next.getFixedT(ctx.from.language_code || 'en')('sessionRunning', {
                        time: Math.floor(MAX_CHECKING_DURATION / 60000),
                        menuLink: '/menu',
                    })
                );

            if (!this.currentExchange) return ctx.reply(i18next.getFixedT(ctx.from.language_code || 'en')('selectExchange'));

            if (userInput) return this._startSession(ctx, userInput);

            ctx.reply(i18next.getFixedT(ctx.from.language_code || 'en')('invalidAmount'));
        });
    }

    launch() {
        this.bot.launch();

        process.once('SIGINT', () => this.bot.stop('SIGINT'));
        process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
    }
}

const exchanges = ['binance', 'bybit', 'gate'];
const botHandler = new BotHandler(process.env.TELEGRAM_BOT_TOKEN, exchanges);
botHandler.launch();
