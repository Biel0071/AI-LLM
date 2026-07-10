/**
 * Semaforos de coordenacao de acesso a GPU/CPU local, um por tipo de
 * carga (texto vs imagem) - NAO um unico semaforo compartilhado entre os
 * dois. Um semaforo global unico causava um bug real em producao: varias
 * chamadas de imagem simultaneas (via /v1/image sincrono, que nao passa
 * pela fila BullMQ) conseguiam todas "passar" ao mesmo tempo quando o
 * limite era >1, empilhando geracoes concorrentes no ComfyUI (que so
 * processa 1 workflow por vez de verdade) - isso estourava a RAM
 * disponivel, forcava swap em disco, e derrubava a velocidade de TODA
 * geracao (imagem e texto) em ate 20x (250s/passo em vez de ~12s/passo,
 * medido em producao). Com semaforos separados:
 *   - imagem fica travada em 1 (so faz sentido 1 workflow ativo por vez
 *     no ComfyUI - mais que isso so cria fila falsa que estoura memoria)
 *   - texto tem seu proprio limite independente (nao fica preso atras de
 *     uma geracao de imagem em andamento)
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

// ComfyUI so processa 1 workflow por vez de verdade - mais que 1 aqui so
// permite que multiplas requisicoes concorrentes (ex: varias chamadas
// sincronas de /v1/image ao mesmo tempo) empilhem trabalho em paralelo
// que a memoria disponivel nao aguenta.
const imageMax = Number(process.env.IMAGE_MAX_CONCURRENT) || 1;
export const imageGpuSemaphore = new Semaphore(imageMax);

// Ollama aceita paralelismo real internamente (OLLAMA_NUM_PARALLEL) -
// esse semaforo so limita quantas chamadas de texto/embed/vision o
// container api/worker deixa "em voo" ao mesmo tempo, independente de
// quantas geracoes de imagem estiverem rodando.
const textMax = Number(process.env.GPU_MAX_CONCURRENT) || 3;
export const textGpuSemaphore = new Semaphore(textMax);
