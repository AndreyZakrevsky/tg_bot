import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import path from 'path';
import { fileURLToPath } from 'url';
import ccxt from 'ccxt';
import LocalSession from 'telegraf-session-local';
import { DateTime } from 'luxon';
import i18next from 'i18next';
import Backend from 'i18next-fs-backend';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

i18next.use(Backend).init({
    fallbackLng: 'en',
    preload: ['en', 'vi'],
    backend: {
        loadPath: path.join(__dirname, 'locales/{{lng}}/translation.json'),
    },
});

const sessionFilePath = process.env.SESSION_FILE_PATH || 'session.json';
const localSessionConfig = {
    database: sessionFilePath,
    format: {
        serialize: (obj) => JSON.stringify(obj, null, 2),
        deserialize: (str) => JSON.parse(str),
    },
};

const VND_PRICE = 25700;
const MAX_CHECKING_DURATION = 180000;
const CHECK_INTERVAL = 5000;
const PERCENTAGE_GAP = 98;

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
        this.buttonsMarker = ['0_button', '1_button', '2_button', '3_button'];
        this.translate = i18next.getFixedT('en');

        this._setup();
        this._setupExchanges();
    }

    async _checkBalance(ctx, userInputValue, originUserInputValue) {
        const startTime = Date.now();

        try {
            while (Date.now() - startTime < MAX_CHECKING_DURATION && this.sessionFreezed) {
                const deposit = await this._getDepositOrder(userInputValue);
                const { amount = null } = deposit || {};
                console.log('Current deposit amount is ', amount);

                if (amount) {
                    this._setDailyBalances(ctx, originUserInputValue);
                    ctx.reply(this.translate('balanceChanged', { difference: amount }));
                    return this._clearSession();
                }

                await this._sleep(CHECK_INTERVAL);
            }
        } catch (error) {
            console.log('SOME ERROR', error.message);
        }

        ctx.reply(this.translate('cancelSessionDueToNoPayment'));
        this._clearSession();
    }

    async _getDepositOrder(userInputValue) {
        const threeMinutesAgo = Date.now() - 3 * 60 * 1000;
        const balances = await this[this.currentExchange].fetchDeposits('USDT', threeMinutesAgo);

        return this._findMatchingElement(balances || [], userInputValue);
    }

    _findMatchingElement(array, targetAmount) {
        const lowerBound = targetAmount * (PERCENTAGE_GAP / 100);
        const upperBound = targetAmount * (2 - PERCENTAGE_GAP / 100);

        return array.find((item) => item.status === 'ok' && item.amount >= lowerBound && item.amount <= upperBound);
    }

    async _startSession(ctx, userInput) {
        this.sessionFreezed = true;
        const convertedValue = this._roundUpSecondDecimal(Number(userInput) / (this.price || VND_PRICE));
        const filePath = path.join(__dirname, 'assets', `${this.currentExchange}.jpg`);

        await ctx.reply(this.translate('enteredAmount', { amount: userInput, convertedValue }));
        await ctx.replyWithPhoto({ source: filePath });
        await ctx.reply(this.translate('sessionStarted', { convertedValue, time: Math.floor(MAX_CHECKING_DURATION / 60000) }));
        // NOTE: For testing purposes only!
        //this._setDailyBalances(ctx, userInput);

        this._checkBalance(ctx, convertedValue, userInput);
    }

    async _getUSDTBalance(exchange) {
        const balances = await this[exchange].fetchBalance({ type: 'funding' });
        return this._toNormalNumber(balances?.USDT?.free || 0);
    }

    _clearSession() {
        this.currentExchange = null;
        this.sessionFreezed = false;
    }

    _createBalanceStr(exchangeData, exchangeName = '') {
        const { total = null, transactions = [] } = exchangeData || {};
        const substrName = exchangeName ? ` via ${exchangeName}` : '';

        if (total === 0 || transactions.length === 0) return null;

        return this.translate('dailyBalance', { substrName, total, transactions: transactions.map((tr, i) => `${i + 1}:   ${tr.amount} VND  ${tr.time}\n`).join('') });
    }

    async _checkDailyBalancePrivate(ctx) {
        const { binance = null, bybit = null, gate = null } = ctx?.session?.balances || {};

        const binanceStr = binance ? this._createBalanceStr(binance, 'Binance') : null;
        const bybitStr = bybit ? this._createBalanceStr(bybit, 'Bybit') : null;
        const gateStr = gate ? this._createBalanceStr(gate, 'Gate') : null;

        if (binanceStr) await ctx.reply(binanceStr);

        if (bybitStr) await ctx.reply(bybitStr);

        if (gateStr) await ctx.reply(gateStr);
    }

    async _checkDailyBalance(ctx) {
        const balances = ctx?.session?.balances || {};
        let total = 0;
        let transactions = [];

        Object.entries(balances).forEach(([exchange, data]) => {
            if (data?.total && data?.transactions?.length > 0) {
                total += data.total;
                transactions = transactions.concat(data.transactions);
            }
        });

        if (total === 0 || transactions.length === 0) return ctx.reply(this.translate('nothingOnBalanceSheet'));

        await ctx.reply(this._createBalanceStr({ total, transactions }));
    }

    _initDailyBalances(ctx) {
        const newBalances = this.exchanges.reduce((obj, platform) => {
            obj[platform] = {
                total: 0,
                transactions: [],
            };
            return obj;
        }, {});

        ctx.session.balances = newBalances;
    }

    _setDailyBalances(ctx, value) {
        if (!ctx?.session?.balances) this._initDailyBalances(ctx);

        ctx.session.balances[this.currentExchange].total += value;

        const time = DateTime.now().setZone('Asia/Ho_Chi_Minh').toLocaleString(DateTime.DATETIME_FULL).replace(' GMT+7', '');

        ctx.session.balances[this.currentExchange].transactions.push({
            amount: value,
            time,
        });
    }

    _toNormalNumber(input, precision = 5) {
        const num = Number(input);
        if (isNaN(num)) return null;
        if (num < 0.0001) return 0;

        return parseFloat(num.toFixed(precision));
    }

    _sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    _printMenu(ctx) {
        const actions = [this.translate('checkDailyBalance'), this.translate('clearDailyBalance')];
        const buttonsExchange = this.exchanges.map((name) => Markup.button.callback(`${this._capitalizeFirstLetter(name)} ✅`, `SELECT_${name}`));

        const buttonsActions = actions.map((name, i) => Markup.button.callback(`${name} ✅`, `SELECT_${this.buttonsMarker[i]}`));

        const buttonClearSession = [Markup.button.callback(`${this.translate('clearSession')} ❌`, `SELECT_${this.buttonsMarker[2]}`)];

        const buttonSelectLanguage = [Markup.button.callback(`${this.translate('selectLanguage')} ✅`, `SELECT_${this.buttonsMarker[3]}`)];

        ctx.reply(this.translate('chooseAction'), Markup.inlineKeyboard([buttonsExchange, buttonsActions, buttonSelectLanguage, buttonClearSession]));
    }

    _handleAction(value, ctx) {
        if (value == this.buttonsMarker[3]) {
            return ctx.reply(
                'Please select your language:',
                Markup.inlineKeyboard([[Markup.button.callback('English', 'SET_LANG_en')], [Markup.button.callback('Tiếng Việt', 'SET_LANG_vi')]])
            );
        }

        if (value == this.buttonsMarker[2]) {
            ctx.reply(this.translate('clearSessionSuccess'));
            return this._clearSession();
        }

        if (value === this.buttonsMarker[1]) return ctx.reply(this.translate('clearDailyBalancePrompt'));
        if (value === this.buttonsMarker[0]) return this._checkDailyBalance(ctx);
        if (this.sessionFreezed) return ctx.reply(this.translate('sessionStillRunning'));

        this.currentExchange = value;

        ctx.reply(this.translate('amountRequest', { exchange: this._capitalizeFirstLetter(value) }));
    }

    _setVndValue(ctx, value) {
        const vndValue = this._toNormalNumber(value);
        if (!vndValue) return ctx.reply(this.translate('invalidAmount'));

        this.price = vndValue;
        ctx.reply(this.translate('priceChanged'), { price: vndValue });
    }

    _setup() {
        this.bot.command('start', async (ctx) => {
            const languageCode = ctx?.session?.lang || 'en';
            this.translate = i18next.getFixedT(languageCode);
            await ctx.reply(this.translate('welcome', { botName: ctx.botInfo.first_name || 'Bot' }));
            this._printMenu(ctx);
        });

        this.bot.command('menu', async (ctx) => this._printMenu(ctx));
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
            if (!value) return ctx.reply(t('invalidAction'));

            this._handleAction(value, ctx);
        });

        this.bot.action(/SET_LANG_(.+)/, async (ctx) => {
            const langCode = ctx.match[1];
            ctx.session.lang = langCode;
            this.translate = i18next.getFixedT(langCode);
            this._printMenu(ctx);
        });

        this.bot.on('text', (ctx) => {
            const userInput = this._toNormalNumber(ctx?.message?.text);

            if (this.sessionFreezed) return ctx.reply(this.translate('sessionInProgress', { time: Math.floor(MAX_CHECKING_DURATION / 60000) }));

            if (!this.currentExchange) return ctx.reply(this.translate('selectExchange'));

            if (userInput) return this._startSession(ctx, userInput);

            ctx.reply(this.translate('invalidAmount'));
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

    _roundUpSecondDecimal(num) {
        if (typeof num !== 'number' || isNaN(num) || !Number.isFinite(num)) return null;

        return Math.ceil(num * 100) / 100;
    }

    _capitalizeFirstLetter(string) {
        if (!string) return '';

        return string.charAt(0).toUpperCase() + string.slice(1);
    }

    launch() {
        this.bot.launch();

        process.once('SIGINT', () => this.bot.stop('SIGINT'));
        process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
    }
}

const exchanges = ['binance', 'bybit', 'gate'];
const botHandler = new BotHandler(process.env.TG_TOKEN, exchanges);
botHandler.launch();

// https://emojipedia.org/en/search?q=crypto
