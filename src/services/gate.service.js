import GateApi from 'gate-api';
import 'dotenv/config';

const API_KEY = process.env.GATE_API_KEY;
const SECRET_KEY = process.env.GATE_API_SECRET;

export class GateService {
    constructor() {
        this.apiKey = API_KEY;
        this.secretKey = SECRET_KEY;

        const client = new GateApi.ApiClient();
        client.setApiKeySecret(this.apiKey, this.secretKey);

        this.walletApi = new GateApi.WalletApi(client);
    }

    async getTransactions(startTime = null) {
        try {
            const params = {
                from: startTime ? Math.floor(startTime / 1000) : undefined,
                to: Math.floor(Date.now() / 1000),
                currency: 'USDT',
                transactionType: 'deposit',
            };

            const response = await this.walletApi.listPushOrders(params);
            return response.body || [];
        } catch (error) {
            console.error('Error fetching incoming transactions:', error.response?.data?.message || error.message);
            throw error;
        }
    }
}
