import { TgBot } from './services/bot.service.js';

const exchanges = ['binance', 'bybit', 'gate'];
const botHandler = new TgBot(process.env.TG_TOKEN, exchanges);
botHandler.launch();
