import { calculateOrderSize, CopyStrategy, CopyStrategyConfig } from '../config/copyStrategy';

const runTests = () => {
    console.log('🧪 Testing PERCENTAGE_OF_BANKROLL Strategy...\n');

    const config: CopyStrategyConfig = {
        strategy: CopyStrategy.PERCENTAGE_OF_BANKROLL,
        copySize: 5.0, // 5%
        maxOrderSizeUSD: 100.0,
        minOrderSizeUSD: 1.0,
    };

    const scenarios = [
        {
            name: 'Standard Case',
            balance: 100.0,
            traderSize: 50.0, // Irrelevant for this strategy
            expectedAmount: 5.0, // 5% of 100
        },
        {
            name: 'Low Balance',
            balance: 10.0,
            traderSize: 50.0,
            expectedAmount: 0.5, // 5% of 10 = 0.5 (Check min order size later)
        },
        {
            name: 'High Balance',
            balance: 1000.0,
            traderSize: 50.0,
            expectedAmount: 50.0, // 5% of 1000
        },
    ];

    let passed = 0;
    let failed = 0;

    for (const scenario of scenarios) {
        const result = calculateOrderSize(
            config,
            scenario.traderSize,
            scenario.balance
        );

        // For the Low Balance case, we expect it to be filtered out by minOrderSizeUSD (1.0)
        // But calculateOrderSize logic calculates baseAmount first, then applies limits.
        // Let's check baseAmount for correctness of calculation.

        const isMatch = Math.abs(result.baseAmount - scenario.expectedAmount) < 0.001;

        if (isMatch) {
            console.log(`✅ ${scenario.name}: Balance $${scenario.balance} -> Order $${result.baseAmount.toFixed(2)} [Expected $${scenario.expectedAmount.toFixed(2)}]`);
            passed++;
        } else {
            console.log(`❌ ${scenario.name}: Balance $${scenario.balance} -> Order $${result.baseAmount.toFixed(2)} [Expected $${scenario.expectedAmount.toFixed(2)}]`);
            failed++;
        }

        console.log(`   Detailed Reasoning: ${result.reasoning}`);

        if (result.belowMinimum) {
             console.log(`   (Correctly identified as below minimum)`);
        }
        console.log('');
    }

    console.log(`\nResults: ${passed} Passed, ${failed} Failed`);
};

runTests();
