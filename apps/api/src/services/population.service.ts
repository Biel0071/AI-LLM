export interface PopulationJobState {
  id: string;
  status: string;
}

export interface QueuePopulationState {
  waiting: number;
  active: number;
  delayed: number;
  prioritized: number;
  estimatedDrainMs: number;
}

export function populationSummary(
  jobs: PopulationJobState[],
  submitted = jobs.length,
  accepted = jobs.length,
  rejected = 0,
) {
  const counts = { waiting: 0, active: 0, completed: 0, failed: 0 };
  for (const job of jobs) {
    if (job.status in counts) counts[job.status as keyof typeof counts]++;
  }
  const processing = counts.waiting + counts.active;
  const terminal = counts.completed + counts.failed;
  const populationStatus =
    processing > 0
      ? 'populating'
      : jobs.length === 0 && rejected > 0
        ? 'failed'
        : counts.failed > 0 && counts.completed > 0
          ? 'completed_with_errors'
          : counts.failed > 0
            ? 'failed'
            : 'completed';
  const message =
    populationStatus === 'populating'
      ? `Sistema esta populando: ${processing} job(s) aguardando ou em processamento.`
      : populationStatus === 'completed'
        ? 'Populacao concluida; nenhum job pendente.'
        : populationStatus === 'completed_with_errors'
          ? 'Populacao concluida parcialmente; existem itens com erro.'
          : 'Populacao encerrada com falha.';
  return {
    populationStatus,
    message,
    submitted,
    accepted,
    rejected,
    uniqueJobs: jobs.length,
    duplicateReferences: Math.max(0, accepted - jobs.length),
    counts,
    progressPercent: jobs.length ? Math.round((terminal / jobs.length) * 10_000) / 100 : 100,
  };
}

export function queuePopulationSummary(queues: QueuePopulationState[]) {
  const waiting = queues.reduce(
    (sum, queue) => sum + queue.waiting + queue.delayed + queue.prioritized,
    0,
  );
  const active = queues.reduce((sum, queue) => sum + queue.active, 0);
  const queued = waiting + active;
  const estimatedDrainMs = Math.max(0, ...queues.map((queue) => queue.estimatedDrainMs));
  return {
    populationStatus: queued > 0 ? 'populating' : 'idle',
    message:
      queued > 0
        ? `Sistema esta populando: ${queued} job(s) organizados nas filas.`
        : 'Sistema disponivel; nenhuma populacao pendente.',
    waiting,
    active,
    queued,
    estimatedDrainMs,
    estimatedFinishAt: queued > 0 ? new Date(Date.now() + estimatedDrainMs).toISOString() : null,
  };
}

export function queueEntryPopulation(queue: { state: string }) {
  if (queue.state === 'completed') {
    return {
      populationStatus: 'completed',
      message: 'Demanda ja concluida; resultado reutilizado por cache ou deduplicacao.',
    };
  }
  if (queue.state === 'failed') {
    return { populationStatus: 'failed', message: 'Demanda encerrada com falha.' };
  }
  if (['waiting', 'active', 'delayed', 'prioritized'].includes(queue.state)) {
    return {
      populationStatus: 'populating',
      message: 'Sistema esta populando; demanda organizada na fila sem bloquear a aplicacao.',
    };
  }
  return { populationStatus: 'accepted', message: 'Demanda aceita e organizada pelo sistema.' };
}