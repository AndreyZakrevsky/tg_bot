import axios from 'axios';
import 'dotenv/config';
import crypto from 'crypto';

const API_KEY = process.env.BINANCE_API_KEY;
const SECRET_KEY = process.env.BINANCE_API_SECRET;
const BINANCE_BASE_URL = process.env.BINANCE_BASE_URL;
const TRANSACTIONS_ENDPOINT = '/sapi/v1/pay/transactions';

export class BinanceService {
    constructor() {
        this.apiKey = API_KEY;
        this.secretKey = SECRET_KEY;
        this.baseUrl = BINANCE_BASE_URL;
    }

    createSignature(params) {
        const query = new URLSearchParams(params).toString();
        return crypto.createHmac('sha256', this.secretKey).update(query).digest('hex');
    }

    async getTransactions(startTime = null, endTime = null, limit = 100) {
        const timestamp = Date.now();
        const headers = { 'X-MBX-APIKEY': this.apiKey };
        const params = { timestamp, limit };

        if (startTime) params.startTime = startTime;
        if (endTime) params.endTime = endTime;

        params.signature = this.createSignature(params);

        try {
            const {
                data: { data: transactions },
            } = await axios.get(this.baseUrl + TRANSACTIONS_ENDPOINT, {
                params,
                headers,
            });
            return transactions;
        } catch (error) {
            console.log('Can not get Binance transactions: ', error.message);
            return null;
        }
    }
}
