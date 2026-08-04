import { LoadingState } from '../components/ui-states';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function Logs() {
  const { data, isLoading } = useQuery({
    queryKey: ['logs'],
    queryFn: api.getLogs,
  });

  if (isLoading) return <LoadingState />;

  const logs = data?.logs || [
    { id: 1, message: "Server started on port 3000", timestamp: "2023-10-27T10:00:00Z", level: "info" },
    { id: 2, message: "Failed to connect to database", timestamp: "2023-10-27T10:05:00Z", level: "error" },
    { id: 3, message: "User authenticated successfully", timestamp: "2023-10-27T10:15:00Z", level: "info" },
    { id: 4, message: "Rate limit exceeded for project 'Mobile App'", timestamp: "2023-10-27T10:25:00Z", level: "warn" },
  ];

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-50">System Logs</h1>
          <p className="text-slate-400 mt-2">View application and system logs.</p>
        </div>
      </div>
      <div className="bg-black/40 border border-white/10 rounded-2xl backdrop-blur-md overflow-hidden p-6 font-mono text-sm">
        <ul className="space-y-3">
          {logs.map((log: any) => (
            <li key={log.id} className="flex gap-4 border-b border-white/5 pb-3">
              <span className="text-slate-500 w-48 shrink-0">{new Date(log.timestamp).toLocaleString()}</span>
              <span className={`font-semibold shrink-0 w-20 ${log.level === 'error' ? 'text-rose-400' : log.level === 'warn' ? 'text-amber-400' : 'text-indigo-400'}`}>[{log.level.toUpperCase()}]</span>
              <span className="text-slate-300">{log.message}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
