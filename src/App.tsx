import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Brain,
  Boxes,
  ChevronDown,
  ChevronRight,
  Clock3,
  ExternalLink,
  Gauge,
  Layers3,
  MessageCircleMore,
  PackageCheck,
  ShieldAlert,
  Store,
  Truck,
  Warehouse,
} from 'lucide-react';
import type {
  AgentStatusCard,
  ArchitecturePayload,
  CeoChatPayload,
  CustomerChatsPayload,
  InventoryPayload,
  ListingDraft,
  OverviewPayload,
  ProductCandidate,
  StorePayload,
  SupplierChatsPayload,
  ValidationPayload,
} from './types';

type TabId = 'overview' | 'inventory' | 'agents' | 'store' | 'suppliers' | 'customers' | 'architecture' | 'validation';
type BusyAction =
  | 'discovery'
  | 'resume'
  | 'kill-switch'
  | 'worker-tick'
  | `approve:${string}`
  | `reject:${string}`
  | `publish:${string}`
  | `refine:${string}`
  | `supplier:${string}`
  | 'ceo-send'
  | null;

interface ConsoleData {
  overview: OverviewPayload;
  inventory: InventoryPayload;
  agents: { generatedAt: string; fleet: AgentStatusCard[] };
  store: StorePayload;
  suppliers: SupplierChatsPayload;
  customers: CustomerChatsPayload;
  architecture: ArchitecturePayload;
  validation: ValidationPayload;
  ceo: CeoChatPayload;
}

const tabs: Array<{ id: TabId; label: string; icon: ReactNode }> = [
  { id: 'overview', label: 'Overview', icon: <Gauge className="h-4 w-4" /> },
  { id: 'inventory', label: 'Inventory', icon: <Boxes className="h-4 w-4" /> },
  { id: 'agents', label: 'Agents', icon: <Bot className="h-4 w-4" /> },
  { id: 'store', label: 'Store', icon: <Store className="h-4 w-4" /> },
  { id: 'suppliers', label: 'Suppliers', icon: <Warehouse className="h-4 w-4" /> },
  { id: 'customers', label: 'Customers', icon: <MessageCircleMore className="h-4 w-4" /> },
  { id: 'architecture', label: 'Architecture', icon: <Layers3 className="h-4 w-4" /> },
  { id: 'validation', label: 'Validation', icon: <ShieldAlert className="h-4 w-4" /> },
];

const card = 'rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.06)]';

function currency(value: number | null | undefined): string {
  if (typeof value !== 'number') return '--';
  return `$${value.toFixed(2)}`;
}

function formatPct(value: number | null | undefined): string {
  if (typeof value !== 'number') return '--';
  return `${value.toFixed(1)}%`;
}

