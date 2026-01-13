import createClobClient from '../utils/createClobClient';
import { ENV } from '../config/env';

async function checkOpenOrders() {
    try {
        console.log('🔍 Checking for Open Orders...');
        const clobClient = await createClobClient();
        const openOrders = await clobClient.getOpenOrders();

        console.log(`📋 Found ${openOrders.length} Open Orders`);
        if (openOrders.length > 0) {
            console.log(JSON.stringify(openOrders, null, 2));
            console.log('\n⚠️  These orders are locking your funds!');
        } else {
            console.log('✅ No open orders found.');
        }
    } catch (error) {
        console.error('❌ Error fetching open orders:', error);
    }
}

checkOpenOrders();
