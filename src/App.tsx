import { type ReactNode, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BellRing,
  Bot,
  Boxes,
  Brain,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Cpu,
  Gauge,
  Globe2,
  Layers3,
  MessageCircleMore,
  MessageSquareCode,
  PackageCheck,
  Rocket,
  ShieldAlert,
  Siren,
  Store,
  Truck,
  UserRoundCog,
  Warehouse,
} from 'lucide-react';
import {
  ArchitecturePayload,
  AgentsPayload,
  CeoChatPayload,
  CustomerChatsPayload,
  DraftStatus,
  InventoryPayload,
  OrdersPayload,
  OverviewPayload,
  ProductCandidate,
  StorePayload,
  SupplierChatsPayload,
  ValidationPayload,
} from './types';

type TabId = 'overview' | 'architecture' | 'validation' | 'agents' | 'store' | 'inventory' | 'orders' | 'suppliers' | 'customers' | 'ceo';
type BusyAction =
  | 'discovery'
  | 'tick'
  | 'approval-mode'
  | 'resume'
  | 'kill-switch'
  | `approve:${string}`
  | `reject:${string}`
  | `publish:${string}`
  | `supplier:${string}`
  | `validation-rerun:${string}`
  | `validation-refine:${string}`
  | 'ceo-send'
  | null;

interface ConsoleData {
  overview: OverviewPayload;
  architecture: ArchitecturePayload;
  validation: ValidationPayload;
  agents: AgentsPayload;
  store: StorePayload;
  inventory: InventoryPayload;
  orders: OrdersPayload;
  suppliers: SupplierChatsPayload;
  customers: CustomerChatsPayload;
  ceo: CeoChatPayload;
}

const tabs: Array<{ id: TabId; label: string; icon: ReactNode }> = [
  { id: 'overview', label: 'Overview', icon: <Gauge className="h-4 w-4" /> },
  { id: 'architecture', label: 'Architecture', icon: <Layers3 className="h-4 w-4" /> },
  { id: 'validation', label: 'Validation', icon: <ShieldAlert className="h-4 w-4" /> },
  { id: 'agents', label: 'Agents', icon: <Bot className="h-4 w-4" /> },
  { id: 'store', label: 'Store', icon: <Store className="h-4 w-4" /> },
  { id: 'inventory', label: 'Inventory', icon: <Boxes className="h-4 w-4" /> },
  { id: 'orders', label: 'Orders', icon: <Truck className="h-4 w-4" /> },
  { id: 'suppliers', label: 'Supplier Chats', icon: <Warehouse className="h-4 w-4" /> },
  { id: 'customers', label: 'Customer Chats', icon: <MessageCircleMore className="h-4 w-4" /> },
  { id: 'ceo', label: 'CEO Chat', icon: <Brain className="h-4 w-4" /> },
];