function tone(value: string): string {
  switch (value) {
    case 'published':
    case 'READY_TO_LIST':
    case 'connected':
    case 'resolved':
    case 'available':
    case 'passed':
    case 'healthy':
      return 'bg-emerald-100 text-emerald-700';
    case 'ready_to_publish':
    case 'APPROVAL_REQUIRED':
    case 'TEST_ONLY':
    case 'warning':
    case 'watch':
    case 'sandbox':
    case 'awaiting_reply':
    case 'running':
      return 'bg-amber-100 text-amber-800';
    case 'blocked':
    case 'BLOCKED':
    case 'PAUSED':
    case 'critical':
    case 'rejected':
    case 'failed':
    case 'risk':
    case 'unavailable':
      return 'bg-rose-100 text-rose-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function decisionTone(candidate: ProductCandidate): string {
  const score = candidate.scoreBreakdown?.totalScore ?? 0;
  if (score >= 85) return 'text-emerald-600';
  if (score >= 70) return 'text-amber-600';
  return 'text-rose-600';
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}`);
  }
  return (await response.json()) as T;
}

export default function App() {
  const [data, setData] = useState<ConsoleData | null>(null);
  const [tab, setTab] = useState<TabId>('overview');
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [ceoPrompt, setCeoPrompt] = useState('');

  async function refreshAll() {
    const [overview, inventory, agents, store, suppliers, customers, architecture, validation, ceo] = await Promise.all([
      fetchJson<OverviewPayload>('/api/overview'),
      fetchJson<InventoryPayload>('/api/inventory'),
      fetchJson<{ generatedAt: string; fleet: AgentStatusCard[] }>('/api/agents'),
      fetchJson<StorePayload>('/api/store'),
      fetchJson<SupplierChatsPayload>('/api/suppliers/chats'),
      fetchJson<CustomerChatsPayload>('/api/customer-chats'),
      fetchJson<ArchitecturePayload>('/api/architecture'),
      fetchJson<ValidationPayload>('/api/validation'),
      fetchJson<CeoChatPayload>('/api/ceo-chat'),
    ]);
    setData({ overview, inventory, agents, store, suppliers, customers, architecture, validation, ceo });
    if (!selectedCandidateId && inventory.candidates[0]) setSelectedCandidateId(inventory.candidates[0].id);
    if (!selectedSupplierId && suppliers.chats[0]) setSelectedSupplierId(suppliers.chats[0].id);
    if (!expandedAgentId && agents.fleet[0]) setExpandedAgentId(agents.fleet[0].id);
  }

  async function runAction(action: BusyAction, url: string, options?: RequestInit) {
    setBusyAction(action);
    setActionError(null);
    setActionMessage(null);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...options,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        summary?: { scanned?: number; shortlisted?: number; drafted?: number };
      };
      if (!response.ok) {
        throw new Error(payload.error || 'Action failed.');
      }
      if (action === 'discovery' && payload.summary) {
        setActionMessage(`Discovery complete: scanned ${payload.summary.scanned ?? 0}, shortlisted ${payload.summary.shortlisted ?? 0}, drafted ${payload.summary.drafted ?? 0}.`);
      } else if (action?.startsWith('approve:')) {
        setActionMessage('eBay inventory draft created. Use Confirm Live Publish to go live.');
      } else if (action?.startsWith('publish:')) {
        setActionMessage('Live publish confirmed.');
      } else if (action?.startsWith('reject:')) {
        setActionMessage('Draft rejected.');
      } else if (action?.startsWith('refine:')) {
        setActionMessage('Draft refinement requested.');
      } else if (action === 'resume') {
        setActionMessage('Automation resumed in approval-required mode.');
      } else if (action === 'kill-switch') {
        setActionMessage('Kill switch engaged.');
      } else if (action === 'ceo-send') {
        setActionMessage('CEO chat updated.');
      } else {
        setActionMessage('Action completed.');
      }
      await refreshAll();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Action failed.');
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

  const selectedCandidate = useMemo(
    () => data?.inventory.candidates.find((candidate) => candidate.id === selectedCandidateId) || data?.inventory.candidates[0] || null,
    [data, selectedCandidateId],
  );
  const selectedSupplier = useMemo(
    () => data?.suppliers.chats.find((chat) => chat.id === selectedSupplierId) || data?.suppliers.chats[0] || null,
    [data, selectedSupplierId],
  );

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-700">
        <div className={`${card} px-8 py-6`}>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">YuziGoods</p>
          <h1 className="mt-2 text-2xl font-black text-slate-950">Loading Growth Console v4.2</h1>
        </div>
      </div>
    );
  }

  const needsReview = data.inventory.drafts.filter((draft) => draft.status === 'needs_review');
  const readyToPublish = data.inventory.drafts.filter((draft) => draft.status === 'ready_to_publish');
  const published = data.inventory.published;
  const rejected = data.inventory.drafts.filter((draft) => draft.status === 'rejected');
  const hardGateSurvivors = data.inventory.candidates.filter((candidate) => candidate.status !== 'BLOCKED').length;
  const ordersCount = data.store.storeOverview.reduce((sum, store) => sum + store.ordersToday, 0);
  const impressions = data.overview.analytics.impressions;
  const ctr = data.overview.analytics.ctr;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#dbeafe_0%,_#eff6ff_35%,_#f8fafc_100%)] text-slate-900">
      <div className="mx-auto max-w-[1680px] px-5 py-6 lg:px-8">
        <header className={`${card} overflow-hidden bg-slate-950 text-white`}>
          <div className="grid gap-6 px-6 py-7 lg:grid-cols-[1.45fr_1fr]">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.28em] text-blue-300">YuziGoods / Growth Console v4.2</p>
              <h1 className="mt-3 text-4xl font-black tracking-tight">Find better products. Draft safer listings. See every decision.</h1>
              <p className="mt-3 max-w-3xl text-sm text-slate-300">
                Discovery is focused on US-warehouse winners with a 7-day hard shipping gate, strong score visibility, and a two-step eBay publish flow through May 10, 2026.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <ActionButton busy={busyAction !== null} primary onClick={() => runAction('discovery', '/api/discovery/run')}>
                  Run Discovery
                </ActionButton>
                <ActionButton busy={busyAction !== null} onClick={() => runAction('worker-tick', '/api/worker/tick')}>
                  Process Queue
                </ActionButton>
                <ActionButton busy={busyAction !== null} onClick={() => runAction('resume', '/api/system/resume')}>
                  Resume
                </ActionButton>
                <ActionButton busy={busyAction !== null} onClick={() => runAction('kill-switch', '/api/system/kill-switch')}>
                  Kill Switch
                </ActionButton>
              </div>
              {(actionMessage || actionError) && (
                <div className={`mt-4 rounded-2xl px-4 py-3 text-sm font-semibold ${actionError ? 'bg-rose-500/15 text-rose-100' : 'bg-emerald-500/15 text-emerald-100'}`}>
                  {actionError || actionMessage}
                </div>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <HeroBadge label="Automation Mode" value={data.overview.settings.automationMode.replace(/_/g, ' ')} toneClass={tone(data.overview.settings.automationMode)} />
              <HeroBadge label="Traffic Source" value={data.overview.analytics.source} toneClass={tone(data.overview.analytics.state)} />
              <HeroInfo label="Approval Window" value={new Date(data.overview.settings.approvalWindowEndsAt).toLocaleDateString()} note="Live publish still requires a second click until this date." />
              <HeroInfo label="AI Budget" value={`${currency(data.overview.budgets.dayToDateUsd)} / ${currency(data.overview.budgets.dailyCapUsd)}`} note={`Monthly ${currency(data.overview.budgets.monthToDateUsd)} / ${currency(data.overview.budgets.monthlyCapUsd)}`} />
            </div>
          </div>
        </header>

        <nav className={`${card} mt-6 p-3`}>
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
        </nav>

        {tab === 'overview' && (
          <div className="mt-6 grid gap-6 xl:grid-cols-[1.45fr_0.55fr]">
            <div className="space-y-6">
              <section className="grid gap-4 md:grid-cols-4">
                <KpiCard label="Candidates" value={data.inventory.candidates.length} note={`${hardGateSurvivors} passed hard gates`} />
                <KpiCard label="Drafts" value={needsReview.length + readyToPublish.length} note={`${published.length} published`} />
                <KpiCard label="Orders" value={ordersCount} note={`${data.inventory.candidates.filter((candidate) => candidate.status === 'BLOCKED').length} blocked`} />
                <KpiCard
                  label="CTR"
                  value={ctr === null ? 'No analytics yet' : formatPct(ctr)}
                  note={impressions === null ? data.overview.analytics.note : `${impressions} impressions`}
                />
              </section>

              <section className={`${card} p-5`}>
                <SectionHeader eyebrow="Row 2 / Draft Queue" title="One-Click Draft Workflow" icon={<PackageCheck className="h-5 w-5 text-slate-400" />} />
                <div className="mt-5 grid gap-4 xl:grid-cols-4">
                  <DraftColumn
                    title="Needs Review"
                    drafts={needsReview}
                    inventory={data.inventory}
                    busyAction={busyAction}
                    onApprove={(draftId) => runAction(`approve:${draftId}`, `/api/drafts/${draftId}/approve`)}
                    onReject={(draftId) => runAction(`reject:${draftId}`, `/api/drafts/${draftId}/reject`)}
                    onRefine={(draft) => {
                      const executionId = draft.linkedExecutionIds?.[0];
                      if (executionId) {
                        return runAction(`refine:${draft.id}`, `/api/validation/${executionId}/refine`);
                      }
                      return Promise.resolve();
                    }}
                  />
                  <DraftColumn
                    title="Ready to Publish"
                    drafts={readyToPublish}
                    inventory={data.inventory}
                    busyAction={busyAction}
                    onPublish={(draftId) => runAction(`publish:${draftId}`, `/api/drafts/${draftId}/publish`)}
                  />
                  <DraftColumn title="Published" drafts={published} inventory={data.inventory} busyAction={busyAction} />
                  <DraftColumn title="Rejected" drafts={rejected} inventory={data.inventory} busyAction={busyAction} />
                </div>
              </section>

              <section className={`${card} p-5`}>
                <SectionHeader eyebrow="Row 3 / Agents" title="Agent Input, Output, Decision, and Next Run" icon={<Bot className="h-5 w-5 text-slate-400" />} />
                <div className="mt-5 space-y-4">
                  {data.agents.fleet.map((agent) => {
                    const expanded = expandedAgentId === agent.id;
                    return (
                      <article key={agent.id} className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80">
                        <button
                          onClick={() => setExpandedAgentId(expanded ? null : agent.id)}
                          className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-lg font-black tracking-tight text-slate-950">{agent.name}</p>
                              <Pill value={agent.status} />
                              <Pill value={agent.validationStatus} />
                            </div>
                            <p className="mt-1 text-sm text-slate-500">{agent.decisionSummary}</p>
                          </div>
                          <div className="flex items-center gap-4 text-right">
                            <div className="hidden text-xs text-slate-500 sm:block">
                              <p>Last run: {agent.lastRunAt ? new Date(agent.lastRunAt).toLocaleString() : 'Never'}</p>
                              <p>Next run: {agent.nextScheduledRun}</p>
                            </div>
                            {expanded ? <ChevronDown className="h-5 w-5 text-slate-400" /> : <ChevronRight className="h-5 w-5 text-slate-400" />}
                          </div>
                        </button>
                        {expanded && (
                          <div className="border-t border-slate-200 px-5 py-5">
                            <div className="grid gap-4 lg:grid-cols-2">
                              <InfoBlock label="Role" body={agent.role} />
                              <InfoBlock label="Current Task" body={agent.currentTask} />
                              <InfoBlock label="Input Summary" body={agent.inputSummary} />
                              <InfoBlock label="Output Summary" body={agent.outputSummary} />
                              <InfoBlock label="Next Action" body={agent.nextAction} />
                              <InfoBlock label="Provider / Model" body={agent.providerSummary} />
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            </div>

            <aside className={`${card} p-5 xl:sticky xl:top-6 xl:h-fit`}>
              <SectionHeader eyebrow="CEO Sidebar" title="Operational Summary" icon={<Brain className="h-5 w-5 text-slate-400" />} />
              <div className="mt-5 space-y-3">
                {data.ceo.thread.messages.slice(-8).map((message) => (
                  <ChatBubble key={message.id} sender={message.sender} message={message.message} meta={`${message.provider || 'system'}${message.modelName ? ` / ${message.modelName}` : ''}`} />
                ))}
              </div>
              <div className="mt-5 space-y-3">
                <textarea
                  value={ceoPrompt}
                  onChange={(event) => setCeoPrompt(event.target.value)}
                  rows={4}
                  placeholder="Ask why no drafts were produced, what blocked discovery, or what to fix next."
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
                />
                <ActionButton
                  busy={busyAction !== null || !ceoPrompt.trim()}
                  primary
                  onClick={() => {
                    if (!ceoPrompt.trim()) return;
                    runAction('ceo-send', '/api/ceo-chat/messages', { body: JSON.stringify({ message: ceoPrompt }) }).catch((error) => console.error(error));
                    setCeoPrompt('');
                  }}
                >
                  Ask CEO Agent
                </ActionButton>
              </div>
            </aside>
          </div>
        )}

        {tab === 'inventory' && (
          <div className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
            <section className={`${card} p-5`}>
              <SectionHeader eyebrow="Candidates" title="Pass-Through by Stage" icon={<Boxes className="h-5 w-5 text-slate-400" />} />
              <div className="mt-5 space-y-4">
                <CandidateGroup
                  title="High Priority"
                  items={data.inventory.candidates.filter((candidate) => candidate.status === 'READY_TO_LIST')}
                  selectedId={selectedCandidate?.id || null}
                  onSelect={setSelectedCandidateId}
                />
                <CandidateGroup
                  title="Test"
                  items={data.inventory.candidates.filter((candidate) => candidate.status === 'TEST_ONLY')}
                  selectedId={selectedCandidate?.id || null}
                  onSelect={setSelectedCandidateId}
                />
                <CandidateGroup
                  title="Blocked"
                  items={data.inventory.candidates.filter((candidate) => candidate.status === 'BLOCKED' || candidate.status === 'IGNORED')}
                  selectedId={selectedCandidate?.id || null}
                  onSelect={setSelectedCandidateId}
                />
              </div>
            </section>
            <section className={`${card} p-5`}>
              <SectionHeader eyebrow="Candidate Detail" title={selectedCandidate?.title || 'Select a candidate'} icon={<AlertTriangle className="h-5 w-5 text-slate-400" />} />
              {!selectedCandidate ? (
                <EmptyState title="No candidate selected" body="Choose a candidate to see cost, price, demand, shipping ETA, policy risk, and rejection reasons." />
              ) : (
                <div className="mt-5">
                  <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
                    <img src={selectedCandidate.imageUrl} alt={selectedCandidate.title} className="h-56 w-full rounded-[1.5rem] object-cover" />
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-3xl font-black ${decisionTone(selectedCandidate)}`}>{selectedCandidate.scoreBreakdown?.totalScore ?? '--'}</span>
                        <Pill value={selectedCandidate.status} />
                        <Pill value={selectedCandidate.policyState} />
                      </div>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <Metric label="CJ Cost" value={currency(selectedCandidate.landedCost)} />
                        <Metric label="Suggested Price" value={currency(selectedCandidate.targetPrice)} />
                        <Metric label="Net Margin" value={formatPct(selectedCandidate.scoreBreakdown?.netMarginPercent)} />
                        <Metric label="Demand Score" value={`${selectedCandidate.scoreBreakdown?.demandScore ?? '--'} / sold ${selectedCandidate.searchSnapshot?.sold30d ?? '--'}`} />
                        <Metric label="Shipping ETA" value={`${selectedCandidate.estimatedDeliveryBusinessDays} business days`} />
                        <Metric label="Competition Score" value={`${selectedCandidate.scoreBreakdown?.competitionScore ?? '--'}`} />
                        <Metric label="Policy Risk" value={`${selectedCandidate.scoreBreakdown?.policyRiskScore ?? '--'}`} />
                        <Metric label="Complexity" value={`${selectedCandidate.scoreBreakdown?.listingComplexityScore ?? '--'}`} />
                        <Metric label="Decision" value={selectedCandidate.status.replace(/_/g, ' ')} />
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Rejection / Warning Reasons</p>
                        <div className="mt-3 space-y-2 text-sm text-slate-700">
                          {(selectedCandidate.rejectionReasons.length ? selectedCandidate.rejectionReasons : selectedCandidate.policyMatches).map((reason) => (
                            <p key={reason}>- {reason}</p>
                          ))}
                          {!selectedCandidate.rejectionReasons.length && !selectedCandidate.policyMatches.length && <p>No rejection reasons. Candidate is eligible for scoring or drafting.</p>}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        {selectedCandidate.openInCjUrl && (
                          <a href={selectedCandidate.openInCjUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-700 hover:bg-slate-50">
                            Open in CJ
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {tab === 'agents' && (
          <section className={`${card} mt-6 p-5`}>
            <SectionHeader eyebrow="Agent Runtime" title="Last Run, Inputs, Outputs, Decisions, and Next Schedule" icon={<Bot className="h-5 w-5 text-slate-400" />} />
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {data.agents.fleet.map((agent) => (
                <div key={agent.id} className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-black text-slate-950">{agent.name}</h3>
                    <Pill value={agent.status} />
                    <Pill value={agent.validationStatus} />
                  </div>
                  <p className="mt-2 text-sm text-slate-500">{agent.role}</p>
                  <div className="mt-4 space-y-3">
                    <MetricRow label="Last run" value={agent.lastRunAt ? new Date(agent.lastRunAt).toLocaleString() : 'Never'} />
                    <MetricRow label="Input summary" value={agent.inputSummary} />
                    <MetricRow label="Output summary" value={agent.outputSummary} />
                    <MetricRow label="Decision" value={agent.decisionSummary} />
                    <MetricRow label="Next action" value={agent.nextAction} />
                    <MetricRow label="Next scheduled run" value={agent.nextScheduledRun} />
                    <MetricRow label="Provider / model" value={agent.providerSummary} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'store' && (
          <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <section className={`${card} p-5`}>
              <SectionHeader eyebrow="Connections" title="Store and Platform Readiness" icon={<Store className="h-5 w-5 text-slate-400" />} />
              <div className="mt-5 space-y-3">
                {data.store.connections.map((connection) => (
                  <div key={connection.name} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-slate-950">{connection.name}</p>
                        <p className="mt-1 text-xs text-slate-500">{connection.notes}</p>
                      </div>
                      <Pill value={connection.status} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section className={`${card} p-5`}>
              <SectionHeader eyebrow="Traffic and Reach" title="Free Traffic API State" icon={<Truck className="h-5 w-5 text-slate-400" />} />
              <div className="mt-5 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill value={data.store.analytics.state} />
                  <span className="text-sm font-semibold text-slate-500">{data.store.analytics.source}</span>
                </div>
                <p className="mt-3 text-sm text-slate-700">{data.store.analytics.note}</p>
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <Metric label="Impressions" value={data.store.analytics.impressions === null ? '--' : `${data.store.analytics.impressions}`} />
                  <Metric label="Clicks" value={data.store.analytics.clicks === null ? '--' : `${data.store.analytics.clicks}`} />
                  <Metric label="CTR" value={data.store.analytics.ctr === null ? '--' : formatPct(data.store.analytics.ctr)} />
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {data.store.readinessChecklist.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-bold text-slate-900">{item.label}</p>
                      <Pill value={item.done ? 'passed' : 'warning'} />
                    </div>
                    <p className="mt-2 text-sm text-slate-500">{item.note}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {tab === 'suppliers' && (
          <div className="mt-6 grid gap-6 xl:grid-cols-[0.7fr_1.3fr]">
            <section className={`${card} p-5`}>
              <SectionHeader eyebrow="Supplier Notes" title="Internal Notes + Open in CJ" icon={<Warehouse className="h-5 w-5 text-slate-400" />} />
              <div className="mt-5 space-y-3">
                {data.suppliers.chats.map((chat) => (
                  <button
                    key={chat.id}
                    onClick={() => setSelectedSupplierId(chat.id)}
                    className={`w-full rounded-[1.5rem] border px-4 py-4 text-left transition ${
                      selectedSupplier?.id === chat.id ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className={`text-xs font-black uppercase tracking-[0.18em] ${selectedSupplier?.id === chat.id ? 'text-blue-200' : 'text-slate-400'}`}>{chat.supplierRegion}</p>
                        <h3 className="mt-1 text-lg font-black">{chat.supplierName}</h3>
                        <p className={`mt-1 text-sm ${selectedSupplier?.id === chat.id ? 'text-slate-300' : 'text-slate-500'}`}>{chat.topic}</p>
                      </div>
                      <Pill value={chat.status} inverted={selectedSupplier?.id === chat.id} />
                    </div>
                  </button>
                ))}
              </div>
            </section>
            <section className={`${card} p-5`}>
              <SectionHeader eyebrow="Selected Supplier" title={selectedSupplier?.supplierName || 'Supplier'} icon={<MessageCircleMore className="h-5 w-5 text-slate-400" />} />
              {!selectedSupplier ? (
                <div className="mt-5"><EmptyState title="No supplier selected" body="Choose a supplier note thread to see product context, notes, and the CJ open link." /></div>
              ) : (
                <div className="mt-5 space-y-5">
                  <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill value={selectedSupplier.status} />
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-slate-700">{selectedSupplier.sellerSku}</span>
                    </div>
                    <p className="mt-3 text-sm font-bold text-slate-900">{selectedSupplier.productTitle}</p>
                    <p className="mt-1 text-sm text-slate-500">{selectedSupplier.topic}</p>
                    {selectedSupplier.openInCjUrl && (
                      <a href={selectedSupplier.openInCjUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-700 hover:bg-slate-50">
                        Open in CJ
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                  <div className="grid gap-5 lg:grid-cols-2">
                    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5">
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Internal Notes</p>
                      <div className="mt-4 space-y-3">
                        {selectedSupplier.notes.map((note) => (
                          <div key={note.id} className="rounded-2xl bg-slate-50 p-4">
                            <p className="text-sm text-slate-700">{note.body}</p>
                            <p className="mt-2 text-xs text-slate-500">{new Date(note.createdAt).toLocaleString()}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5">
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Note Timeline</p>
                      <div className="mt-4 space-y-3">
                        {selectedSupplier.messages.map((message) => (
                          <ChatBubble key={message.id} sender={message.sender} message={message.message} meta={message.provider || 'system'} />
                        ))}
                      </div>
                    </div>
                  </div>
                  <ActionButton
                    busy={busyAction !== null}
                    primary
                    onClick={() =>
                      runAction(`supplier:${selectedSupplier.id}`, `/api/suppliers/chats/${selectedSupplier.id}/simulate-send`, {
                        body: JSON.stringify({ message: 'Please reconfirm stock, dispatch timing, and replacement handling for this SKU.' }),
                      })
                    }
                  >
                    Add Follow-Up Note
                  </ActionButton>
                </div>
              )}
            </section>
          </div>
        )}

        {tab === 'customers' && (
          <section className={`${card} mt-6 p-5`}>
            <SectionHeader eyebrow="Customer Messages" title="Read-Only eBay Import + Open in eBay" icon={<MessageCircleMore className="h-5 w-5 text-slate-400" />} />
            {!data.customers.connected && (
              <div className="mt-5 rounded-[1.5rem] border border-amber-200 bg-amber-50 p-5">
                <p className="text-sm font-bold text-amber-900">Waiting for eBay connection</p>
                <p className="mt-2 text-sm text-amber-800">{data.customers.waitingReason}</p>
              </div>
            )}
            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              {data.customers.conversations.length === 0 && <EmptyState title="No imported customer conversations" body="Once eBay messaging is connected, the last 90 days of customer messages will appear here in read-only mode." />}
              {data.customers.conversations.map((conversation) => (
                <div key={conversation.id} className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{conversation.buyerUserId}</p>
                      <h3 className="mt-1 text-lg font-black text-slate-950">{conversation.subject}</h3>
                    </div>
                    <Pill value={conversation.autoSendEligible ? 'passed' : 'warning'} />
                  </div>
                  <p className="mt-2 text-sm text-slate-500">{conversation.messages.length} imported message(s). Safe shipping-status updates only.</p>
                  {conversation.openInEbayUrl && (
                    <a href={conversation.openInEbayUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-700 hover:bg-slate-50">
                      Open in eBay
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'architecture' && (
          <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <section className={`${card} p-5`}>
              <SectionHeader eyebrow="Live Flowchart" title="CJ -> Score -> Draft -> Publish -> Fulfill -> Support" icon={<Layers3 className="h-5 w-5 text-slate-400" />} />
              <pre className="mt-5 overflow-x-auto rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-700">{data.architecture.flowchart}</pre>
            </section>
            <section className={`${card} p-5`}>
              <SectionHeader eyebrow="Contracts" title="Role, Inputs, Outputs, Validators, Routing" icon={<ShieldAlert className="h-5 w-5 text-slate-400" />} />
              <div className="mt-5 space-y-4">
                {data.architecture.contracts.map((contract) => (
                  <div key={contract.agentId} className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5">
                    <h3 className="text-lg font-black text-slate-950">{contract.agentId.replace(/_/g, ' ')}</h3>
                    <p className="mt-2 text-sm text-slate-600">{contract.role}</p>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <ListBlock title="Inputs" items={contract.inputs} />
                      <ListBlock title="Outputs" items={contract.outputs} />
                      <ListBlock title="Hard Validators" items={contract.hardValidators} />
                      <ListBlock title="Soft Validators" items={contract.softValidators} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {tab === 'validation' && (
          <section className={`${card} mt-6 p-5`}>
            <SectionHeader eyebrow="Validation Queue" title="Blocked, Warnings, Passed" icon={<ShieldAlert className="h-5 w-5 text-slate-400" />} />
            <div className="mt-5 grid gap-4 md:grid-cols-5">
              <KpiCard label="Passed" value={data.validation.stats.passed} note="Validation runs" />
              <KpiCard label="Warnings" value={data.validation.stats.warnings} note="Visible and queryable" />
              <KpiCard label="Failed" value={data.validation.stats.failed} note="Blocked outputs" />
              <KpiCard label="Fallback Runs" value={data.validation.stats.fallbackRuns} note="Provider downgrade visible" />
              <KpiCard label="Simulated Runs" value={data.validation.stats.simulatedRuns} note="Hidden states avoided" />
            </div>
            <div className="mt-5 space-y-3">
              {data.validation.runs.map((run) => (
                <div key={run.id} className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-black text-slate-950">{run.agentId.replace(/_/g, ' ')}</p>
                    <Pill value={run.status} />
                    {run.simulatedData && <Pill value="simulated" />}
                    {run.fallbackUsed && <Pill value="fallback" />}
                  </div>
                  <p className="mt-2 text-sm text-slate-600">Score {run.score} / refinement count {run.refinementCount}</p>
                  <div className="mt-3 space-y-2">
                    {run.validatorResults.slice(0, 4).map((result) => (
                      <p key={result.validatorId} className="text-sm text-slate-700">
                        - <span className="font-semibold">{result.name}</span>: {result.observed}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function ActionButton(props: { onClick: () => void; busy: boolean; primary?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.busy}
      className={`rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-[0.18em] transition disabled:cursor-not-allowed disabled:opacity-60 ${
        props.primary ? 'bg-blue-600 text-white hover:bg-blue-500' : 'border border-white/20 bg-white/10 text-white hover:bg-white/20'
      }`}
    >
      {props.children}
    </button>
  );
}

function HeroBadge(props: { label: string; value: string; toneClass: string }) {
  return (
    <div className="rounded-[1.5rem] border border-white/10 bg-white/10 p-5">
      <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-300">{props.label}</p>
      <div className="mt-3">
        <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.18em] ${props.toneClass}`}>{props.value}</span>
      </div>
    </div>
  );
}

function HeroInfo(props: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-[1.5rem] border border-white/10 bg-white/10 p-5">
      <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-300">{props.label}</p>
      <p className="mt-3 text-lg font-black">{props.value}</p>
      <p className="mt-1 text-xs text-slate-300">{props.note}</p>
    </div>
  );
}

function KpiCard(props: { label: string; value: string | number; note: string }) {
  return (
    <article className={`${card} p-5`}>
      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{props.label}</p>
      <p className="mt-3 text-3xl font-black text-slate-950">{props.value}</p>
      <p className="mt-1 text-xs text-slate-500">{props.note}</p>
    </article>
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

function Pill(props: { value: string; inverted?: boolean }) {
  const value = props.value.replace(/_/g, ' ');
  return <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${props.inverted ? 'bg-white/15 text-white' : tone(props.value)}`}>{value}</span>;
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{props.label}</p>
      <p className="mt-1 text-sm font-bold text-slate-900">{props.value}</p>
    </div>
  );
}

function MetricRow(props: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{props.label}</p>
      <p className="mt-1 text-sm text-slate-700">{props.value}</p>
    </div>
  );
}

function InfoBlock(props: { label: string; body: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{props.label}</p>
      <p className="mt-2 text-sm text-slate-700">{props.body}</p>
    </div>
  );
}

function EmptyState(props: { title: string; body: string }) {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 p-6">
      <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-900">{props.title}</h3>
      <p className="mt-2 text-sm text-slate-500">{props.body}</p>
    </div>
  );
}

function DraftColumn(props: {
  title: string;
  drafts: ListingDraft[];
  inventory: InventoryPayload;
  busyAction: BusyAction;
  onApprove?: (draftId: string) => Promise<void>;
  onReject?: (draftId: string) => Promise<void>;
  onPublish?: (draftId: string) => Promise<void>;
  onRefine?: (draft: ListingDraft) => Promise<void>;
}) {
  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-black text-slate-950">{props.title}</h3>
        <span className="rounded-full bg-white px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-slate-700">{props.drafts.length}</span>
      </div>
      <div className="mt-4 space-y-3">
        {props.drafts.length === 0 && <p className="text-sm text-slate-500">No drafts in this bucket.</p>}
        {props.drafts.map((draft) => {
          const candidate = props.inventory.candidates.find((item) => item.id === draft.candidateId);
          return (
            <div key={draft.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex gap-3">
                <img src={candidate?.imageUrl || draft.images[0] || 'https://placehold.co/160x160?text=Draft'} alt={draft.title} className="h-16 w-16 rounded-2xl object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-black text-slate-950">{draft.overallScore ?? '--'}</span>
                    <Pill value={draft.status} />
                    <Pill value={draft.validationStatus} />
                  </div>
                  <h4 className="mt-2 text-sm font-bold text-slate-900">{draft.title}</h4>
                  <p className="mt-1 text-xs text-slate-500">{draft.sellerSku}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                    <p>Price {currency(draft.price)}</p>
                    <p>Margin {formatPct(candidate?.scoreBreakdown?.netMarginPercent)}</p>
                  </div>
                  {draft.warningMessages[0] && <p className="mt-2 text-xs text-amber-700">{draft.warningMessages[0]}</p>}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {props.onRefine && draft.status === 'needs_review' && (
                  <button
                    onClick={() => props.onRefine?.(draft)}
                    disabled={props.busyAction !== null}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-700 disabled:opacity-60"
                  >
                    Refine Draft
                  </button>
                )}
                {props.onApprove && draft.status === 'needs_review' && (
                  <button
                    onClick={() => props.onApprove?.(draft.id)}
                    disabled={props.busyAction !== null}
                    className="rounded-2xl bg-blue-600 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
                  >
                    Approve & Queue Publish
                  </button>
                )}
                {props.onReject && draft.status === 'needs_review' && (
                  <button
                    onClick={() => props.onReject?.(draft.id)}
                    disabled={props.busyAction !== null}
                    className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-rose-700 disabled:opacity-60"
                  >
                    Reject
                  </button>
                )}
                {props.onPublish && draft.status === 'ready_to_publish' && (
                  <button
                    onClick={() => props.onPublish?.(draft.id)}
                    disabled={props.busyAction !== null}
                    className="rounded-2xl bg-slate-950 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
                  >
                    Confirm Live Publish
                  </button>
                )}
                {draft.openInEbayUrl && (
                  <a href={draft.openInEbayUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-700">
                    Open in eBay
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CandidateGroup(props: { title: string; items: ProductCandidate[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-lg font-black text-slate-950">{props.title}</h3>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-slate-700">{props.items.length}</span>
      </div>
      <div className="space-y-3">
        {props.items.slice(0, 10).map((candidate) => (
          <button
            key={candidate.id}
            onClick={() => props.onSelect(candidate.id)}
            className={`w-full rounded-[1.5rem] border px-4 py-4 text-left transition ${
              props.selectedId === candidate.id ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
            }`}
          >
            <div className="flex items-start gap-3">
              <img src={candidate.imageUrl} alt={candidate.title} className="h-14 w-14 rounded-2xl object-cover" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-xl font-black ${props.selectedId === candidate.id ? 'text-white' : decisionTone(candidate)}`}>{candidate.scoreBreakdown?.totalScore ?? '--'}</span>
                  <Pill value={candidate.status} inverted={props.selectedId === candidate.id} />
                </div>
                <p className="mt-2 line-clamp-2 text-sm font-bold">{candidate.title}</p>
                <p className={`mt-1 text-xs ${props.selectedId === candidate.id ? 'text-slate-300' : 'text-slate-500'}`}>{currency(candidate.landedCost)} / ETA {candidate.estimatedDeliveryBusinessDays}d / margin {formatPct(candidate.scoreBreakdown?.netMarginPercent)}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatBubble(props: { key?: string; sender: string; message: string; meta: string }) {
  const outbound = props.sender === 'owner' || props.sender === 'ceo';
  return (
    <div className={`rounded-[1.4rem] border p-4 ${outbound ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-900'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-[11px] font-black uppercase tracking-[0.18em] ${outbound ? 'text-blue-200' : 'text-slate-400'}`}>{props.sender}</span>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${outbound ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-700'}`}>{props.meta}</span>
      </div>
      <p className={`mt-3 text-sm ${outbound ? 'text-slate-100' : 'text-slate-700'}`}>{props.message}</p>
    </div>
  );
}

function ListBlock(props: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{props.title}</p>
      <div className="mt-3 space-y-2">
        {props.items.map((item) => (
          <p key={item} className="text-sm text-slate-700">
            - {item}
          </p>
        ))}
      </div>
    </div>
  );
}
