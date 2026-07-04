import { Command } from 'commander';
import { printHeader, printError, fmt } from '../output.js';

/**
 * Plan ladder mirrors `lib/pricing/rate-card.ts` (RATE_CARD_VERSION v2,
 * effective 2026-06-21). Keep in sync with the router's rate card any time
 * prices, inclusions, or overage rates change.
 */
const RATE_CARD_VERSION = 'v2';
const RATE_CARD_EFFECTIVE_DATE = '2026-06-21';

interface PlanRow {
    id: 'sandbox' | 'build' | 'growth' | 'scale' | 'enterprise';
    name: string;
    price: string;
    includedEvents: string;
    overagePer1k: string;
    retentionDays: string;
    audience: string;
    salesMotion: 'self-serve' | 'sales-assisted' | 'sales-led';
}

const PLANS: PlanRow[] = [
    {
        id: 'sandbox',
        name: 'Sandbox',
        price: 'Free',
        includedEvents: '25,000 / mo',
        overagePer1k: 'hard cap',
        retentionDays: '14',
        audience: 'Developers evaluating P402',
        salesMotion: 'self-serve',
    },
    {
        id: 'build',
        name: 'Build',
        price: '$49 / mo',
        includedEvents: '250,000 / mo',
        overagePer1k: '$0.25',
        retentionDays: '30',
        audience: 'Small teams shipping production AI workflows',
        salesMotion: 'sales-assisted',
    },
    {
        id: 'growth',
        name: 'Growth',
        price: '$199 / mo',
        includedEvents: '1,000,000 / mo',
        overagePer1k: '$0.15',
        retentionDays: '90',
        audience: 'Production workloads across teams',
        salesMotion: 'sales-assisted',
    },
    {
        id: 'scale',
        name: 'Scale',
        price: '$799 / mo (annual only)',
        includedEvents: '5,000,000 / mo',
        overagePer1k: '$0.08',
        retentionDays: '180',
        audience: 'Regulated / high-volume operations',
        salesMotion: 'sales-led',
    },
    {
        id: 'enterprise',
        name: 'Enterprise',
        price: 'Custom',
        includedEvents: 'custom commit',
        overagePer1k: 'trued up at renewal',
        retentionDays: 'custom',
        audience: 'Bespoke SLA, SSO, SCIM, on-prem, BAA',
        salesMotion: 'sales-led',
    },
];

const BRIDGE_OFFERS = [
    { id: 'ai_spend_audit',  name: 'AI Spend Audit',  price: '$1,500 one-time',   description: 'Zero-deployment KQL audit against your existing telemetry.' },
    { id: 'proof_sprint',    name: 'Proof Sprint',    price: '$5,000 / 2 weeks',  description: 'Fixed-scope non-inferiority trial on one workflow.' },
    { id: 'paid_pilot',      name: 'Paid Pilot',      price: '$15,000 / 30 days', description: 'Structured evaluation with success criteria.' },
    { id: 'regulated_pilot', name: 'Regulated Pilot', price: '$50,000 / 90 days', description: 'Route Optimization Pilot on 1–3 workflows.' },
];

function printLadder(): void {
    printHeader('P402 Plan Ladder');
    console.log(
        fmt.dim(
            `  Rate card: ${RATE_CARD_VERSION}    Effective: ${RATE_CARD_EFFECTIVE_DATE}\n`
        )
    );
    for (const p of PLANS) {
        console.log(`  ${fmt.primary(p.name.padEnd(11))} ${p.price}`);
        console.log(`  ${''.padEnd(11)} ${fmt.dim('events:')}    ${p.includedEvents}`);
        console.log(`  ${''.padEnd(11)} ${fmt.dim('overage:')}   ${p.overagePer1k} per 1k events`);
        console.log(`  ${''.padEnd(11)} ${fmt.dim('retention:')} ${p.retentionDays} days`);
        console.log(`  ${''.padEnd(11)} ${fmt.dim('for:')}       ${p.audience}`);
        console.log(`  ${''.padEnd(11)} ${fmt.dim('motion:')}    ${p.salesMotion}`);
        console.log();
    }
    console.log(fmt.primary('  Bridge offers'));
    for (const o of BRIDGE_OFFERS) {
        console.log(`  ${fmt.primary(o.name.padEnd(18))} ${o.price}`);
        console.log(`  ${''.padEnd(18)} ${fmt.dim(o.description)}`);
    }
    console.log();
    console.log(fmt.dim('  See https://p402.io/pricing for the full rate card.'));
    console.log();
}

function printLadderJson(): void {
    const payload = {
        rate_card_version: RATE_CARD_VERSION,
        effective_date: RATE_CARD_EFFECTIVE_DATE,
        plans: PLANS,
        bridge_offers: BRIDGE_OFFERS,
    };
    console.log(JSON.stringify(payload, null, 2));
}

export function planCommand(): Command {
    const cmd = new Command('plan');
    cmd
        .description('Show the P402 plan ladder (Sandbox / Build / Growth / Scale / Enterprise).')
        .option('--json', 'Output the rate card as JSON')
        .option('--current', 'Show the current tenant plan (requires dashboard until API ships)')
        .action((opts: { json?: boolean; current?: boolean }) => {
            if (opts.current) {
                // TODO: wire to /api/v2/billing/plan once the router exposes a
                // Bearer-authed endpoint that returns { plan_id, included, used,
                // overage_rate, ... }. Until then, point the user to the
                // dashboard so we do not lie about what the CLI can see.
                printError(
                    'Current plan lookup is not yet available in the CLI.',
                    'Visit https://p402.io/dashboard/settings to view your tenant\'s plan and usage. See `p402 plan` (without --current) for the tier ladder.',
                );
                return;
            }
            if (opts.json) {
                printLadderJson();
                return;
            }
            printLadder();
        });

    return cmd;
}
