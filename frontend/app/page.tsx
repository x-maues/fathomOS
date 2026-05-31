import Link from 'next/link';
import { Terminal, Database, Activity, ShieldAlert, Code, Server, ArrowRight } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#030303] text-slate-300 font-sans selection:bg-emerald-500/30 flex flex-col items-center justify-center relative overflow-hidden">
      
      {/* Background glow effects */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-900/10 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-emerald-900/10 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="relative z-10 max-w-4xl w-full px-6 flex flex-col items-center text-center">
        
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#0a1a0f] border border-emerald-900/50 mb-8 animate-fade-in-up">
          <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse"></div>
          <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400 font-semibold">Coral SQL Engine Linked</span>
        </div>

        {/* Hero Text */}
        <h1 className="text-6xl md:text-8xl font-bold tracking-tighter text-white mb-6">
          fathom<span className="text-emerald-500">OS</span>
        </h1>
        
        <p className="text-xl md:text-2xl text-slate-400 font-light max-w-2xl mb-4 leading-relaxed">
          The <span className="text-white font-medium">Cursor</span> for Site Reliability Engineers.
        </p>

        <p className="text-sm text-slate-500 max-w-xl mb-12 font-mono leading-relaxed">
          Stop chatting with black-box bots. Start querying your operational reality. fathomOS translates intent into highly-optimized <span className="text-emerald-400/80">Coral SQL</span>, correlating Datadog, Sentry, PagerDuty, and GitHub instantly.
        </p>

        {/* CTA Button */}
        <Link 
          href="/investigate"
          className="group relative inline-flex items-center gap-3 px-8 py-4 bg-white text-black font-semibold rounded hover:bg-emerald-50 transition-all duration-300 hover:scale-105 hover:shadow-[0_0_30px_rgba(16,185,129,0.3)]"
        >
          <Terminal className="w-5 h-5" />
          <span>Launch Workspace</span>
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </Link>

        {/* Integration Icons */}
        <div className="mt-24 pt-8 border-t border-[#1a1a1a] w-full flex flex-col items-center">
          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-600 mb-6">Zero-ETL Integrations</p>
          <div className="flex flex-wrap justify-center gap-8 opacity-50 grayscale hover:grayscale-0 transition-all duration-500">
             <div className="flex items-center gap-2 text-red-500"><ShieldAlert className="w-5 h-5"/> <span className="font-semibold text-sm">PagerDuty</span></div>
             <div className="flex items-center gap-2 text-orange-500"><Activity className="w-5 h-5"/> <span className="font-semibold text-sm">Sentry</span></div>
             <div className="flex items-center gap-2 text-blue-500"><Activity className="w-5 h-5"/> <span className="font-semibold text-sm">Datadog</span></div>
             <div className="flex items-center gap-2 text-purple-500"><Code className="w-5 h-5"/> <span className="font-semibold text-sm">GitHub</span></div>
             <div className="flex items-center gap-2 text-emerald-500"><Server className="w-5 h-5"/> <span className="font-semibold text-sm">StatusGator</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
