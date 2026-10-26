import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Globe, MessageSquare, AudioLines, Lock, Package, Workflow, Zap, AlarmClock,
  Gem, FileText, BookOpen, Brain, Cpu, ListChecks, Gauge, ShieldCheck, Target, Laptop, Puzzle, KeyRound,
} from 'lucide-react';
import { api, stream } from './api.js';
import Aurora from './components/Aurora.jsx';
import TopBar from './components/TopBar.jsx';
import CatchUpBanner from './components/CatchUpBanner.jsx';
import Layer from './components/Layer.jsx';
import VoiceCard from './components/VoiceCard.jsx';
import ChatView from './components/ChatView.jsx';
import BriefPanel from './components/BriefPanel.jsx';
import SkillsPanel from './components/SkillsPanel.jsx';
import JobPanel from './components/JobPanel.jsx';
import HistoryPanel from './components/HistoryPanel.jsx';
import VaultPanel from './components/VaultPanel.jsx';
import MemoryFlow from './components/MemoryFlow.jsx';
import EngineCard from './components/EngineCard.jsx';
import UsagePanel from './components/UsagePanel.jsx';
import { FileViewer, Panel } from './components/ui.jsx';
import { clock } from './util.js';

export default function App() {
  const [status, setStatus] = useState(null);
  const [fatal, setFatal] = useState(null);
  const [skills, setSkills] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [auto, setAuto] = useState({ automations: [], pending: [] });
  const [runs, setRuns] = useState([]);
  const [brief, setBrief] = useState(null);
  const [vault, setVault] = useState(null);
  const [usage, setUsage] = useState(null);
  const [mcp, setMcp] = useState(null);
  const [mcpToday, setMcpToday] = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);
  const [openFile, setOpenFile] = useState(null);
  const [messages, setMessages] = useState([]);
  const timer = useRef(null);

  const refresh = useCallback(async () => {
    const results = await Promise.allSettled([
      api('/jobs?limit=50').then((r) => setJobs(r.jobs)),
      api('/automations').then(setAuto),
      api('/automations/runs?limit=50').then((r) => setRuns(r.runs)),
      api('/brief/latest').then((r) => setBrief(r.brief)),
      api('/vault/stats').then(setVault),
      api('/usage').then(setUsage),
    ]);
    if (results.some((r) => r.status === 'rejected' && r.reason?.status === 401)) {
      setFatal('This page is missing its local token. Open the address printed in Terminal (http://127.0.0.1:…).');
    }
  }, []);

  const refreshSoon = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(refresh, 250);
  }, [refresh]);

  useEffect(() => {
    api('/status').then(setStatus).catch((e) => setFatal(e.status === 401 ? 'This page is missing its local token. Open the address printed in Terminal (http://127.0.0.1:…).' : `Can’t reach the Agentic OS backend: ${e.message}`));
    api('/skills').then((r) => setSkills(r.skills)).catch(() => {});
    refresh();
    const t1 = setTimeout(() => api('/status').then(setStatus).catch(() => {}), 4000);
    api('/mcp/status').then((s) => { setMcp(s); if (s.configured) api('/mcp/today').then(setMcpToday).catch(() => {}); else setMcpToday({ configured: false }); }).catch(() => {});
    const close = stream('/events', () => refreshSoon());
    const poll = setInterval(refresh, 60000);
    return () => { clearTimeout(t1); close(); clearInterval(poll); };
  }, [refresh, refreshSoon]);

  useEffect(() => {
    if (!selectedJob) {
      const live = jobs.find((j) => ['running', 'queued', 'paused_limit'].includes(j.status));
      if (live) setSelectedJob(live.id);
    }
  }, [jobs, selectedJob]);

  const claudeReady = status?.claude?.installed !== false && status?.claude?.loggedIn !== false;
  const selectJob = (id) => { setSelectedJob(id); refreshSoon(); };
  const morning = auto.automations.find((a) => a.id === 'morning-brief');
  const enabledAutos = auto.automations.filter((a) => a.enabled).length;
  const today = usage?.today;
  const cloud = status?.access?.mode === 'cloud';

  return (
    <>
      <Aurora />
      <main className="relative z-10 mx-auto flex max-w-[1500px] flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8">
        <TopBar status={status} mcp={mcp} />
        {fatal && <div className="glass px-5 py-4 text-[14px] text-rose-200">{fatal}</div>}
        <CatchUpBanner pending={auto.pending} automations={auto.automations} onChanged={refresh} onJob={selectJob} />

        <div className="flex flex-col">
          {/* ---------------- Layer 4: Access ---------------- */}
          <Layer
            n={4}
            label={['Access', 'Layer']}
            color="violet"
            title="Dashboard / Command Center"
            description={`A beautiful interface for you: talk, chat, read today’s brief. No terminal required${cloud ? ' — from any of your Tailscale devices.' : '.'}`}
            features={[
              { icon: Globe, label: 'Web dashboard', value: status ? status.access.origin.replace(/^https?:\/\//, '') : null },
              { icon: AudioLines, label: 'Voice', value: status?.voice.enabled ? 'on' : 'not configured' },
              { icon: MessageSquare, label: 'Chat', value: status?.tier2.enabled ? 'quick chat on' : 'local + skills' },
              { icon: Lock, label: 'Access', value: cloud ? 'your Tailscale devices' : 'this Mac only' },
            ]}
          >
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <div className="lg:col-span-4"><VoiceCard status={status} setMessages={setMessages} /></div>
              <div className="lg:col-span-4">
                <Panel title="Chat" icon={MessageSquare} className="h-full min-h-[480px]">
                  <div className="flex min-h-0 flex-1"><ChatView messages={messages} setMessages={setMessages} onJob={selectJob} tier2Enabled={status?.tier2.enabled} /></div>
                </Panel>
              </div>
              <div className="lg:col-span-4"><BriefPanel brief={brief} automations={auto.automations} mcpToday={mcpToday} onJob={selectJob} /></div>
            </div>
          </Layer>

          {/* ---------------- Layer 3: Automation ---------------- */}
          <Layer
            n={3}
            label={['Automation', 'Layer']}
            color="green"
            title="Skills + Automations"
            description="Turn prompts into repeatable workflows and scheduled automations. Every run streams here live."
            features={[
              { icon: Package, label: 'Skill packs', value: skills.length || null },
              { icon: Workflow, label: 'Workflows', value: jobs.filter((j) => j.status === 'running').length ? 'running now' : 'idle' },
              { icon: Zap, label: 'Automations', value: `${enabledAutos} on${morning?.nextRun ? ` · next ${clock(morning.nextRun)}` : ''}` },
              { icon: AlarmClock, label: 'Missed runs', value: auto.pending.length || 'none' },
            ]}
          >
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <div className="lg:col-span-5"><SkillsPanel skills={skills} claudeReady={claudeReady} onJob={selectJob} /></div>
              <div className="lg:col-span-4"><JobPanel jobId={selectedJob} onOpenFile={setOpenFile} onChanged={refresh} /></div>
              <div className="lg:col-span-3"><HistoryPanel mode="automations" jobs={jobs} runs={runs} automations={auto.automations} selectedId={selectedJob} onSelect={selectJob} onOpenFile={setOpenFile} /></div>
            </div>
          </Layer>

          {/* ---------------- Layer 2: Memory ---------------- */}
          <Layer
            n={2}
            label={['Memory', 'Layer']}
            color="blue"
            title="Memory Layer (Obsidian Vault)"
            description="A simple Markdown vault, not an overbuilt RAG system. Claude reads, writes and remembers over time."
            features={[
              { icon: Gem, label: 'Obsidian vault', value: status?.vault.name },
              { icon: FileText, label: 'Markdown files', value: vault ? vault.totalNotes : null },
              { icon: BookOpen, label: 'Decisions & context', value: vault?.roots.wiki.exists ? `${vault.roots.wiki.notes} wiki notes` : null },
              { icon: Brain, label: 'Long-term memory', value: vault ? `${vault.addedThisWeek} changed this week` : null },
            ]}
          >
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <div className="lg:col-span-4"><VaultPanel stats={vault} vaultName={status?.vault.name} onOpenFile={setOpenFile} /></div>
              <div className="lg:col-span-8"><MemoryFlow stats={vault} /></div>
            </div>
          </Layer>

          {/* ---------------- Layer 1: Execution engine ---------------- */}
          <Layer
            n={1}
            label={['Execution', 'Engine']}
            color="orange"
            connector={false}
            title="Claude Code (Engine)"
            description="The core engine that reasons, researches, writes and gets things done — through your Claude login, within the limits you set."
            features={[
              { icon: Brain, label: 'Reasoning' },
              { icon: ListChecks, label: 'Task execution', value: today ? `${today.claude.runs} runs today` : null },
              { icon: Cpu, label: 'Multi-step workflows', value: today ? `${today.claude.turns} turns today` : null },
              { icon: ShieldCheck, label: 'Scoped permissions' },
            ]}
          >
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <div className="lg:col-span-4"><EngineCard status={status} jobs={jobs} /></div>
              <div className="lg:col-span-5"><HistoryPanel mode="jobs" jobs={jobs} runs={runs} automations={auto.automations} selectedId={selectedJob} onSelect={selectJob} onOpenFile={setOpenFile} /></div>
              <div className="lg:col-span-3"><UsagePanel usage={usage} /></div>
            </div>
          </Layer>
        </div>

        {auto.loadError && <p className="text-[12.5px] text-amber-200/80">automations.config.json has a problem: {auto.loadError}</p>}

        <footer className="glass grid grid-cols-1 items-center overflow-hidden md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="flex items-center gap-4 p-5">
            <Target size={44} className="shrink-0 text-sky-400" strokeWidth={1.6} aria-hidden="true" />
            <div>
              <p className="font-display text-[16px] font-semibold uppercase tracking-wide">Built for you — runs on {cloud ? 'your own server' : 'this Mac'}</p>
              <p className="text-[14px] text-sky-300">One system. Your files. Your rules.</p>
            </div>
          </div>
          {[[Laptop, cloud ? 'Always on' : 'Local'], [Puzzle, 'Extensible'], [KeyRound, 'Private']].map(([Icon, l]) => (
            <div key={l} className="flex flex-col items-center gap-1.5 border-t border-white/[0.07] p-4 md:border-l md:border-t-0">
              <Icon size={28} className="text-sky-400" strokeWidth={1.6} aria-hidden="true" />
              <span className="text-[13.5px] text-white/80">{l}</span>
            </div>
          ))}
        </footer>
        <p className="pb-2 text-center text-[11.5px] text-white/30">
          {cloud
            ? 'Runs on your own server, reachable only from your Tailscale devices. Your vault syncs through your private Git repo; skill prompts and file contents are sent to Anthropic/OpenAI when a skill or voice runs.'
            : 'Runs only on this Mac (127.0.0.1). Your vault and data stay local; skill prompts and file contents are sent to Anthropic/OpenAI when a skill or voice runs.'}
        </p>
      </main>
      <FileViewer path={openFile} onClose={() => setOpenFile(null)} />
    </>
  );
}
