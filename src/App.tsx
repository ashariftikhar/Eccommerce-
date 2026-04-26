import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Cpu,
  DollarSign,
  Gauge,
  PlayCircle,
  Rocket,
  ShieldAlert,
  Siren,
  Truck,
} from 'lucide-react';
import { DashboardPayload, ListingDraft, ProductCandidate } from './types';

type BusyAction =
  | 'discovery'
  | 'tick'
  | 'approval-mode'
  | 'resume'
  | 'kill-switch'
  | `approve:${string}`
  | `reject:${string}`
  | `publish:${string}`
  | null;

const cardStyle = 'rounded-[2rem] border border-slate-200 bg-white/90 shadow-[0_20px_60px_rgba(15,23,42,0.06)]';

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function statusTone(value: string): string {
  switch (value) {
    case 'PAUSED':
    case 'blocked':
    case 'BLOCKED':
    case 'critical':
      return 'bg-rose-100 text-rose-700';
    case 'AUTO_PUBLISH':
    case 'READY_TO_LIST':
    case 'connected':
    case 'completed':
      return 'bg-emerald-100 text-emerald-700';
    case 'APPROVAL_REQUIRED':
    case 'TEST_ONLY':
    case 'warning':
    case 'sandbox':
      return 'bg-amber-100 text-amber-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function scoreTone(candidate: ProductCandidate): string {
  const total = candidate.scoreBreakdown?.totalScore ?? 0;
  if (total >= 85) {
    return 'text-emerald-600';
  }
  if (total >= 70) {
    return 'text-amber-600';
  }
  return 'text-rose-600';
}

export default function App() {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);

  async function refreshDashboard() {
    const response = await fetch('/api/dashboard');
    const payload = (await response.json()) as DashboardPayload;
    setDashboard(payload);
  }

  async function runAction(action: BusyAction, url: string, options?: RequestInit) {
    setBusyAction(action);
    try {
      await fetch(url, { method: 'POST', ...options });
      await refreshDashboard();
    } finally {
      setBusyAction(null);
    }
  }

  useEffect(() => {
    refreshDashboard().catch((error) => console.error(error));
    const timer = setInterval(() => {
      refreshDashboard().catch((error) => console.error(error));
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  if (!dashboard) {
    return (
      <div className="min-h-screen bg-[#eef4ff] text-slate-900 flex items-center justify-center">
        <div className="flex items-center gap-4 rounded-[2rem] border border-slate-200 bg-white px-8 py-6 shadow-xl">
          <Cpu className="h-8 w-8 animate-pulse text-blue-600" />
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">YuziGoods</p>
            <h1 className="text-xl font-black text-slate-900">Loading Ops Console</h1>
          </div>
        </div>
      </div>
    );
  }

  const pendingDrafts = dashboard.listingDrafts.filter((draft) => draft.status === 'DRAFT_READY');
  const openAlerts = dashboard.alerts.filter((alert) => alert.status === 'open');

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#dbeafe_0%,_#eef4ff_38%,_#f8fafc_100%)] text-slate-900">
      <div className="mx-auto flex max-w-[1540px] flex-col gap-8 px-6 py-8 lg:px-10">
        <header className={`${cardStyle} overflow-hidden bg-slate-950 text-white`}>
          <div className="grid gap-6 px-8 py-8 lg:grid-cols-[1.7fr_1fr] lg:px-10">
            <div className="space-y-4">
              <p className="text-xs font-black uppercase tracking-[0.35em] text-blue-300">YuziGoods / US eBay Ops</p>
              <div className="space-y-2">
                <h1 className="text-4xl font-black tracking-tight lg:text-5xl">Smart Buys, Fast Shipping.</h1>
                <p className="max-w-2xl text-sm font-medium text-slate-300 lg:text-base">
                  Production control room for sandbox-first discovery, approval-first publishing, low-risk order push, and emergency rollback.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => runAction('discovery', '/api/discovery/run')}
                  disabled={busyAction !== null}
                  className="rounded-2xl bg-blue-600 px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Run Discovery
                </button>
                <button
                  onClick={() => runAction('tick', '/api/worker/tick')}
                  disabled={busyAction !== null}
                  className="rounded-2xl border border-white/20 bg-white/10 px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Process Queue
                </button>
                <button
                  onClick={() => runAction('approval-mode', '/api/system/mode/approval')}
                  disabled={busyAction !== null}
                  className="rounded-2xl border border-white/20 bg-transparent px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Enter Approval Mode
                </button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[1.5rem] border border-white/10 bg-white/10 p-5 backdrop-blur">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-300">Automation Mode</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.18em] ${statusTone(dashboard.settings.automationMode)}`}>
                    {dashboard.settings.automationMode.replace('_', ' ')}
                  </span>
                  <Gauge className="h-5 w-5 text-blue-300" />
                </div>
              </div>
              <div className="rounded-[1.5rem] border border-white/10 bg-white/10 p-5 backdrop-blur">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-300">Sandbox Window</p>
                <div className="mt-3 text-lg font-black">{new Date(dashboard.settings.sandboxEndsAt).toLocaleDateString()}</div>
                <p className="mt-1 text-xs text-slate-300">No production listings until sandbox criteria pass.</p>
              </div>
              <div className="rounded-[1.5rem] border border-white/10 bg-white/10 p-5 backdrop-blur">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-300">AI Budget</p>
                <div className="mt-3 text-lg font-black">
                  {money(dashboard.budgets.dayToDateUsd)} / {money(dashboard.budgets.dailyCapUsd)}
                </div>
                <p className="mt-1 text-xs text-slate-300">Monthly: {money(dashboard.budgets.monthToDateUsd)} / {money(dashboard.budgets.monthlyCapUsd)}</p>
              </div>
              <div className="rounded-[1.5rem] border border-white/10 bg-white/10 p-5 backdrop-blur">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-300">Kill Switch</p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => runAction('kill-switch', '/api/system/kill-switch')}
                    disabled={busyAction !== null}
                    className="flex-1 rounded-xl bg-rose-600 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Pause & Rollback
                  </button>
                  <button
                    onClick={() => runAction('resume', '/api/system/resume')}
                    disabled={busyAction !== null}
                    className="flex-1 rounded-xl border border-white/20 bg-transparent px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Resume
                  </button>
                </div>
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {[
            { icon: Rocket, label: 'Total Candidates', value: dashboard.stats.totalCandidates, hint: `${dashboard.stats.readyToList} ready to list` },
            { icon: CheckCircle2, label: 'Pending Approvals', value: dashboard.stats.pendingApprovals, hint: `${dashboard.stats.publishedListings} published` },
            { icon: BellRing, label: 'Open Alerts', value: dashboard.stats.openAlerts, hint: `${dashboard.stats.deadLetters} dead letters` },
            { icon: Truck, label: 'Auto-Push Eligible', value: dashboard.stats.autoPushEligibleOrders, hint: 'Low-risk orders only' },
          ].map((stat) => (
            <article key={stat.label} className={`${cardStyle} p-6`}>
              <div className="flex items-center justify-between">
                <div className="rounded-2xl bg-blue-50 p-3 text-blue-600">
                  <stat.icon className="h-6 w-6" />
                </div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{stat.label}</p>
              </div>
              <div className="mt-5 flex items-end justify-between gap-3">
                <h2 className="text-4xl font-black tracking-tight text-slate-950">{stat.value}</h2>
                <p className="text-right text-xs font-semibold text-slate-500">{stat.hint}</p>
              </div>
            </article>
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
          <article className={`${cardStyle} overflow-hidden`}>
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Discovery Queue</p>
                <h2 className="mt-1 text-2xl font-black tracking-tight">Scored CJ Candidates</h2>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-slate-600">
                Daily target: 80 scored
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                  <tr>
                    <th className="px-6 py-4">Product</th>
                    <th className="px-4 py-4">Score</th>
                    <th className="px-4 py-4">Decision</th>
                    <th className="px-4 py-4">Economics</th>
                    <th className="px-4 py-4">Signals</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.candidates.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-10 text-sm font-medium text-slate-500">
                        No candidates yet. Run discovery to pull US-warehouse CJ products, apply policy checks, and score against eBay demand.
                      </td>
                    </tr>
                  )}
                  {dashboard.candidates.map((candidate) => (
                    <tr key={candidate.id} className="border-t border-slate-100 align-top">
                      <td className="px-6 py-5">
                        <div className="flex gap-4">
                          <img src={candidate.imageUrl} alt={candidate.title} className="h-16 w-16 rounded-2xl object-cover" />
                          <div className="space-y-1">
                            <h3 className="text-sm font-bold text-slate-900">{candidate.title}</h3>
                            <p className="text-xs text-slate-500">{candidate.categoryPath}</p>
                            <div className="flex flex-wrap gap-2">
                              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-blue-700">{candidate.sellerSku}</span>
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-600">{candidate.warehouseCountry} warehouse</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className={`px-4 py-5 text-2xl font-black ${scoreTone(candidate)}`}>
                        {candidate.scoreBreakdown?.totalScore ?? '--'}
                      </td>
                      <td className="px-4 py-5">
                        <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${statusTone(candidate.status)}`}>
                          {candidate.status.replace(/_/g, ' ')}
                        </span>
                        {candidate.policyMatches.length > 0 && (
                          <p className="mt-3 text-xs text-rose-600">{candidate.policyMatches[0]}</p>
                        )}
                      </td>
                      <td className="px-4 py-5 text-sm">
                        <p className="font-semibold text-slate-800">Landed: {money(candidate.landedCost)}</p>
                        <p className="text-slate-500">Target: {money(candidate.targetPrice)}</p>
                        <p className="text-slate-500">ETA: {candidate.estimatedDeliveryBusinessDays} business days</p>
                      </td>
                      <td className="px-4 py-5 text-xs text-slate-600">
                        <p>Demand: {candidate.scoreBreakdown?.demandScore ?? '--'}</p>
                        <p>Competition: {candidate.scoreBreakdown?.competitionScore ?? '--'}</p>
                        <p>Margin: {candidate.scoreBreakdown?.netMarginPercent ?? '--'}%</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <div className="space-y-6">
            <article className={`${cardStyle} p-6`}>
              <div className="flex items-center gap-3">
                <Siren className="h-6 w-6 text-rose-600" />
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Connections</p>
                  <h2 className="text-xl font-black">Provider Health</h2>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {dashboard.connections.map((connection) => (
                  <div key={connection.name} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                    <div>
                      <p className="text-sm font-bold text-slate-900">{connection.name}</p>
                      <p className="text-xs text-slate-500">{connection.notes || 'Configured through runtime env vars'}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${statusTone(connection.status)}`}>
                      {connection.status}
                    </span>
                  </div>
                ))}
              </div>
            </article>

            <article className={`${cardStyle} p-6`}>
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-6 w-6 text-amber-500" />
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Mandatory Alerts</p>
                  <h2 className="text-xl font-black">What Needs Attention</h2>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {openAlerts.length === 0 && <p className="text-sm text-slate-500">No open alerts right now.</p>}
                {openAlerts.map((alert) => (
                  <div key={alert.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-bold text-slate-900">{alert.message}</p>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${statusTone(alert.severity)}`}>
                        {alert.severity}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">{alert.context}</p>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <article className={`${cardStyle} overflow-hidden`}>
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Approval Window</p>
                <h2 className="mt-1 text-2xl font-black tracking-tight">Listing Drafts</h2>
              </div>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-blue-700">
                {pendingDrafts.length} waiting
              </span>
            </div>
            <div className="space-y-4 p-6">
              {dashboard.listingDrafts.length === 0 && (
                <p className="text-sm text-slate-500">No drafts yet. Discovery creates drafts after policy checks and eBay scoring pass.</p>
              )}
              {dashboard.listingDrafts.map((draft) => (
                <DraftCard
                  key={draft.id}
                  draft={draft}
                  candidate={dashboard.candidates.find((candidate) => candidate.id === draft.candidateId)}
                  onApprove={() => runAction(`approve:${draft.id}`, `/api/drafts/${draft.id}/approve`)}
                  onReject={() => runAction(`reject:${draft.id}`, `/api/drafts/${draft.id}/reject`)}
                  onPublish={() => runAction(`publish:${draft.id}`, `/api/drafts/${draft.id}/publish`)}
                  busyAction={busyAction}
                />
              ))}
            </div>
          </article>

          <article className={`${cardStyle} overflow-hidden`}>
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Manual Review</p>
                <h2 className="mt-1 text-2xl font-black tracking-tight">Dead Letters & Audit Trail</h2>
              </div>
              <ShieldAlert className="h-6 w-6 text-slate-400" />
            </div>
            <div className="grid gap-5 p-6">
              <div>
                <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-500">Dead Letters</h3>
                <div className="mt-3 space-y-3">
                  {dashboard.deadLetters.length === 0 && <p className="text-sm text-slate-500">Nothing in manual review.</p>}
                  {dashboard.deadLetters.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-rose-100 bg-rose-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-bold text-rose-900">{item.resourceType}</p>
                        <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-rose-700">{item.provider}</span>
                      </div>
                      <p className="mt-2 text-xs text-rose-700">{item.errorClass}</p>
                      <p className="mt-1 text-xs text-rose-600">Resource: {item.resourceId}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-500">Recent Audit Logs</h3>
                <div className="mt-3 space-y-3">
                  {dashboard.auditLogs.map((log) => (
                    <div key={log.id} className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-sm font-bold text-slate-900">{log.summary}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {log.action} / {new Date(log.createdAt).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </article>
        </section>
      </div>
    </div>
  );
}

function DraftCard(props: {
  key?: string;
  draft: ListingDraft;
  candidate: ProductCandidate | undefined;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
  onPublish: () => Promise<void>;
  busyAction: BusyAction;
}) {
  const { draft, candidate, onApprove, onReject, onPublish, busyAction } = props;
  const isBusy = busyAction === `approve:${draft.id}` || busyAction === `reject:${draft.id}` || busyAction === `publish:${draft.id}`;

  return (
    <div className="rounded-[2rem] border border-slate-200 bg-slate-50/70 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${statusTone(draft.status)}`}>{draft.status.replace(/_/g, ' ')}</span>
            <span className="rounded-full bg-slate-200 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-slate-700">{draft.marketplace}</span>
            {candidate && (
              <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${statusTone(candidate.status)}`}>{candidate.status.replace(/_/g, ' ')}</span>
            )}
          </div>
          <div>
            <h3 className="text-lg font-black tracking-tight text-slate-950">{draft.title}</h3>
            <p className="text-sm text-slate-500">{candidate?.categoryPath || 'Awaiting candidate link'} / {draft.sellerSku}</p>
          </div>
          <div className="grid gap-2 text-sm text-slate-600 md:grid-cols-2">
            <p>Price: <span className="font-bold text-slate-900">{money(draft.price)}</span></p>
            <p>Qty: <span className="font-bold text-slate-900">{draft.quantity}</span></p>
            <p>Demand: <span className="font-bold text-slate-900">{candidate?.scoreBreakdown?.demandScore ?? '--'}</span></p>
            <p>Margin: <span className="font-bold text-slate-900">{candidate?.scoreBreakdown?.netMarginPercent ?? '--'}%</span></p>
          </div>
          {draft.warningMessages.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-700">Warnings</p>
              <ul className="mt-2 space-y-1 text-sm text-amber-800">
                {draft.warningMessages.slice(0, 3).map((warning) => (
                  <li key={warning}>- {warning}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="flex min-w-[240px] flex-col gap-2">
          <button
            onClick={() => void onApprove()}
            disabled={isBusy}
            className="rounded-2xl bg-emerald-600 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Approve
          </button>
          <button
            onClick={() => void onPublish()}
            disabled={isBusy}
            className="rounded-2xl bg-blue-600 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Queue Publish
          </button>
          <button
            onClick={() => void onReject()}
            disabled={isBusy}
            className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}
