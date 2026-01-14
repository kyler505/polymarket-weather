
import { getUserActivityModel } from '../models/userHistory';
import { ENV } from '../config/env';
import connectDB, { closeDB } from '../config/db';

const main = async () => {
    await connectDB();
    const walletAddress = ENV.PROXY_WALLET;
    const ActivityModel = getUserActivityModel(walletAddress);

    const activities = await ActivityModel.find({
        type: { $in: ['TRADE', 'REDEEM'] }
    }).sort({ timestamp: 1 }).lean();

    console.log(`Found ${activities.length} activities.`);

    let currentInv = {
        size: 0,
        avgPrice: 0
    };
    let cumulativePnL = 0;

    for (const trade of activities) {
        // @ts-ignore
        const price = trade.price || 0;
        // @ts-ignore
        const size = trade.size || 0;

        console.log(`Processing: ${trade.type} ${trade.side} | Size: ${size} | Price: ${price}`);

        if (trade.side === 'BUY') {
            const totalValue = (currentInv.avgPrice * currentInv.size) + (price * size);
            const totalSize = currentInv.size + size;
            currentInv.avgPrice = totalValue / totalSize;
            currentInv.size = totalSize;
            console.log(`   --> BUY Processed. New Inv: Size ${currentInv.size.toFixed(2)}, AvgPrice ${currentInv.avgPrice.toFixed(4)}`);
        } else if (trade.side === 'SELL' || trade.type === 'REDEEM') {
            const executionPrice = trade.type === 'REDEEM' ? 1.0 : price;
            console.log(`   --> REDEEM/SELL. Exec Price: ${executionPrice}`);

            const sizeToSell = Math.min(size, currentInv.size > 0 ? currentInv.size : size);
            const realizedPnL = (executionPrice - currentInv.avgPrice) * sizeToSell;

            cumulativePnL += realizedPnL;
            console.log(`   --> PnL: (${executionPrice} - ${currentInv.avgPrice.toFixed(4)}) * ${sizeToSell.toFixed(2)} = ${realizedPnL.toFixed(2)}`);
            console.log(`   --> Cum PnL: ${cumulativePnL.toFixed(2)}`);

            currentInv.size -= size;
            if (currentInv.size <= 0) {
                currentInv.size = 0;
                currentInv.avgPrice = 0;
            }
        }
    }

    await closeDB();
};

main();
