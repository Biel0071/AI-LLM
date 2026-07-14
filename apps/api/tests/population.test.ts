import { describe, expect, it } from 'vitest';
import { populationSummary, queueEntryPopulation, queuePopulationSummary } from '../src/services/population.service';

describe('population status', () => {
  it('reports active populations with progress and deduplication', () => {
    const result = populationSummary(
      [
        { id: '1', status: 'completed' },
        { id: '2', status: 'active' },
        { id: '3', status: 'waiting' },
      ],
      5,
      5,
      0,
    );
    expect(result.populationStatus).toBe('populating');
    expect(result.duplicateReferences).toBe(2);
    expect(result.progressPercent).toBeCloseTo(33.33, 2);
  });

  it('reports completion and partial errors', () => {
    expect(populationSummary([{ id: '1', status: 'completed' }]).populationStatus).toBe(
      'completed',
    );
    expect(
      populationSummary([
        { id: '1', status: 'completed' },
        { id: '2', status: 'failed' },
      ]).populationStatus,
    ).toBe('completed_with_errors');
  });

  it('does not claim that a deduplicated completed job is still populating', () => {
    expect(queueEntryPopulation({ state: 'completed' }).populationStatus).toBe('completed');
    expect(queueEntryPopulation({ state: 'active' }).populationStatus).toBe('populating');
  });

  it('aggregates queues into a single operational state and ETA', () => {
    const result = queuePopulationSummary([
      { waiting: 3, active: 1, delayed: 2, prioritized: 4, estimatedDrainMs: 12_000 },
      { waiting: 0, active: 0, delayed: 0, prioritized: 0, estimatedDrainMs: 0 },
    ]);
    expect(result.populationStatus).toBe('populating');
    expect(result.queued).toBe(10);
    expect(result.estimatedDrainMs).toBe(12_000);
  });
});
