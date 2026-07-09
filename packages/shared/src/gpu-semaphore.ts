/**
 * Semaforo global compartilhado entre TODOS os providers que usam a GPU
 * local (Ollama e ComfyUI). Sao dois processos separados competindo pela
 * mesma placa de 4GB sem nenhuma coordenacao entre si - rodar texto e
 * imagem "em paralelo" sem isso faz os dois brigarem por VRAM ao mesmo
 * tempo, derrubando a velocidade de ambos e estourando timeouts que
 * funcionam bem quando testados isoladamente. Isso serializa o acesso
 * real a GPU entre os dois tipos de carga, mantendo os semaforos
 * internos de cada provider (que limitam concorrencia dentro do mesmo
 * tipo) como uma segunda camada.
 */
export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve(() => this.release());
      });
    });
  }
  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

const max = Number(process.env.GPU_MAX_CONCURRENT) || 3;
export const globalGpuSemaphore = new Semaphore(max);
