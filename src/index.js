import { TgBot } from './bot.js';

const exchanges = ['binance', 'bybit', 'gate'];
const botHandler = new TgBot(process.env.TG_TOKEN, exchanges);
botHandler.launch();
