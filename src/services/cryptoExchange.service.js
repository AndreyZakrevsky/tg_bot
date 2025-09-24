import { BinanceService } from './binance.service.js';
import { GateService } from './gate.service.js';

const DEFAULT_CHECK_TIME = 5 * 60 * 1000;

export class CryptoExchangeManager {
    constructor() {
        this.binance = new BinanceService();
        this.gate = new GateService();
    }

    async getDeposits(exchange, startTime) {
        if (!this?.[exchange]) return null;

        const time = Date.now() - (startTime || DEFAULT_CHECK_TIME);

        try {
            const deposits = await this[exchange].getTransactions(time);
            return deposits;
        } catch (error) {
            console.log(error.message);
            return null;
        }
    }
}
