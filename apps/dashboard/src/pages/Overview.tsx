import { motion } from 'framer-motion';
import { Activity, Zap, Users, Globe, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { LoadingState } from '../components/ui-states';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
};

export function Overview() {
  const { data, isLoading } = useQuery({
    queryKey: ['overview'],
    queryFn: api.getOverview,
  });

  if (isLoading) return <LoadingState />;

  const stats = data?.stats || {
    totalRequests: "1.24M",
    avgLatency: "45ms",
    activeProjects: "24",
    errorRate: "0.12%"
  };

  const activities = data?.activities || [
    { msg: "New API Key generated", project: "E-Commerce App", time: "2m ago", type: "key" },
    { msg: "Spike in traffic detected", project: "Mobile Backend", time: "15m ago", type: "alert" },
    { msg: "Model limits updated", project: "Customer AI", time: "1h ago", type: "system" },
    { msg: "New provider 'Anthropic' added", project: "Global", time: "3h ago", type: "system" },
  ];

  return (
    <div className="space-y-8 pb-12">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-50">Dashboard Overview</h1>
        <p className="text-slate-400 mt-2">Welcome back. Here's what's happening with your API platform today.</p>
      </div>

      <motion.div 
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
      >
        <StatCard 
          title="Total Requests" 
          value={stats.totalRequests} 
          change="+14.5%" 
          isPositive={true} 
          icon={Activity} 
          color="indigo" 
        />
        <StatCard 
          title="Avg Latency" 
          value={stats.avgLatency} 
          change="-2.4%" 
          isPositive={true} 
          icon={Zap} 
          color="amber" 
        />
        <StatCard 
          title="Active Projects" 
          value={stats.activeProjects} 
          change="+3" 
          isPositive={true} 
          icon={Users} 
          color="emerald" 
        />
        <StatCard 
          title="Error Rate" 
          value={stats.errorRate} 
          change="+0.05%" 
          isPositive={false} 
          icon={Globe} 
          color="rose" 
        />
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Chart Placeholder */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
          className="lg:col-span-2 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-md p-6 relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 blur-[80px] rounded-full pointer-events-none" />
          <h2 className="text-lg font-medium text-slate-200 mb-6">API Traffic (30 Days)</h2>
          <div className="h-64 flex items-end justify-between gap-2 border-b border-l border-white/10 pb-2 pl-2">
            {/* Simulated Chart Bars */}
            {Array.from({ length: 30 }).map((_, i) => {
              const height = 20 + Math.random() * 80;
              return (
                <div key={i} className="w-full flex justify-center group">
                  <div 
                    className="w-full max-w-[12px] bg-indigo-500/50 hover:bg-indigo-400 rounded-t-sm transition-all duration-300 relative"
                    style={{ height: `${height}%` }}
                  >
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 bg-slate-800 text-xs px-2 py-1 rounded transition-opacity pointer-events-none z-10 whitespace-nowrap">
                      {Math.round(height * 100)} reqs
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>

        {/* Recent Activity */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4 }}
          className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-md p-6"
        >
          <h2 className="text-lg font-medium text-slate-200 mb-6">Recent Activity</h2>
          <div className="space-y-6">
            {activities.map((activity: any, i: number) => (
              <div key={i} className="flex gap-4">
                <div className="mt-1">
                  <div className={cn(
                    "w-2 h-2 rounded-full ring-4 ring-black",
                    activity.type === 'alert' ? "bg-rose-500 ring-rose-500/20" : 
                    activity.type === 'key' ? "bg-emerald-500 ring-emerald-500/20" : 
                    "bg-indigo-500 ring-indigo-500/20"
                  )} />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-200">{activity.msg}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                    <span>{activity.project}</span>
                    <span>•</span>
                    <span>{activity.time}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function StatCard({ title, value, change, isPositive, icon: Icon, color }: any) {
  const colorStyles = {
    indigo: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
    amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    rose: "text-rose-400 bg-rose-500/10 border-rose-500/20",
  };

  return (
    <motion.div variants={item} className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-md relative overflow-hidden group hover:border-white/20 transition-colors">
      <div className={`absolute -right-4 -top-4 w-24 h-24 blur-3xl opacity-20 rounded-full bg-${color}-500 transition-opacity group-hover:opacity-40`} />
      <div className="flex justify-between items-start mb-4 relative z-10">
        <h3 className="text-slate-400 text-sm font-medium">{title}</h3>
        <div className={cn("p-2 rounded-lg border", colorStyles[color as keyof typeof colorStyles])}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="flex items-baseline gap-2 relative z-10">
        <span className="text-3xl font-bold text-slate-50">{value}</span>
        <span className={cn(
          "flex items-center text-xs font-medium px-1.5 py-0.5 rounded-md",
          isPositive ? "text-emerald-400 bg-emerald-400/10" : "text-rose-400 bg-rose-400/10"
        )}>
          {isPositive ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
          {change}
        </span>
      </div>
    </motion.div>
  );
}
