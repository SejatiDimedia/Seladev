import { Terminal, Shield, Cpu, RefreshCw, Key, Activity } from 'lucide-react';

export function App() {
  return (
    <div className="min-h-screen bg-[#09090b] text-[#fafafa] flex flex-col justify-between selection:bg-[#6366f1] selection:text-[#ffffff]">
      {/* Sleek Decorative Gradients */}
      <div className="absolute top-0 left-1/4 w-[500px] height-[500px] bg-[#6366f1] opacity-[0.05] blur-[120px] rounded-full pointer-events-none"></div>
      <div className="absolute bottom-0 right-1/4 w-[500px] height-[500px] bg-[#a855f7] opacity-[0.05] blur-[120px] rounded-full pointer-events-none"></div>

      {/* Header */}
      <header className="glass-panel sticky top-0 z-50 border-b border-white/5 py-4 px-6 md:px-12 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="bg-[#6366f1] p-2.5 rounded-xl shadow-lg shadow-indigo-500/20 flex items-center justify-center">
            <Cpu className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-white via-neutral-200 to-neutral-500 bg-clip-text text-transparent">SELADEV</span>
            <span className="text-[10px] uppercase font-bold tracking-widest text-[#6366f1] block leading-none">Control Plane</span>
          </div>
        </div>
        <div className="flex gap-4 items-center">
          <a
            href="https://seladev.dev"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-neutral-400 hover:text-white transition-colors"
          >
            Docs
          </a>
          <div className="h-4 w-px bg-white/10"></div>
          <span className="text-xs font-semibold px-2.5 py-1 bg-indigo-500/10 text-[#818cf8] border border-indigo-500/20 rounded-full flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
            Bootstrap Phase
          </span>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto w-full px-6 py-12 md:py-20 flex-grow flex flex-col justify-center gap-12">
        <div className="text-center max-w-3xl mx-auto space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/5 border border-white/10 rounded-full text-xs font-medium text-neutral-400">
            <Terminal className="w-3.5 h-3.5 text-indigo-400" />
            Monorepo Framework Bootstrapped Successfully
          </div>
          <h1 className="text-4xl md:text-6xl font-black tracking-tight leading-none bg-gradient-to-b from-white to-neutral-400 bg-clip-text text-transparent">
            Bridge Your Code & Cloud Deployments
          </h1>
          <p className="text-base md:text-lg text-neutral-400 leading-relaxed font-light">
            Centralize your software development lifecycle. Manage environments, encrypted secrets, scoped API keys, webhooks, audit logs, and real-time status pipelines from a unified interface.
          </p>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            {
              icon: Shield,
              title: "Secrets Manager",
              desc: "AES-256-GCM encrypted key-value pairs scoped to environments.",
              color: "text-emerald-400",
            },
            {
              icon: Key,
              title: "Scoped API Keys",
              desc: "SHA-256 hashed platform access tokens with role scopes.",
              color: "text-blue-400",
            },
            {
              icon: Activity,
              title: "Live Deployments",
              desc: "BullMQ asynchronous state pipeline with Socket.IO status streaming.",
              color: "text-indigo-400",
            },
            {
              icon: RefreshCw,
              title: "Webhook Deliveries",
              desc: "HMAC-SHA256 signed hooks with automated exponential retries.",
              color: "text-purple-400",
            },
          ].map((item, idx) => {
            const Icon = item.icon;
            return (
              <div key={idx} className="glass-card p-6 rounded-2xl flex flex-col gap-4">
                <div className="p-3 bg-white/5 rounded-xl w-fit flex items-center justify-center border border-white/5">
                  <Icon className={`w-6 h-6 ${item.color}`} />
                </div>
                <h3 className="font-bold text-lg text-white">{item.title}</h3>
                <p className="text-neutral-400 text-sm leading-relaxed">{item.desc}</p>
              </div>
            );
          })}
        </div>

        {/* System Stack Info */}
        <div className="glass-card p-8 rounded-3xl border border-white/10 flex flex-col md:flex-row gap-8 justify-between items-start md:items-center">
          <div className="space-y-2">
            <h4 className="font-black text-xl text-white">Technology Stack & Architecture</h4>
            <p className="text-neutral-400 text-sm font-light">
              Full-stack TypeScript monorepo using pnpm workspaces, Turborepo, Vitest, Express, MongoDB (Mongoose), Redis (BullMQ), and Socket.IO.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {["React 18", "Express", "Vite", "TypeScript", "TailwindCSS", "Zod", "Mongoose", "Redis"].map((tag, i) => (
              <span key={i} className="text-xs px-3 py-1.5 bg-white/5 border border-white/10 text-neutral-300 rounded-lg">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 py-6 px-12 text-center flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-neutral-500">
        <div>
          © {new Date().getFullYear()} SELADEV Platform. All rights reserved.
        </div>
        <div className="flex gap-4">
          <a href="https://seladev.dev" className="hover:text-white transition-colors">Privacy Policy</a>
          <a href="https://seladev.dev" className="hover:text-white transition-colors">Terms of Service</a>
        </div>
      </footer>
    </div>
  );
}
