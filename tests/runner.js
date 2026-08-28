import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';
import { runDockerConfigTests } from './docker_config.test.js';
import { runPipelineTests } from './unit_pipeline.test.js';
import { runApiServerTests } from './api_server.test.js';

// ANSI styling colors
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m'
};

/**
 * 4-Tier Automated Test Runner & Reporter
 */
class TestReporter {
    constructor() {
        this.results = [];
        this.currentSuite = '';
        this.tierStats = {
            'Tier 1': { total: 0, passed: 0, failed: 0 },
            'Tier 2': { total: 0, passed: 0, failed: 0 },
            'Tier 3': { total: 0, passed: 0, failed: 0 },
            'Tier 4': { total: 0, passed: 0, failed: 0 },
            'General': { total: 0, passed: 0, failed: 0 }
        };
    }

    identifyTier(name) {
        if (name.includes('Tier 1')) return 'Tier 1';
        if (name.includes('Tier 2')) return 'Tier 2';
        if (name.includes('Tier 3')) return 'Tier 3';
        if (name.includes('Tier 4')) return 'Tier 4';
        return 'General';
    }

    async test(suite, name, fn) {
        if (this.currentSuite !== suite) {
            this.currentSuite = suite;
            console.log(`\n${colors.cyan}${colors.bright}▶ Suite: ${suite}${colors.reset}`);
        }

        const tier = this.identifyTier(name);
        this.tierStats[tier].total++;

        const start = performance.now();
        try {
            await fn();
            const duration = (performance.now() - start).toFixed(1);
            this.tierStats[tier].passed++;
            this.results.push({ suite, name, tier, passed: true, duration });
            console.log(`  ${colors.green}✔ PASS${colors.reset} ${name} ${colors.dim}(${duration}ms)${colors.reset}`);
        } catch (err) {
            const duration = (performance.now() - start).toFixed(1);
            this.tierStats[tier].failed++;
            this.results.push({ suite, name, tier, passed: false, duration, error: err });
            console.log(`  ${colors.red}✖ FAIL${colors.reset} ${name} ${colors.dim}(${duration}ms)${colors.reset}`);
            console.log(`    ${colors.red}${err.message}${colors.reset}`);
            if (err.stack) {
                const stackLines = err.stack.split('\n').slice(1, 4).join('\n');
                console.log(`    ${colors.dim}${stackLines}${colors.reset}`);
            }
        }
    }

    summary(totalDurationMs) {
        const total = this.results.length;
        const passed = this.results.filter(r => r.passed).length;
        const failed = this.results.filter(r => !r.passed).length;

        console.log(`\n${colors.bright}====================================================${colors.reset}`);
        console.log(`${colors.bright}         HIGGSFIELD TEST EXECUTION SUMMARY          ${colors.reset}`);
        console.log(`${colors.bright}====================================================${colors.reset}`);

        console.log(`\n${colors.bright}4-Tier Breakdown:${colors.reset}`);
        for (const [tier, stats] of Object.entries(this.tierStats)) {
            if (stats.total > 0) {
                const statusColor = stats.failed === 0 ? colors.green : colors.red;
                console.log(`  • ${colors.bright}${tier}${colors.reset}: ${statusColor}${stats.passed}/${stats.total} Passed${colors.reset} (${stats.failed} Failed)`);
            }
        }

        console.log(`\n${colors.bright}Overall Metrics:${colors.reset}`);
        console.log(`  • Total Tests:    ${colors.bright}${total}${colors.reset}`);
        console.log(`  • Passed:         ${colors.green}${colors.bright}${passed}${colors.reset}`);
        console.log(`  • Failed:         ${failed > 0 ? colors.red : colors.green}${colors.bright}${failed}${colors.reset}`);
        console.log(`  • Execution Time: ${(totalDurationMs / 1000).toFixed(2)}s`);

        if (failed === 0) {
            console.log(`\n${colors.bgGreen}${colors.white}${colors.bright}  ALL TESTS PASSED SUCCESSFULLY (100%)  ${colors.reset}\n`);
            return 0;
        } else {
            console.log(`\n${colors.bgRed}${colors.white}${colors.bright}  ${failed} TEST(S) FAILED  ${colors.reset}\n`);
            return 1;
        }
    }
}

/**
 * Main Runner Function
 */
export async function runAllTests() {
    console.log(`${colors.magenta}${colors.bright}`);
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║   Higgsfield Video Queue - Automated Test Suite  ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log(`${colors.reset}`);

    const reporter = new TestReporter();
    const startTime = performance.now();

    try {
        // Run Test Suites
        await runDockerConfigTests(reporter);
        await runPipelineTests(reporter);
        await runApiServerTests(reporter);

        const totalDuration = performance.now() - startTime;
        const exitCode = reporter.summary(totalDuration);
        return exitCode;
    } catch (err) {
        console.error(`${colors.red}Fatal test runner error:${colors.reset}`, err);
        return 1;
    }
}

// Auto-run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runAllTests().then((exitCode) => {
        process.exit(exitCode);
    });
}
