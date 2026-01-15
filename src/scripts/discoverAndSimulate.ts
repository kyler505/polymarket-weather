/**
 * Discover and Simulate - Combined Trader Discovery + Simulation
 *
 * This script:
 * 1. Fetches top traders from Polymarket leaderboard
 * 2. Runs quick simulations to filter profitable traders
 * 3. Runs detailed simulations on top performers with multiple multipliers
 * 4. Outputs optimal trader + multiplier recommendations for your .env
 *
 * Usage: npm run discover
 */

import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const colors = {
    cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
    green: (text: string) => `\x1b[32m${text}\x1b[0m`,
    red: (text: string) => `\x1b[31m${text}\x1b[0m`,
    yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
    gray: (text: string) => `\x1b[90m${text}\x1b[0m`,
};

interface TraderResult {
    address: string;
    roi: number;
    totalPnl: number;
    copiedTrades: number;
    multiplier: number;
}

interface Recommendation {
    address: string;
    multiplier: number;
    roi: number;
    reason: string;
}

async function prompt(question: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

async function runCommand(command: string, description: string): Promise<boolean> {
    console.log(colors.cyan(`\n🔄 ${description}...\n`));

    return new Promise((resolve) => {
        const child = spawn('npm', ['run', ...command.split(' ')], {
            stdio: 'inherit',
            shell: true,
            cwd: process.cwd(),
        });

        child.on('close', (code) => {
            resolve(code === 0);
        });

        child.on('error', (err) => {
            console.error(colors.red(`Error: ${err.message}`));
            resolve(false);
        });
    });
}

function loadLatestAnalysis(): TraderResult[] | null {
    const analysisDir = path.join(process.cwd(), 'trader_analysis_results');

    if (!fs.existsSync(analysisDir)) {
        return null;
    }

    const files = fs.readdirSync(analysisDir)
        .filter(f => f.startsWith('analysis_') && f.endsWith('.json'))
        .sort()
        .reverse();

    if (files.length === 0) {
        return null;
    }

    const latestFile = path.join(analysisDir, files[0]);
    console.log(colors.gray(`Loading analysis from: ${files[0]}`));

    const data = JSON.parse(fs.readFileSync(latestFile, 'utf8'));

    return data.results
        .filter((r: any) => r.roi > 0 && !r.error)
        .map((r: any) => ({
            address: r.address,
            roi: r.roi,
            totalPnl: r.totalPnl,
            copiedTrades: r.copiedTrades,
            multiplier: 1,
        }))
        .sort((a: TraderResult, b: TraderResult) => b.roi - a.roi);
}

function loadLatestBatchSummary(): TraderResult[] | null {
    const resultsDir = path.join(process.cwd(), 'simulation_results');

    if (!fs.existsSync(resultsDir)) {
        return null;
    }

    const files = fs.readdirSync(resultsDir)
        .filter(f => f.startsWith('batch_summary_') && f.endsWith('.json'))
        .sort()
        .reverse();

    if (files.length === 0) {
        return null;
    }

    const latestFile = path.join(resultsDir, files[0]);
    console.log(colors.gray(`Loading batch summary from: ${files[0]}`));

    const data = JSON.parse(fs.readFileSync(latestFile, 'utf8'));

    return data.results.map((r: any) => ({
        address: r.trader,
        roi: r.roi,
        totalPnl: r.totalPnl,
        copiedTrades: r.copiedTrades,
        multiplier: r.multiplier,
    }));
}

function generateRecommendations(results: TraderResult[]): Recommendation[] {
    // Group by trader address
    const traderMap = new Map<string, TraderResult[]>();

    for (const r of results) {
        const existing = traderMap.get(r.address) || [];
        existing.push(r);
        traderMap.set(r.address, existing);
    }

    const recommendations: Recommendation[] = [];

    for (const [address, traderResults] of traderMap) {
        // Sort by ROI and find best multiplier
        traderResults.sort((a, b) => b.roi - a.roi);
        const best = traderResults[0];

        if (best.roi > 0) {
            // Check if higher multipliers are worse (suggesting not to over-leverage)
            const maxMultResult = traderResults.find(r => r.multiplier === 3);
            const minMultResult = traderResults.find(r => r.multiplier === 0.5);

            let reason = '';
            if (maxMultResult && minMultResult) {
                if (maxMultResult.roi < best.roi * 0.9) {
                    reason = `Best at ${best.multiplier}x (drops at higher multipliers)`;
                } else if (maxMultResult.roi > minMultResult.roi) {
                    reason = `Scales well - can use higher multipliers`;
                } else {
                    reason = `Stable across multipliers`;
                }
            } else {
                reason = `ROI: +${best.roi.toFixed(1)}%`;
            }

            recommendations.push({
                address,
                multiplier: best.multiplier,
                roi: best.roi,
                reason,
            });
        }
    }

    // Sort by ROI
    recommendations.sort((a, b) => b.roi - a.roi);

    return recommendations.slice(0, 5); // Top 5
}

function generateEnvConfig(recommendations: Recommendation[]): string {
    const addresses = recommendations.map(r => r.address).join(',');
    const multipliers = recommendations.map(r => r.multiplier).join(',');

    let config = `# ================================================================\n`;
    config += `# TRADERS TO COPY (Auto-generated by discover command)\n`;
    config += `# ================================================================\n`;

    for (let i = 0; i < recommendations.length; i++) {
        const r = recommendations[i];
        config += `# ${i + 1}. ${r.address.slice(0, 10)}... (+${r.roi.toFixed(1)}% ROI @ ${r.multiplier}x)\n`;
    }

    config += `USER_ADDRESSES="${addresses}"\n\n`;
    config += `# Per-trader multipliers (matches order above)\n`;
    config += `TRADER_MULTIPLIERS="${multipliers}"\n`;

    return config;
}

async function main() {
    console.log(colors.bold(colors.cyan('\n════════════════════════════════════════════════════════════════')));
    console.log(colors.bold(colors.cyan('  🔍 DISCOVER & SIMULATE - Automated Trader Optimization')));
    console.log(colors.bold(colors.cyan('════════════════════════════════════════════════════════════════\n')));

    console.log('This script will:');
    console.log('  1. Find profitable traders from the leaderboard');
    console.log('  2. Simulate the top performers at multiple multipliers');
    console.log('  3. Generate an optimized .env configuration\n');

    const mode = await prompt('Choose mode:\n  1. Full discovery + simulation (takes ~5 min)\n  2. Use existing find-traders results, run simulations\n  3. Just analyze existing results\n\nEnter choice (1/2/3): ');

    if (mode === '1') {
        // Step 1: Run find-traders
        console.log(colors.bold('\n📊 STEP 1: Discovering Traders\n'));
        const findSuccess = await runCommand('find-traders', 'Finding and analyzing traders');

        if (!findSuccess) {
            console.log(colors.red('❌ find-traders failed'));
            return;
        }

        // Step 2: Load results and set up simulation
        const analysisResults = loadLatestAnalysis();

        if (!analysisResults || analysisResults.length === 0) {
            console.log(colors.red('❌ No profitable traders found'));
            return;
        }

        console.log(colors.green(`\n✓ Found ${analysisResults.length} profitable traders\n`));

        // Take top 3 for detailed simulation
        const topTraders = analysisResults.slice(0, 3);
        const addresses = topTraders.map(t => t.address).join(',');

        console.log(colors.bold('📊 STEP 2: Detailed Simulation of Top 3\n'));
        console.log('Running simulations at 0.5x, 1x, 2x, 3x multipliers...\n');

        // Update .env temporarily for simulation
        const envPath = path.join(process.cwd(), '.env');
        const envBackup = fs.readFileSync(envPath, 'utf8');

        // Replace USER_ADDRESSES in .env
        let newEnv = envBackup.replace(
            /USER_ADDRESSES=.*/,
            `USER_ADDRESSES="${addresses}"`
        );
        fs.writeFileSync(envPath, newEnv);

        try {
            // Use 'env standard' mode for non-interactive simulation
            await runCommand('sim env standard', 'Running batch simulations');
        } finally {
            // Restore .env
            fs.writeFileSync(envPath, envBackup);
        }
    } else if (mode === '2') {
        // Use existing analysis, run sim
        const analysisResults = loadLatestAnalysis();

        if (!analysisResults || analysisResults.length === 0) {
            console.log(colors.yellow('⚠️ No existing analysis found. Running find-traders first...\n'));
            await runCommand('find-traders', 'Finding and analyzing traders');
        }

        const results = loadLatestAnalysis();
        if (!results || results.length === 0) {
            console.log(colors.red('❌ No profitable traders found'));
            return;
        }

        const topTraders = results.slice(0, 3);
        const addresses = topTraders.map(t => t.address).join(',');

        console.log(colors.green(`\n✓ Top ${topTraders.length} traders from analysis:`));
        topTraders.forEach((t, i) => {
            console.log(`   ${i + 1}. ${t.address.slice(0, 10)}... ROI: +${t.roi.toFixed(1)}%`);
        });

        const envPath = path.join(process.cwd(), '.env');
        const envBackup = fs.readFileSync(envPath, 'utf8');

        let newEnv = envBackup.replace(
            /USER_ADDRESSES=.*/,
            `USER_ADDRESSES="${addresses}"`
        );
        fs.writeFileSync(envPath, newEnv);

        try {
            // Use 'env standard' mode for non-interactive simulation
            await runCommand('sim env standard', 'Running batch simulations');
        } finally {
            fs.writeFileSync(envPath, envBackup);
        }
    }

    // Step 3: Analyze and recommend
    console.log(colors.bold('\n📊 STEP 3: Generating Recommendations\n'));

    const batchResults = loadLatestBatchSummary();

    if (!batchResults || batchResults.length === 0) {
        console.log(colors.yellow('⚠️ No batch results found. Run simulation first.'));
        return;
    }

    const recommendations = generateRecommendations(batchResults);

    if (recommendations.length === 0) {
        console.log(colors.red('❌ No profitable traders found in simulations'));
        return;
    }

    console.log(colors.bold(colors.green('🏆 RECOMMENDED CONFIGURATION:\n')));

    recommendations.forEach((r, i) => {
        console.log(`  ${i + 1}. ${colors.cyan(r.address.slice(0, 10) + '...')}`);
        console.log(`     Multiplier: ${colors.yellow(r.multiplier + 'x')}`);
        console.log(`     ROI: ${colors.green('+' + r.roi.toFixed(1) + '%')}`);
        console.log(`     ${colors.gray(r.reason)}\n`);
    });

    const envConfig = generateEnvConfig(recommendations);

    console.log(colors.bold('\n📝 RECOMMENDED .env CONFIG:\n'));
    console.log(colors.gray('─'.repeat(60)));
    console.log(envConfig);
    console.log(colors.gray('─'.repeat(60)));

    const apply = await prompt('\nApply this configuration to .env? (y/n): ');

    if (apply.toLowerCase() === 'y') {
        const envPath = path.join(process.cwd(), '.env');
        let envContent = fs.readFileSync(envPath, 'utf8');

        // Replace USER_ADDRESSES and TRADER_MULTIPLIERS
        const addresses = recommendations.map(r => r.address).join(',');
        const multipliers = recommendations.map(r => r.multiplier).join(',');

        envContent = envContent.replace(
            /USER_ADDRESSES=.*/,
            `USER_ADDRESSES="${addresses}"`
        );

        if (envContent.includes('TRADER_MULTIPLIERS=')) {
            envContent = envContent.replace(
                /TRADER_MULTIPLIERS=.*/,
                `TRADER_MULTIPLIERS="${multipliers}"`
            );
        } else {
            envContent = envContent.replace(
                /USER_ADDRESSES=.*/,
                `USER_ADDRESSES="${addresses}"\nTRADER_MULTIPLIERS="${multipliers}"`
            );
        }

        fs.writeFileSync(envPath, envContent);
        console.log(colors.green('\n✅ Configuration applied to .env!'));
    } else {
        console.log(colors.gray('\n⏩ Skipped. Copy the config above manually if needed.'));
    }

    console.log(colors.bold(colors.cyan('\n════════════════════════════════════════════════════════════════')));
    console.log(colors.bold(colors.cyan('  ✅ DISCOVERY COMPLETE')));
    console.log(colors.bold(colors.cyan('════════════════════════════════════════════════════════════════\n')));
}

main().catch(console.error);
