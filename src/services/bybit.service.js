import { RestClientV5 } from 'bybit-api';
import 'dotenv/config';

const API_KEY = process.env.BYBIT_API_KEY;
const SECRET_KEY = process.env.BYBIT_API_SECRET;
const IS_TESTNET = process.env.BYBIT_TESTNET === 'true';

const client = new RestClientV5({
    key: API_KEY,
    secret: SECRET_KEY,
    testnet: IS_TESTNET,
});

async function getInternalDepositRecords({ startTime, endTime, limit = 50, coin = null, cursor = null }) {
    try {
        const params = {
            // startTime: startTime ? Math.floor(startTime / 1000) : undefined,
            // endTime: endTime ? Math.floor(endTime / 1000) : undefined,
            limit,
            coin,
            cursor: cursor || undefined,
        };

        const response = await client.getInternalDepositRecords(params);

        if (response.retCode === 0) {
            return {
                deposits: response.result.rows || [],
                nextCursor: response.result.nextPageCursor,
            };
        } else {
            throw new Error(`Bybit API Error: ${response.retMsg}`);
        }
    } catch (error) {
        console.error('Error fetching internal deposit records:', error.message);
        throw error;
    }
}

(async () => {
    const startTime = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const endTime = Date.now();

    try {
        const { deposits, nextCursor } = await getInternalDepositRecords({
            startTime,
            endTime,
            limit: 50,
            coin: 'USDT',
        });

        console.log('Internal Deposits:', deposits);

        if (nextCursor) {
            console.log('Next Cursor:', nextCursor);
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
})();
