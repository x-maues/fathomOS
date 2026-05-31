"use client";

import { useState, useRef, useEffect } from "react";
import {
  Terminal, Database, Code, Activity, Play, CornerDownRight,
  ShieldAlert, Zap, Server, FileJson, Clock, CheckCircle2, ChevronRight, ToggleLeft, ToggleRight,
  AlertTriangle, GitMerge, ListChecks, Radio, TrendingUp
} from "lucide-react";

type TimelineEvent = {
  time: string;
  source: 'sentry' | 'pagerduty' | 'github' | 'datadog' | 'statusgator';
  label: string;
  id: string;
};

type Analysis = {
  hypothesis: string;
  confidence: number;
  key_evidence: { source: string; id: string; detail: string }[];
  immediate_actions: string[];
  comms_draft: string;
};

type InvestigationEvent = {
  id: string;
  type: 'system' | 'user_command' | 'ai_proposed_query' | 'execution_result' | 'ai_synthesis';
  timestamp: string;
  content?: string;
  sql?: string;
  evolutionReason?: string;
  resultsCount?: number;
  synthesis?: Analysis;
};

export default function Home() {
  // Sidebar Context State
  const [title, setTitle] = useState("");
  const [service, setService] = useState("auth-service");
  const [severity, setSeverity] = useState("SEV-1");
  const [description, setDescription] = useState("");
  const [investigationActive, setInvestigationActive] = useState(false);

  // Execution Toggle
  const [autoExecute, setAutoExecute] = useState(false);

  // IDE Workspace State
  const [events, setEvents] = useState<InvestigationEvent[]>([]);
  const [currentSql, setCurrentSql] = useState("");
  const [currentData, setCurrentData] = useState<any[] | null>(null);
  const [currentTimeline, setCurrentTimeline] = useState<TimelineEvent[]>([]);
  const [commandInput, setCommandInput] = useState("");

  // Loading States
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  // Layout Dimensions State
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [timelineWidth, setTimelineWidth] = useState(400);
  const [editorHeight, setEditorHeight] = useState(280);

  const isDraggingRef = useRef<'sidebar' | 'timeline' | 'editor' | null>(null);
  const timelineEndRef = useRef<HTMLDivElement>(null);

  // Resizing Logic
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;

      if (isDraggingRef.current === 'sidebar') {
        const newWidth = Math.max(200, Math.min(e.clientX, 500));
        setSidebarWidth(newWidth);
      } else if (isDraggingRef.current === 'timeline') {
        const newWidth = Math.max(300, Math.min(e.clientX - sidebarWidth, 800));
        setTimelineWidth(newWidth);
      } else if (isDraggingRef.current === 'editor') {
        const newHeight = Math.max(150, Math.min(e.clientY - 48, window.innerHeight - 200));
        setEditorHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      isDraggingRef.current = null;
      document.body.style.cursor = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [sidebarWidth]);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  const addEvent = (event: Omit<InvestigationEvent, 'id' | 'timestamp'>) => {
    setEvents(prev => [...prev, {
      ...event,
      id: Math.random().toString(36).substring(7),
      timestamp: new Date().toLocaleTimeString([], { hour12: false })
    }]);
  };

  const handleStartInvestigation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !description) return;

    setInvestigationActive(true);
    addEvent({ type: 'system', content: `Investigation initialized for: ${title}` });

    await generateSql(`Context: ${description}`);
  };

  const handleFollowUpCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim() || isGenerating) return;

    const cmd = commandInput;
    setCommandInput("");
    addEvent({ type: 'user_command', content: cmd });

    await generateSql(cmd);
  };

  const generateSql = async (contextPrompt: string) => {
    setIsGenerating(true);
    try {
      const response = await fetch("http://localhost:8000/api/generate-sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incident_title: title,
          description: contextPrompt,
          service: service || undefined,
          severity: severity || undefined,
          previous_sql: currentSql || undefined
        }),
      });

      const data = await response.json();
      if (data.status === "success") {
        setCurrentSql(data.sql_query);
        addEvent({
          type: 'ai_proposed_query',
          content: "fathomOS proposed a Coral SQL query.",
          sql: data.sql_query,
          evolutionReason: data.evolution_reason
        });

        // Auto-Execute flow
        if (autoExecute) {
          await executeSqlDirectly(data.sql_query);
        }
      } else {
        addEvent({ type: 'system', content: `Error generating SQL: ${data.error}` });
      }
    } catch (err) {
      addEvent({ type: 'system', content: "Connection failed to fathomOS backend." });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExecute = async () => {
    await executeSqlDirectly(currentSql);
  };

  const executeSqlDirectly = async (sqlToRun: string) => {
    if (!sqlToRun.trim()) return;

    setIsExecuting(true);
    addEvent({ type: 'system', content: "Executing Coral query..." });

    try {
      const response = await fetch("http://localhost:8000/api/execute-investigation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incident_title: title,
          service: service || undefined,
          severity: severity || undefined,
          sql_query: sqlToRun
        }),
      });

      const data = await response.json();

      if (data.status === "success") {
        setCurrentData(data.raw_data_found);
        if (Array.isArray(data.timeline)) setCurrentTimeline(data.timeline);
        if (Array.isArray(data.stage_sql) && data.stage_sql.length > 0) {
          addEvent({
            type: 'system',
            content: `Investigation stages: ${data.stage_sql.map((s: any) => s.name).join(" → ")}`
          });
        }
        addEvent({
          type: 'execution_result',
          content: `Coral query executed successfully.`,
          resultsCount: data.row_count ?? (Array.isArray(data.raw_data_found) ? data.raw_data_found.length : 0)
        });

        if (data.analysis) {
          addEvent({
            type: 'ai_synthesis',
            synthesis: data.analysis
          });
        }
      } else {
        addEvent({ type: 'system', content: `Execution Error: ${data.error}` });
      }
    } catch (err) {
      addEvent({ type: 'system', content: "Connection failed during execution." });
    } finally {
      setIsExecuting(false);
    }
  };

  // Helper to render operational cards
  const renderEvidenceRow = (row: any, i: number) => {
    const hasPagerDuty = 'incident_number' in row || 'urgency' in row || 'pagerduty_title' in row || 'incident_title' in row;
    const hasSentry = 'issue_id' in row || 'level' in row || 'sentry_error' in row || 'sentry_issue_id' in row || 'sentry_error_message' in row;
    const hasGitHub = 'pr_number' in row || 'merged_at' in row || 'github_pr_title' in row || 'github_pr_number' in row || 'github_pr_merged_at' in row;
    const hasDatadog = 'metric_id' in row || 'metric_name' in row || 'value' in row || 'datadog_metric' in row;
    const hasStatusGator = 'status_id' in row || 'provider_name' in row || 'status' in row || 'provider_status' in row;

    if (!hasPagerDuty && !hasSentry && !hasGitHub && !hasDatadog && !hasStatusGator) {
      // Fallback generic view
      return (
        <div key={i} className="mb-3 bg-[#0a0a0a] border border-[#1a1a1a] rounded p-3">
          <pre className="text-[11px] font-mono text-slate-400 whitespace-pre-wrap">{JSON.stringify(row, null, 2)}</pre>
        </div>
      );
    }

    return (
      <div key={i} className="flex flex-col xl:flex-row gap-4 mb-4 flex-wrap">
        {hasPagerDuty && (
          <div className="flex-1 min-w-[250px] bg-[#0a0a0a] border border-[#1a1a1a] hover:border-[#333] transition-colors rounded p-3">
            <div className="text-[10px] uppercase text-red-500 font-mono mb-1.5 tracking-widest font-semibold flex items-center gap-1.5 truncate"><ShieldAlert className="w-3 h-3 shrink-0" /> PagerDuty</div>
            <div className="text-[13px] text-slate-200 font-semibold mb-1 truncate">{row.pagerduty_title || row.incident_title || row.title || "Alert"}</div>
            {row.incident_number && <div className="text-[11px] text-slate-400 font-mono truncate">ID: #{row.incident_number}</div>}
            {row.urgency && <div className="text-[11px] text-slate-400 font-mono mt-0.5 truncate">Urgency: {row.urgency}</div>}
          </div>
        )}
        {hasSentry && (
          <div className="flex-1 min-w-[250px] bg-[#0a0a0a] border border-[#1a1a1a] hover:border-[#333] transition-colors rounded p-3">
            <div className="text-[10px] uppercase text-orange-500 font-mono mb-1.5 tracking-widest font-semibold flex items-center gap-1.5 truncate"><Activity className="w-3 h-3 shrink-0" /> Sentry</div>
            <div className="text-[13px] text-slate-200 font-semibold mb-1 truncate">{row.sentry_error_message || row.sentry_error || row.error_message || "Exception"}</div>
            {row.level && <div className="text-[11px] text-slate-400 font-mono uppercase truncate">Level: {row.level}</div>}
            {(row.issue_id || row.sentry_issue_id) && <div className="text-[11px] text-slate-400 font-mono mt-0.5 truncate">Issue: {row.issue_id || row.sentry_issue_id}</div>}
          </div>
        )}
        {hasGitHub && (
          <div className="flex-1 min-w-[250px] bg-[#0a0a0a] border border-[#1a1a1a] hover:border-[#333] transition-colors rounded p-3">
            <div className="text-[10px] uppercase text-purple-500 font-mono mb-1.5 tracking-widest font-semibold flex items-center gap-1.5 truncate"><Code className="w-3 h-3 shrink-0" /> GitHub</div>
            <div className="text-[13px] text-slate-200 font-semibold mb-1 truncate">{row.github_pr_title || row.title || "Pull Request"}</div>
            {(row.pr_number || row.github_pr_number) && <div className="text-[11px] text-slate-400 font-mono truncate">PR #{row.pr_number || row.github_pr_number}</div>}
            {(row.merged_at || row.github_pr_merged_at) && <div className="text-[11px] text-slate-400 font-mono mt-0.5 truncate">Merged: {row.merged_at || row.github_pr_merged_at}</div>}
          </div>
        )}
        {hasDatadog && (
          <div className="flex-1 min-w-[250px] bg-[#0a0a0a] border border-[#1a1a1a] hover:border-[#333] transition-colors rounded p-3">
            <div className="text-[10px] uppercase text-blue-500 font-mono mb-1.5 tracking-widest font-semibold flex items-center gap-1.5 truncate"><Activity className="w-3 h-3 shrink-0" /> Datadog</div>
            <div className="text-[13px] text-slate-200 font-semibold mb-1 truncate">{row.metric_name || "Metric Anomaly"}</div>
            {row.value !== undefined && <div className="text-[11px] text-slate-400 font-mono truncate">Value: {row.value}</div>}
            {row.timestamp && <div className="text-[11px] text-slate-400 font-mono mt-0.5 truncate">Time: {row.timestamp}</div>}
          </div>
        )}
        {hasStatusGator && (
          <div className="flex-1 min-w-[250px] bg-[#0a0a0a] border border-[#1a1a1a] hover:border-[#333] transition-colors rounded p-3">
            <div className="text-[10px] uppercase text-emerald-500 font-mono mb-1.5 tracking-widest font-semibold flex items-center gap-1.5 truncate"><Server className="w-3 h-3 shrink-0" /> StatusGator</div>
            <div className="text-[13px] text-slate-200 font-semibold mb-1 truncate">{row.provider_name || "Provider"}</div>
            {(row.status || row.provider_status) && <div className="text-[11px] text-slate-400 font-mono uppercase truncate">Status: {row.status || row.provider_status}</div>}
            {(row.reported_at || row.provider_reported_at) && <div className="text-[11px] text-slate-400 font-mono mt-0.5 truncate">Reported: {row.reported_at || row.provider_reported_at}</div>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-screen w-screen bg-[#030303] text-slate-300 font-sans selection:bg-emerald-500/30 flex flex-col overflow-hidden">

      {/* GLOBAL HEADER */}
      <header className="h-12 border-b border-[#1a1a1a] bg-[#050505] flex items-center px-4 shrink-0 justify-between">
        <div className="flex items-center gap-3">
          <Terminal className="w-4 h-4 text-emerald-500" />
          <h1 className="text-sm font-semibold tracking-wide text-slate-200">fathom OS</h1>
          <div className="h-3 w-[1px] bg-[#333] mx-2"></div>
          <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
            Coral Engine Linked
          </span>
        </div>
      </header>

      {/* 3-PANE WORKSPACE */}
      <div className="flex-1 flex min-h-0">

        {/* LEFT PANE: Metadata */}
        <div
          className="bg-[#050505] flex flex-col shrink-0 overflow-hidden"
          style={{ width: `${sidebarWidth}px` }}
        >
          <div className="p-4 border-b border-[#1a1a1a]">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">Context Details</h2>

            <form onSubmit={handleStartInvestigation} className="space-y-4">
              <div>
                <label className="block text-[10px] font-mono text-slate-500 mb-1.5 uppercase tracking-wider">Severity</label>
                <select
                  value={severity} onChange={e => setSeverity(e.target.value)}
                  disabled={investigationActive}
                  className="w-full bg-[#0a0a0a] border border-[#222] rounded p-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                >
                  <option>SEV-1</option>
                  <option>SEV-2</option>
                  <option>SEV-3</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-mono text-slate-500 mb-1.5 uppercase tracking-wider">Service</label>
                <input
                  value={service} onChange={e => setService(e.target.value)} disabled={investigationActive}
                  className="w-full bg-[#0a0a0a] border border-[#222] rounded p-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono text-slate-500 mb-1.5 uppercase tracking-wider">Incident Title</label>
                <input
                  value={title} onChange={e => setTitle(e.target.value)} required disabled={investigationActive}
                  className="w-full bg-[#0a0a0a] border border-[#222] rounded p-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono text-slate-500 mb-1.5 uppercase tracking-wider">Initial Logs/Context</label>
                <textarea
                  value={description} onChange={e => setDescription(e.target.value)} required disabled={investigationActive}
                  rows={4}
                  className="w-full bg-[#0a0a0a] border border-[#222] rounded p-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 resize-none font-mono custom-scrollbar"
                />
              </div>

              {!investigationActive && (
                <button type="submit" className="w-full bg-slate-200 hover:bg-white text-black font-semibold text-xs py-2 rounded transition-colors flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(255,255,255,0.1)]">
                  Launch Investigation <Play className="w-3 h-3" />
                </button>
              )}
            </form>
          </div>

          <div className="p-4 flex-1 flex flex-col justify-start overflow-hidden">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4 shrink-0">Status</h2>
            <div className="flex items-center gap-2 text-xs text-emerald-500 mb-6 font-mono shrink-0">
              <Activity className="w-3 h-3" /> {investigationActive ? "Active" : "Idle"}
            </div>

            {/* Execution Toggle - Moved UP to be immediately visible under status */}
            <div className={`border rounded p-3 transition-colors shrink-0 ${autoExecute ? 'bg-[#0a1a0f] border-emerald-900/50' : 'bg-[#0a0a0a] border-[#1a1a1a]'}`}>
              <h3 className="text-[10px] font-mono text-slate-500 mb-2 uppercase tracking-wider">Query Execution</h3>
              <button
                onClick={() => setAutoExecute(!autoExecute)}
                className="flex items-center gap-2 text-xs font-semibold w-full text-slate-300 hover:text-white transition-colors"
              >
                {autoExecute ? (
                  <><ToggleRight className="w-5 h-5 text-emerald-500" /> <span className="text-emerald-400">Auto Execute ON</span></>
                ) : (
                  <><ToggleLeft className="w-5 h-5 text-slate-500" /> Manual Review</>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* SPLITTER 1 (Sidebar / Timeline) */}
        <div
          className="w-1 bg-[#1a1a1a] hover:bg-emerald-500/50 cursor-col-resize shrink-0 transition-colors"
          onMouseDown={() => {
            isDraggingRef.current = 'sidebar';
            document.body.style.cursor = 'col-resize';
          }}
        />

        {/* CENTER PANE: Timeline Log */}
        <div
          className="flex flex-col bg-[#080808] shrink-0 overflow-hidden"
          style={{ width: `${timelineWidth}px` }}
        >
          <div className="h-10 border-b border-[#1a1a1a] bg-[#050505] flex items-center px-4 shrink-0">
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-400 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5" /> Operational Log
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-4">
            {events.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-slate-600 font-mono text-xs text-center opacity-50">
                <Server className="w-8 h-8 mb-3 opacity-20" />
                Awaiting operator initialization.
              </div>
            )}

            {events.map((evt) => (
              <div key={evt.id} className="flex gap-3 text-sm animate-slide-up">
                <div className="text-[10px] text-slate-500 font-mono pt-0.5 shrink-0 w-12 text-right">
                  {evt.timestamp}
                </div>

                <div className="flex-1 overflow-hidden">
                  {evt.type === 'system' && (
                    <span className="text-slate-500 text-[11px] font-mono break-words">{evt.content}</span>
                  )}

                  {evt.type === 'user_command' && (
                    <div className="flex items-start gap-2 text-emerald-400 bg-[#0a0a0a] border border-[#1a1a1a] p-2 rounded">
                      <CornerDownRight className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-600" />
                      <span className="font-medium text-[12px] break-words">{evt.content}</span>
                    </div>
                  )}

                  {evt.type === 'ai_proposed_query' && (
                    <div className="bg-[#111] border border-[#222] rounded p-2">
                      <div className="flex items-center gap-1.5 text-purple-400 text-[11px] font-mono font-semibold mb-1">
                        <Zap className="w-3 h-3 shrink-0" /> Query Proposed
                      </div>
                      {evt.evolutionReason && (
                        <div className="text-[11px] text-slate-400 italic mb-1 border-l-2 border-[#333] pl-2 break-words">
                          "{evt.evolutionReason}"
                        </div>
                      )}
                    </div>
                  )}

                  {evt.type === 'execution_result' && (
                    <div className="flex items-center gap-1.5 text-blue-400 text-[11px] font-mono bg-[#050c14] border border-[#0a1a2e] p-2 rounded">
                      <CheckCircle2 className="w-3 h-3 shrink-0" />
                      Returned {evt.resultsCount} rows.
                    </div>
                  )}

                  {evt.type === 'ai_synthesis' && evt.synthesis && (
                    <div className="mt-1 space-y-2">
                      {/* Hypothesis + confidence */}
                      <div className="bg-[#1a150f] p-3 rounded border border-[#332211] border-l-2 border-l-orange-500 shadow-lg">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5 text-orange-500 text-[10px] font-bold uppercase tracking-wider">
                            <ShieldAlert className="w-3 h-3 shrink-0" /> Hypothesis
                          </div>
                          <div className="flex items-center gap-1.5">
                            <TrendingUp className="w-3 h-3 text-emerald-500" />
                            <span className={`text-[11px] font-mono font-bold ${
                              (evt.synthesis.confidence ?? 0) >= 80 ? 'text-emerald-400' :
                              (evt.synthesis.confidence ?? 0) >= 50 ? 'text-yellow-400' : 'text-red-400'
                            }`}>
                              {evt.synthesis.confidence ?? '?'}% confidence
                            </span>
                          </div>
                        </div>
                        <div className="text-slate-300 text-[12px] leading-relaxed break-words">
                          {evt.synthesis.hypothesis}
                        </div>
                      </div>

                      {/* Key Evidence */}
                      {evt.synthesis.key_evidence && evt.synthesis.key_evidence.length > 0 && (
                        <div className="bg-[#0a0f1a] p-3 rounded border border-[#0a1a2e]">
                          <div className="flex items-center gap-1.5 text-blue-400 text-[10px] font-bold uppercase tracking-wider mb-2">
                            <Database className="w-3 h-3 shrink-0" /> Key Evidence
                          </div>
                          <div className="space-y-1">
                            {evt.synthesis.key_evidence.map((e: any, i: number) => (
                              <div key={i} className="flex gap-2 text-[11px] font-mono">
                                <span className={`shrink-0 ${
                                  e.source === 'sentry' ? 'text-orange-400' :
                                  e.source === 'pagerduty' ? 'text-red-400' : 'text-purple-400'
                                }`}>[{e.source}]</span>
                                <span className="text-slate-400">{e.id}</span>
                                <span className="text-slate-500">—</span>
                                <span className="text-slate-300 break-words">{e.detail}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Immediate Actions */}
                      {evt.synthesis.immediate_actions && evt.synthesis.immediate_actions.length > 0 && (
                        <div className="bg-[#0f1a0a] p-3 rounded border border-[#1a3311]">
                          <div className="flex items-center gap-1.5 text-emerald-400 text-[10px] font-bold uppercase tracking-wider mb-2">
                            <ListChecks className="w-3 h-3 shrink-0" /> Immediate Actions
                          </div>
                          <ol className="space-y-1">
                            {evt.synthesis.immediate_actions.map((action: string, i: number) => (
                              <li key={i} className="flex gap-2 text-[11px] text-slate-300">
                                <span className="text-emerald-600 font-mono shrink-0">{i + 1}.</span>
                                <span className="break-words">{action}</span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}

                      {/* Comms Draft */}
                      {evt.synthesis.comms_draft && (
                        <div className="bg-[#0a0a0a] p-3 rounded border border-[#1a1a1a]">
                          <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-2">
                            <Radio className="w-3 h-3 shrink-0" /> Stakeholder Update
                          </div>
                          <div className="text-[11px] text-slate-400 italic leading-relaxed break-words">
                            "{evt.synthesis.comms_draft}"
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isGenerating && (
              <div className="flex gap-3 text-sm animate-pulse">
                <div className="text-[10px] text-slate-500 font-mono pt-0.5 shrink-0 w-12 text-right">...</div>
                <div className="flex-1 text-slate-500 text-[11px] font-mono">fathomOS computing...</div>
              </div>
            )}
            <div ref={timelineEndRef} />
          </div>

          {/* Follow-up Command Bar */}
          <div className="p-4 border-t border-[#1a1a1a] bg-[#050505] shrink-0">
            <form onSubmit={handleFollowUpCommand} className="relative flex items-center">
              <ChevronRight className="absolute left-3 w-4 h-4 text-emerald-500" />
              <input
                value={commandInput}
                onChange={e => setCommandInput(e.target.value)}
                placeholder={investigationActive ? "Filter for fatal errors..." : "Start investigation first"}
                disabled={!investigationActive || isGenerating || isExecuting}
                className="w-full bg-[#0a0a0a] border border-[#222] rounded-md py-2.5 pl-9 pr-4 text-[12px] text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors disabled:opacity-50 font-mono placeholder:font-sans shadow-inner"
              />
            </form>
          </div>
        </div>

        {/* SPLITTER 2 (Timeline / Right Workspace) */}
        <div
          className="w-1 bg-[#1a1a1a] hover:bg-emerald-500/50 cursor-col-resize shrink-0 transition-colors"
          onMouseDown={() => {
            isDraggingRef.current = 'timeline';
            document.body.style.cursor = 'col-resize';
          }}
        />

        {/* RIGHT PANE: Workspace (Editor + Bottom Evidence) */}
        <div className="flex-1 flex flex-col bg-[#050505] min-w-[300px] overflow-hidden">

          {/* SQL Editor Area (Secondary) */}
          <div
            className="flex flex-col shrink-0 bg-[#050505]"
            style={{ height: `${editorHeight}px` }}
          >
            <div className="h-10 border-b border-[#1a1a1a] bg-[#050505] flex items-center justify-between px-4 shrink-0">
              <span className="text-[10px] font-mono font-medium tracking-widest text-slate-500 flex items-center gap-2 uppercase">
                <Code className="w-3 h-3" /> Coral Query Editor
              </span>
              <button
                onClick={handleExecute}
                disabled={!currentSql.trim() || isExecuting}
                className="bg-emerald-600/10 text-emerald-500 hover:bg-emerald-600 hover:text-white border border-emerald-600/30 px-3 py-1 rounded text-[10px] font-bold uppercase tracking-widest transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isExecuting ? <Activity className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                Run Query
              </button>
            </div>

            <div className="flex-1 p-4 relative flex bg-[#030303] overflow-hidden">
              <textarea
                value={currentSql}
                onChange={e => setCurrentSql(e.target.value)}
                spellCheck={false}
                placeholder="-- SQL will appear here. Edit manually or command fathomOS to modify."
                className="flex-1 w-full h-full bg-transparent text-emerald-400/90 font-mono text-[13px] leading-relaxed resize-none focus:outline-none custom-scrollbar"
              />
            </div>
          </div>

          {/* SPLITTER 3 (Horizontal: Editor / Evidence) */}
          <div
            className="h-1 bg-[#1a1a1a] hover:bg-emerald-500/50 cursor-row-resize shrink-0 transition-colors"
            onMouseDown={() => {
              isDraggingRef.current = 'editor';
              document.body.style.cursor = 'row-resize';
            }}
          />

          {/* Incident Timeline (shown when data is available) */}
          {currentTimeline.length > 0 && (
            <div className="shrink-0 border-b border-[#1a1a1a] bg-[#050505]">
              <div className="h-9 border-b border-[#1a1a1a] flex items-center px-4">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                  <Clock className="w-3 h-3 text-yellow-500" /> Incident Timeline
                </span>
              </div>
              <div className="flex items-start gap-0 overflow-x-auto px-4 py-3 custom-scrollbar">
                {currentTimeline.map((evt, i) => (
                  <div key={evt.id + i} className="flex items-start shrink-0">
                    <div className="flex flex-col items-center w-[140px]">
                      <div
                        className={`w-2 h-2 rounded-full shrink-0 mt-1 ${
                          evt.source === 'sentry'
                            ? 'bg-orange-500'
                            : evt.source === 'pagerduty'
                              ? 'bg-red-500'
                              : evt.source === 'datadog'
                                ? 'bg-blue-500'
                                : evt.source === 'statusgator'
                                  ? 'bg-emerald-500'
                                  : 'bg-purple-500'
                        }`}
                      />
                      <div className="text-[9px] font-mono text-slate-500 mt-1 text-center">
                        {evt.time.substring(11, 16)}Z
                      </div>
                      <div
                        className={`text-[9px] uppercase font-bold mt-0.5 text-center ${
                          evt.source === 'sentry'
                            ? 'text-orange-500'
                            : evt.source === 'pagerduty'
                              ? 'text-red-500'
                              : evt.source === 'datadog'
                                ? 'text-blue-500'
                                : evt.source === 'statusgator'
                                  ? 'text-emerald-500'
                                  : 'text-purple-500'
                        }`}
                      >
                        {evt.source}
                      </div>
                      <div className="text-[10px] text-slate-300 text-center mt-0.5 px-1 leading-tight line-clamp-2" title={evt.label}>
                        {evt.label}
                      </div>
                    </div>
                    {i < currentTimeline.length - 1 && (
                      <div className="w-6 h-[1px] bg-[#2a2a2a] mt-2 shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Evidence Explorer (Primary) */}
          <div className="flex-1 flex flex-col bg-[#080808] overflow-hidden">
            <div className="h-10 border-b border-[#1a1a1a] bg-[#050505] flex items-center px-4 shrink-0">
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-200 flex items-center gap-2">
                <Database className="w-4 h-4 text-blue-500" /> Operational Evidence
              </span>
            </div>

            <div className="flex-1 overflow-auto p-6 custom-scrollbar bg-[#050505]">
              {!currentData ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-600 font-mono text-xs text-center opacity-50">
                  <FileJson className="w-6 h-6 mb-2 opacity-20" />
                  Execute a query to retrieve evidence cards.
                </div>
              ) : currentData.length === 0 ? (
                <div className="p-4 text-slate-400 font-mono text-xs border border-[#1a1a1a] rounded bg-[#0a0a0a]">Zero evidence found. Broaden the query.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {currentData.map((row, i) => renderEvidenceRow(row, i))}
                </div>
              )}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}