const card = 'rounded-[2rem] border border-slate-200 bg-white/90 shadow-[0_20px_60px_rgba(15,23,42,0.06)]';

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function tone(value: string): string {
  switch (value) {
    case 'PAUSED':
    case 'blocked':
    case 'BLOCKED':
    case 'critical':
    case 'high':
    case 'risk':
    case 'failed':
      return 'bg-rose-100 text-rose-700';
    case 'AUTO_PUBLISH':
    case 'READY_TO_LIST':
    case 'connected':
    case 'completed':
    case 'healthy':
    case 'online':
    case 'resolved':
      return 'bg-emerald-100 text-emerald-700';
    case 'APPROVAL_REQUIRED':
    case 'TEST_ONLY':
    case 'warning':
    case 'sandbox':
    case 'watch':
    case 'awaiting_reply':
    case 'medium':
    case 'running':
      return 'bg-amber-100 text-amber-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function scoreTone(candidate: ProductCandidate): string {
  const total = candidate.scoreBreakdown?.totalScore ?? 0;
  if (total >= 85) return 'text-emerald-600';
  if (total >= 70) return 'text-amber-600';
  return 'text-rose-600';
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  return (await response.json()) as T;
}

export default function App() {
  const [data, setData] = useState<ConsoleData | null>(null);
  const [tab, setTab] = useState<TabId>('overview');
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [ceoPrompt, setCeoPrompt] = useState('');
  const [selectedValidationExecutionId, setSelectedValidationExecutionId] = useState<string | null>(null);

  async function refreshAll() {
    const [overview, architecture, validation, agents, store, inventory, orders, suppliers, customers, ceo] = await Promise.all([
      fetchJson<OverviewPayload>('/api/overview'),
      fetchJson<ArchitecturePayload>('/api/architecture'),
      fetchJson<ValidationPayload>('/api/validation'),
      fetchJson<AgentsPayload>('/api/agents'),
      fetchJson<StorePayload>('/api/store'),
      fetchJson<InventoryPayload>('/api/inventory'),
      fetchJson<OrdersPayload>('/api/orders'),
      fetchJson<SupplierChatsPayload>('/api/suppliers/chats'),
      fetchJson<CustomerChatsPayload>('/api/customer-chats'),
      fetchJson<CeoChatPayload>('/api/ceo-chat'),
    ]);
    setData({ overview, architecture, validation, agents, store, inventory, orders, suppliers, customers, ceo });
    if (!selectedAgentId && agents.fleet[0]) {
      setSelectedAgentId(agents.fleet[0].id);
    }
    if (!selectedSupplierId && suppliers.chats[0]) {
      setSelectedSupplierId(suppliers.chats[0].id);
    }
    if (!selectedValidationExecutionId && validation.runs[0]) {
      setSelectedValidationExecutionId(validation.runs[0].executionId);
    }
  }

  async function runAction(action: BusyAction, url: string, options?: RequestInit) {
    setBusyAction(action);
    try {
      await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, ...options });
      await refreshAll();
    } finally {
      setBusyAction(null);
    }
  }

  useEffect(() => {
    refreshAll().catch((error) => console.error(error));
    const timer = setInterval(() => {
      refreshAll().catch((error) => console.error(error));
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  if (!data) {
    return (
      <div className="min-h-screen bg-[#eef4ff] text-slate-900 flex items-center justify-center">
        <div className="flex items-center gap-4 rounded-[2rem] border border-slate-200 bg-white px-8 py-6 shadow-xl">
          <Cpu className="h-8 w-8 animate-pulse text-blue-600" />
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">YuziGoods</p>
            <h1 className="text-xl font-black text-slate-900">Loading Ops Console v3</h1>
          </div>
        </div>
      </div>
    );
  }

  const selectedAgent = data.agents.fleet.find((agent) => agent.id === selectedAgentId) || data.agents.fleet[0];
  const selectedSupplier = data.suppliers.chats.find((chat) => chat.id === selectedSupplierId) || data.suppliers.chats[0];
  const selectedExecutions = selectedAgent ? data.agents.executions.filter((execution) => execution.agentId === selectedAgent.id) : [];
  const openAlerts = data.overview.alerts.filter((alert) => alert.status === 'open');
  const candidates = data.inventory.candidates;
  const draftCount = data.inventory.drafts.length;
  const publishedCount = data.inventory.published.length;
  const selectedValidationRuns = selectedValidationExecutionId
    ? data.validation.runs.filter((run) => run.executionId === selectedValidationExecutionId)
    : [];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#dbeafe_0%,_#eef4ff_38%,_#f8fafc_100%)] text-slate-900">
      <div className="mx-auto max-w-[1580px] px-6 py-8 lg:px-10">
        <header className={`${card} overflow-hidden bg-slate-950 text-white`}>
          <div className="grid gap-6 px-8 py-8 lg:grid-cols-[1.65fr_1fr] lg:px-10">
            <div className="space-y-4">
              <p className="text-xs font-black uppercase tracking-[0.35em] text-blue-300">YuziGoods / Ops Console v3</p>
              <div className="space-y-2">
                <h1 className="text-4xl font-black tracking-tight lg:text-5xl">Watch every agent work.</h1>
                <p className="max-w-2xl text-sm font-medium text-slate-300 lg:text-base">
                  Multi-tab operator cockpit for CJ discovery, scoring, listing generation, supplier coordination, readiness, and future eBay backfill.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <ActionButton onClick={() => runAction('discovery', '/api/discovery/run')} busy={busyAction !== null} primary>
                  Run Discovery
                </ActionButton>
                <ActionButton onClick={() => runAction('tick', '/api/worker/tick')} busy={busyAction !== null}>
                  Process Queue
                </ActionButton>
                <ActionButton onClick={() => runAction('approval-mode', '/api/system/mode/approval')} busy={busyAction !== null}>
                  Enter Approval Mode
                </ActionButton>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <HeroStat label="Automation Mode" value={data.overview.settings.automationMode.replace(/_/g, ' ')} badgeTone={tone(data.overview.settings.automationMode)} />
              <HeroCard label="Sandbox Window" value={new Date(data.overview.settings.sandboxEndsAt).toLocaleDateString()} note="Stay sandbox-first for one full week." />
              <HeroCard
                label="AI Budget"
                value={`${money(data.overview.budgets.dayToDateUsd)} / ${money(data.overview.budgets.dailyCapUsd)}`}
                note={`Monthly ${money(data.overview.budgets.monthToDateUsd)} / ${money(data.overview.budgets.monthlyCapUsd)}`}
              />
              <div className="rounded-[1.5rem] border border-white/10 bg-white/10 p-5 backdrop-blur">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-300">Emergency Control</p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => runAction('kill-switch', '/api/system/kill-switch')}
                    disabled={busyAction !== null}
                    className="flex-1 rounded-xl bg-rose-600 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Kill Switch
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

        <section className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {[
            { icon: Rocket, label: 'Candidates', value: data.overview.stats.totalCandidates, hint: `${data.overview.stats.readyToList} ready to list` },
            { icon: PackageCheck, label: 'Drafts', value: draftCount, hint: `${publishedCount} published` },
            { icon: BellRing, label: 'Open Alerts', value: data.overview.stats.openAlerts, hint: `${data.overview.stats.deadLetters} dead letters` },
            { icon: Truck, label: 'Orders Eligible', value: data.overview.stats.autoPushEligibleOrders, hint: 'Low-risk only' },
          ].map((stat) => (
            <article key={stat.label} className={`${card} p-6`}>
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

        <section className="mt-6">
          <div className={`${card} p-3`}>
            <div className="flex flex-wrap gap-2">
              {tabs.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => setTab(entry.id)}
                  className={`flex items-center gap-2 rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-[0.18em] transition ${
                    tab === entry.id ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {entry.icon}
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-6">
          {tab === 'overview' && (
            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <article className={`${card} p-6`}>
                <SectionHeader eyebrow="Condensed Health" title="System Status at a Glance" icon={<Activity className="h-5 w-5 text-slate-400" />} />
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  {data.overview.storeOverview.map((store) => (
                    <div key={store.id} className="rounded-[1.75rem] border border-slate-200 bg-slate-50/80 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{store.platform}</p>
                          <h3 className="mt-1 text-lg font-black tracking-tight text-slate-950">{store.name}</h3>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${tone(store.status)}`}>{store.status}</span>
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                        <MiniStat label="Listings" value={store.totalListings} />
                        <MiniStat label="Pending" value={store.pendingApprovals} />
                        <MiniStat label="Health" value={store.accountHealth} />
                      </div>
                      <p className="mt-4 text-sm text-slate-600">{store.note}</p>
                    </div>
                  ))}
                </div>
              </article>

              <article className={`${card} p-6`}>
                <SectionHeader eyebrow="Urgency" title="Alerts and Connection Readiness" icon={<AlertTriangle className="h-5 w-5 text-slate-400" />} />
                <div className="mt-5 space-y-4">
                  {data.overview.connections.map((connection) => (
                    <div key={connection.name} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-slate-900">{connection.name}</p>
                          <p className="text-xs text-slate-500">{connection.notes}</p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${tone(connection.status)}`}>{connection.status}</span>
                      </div>
                    </div>
                  ))}
                  {openAlerts.length === 0 && <p className="text-sm text-slate-500">No open alerts right now.</p>}
                  {openAlerts.map((alert) => (
                    <div key={alert.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-bold text-slate-900">{alert.message}</p>
                        <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${tone(alert.severity)}`}>{alert.severity}</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-500">{alert.context}</p>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          )}

          {tab === 'architecture' && (
            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <article className={`${card} p-6`}>
                <SectionHeader eyebrow="System Map" title="Hybrid-Gated Multi-Agent Flow" icon={<Layers3 className="h-5 w-5 text-slate-400" />} />
                <div className="mt-5 rounded-[1.75rem] border border-slate-200 bg-slate-50/80 p-5">
                  <pre className="overflow-x-auto whitespace-pre-wrap text-sm leading-6 text-slate-700">{data.architecture.flowchart}</pre>
                </div>
                <div className="mt-5 rounded-[1.75rem] border border-slate-200 bg-white p-5">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Routing Rules</p>
                  <div className="mt-3 space-y-2">
                    {data.architecture.routingRules.map((rule) => (
                      <p key={rule} className="text-sm text-slate-700">- {rule}</p>
                    ))}
                  </div>
                </div>
              </article>

              <article className={`${card} p-6`}>
                <SectionHeader eyebrow="Contracts" title="Agent Roles, Inputs, Outputs, Guards" icon={<Bot className="h-5 w-5 text-slate-400" />} />
                <div className="mt-5 space-y-4">
                  {data.architecture.contracts.map((contract) => (
                    <div key={contract.agentId} className="rounded-[1.75rem] border border-slate-200 bg-slate-50/80 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{contract.agentId.replace(/_/g, ' ')}</p>
                          <h3 className="mt-1 text-lg font-black tracking-tight text-slate-950">{contract.role}</h3>
                        </div>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-slate-700">
                          {contract.handoffTargets.join(' -> ')}
                        </span>
                      </div>
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <ArchitectureList title="Inputs" items={contract.inputs} />
                        <ArchitectureList title="Outputs" items={contract.outputs} />
                        <ArchitectureList title="Hard Validators" items={contract.hardValidators} />
                        <ArchitectureList title="Soft Validators" items={contract.softValidators} />
                      </div>
                      <div className="mt-4 grid gap-3">
                        <ArchitectureNote label="Fallback" text={contract.fallbackBehavior} />
                        <ArchitectureNote label="Refinement" text={contract.refinementBehavior} />
                        <ArchitectureNote label="Blocking Failure" text={contract.blockingFailureBehavior} />
                        <ArchitectureNote label="Optimization" text={contract.optimizationNotes.join(' | ')} />
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              <article className={`${card} p-6 xl:col-span-2`}>
                <SectionHeader eyebrow="Failure Matrix" title="How the System Handles Real-World Breaks" icon={<AlertTriangle className="h-5 w-5 text-slate-400" />} />
                <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {data.architecture.failureMatrix.map((item) => (
                    <div key={item.id} className="rounded-[1.75rem] border border-slate-200 bg-slate-50/80 p-5">
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{item.stage}</p>
                      <h3 className="mt-1 text-sm font-black uppercase tracking-[0.16em] text-slate-900">{item.failure}</h3>
                      <p className="mt-3 text-sm text-slate-600">{item.handling}</p>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          )}

          {tab === 'validation' && (
            <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
              <article className={`${card} p-6`}>
                <SectionHeader eyebrow="Validation Queue" title="Passed, Warnings, and Blocks" icon={<ShieldAlert className="h-5 w-5 text-slate-400" />} />
                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  <MiniStat label="Passed" value={data.validation.stats.passed} />
                  <MiniStat label="Warnings" value={data.validation.stats.warnings} />
                  <MiniStat label="Failed" value={data.validation.stats.failed} />
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <MiniStat label="Fallback Runs" value={data.validation.stats.fallbackRuns} />
                  <MiniStat label="Simulated Runs" value={data.validation.stats.simulatedRuns} />
                </div>
                <div className="mt-5 space-y-3">
                  {data.validation.runs.map((run) => (
                    <button
                      key={run.id}
                      onClick={() => setSelectedValidationExecutionId(run.executionId)}
                      className={`w-full rounded-[1.75rem] border p-4 text-left transition ${
                        selectedValidationExecutionId === run.executionId ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-slate-50/80 text-slate-900 hover:bg-slate-100'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className={`text-xs font-black uppercase tracking-[0.18em] ${selectedValidationExecutionId === run.executionId ? 'text-blue-200' : 'text-slate-400'}`}>
                            {run.agentId.replace(/_/g, ' ')}
                          </p>
                          <h3 className="mt-1 text-sm font-black uppercase tracking-[0.16em]">{run.resourceType} / {run.resourceId}</h3>
                          <p className={`mt-2 text-sm ${selectedValidationExecutionId === run.executionId ? 'text-slate-300' : 'text-slate-500'}`}>
                            score {run.score} / refinement {run.refinementCount}
                          </p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${selectedValidationExecutionId === run.executionId ? 'bg-white/10 text-white' : tone(run.status)}`}>
                          {run.status}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </article>

              <article className={`${card} p-6`}>
                <SectionHeader eyebrow="Validation Detail" title="Validator Results and Refinement Controls" icon={<CheckCircle2 className="h-5 w-5 text-slate-400" />} />
                {selectedValidationRuns.length === 0 ? (
                  <div className="mt-5"><EmptyState title="No validation selected" body="Pick a validation run from the left to inspect pass/fail reasons and refinement options." /></div>
                ) : (
                  <div className="mt-5 space-y-4">
                    {selectedValidationRuns.map((run) => (
                      <div key={run.id} className="rounded-[1.75rem] border border-slate-200 bg-slate-50/80 p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{run.agentId.replace(/_/g, ' ')}</p>
                            <h3 className="mt-1 text-lg font-black tracking-tight text-slate-950">{run.resourceType} / {run.resourceId}</h3>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${tone(run.status)}`}>{run.status}</span>
                            {run.blocking && <span className="rounded-full bg-rose-100 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-rose-700">blocking</span>}
                            {run.simulatedData && <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-amber-700">simulated</span>}
                            {run.fallbackUsed && <span className="rounded-full bg-blue-100 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-blue-700">fallback</span>}
                          </div>
                        </div>
                        <div className="mt-4 space-y-3">
                          {run.validatorResults.map((result) => (
                            <div key={result.validatorId} className="rounded-2xl bg-white p-4">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-bold text-slate-900">{result.name}</span>
                                <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${tone(result.severity)}`}>{result.severity}</span>
                                <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${tone(result.status)}`}>{result.status}</span>
                              </div>
                              <p className="mt-2 text-sm text-slate-600"><span className="font-bold text-slate-900">Expected:</span> {result.expected}</p>
                              <p className="mt-1 text-sm text-slate-600"><span className="font-bold text-slate-900">Observed:</span> {result.observed}</p>
                            </div>
                          ))}
                        </div>
                        <div className="mt-4 flex gap-3">
                          <button
                            onClick={() => runAction(`validation-rerun:${run.executionId}`, `/api/validation/${run.executionId}/rerun`)}
                            disabled={busyAction !== null}
                            className="rounded-2xl bg-slate-950 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Rerun Validation
                          </button>
                          <button
                            onClick={() => runAction(`validation-refine:${run.executionId}`, `/api/validation/${run.executionId}/refine`)}
                            disabled={busyAction !== null}
                            className="rounded-2xl bg-blue-600 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Refine Output
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            </div>
          )}

          {tab === 'agents' && (
            <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
              <article className={`${card} p-6`}>
                <SectionHeader eyebrow="Fleet" title="Every Agent and Current Task" icon={<UserRoundCog className="h-5 w-5 text-slate-400" />} />
                <div className="mt-5 space-y-3">
                  {data.agents.fleet.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => setSelectedAgentId(agent.id)}
                      className={`w-full rounded-[1.75rem] border p-4 text-left transition ${
                        selectedAgent?.id === agent.id ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-slate-50/80 text-slate-900 hover:bg-slate-100'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className={`text-xs font-black uppercase tracking-[0.18em] ${selectedAgent?.id === agent.id ? 'text-blue-200' : 'text-slate-400'}`}>{agent.stage}</p>
                          <h3 className="mt-1 text-lg font-black tracking-tight">{agent.name}</h3>
                          <p className={`mt-1 text-sm ${selectedAgent?.id === agent.id ? 'text-slate-300' : 'text-slate-500'}`}>{agent.role}</p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${selectedAgent?.id === agent.id ? 'bg-white/10 text-white' : tone(agent.status)}`}>
                          {agent.status}
                        </span>
                      </div>
                      <p className={`mt-3 text-sm ${selectedAgent?.id === agent.id ? 'text-slate-200' : 'text-slate-600'}`}>{agent.currentTask}</p>
                      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                        <MiniStat label="Queue" value={agent.queueDepth} inverted={selectedAgent?.id === agent.id} />
                        <MiniStat label="Success" value={`${agent.successRate}%`} inverted={selectedAgent?.id === agent.id} />
                        <MiniStat
                          label="Heartbeat"
                          value={new Date(agent.lastHeartbeatAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          inverted={selectedAgent?.id === agent.id}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              </article>

              <article className={`${card} p-6`}>
                <SectionHeader eyebrow="Trace" title={selectedAgent ? `${selectedAgent.name} Execution Trace` : 'Execution Trace'} icon={<MessageSquareCode className="h-5 w-5 text-slate-400" />} />
                <div className="mt-5 space-y-4">
                  {selectedExecutions.length === 0 && <EmptyState title="No executions yet" body="Run discovery or one of the queue actions to generate step-by-step traces." />}
                  {selectedExecutions.map((execution) => (
                    <div key={execution.id} className="rounded-[1.75rem] border border-slate-200 bg-slate-50/80 p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{execution.triggerSource}</p>
                          <h3 className="mt-1 text-lg font-black tracking-tight text-slate-950">{execution.summary || 'Execution trace'}</h3>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${tone(execution.status)}`}>{execution.status}</span>
                      </div>
                      <div className="mt-4 space-y-3">
                        {execution.steps.map((step) => (
                          <div key={step.id} className="rounded-2xl bg-white p-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-black text-slate-900">{step.stepName}</span>
                              <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${tone(step.provider)}`}>{step.provider}</span>
                              {step.modelName && (
                                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-700">{step.modelName}</span>
                              )}
                            </div>
                            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{step.requestPurpose}</p>
                            <p className="mt-2 text-sm text-slate-600"><span className="font-bold text-slate-900">Input:</span> {step.inputSummary}</p>
                            <p className="mt-1 text-sm text-slate-600"><span className="font-bold text-slate-900">Output:</span> {step.outputSummary}</p>
                            {step.error && <p className="mt-1 text-sm text-rose-600">{step.error}</p>}
                            <p className="mt-2 text-xs text-slate-500">{Math.round(step.durationMs)}ms / {new Date(step.createdAt).toLocaleString()}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          )}

          {tab === 'store' && (
            <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
              <article className={`${card} p-6`}>
                <SectionHeader eyebrow="Readiness" title="Store and Platform Health" icon={<Globe2 className="h-5 w-5 text-slate-400" />} />
                <div className="mt-5 space-y-4">
                  {data.store.storeOverview.map((store) => (
                    <div key={store.id} className="rounded-[1.75rem] border border-slate-200 bg-slate-50/80 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{store.platform}</p>
                          <h3 className="mt-1 text-lg font-black tracking-tight text-slate-950">{store.name}</h3>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${tone(store.status)}`}>{store.status}</span>
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                        <MiniStat label="Listings" value={store.totalListings} />
                        <MiniStat label="Orders Today" value={store.ordersToday} />
                        <MiniStat label="Health" value={store.accountHealth} />
                      </div>
                      <p className="mt-4 text-sm text-slate-600">{store.note}</p>
                    </div>
                  ))}
                </div>
              </article>

              <article className={`${card} p-6`}>
                <SectionHeader eyebrow="Checklist" title="What Still Needs To Be Connected" icon={<CheckCircle2 className="h-5 w-5 text-slate-400" />} />
                <div className="mt-5 space-y-4">
                  {data.store.readinessChecklist.map((item) => (
                    <div key={item.id} className="rounded-[1.75rem] border border-slate-200 bg-white p-5">
                      <div className="flex items-start gap-3">
                        <div className={`mt-1 rounded-full p-2 ${item.done ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {item.done ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                        </div>
                        <div>
                          <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-900">{item.label}</h3>
                          <p className="mt-2 text-sm text-slate-600">{item.note}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          )}

          {tab === 'inventory' && (
            <div className="space-y-6">
              <article className={`${card} p-6`}>
                <SectionHeader eyebrow="Inventory Flow" title="Candidates, Drafts, Published, Blocked, Legacy" icon={<Layers3 className="h-5 w-5 text-slate-400" />} />
                <div className="mt-5 grid gap-6 xl:grid-cols-2">
                  <InventoryPanel title="Candidates" items={candidates.length}>
                    {candidates.slice(0, 8).map((candidate) => (
                      <InventoryCard key={candidate.id} candidate={candidate} />
                    ))}
                  </InventoryPanel>
                  <InventoryPanel title="Drafts" items={data.inventory.drafts.length}>
                    {data.inventory.drafts.length === 0 && <EmptyState title="No drafts yet" body="Run discovery to create score-qualified draft listings." compact />}
                    {data.inventory.drafts.slice(0, 8).map((draft) => {
                      const candidate = candidates.find((item) => item.id === draft.candidateId);
                      return <DraftInventoryCard key={draft.id} draftTitle={draft.title} sellerSku={draft.sellerSku} status={draft.status} candidate={candidate} />;
                    })}
                  </InventoryPanel>
                  <InventoryPanel title="Published" items={data.inventory.published.length}>
                    {data.inventory.published.length === 0 && <EmptyState title="Nothing published" body="Approved listings will appear here after sandbox/approval checks." compact />}
                    {data.inventory.published.slice(0, 8).map((draft) => {
                      const candidate = candidates.find((item) => item.id === draft.candidateId);
                      return <DraftInventoryCard key={draft.id} draftTitle={draft.title} sellerSku={draft.sellerSku} status={draft.status} candidate={candidate} />;
                    })}
                  </InventoryPanel>
                  <InventoryPanel title="Blocked / Policy Review" items={data.inventory.blocked.length}>
                    {data.inventory.blocked.length === 0 && <EmptyState title="No blocked products" body="Blocked candidates and policy-review items will appear here." compact />}
                    {data.inventory.blocked.slice(0, 8).map((candidate) => (
                      <InventoryCard key={candidate.id} candidate={candidate} />
                    ))}
                  </InventoryPanel>
                </div>
                <div className="mt-6 rounded-[1.75rem] border border-slate-200 bg-slate-50/80 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Legacy Imported eBay Listings</p>
                      <h3 className="mt-1 text-lg font-black tracking-tight text-slate-950">Ready for 90-Day Backfill</h3>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-slate-700">{data.inventory.importedListings.length} imported</span>
                  </div>
                  {data.inventory.importedListings.length === 0 ? (
                    <p className="mt-4 text-sm text-slate-500">Once eBay credentials are connected, imported legacy listings will appear here and link to local seller SKUs where possible.</p>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {data.inventory.importedListings.map((item) => (
                        <div key={item.id} className="rounded-2xl bg-white px-4 py-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-bold text-slate-900">{item.title}</p>
                              <p className="text-xs text-slate-500">{item.sellerSku}</p>
                            </div>
                            <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${tone(item.listingState)}`}>{item.listingState}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            </div>
          )}

          {tab === 'orders' && (
            <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
              <article className={`${card} p-6`}>
                <SectionHeader eyebrow="Orders" title="Paid Orders and Fulfillment Queue" icon={<Truck className="h-5 w-5 text-slate-400" />} />
                <div className="mt-5 space-y-4">
                  {data.orders.orders.length === 0 && <EmptyState title="No local orders yet" body="As real or simulated orders enter the system, they will appear with their low-risk routing and trace links." />}
                  {data.orders.orders.map((order) => (
                    <div key={order.id} className="rounded-[1.75rem] border border-slate-200 bg-slate-50/80 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{order.sellerSku}</p>
                          <h3 className="mt-1 text-lg font-black tracking-tight text-slate-950">{order.ebayOrderId}</h3>
                          <p className="text-sm text-slate-500">{money(order.orderTotalUsd)} / qty {order.quantity}</p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${tone(order.fulfillmentStatus)}`}>{order.fulfillmentStatus.replace(/_/g, ' ')}</span>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                        <MiniStat label="Risk" value={order.riskClass} />
                        <MiniStat label="Country" value={order.destinationCountry} />
                        <MiniStat label="Tracking" value={order.trackingNumber || '--'} />
                        <MiniStat label="Execs" value={order.linkedExecutionIds?.length || 0} />
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              <article className={`${card} p-6`}>
                <SectionHeader eyebrow="Fulfillment Detail" title="CJ Push Jobs and Imported History" icon={<PackageCheck className="h-5 w-5 text-slate-400" />} />
                <div className="mt-5 space-y-4">
                  {data.orders.fulfillmentJobs.length === 0 && <EmptyState title="No fulfillment jobs yet" body="Low-risk orders will create fulfillment jobs and idempotent CJ pushes here." />}
                  {data.orders.fulfillmentJobs.map((job) => (
                    <div key={job.id} className="rounded-[1.75rem] border border-slate-200 bg-white p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-slate-900">{job.cjOrderId || 'Pending CJ placement'}</p>
                          <p className="text-xs text-slate-500">Order {job.orderId}</p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${tone(job.status)}`}>{job.status}</span>
                      </div>
                    </div>
                  ))}
                  <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50/80 p-5">
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Imported 90-Day Order Backfill</p>
                    {data.orders.importedOrders.length === 0 ? (
                      <p className="mt-3 text-sm text-slate-500">Imported eBay orders will appear here once seller OAuth is connected.</p>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {data.orders.importedOrders.map((order) => (
                          <div key={order.id} className="rounded-2xl bg-white px-4 py-4">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-bold text-slate-900">{order.ebayOrderId}</p>
                                <p className="text-xs text-slate-500">{order.sellerSku}</p>
                              </div>
                              <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${tone(order.state)}`}>{order.state}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            </div>
          )}

          {tab === 'suppliers' && (
            <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
              <article className={`${card} p-6`}>
                <SectionHeader eyebrow="Supplier Threads" title="CJ Supplier Conversation List" icon={<Warehouse className="h-5 w-5 text-slate-400" />} />
                <div className="mt-5 space-y-3">
                  {data.suppliers.chats.map((chat) => (
                    <button
                      key={chat.id}
                      onClick={() => setSelectedSupplierId(chat.id)}
                      className={`w-full rounded-[1.75rem] border p-4 text-left transition ${
                        selectedSupplier?.id === chat.id ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-slate-50/80 text-slate-900 hover:bg-slate-100'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className={`text-xs font-black uppercase tracking-[0.18em] ${selectedSupplier?.id === chat.id ? 'text-blue-200' : 'text-slate-400'}`}>{chat.supplierRegion}</p>
                          <h3 className="mt-1 text-lg font-black tracking-tight">{chat.supplierName}</h3>
                          <p className={`mt-1 text-sm ${selectedSupplier?.id === chat.id ? 'text-slate-300' : 'text-slate-500'}`}>{chat.topic}</p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${selectedSupplier?.id === chat.id ? 'bg-white/10 text-white' : tone(chat.status)}`}>
                          {chat.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </article>

              <article className={`${card} p-6`}>
                <SectionHeader eyebrow="Thread View" title={selectedSupplier ? selectedSupplier.supplierName : 'Supplier Thread'} icon={<MessageCircleMore className="h-5 w-5 text-slate-400" />} />
                {!selectedSupplier ? (
                  <div className="mt-5"><EmptyState title="No supplier selected" body="Choose a supplier thread from the left to inspect its message flow." /></div>
                ) : (
                  <div className="mt-5 space-y-4">
                    <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50/80 p-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-blue-700">{selectedSupplier.sellerSku}</span>
                        <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${tone(selectedSupplier.status)}`}>{selectedSupplier.status.replace(/_/g, ' ')}</span>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-slate-700">Reply ETA {selectedSupplier.responseEtaHours}h</span>
                      </div>
                      <p className="mt-4 text-sm font-semibold text-slate-800">{selectedSupplier.productTitle}</p>
                      <p className="mt-1 text-sm text-slate-500">{selectedSupplier.topic}</p>
                    </div>
                    <div className="space-y-3">
                      {selectedSupplier.messages.map((message) => (
                        <ChatBubble
                          key={message.id}
                          sender={message.sender}
                          message={message.message}
                          provider={message.provider || null}
                          modelName={message.modelName || null}
                          createdAt={message.createdAt}
                        />
                      ))}
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() =>
                          runAction(
                            `supplier:${selectedSupplier.id}`,
                            `/api/suppliers/chats/${selectedSupplier.id}/simulate-send`,
                            { body: JSON.stringify({ message: 'Please reconfirm stock level, dispatch promise, and replacement handling for this SKU.' }) },
                          )
                        }
                        disabled={busyAction !== null}
                        className="rounded-2xl bg-blue-600 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Simulate Follow-Up
                      </button>
                    </div>
                  </div>
                )}
              </article>
            </div>
          )}

          {tab === 'customers' && (
            <article className={`${card} p-6`}>
              <SectionHeader eyebrow="Customer Messaging" title="Read-Only Until eBay Connects" icon={<MessageCircleMore className="h-5 w-5 text-slate-400" />} />
              <div className="mt-5 space-y-4">
                {!data.customers.connected && (
                  <div className="rounded-[1.75rem] border border-amber-200 bg-amber-50 p-5">
                    <p className="text-sm font-bold text-amber-900">Waiting for eBay connection</p>
                    <p className="mt-2 text-sm text-amber-800">{data.customers.waitingReason}</p>
                  </div>
                )}
                {data.customers.conversations.length === 0 ? (
                  <EmptyState title="No customer conversations yet" body="After eBay credentials are connected, the console will import the last 90 days of buyer messages and keep message-send disabled until full messaging hooks are added." />
                ) : (
                  <div className="grid gap-4 xl:grid-cols-2">
                    {data.customers.conversations.map((conversation) => (
                      <div key={conversation.id} className="rounded-[1.75rem] border border-slate-200 bg-slate-50/80 p-5">
                        <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{conversation.buyerUserId}</p>
                        <h3 className="mt-1 text-lg font-black tracking-tight text-slate-950">{conversation.subject}</h3>
                        <p className="mt-2 text-sm text-slate-500">{conversation.messages.length} imported message(s)</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </article>
          )}

          {tab === 'ceo' && (
            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <article className={`${card} p-6`}>
                <SectionHeader eyebrow="CEO Chat" title="Manager Narrative and Control" icon={<Brain className="h-5 w-5 text-slate-400" />} />
                <div className="mt-5 space-y-3">
                  {data.ceo.thread.messages.map((message) => (
                    <ChatBubble
                      key={message.id}
                      sender={message.sender}
                      message={message.message}
                      provider={message.provider || null}
                      modelName={message.modelName || null}
                      createdAt={message.createdAt}
                    />
                  ))}
                </div>
                <div className="mt-5 flex gap-3">
                  <input
                    value={ceoPrompt}
                    onChange={(event) => setCeoPrompt(event.target.value)}
                    placeholder="Ask the Manager Agent what is happening right now..."
                    className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-400"
                  />
                  <button
                    onClick={() => {
                      if (!ceoPrompt.trim()) return;
                      runAction('ceo-send', '/api/ceo-chat/messages', { body: JSON.stringify({ message: ceoPrompt }) }).catch((error) => console.error(error));
                      setCeoPrompt('');
                    }}
                    disabled={busyAction !== null || !ceoPrompt.trim()}
                    className="rounded-2xl bg-slate-950 px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Ask CEO Agent
                  </button>
                </div>
              </article>

              <article className={`${card} p-6`}>
                <SectionHeader eyebrow="Linked Manager Traces" title="How the Manager Agent Is Thinking" icon={<ChevronRight className="h-5 w-5 text-slate-400" />} />
                <div className="mt-5 space-y-4">
                  {data.agents.executions
                    .filter((execution) => execution.agentId === 'manager')
                    .slice(0, 8)
                    .map((execution) => (
                      <div key={execution.id} className="rounded-[1.75rem] border border-slate-200 bg-slate-50/80 p-5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{execution.triggerSource}</p>
                            <h3 className="mt-1 text-lg font-black tracking-tight text-slate-950">{execution.summary}</h3>
                          </div>
                          <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${tone(execution.status)}`}>{execution.status}</span>
                        </div>
                        <div className="mt-4 space-y-3">
                          {execution.steps.map((step) => (
                            <div key={step.id} className="rounded-2xl bg-white p-4">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-bold text-slate-900">{step.stepName}</span>
                                <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${tone(step.provider)}`}>{step.provider}</span>
                                {step.modelName && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-700">{step.modelName}</span>}
                              </div>
                              <p className="mt-2 text-sm text-slate-600">{step.outputSummary}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </article>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ActionButton(props: { onClick: () => void; busy: boolean; primary?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.busy}
      className={`rounded-2xl px-5 py-3 text-xs font-black uppercase tracking-[0.18em] transition disabled:cursor-not-allowed disabled:opacity-60 ${
        props.primary ? 'bg-blue-600 text-white hover:bg-blue-500' : 'border border-white/20 bg-white/10 text-white hover:bg-white/20'
      }`}
    >
      {props.children}
    </button>
  );
}

function HeroStat(props: { label: string; value: string; badgeTone: string }) {
  return (
    <div className="rounded-[1.5rem] border border-white/10 bg-white/10 p-5 backdrop-blur">
      <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-300">{props.label}</p>
      <div className="mt-3">
        <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.18em] ${props.badgeTone}`}>{props.value}</span>
      </div>
    </div>
  );
}

function HeroCard(props: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-[1.5rem] border border-white/10 bg-white/10 p-5 backdrop-blur">
      <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-300">{props.label}</p>
      <div className="mt-3 text-lg font-black">{props.value}</div>
      <p className="mt-1 text-xs text-slate-300">{props.note}</p>
    </div>
  );
}

function SectionHeader(props: { eyebrow: string; title: string; icon: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{props.eyebrow}</p>
        <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950">{props.title}</h2>
      </div>
      {props.icon}
    </div>
  );
}

function MiniStat(props: { label: string; value: string | number; inverted?: boolean }) {
  return (
    <div className={`rounded-2xl px-3 py-3 ${props.inverted ? 'bg-white/10 text-white' : 'bg-white text-slate-950'}`}>
      <p className={`text-[10px] font-black uppercase tracking-[0.18em] ${props.inverted ? 'text-slate-300' : 'text-slate-400'}`}>{props.label}</p>
      <p className="mt-1 text-sm font-black">{props.value}</p>
    </div>
  );
}

function ArchitectureList(props: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl bg-white p-4">
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{props.title}</p>
      <div className="mt-3 space-y-2">
        {props.items.length === 0 ? (
          <p className="text-sm text-slate-500">No items configured.</p>
        ) : (
          props.items.map((item) => (
            <p key={item} className="text-sm text-slate-700">
              - {item}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

function ArchitectureNote(props: { label: string; text: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{props.label}</p>
      <p className="mt-2 text-sm text-slate-700">{props.text}</p>
    </div>
  );
}

function EmptyState(props: { title: string; body: string; compact?: boolean }) {
  return (
    <div className={`rounded-[1.75rem] border border-dashed border-slate-200 bg-slate-50/80 ${props.compact ? 'p-4' : 'p-6'}`}>
      <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-900">{props.title}</h3>
      <p className="mt-2 text-sm text-slate-500">{props.body}</p>
    </div>
  );
}

function InventoryPanel(props: { title: string; items: number; children: ReactNode }) {
  return (
    <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50/80 p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-black tracking-tight text-slate-950">{props.title}</h3>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-slate-700">{props.items}</span>
      </div>
      <div className="mt-4 space-y-3">{props.children}</div>
    </div>
  );
}

function InventoryCard(props: { key?: string; candidate: ProductCandidate }) {
  const { candidate } = props;
  return (
    <div className="rounded-2xl bg-white p-4">
      <div className="flex gap-4">
        <img src={candidate.imageUrl} alt={candidate.title} className="h-16 w-16 rounded-2xl object-cover" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xl font-black ${scoreTone(candidate)}`}>{candidate.scoreBreakdown?.totalScore ?? '--'}</span>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${tone(candidate.status)}`}>{candidate.status.replace(/_/g, ' ')}</span>
          </div>
          <h4 className="mt-2 text-sm font-bold text-slate-900">{candidate.title}</h4>
          <p className="mt-1 text-xs text-slate-500">{candidate.sellerSku} / {candidate.supplierName}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
            <p>Landed {money(candidate.landedCost)}</p>
            <p>Target {money(candidate.targetPrice)}</p>
            <p>Stock {candidate.stock}</p>
            <p>ETA {candidate.estimatedDeliveryBusinessDays}d</p>
          </div>
          {candidate.policyMatches.length > 0 && <p className="mt-2 text-xs text-rose-600">{candidate.policyMatches[0]}</p>}
        </div>
      </div>
    </div>
  );
}

function DraftInventoryCard(props: { key?: string; draftTitle: string; sellerSku: string; status: DraftStatus; candidate?: ProductCandidate }) {
  return (
    <div className="rounded-2xl bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold text-slate-900">{props.draftTitle}</h4>
          <p className="mt-1 text-xs text-slate-500">{props.sellerSku}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${tone(props.status)}`}>{props.status.replace(/_/g, ' ')}</span>
      </div>
      {props.candidate && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
          <p>Demand {props.candidate.scoreBreakdown?.demandScore ?? '--'}</p>
          <p>Margin {props.candidate.scoreBreakdown?.netMarginPercent ?? '--'}%</p>
        </div>
      )}
    </div>
  );
}

function ChatBubble(props: { key?: string; sender: string; message: string; provider: string | null; modelName: string | null; createdAt: string }) {
  const outbound = props.sender === 'owner' || props.sender === 'ceo';
  return (
    <div className={`rounded-[1.75rem] border p-4 ${outbound ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-900'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-[11px] font-black uppercase tracking-[0.18em] ${outbound ? 'text-blue-200' : 'text-slate-400'}`}>{props.sender}</span>
        {props.provider && <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${outbound ? 'bg-white/10 text-white' : tone(props.provider)}`}>{props.provider}</span>}
        {props.modelName && <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${outbound ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-700'}`}>{props.modelName}</span>}
      </div>
      <p className={`mt-3 text-sm ${outbound ? 'text-slate-100' : 'text-slate-700'}`}>{props.message}</p>
      <p className={`mt-2 text-xs ${outbound ? 'text-slate-300' : 'text-slate-500'}`}>{new Date(props.createdAt).toLocaleString()}</p>
    </div>
  );
}
