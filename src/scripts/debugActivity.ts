
import fetchData from '../utils/fetchData';
import { ENV } from '../config/env';

const main = async () => {
    const address = ENV.PROXY_WALLET;
    console.log(`Checking activity for ${address}...`);
    // Fetch last 10 activities to see the redemption
    const url = `https://data-api.polymarket.com/activity?user=${address}&limit=10`;
    const data = await fetchData(url);
    console.log(JSON.stringify(data, null, 2));
};

main();
