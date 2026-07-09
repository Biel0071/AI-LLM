import { BaseProvider, parseImageInput } from './base.provider';
import {
  Capability,
  GenerateImageInput,
  GeneratedImage,
  ModelInfo,
  ProviderResult,
  UpscaleInput,
} from '../types';
import type { ControlNetInput, ImageProvider, ImageToImageInput, InpaintInput, OutpaintInput, RemoveBackgroundInput, TextToImageInput } from '../image-provider';

export interface A1111Config {
  baseUrl: string;
  defaultModel?: string;
  name?: string;
}

/** Automatic1111 / Stable Diffusion WebUI (endpoints /sdapi/v1/*) */
export class A1111Provider extends BaseProvider implements ImageProvider {
  readonly name: string;
  readonly capabilities: Capability[] = ['image', 'upscale'];

  constructor(private readonly config: A1111Config) {
    super();
    this.name = config.name ?? 'a1111';
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/$/, '')}${path}`;
  }

  private async resolveBase64(image: string): Promise<string> {
    const parsed = parseImageInput(image);
    if (parsed.kind === 'base64') return parsed.data;
    const buf = await this.httpBinary(parsed.data);
    return buf.toString('base64');
  }

  override async generateImage(input: GenerateImageInput): Promise<ProviderResult<{ images: GeneratedImage[] }>> {
    const overrides = input.model ? { sd_model_checkpoint: input.model } : undefined;
    const common = {
      prompt: input.prompt,
      negative_prompt: input.negativePrompt ?? '',
      width: input.width ?? 1024,
      height: input.height ?? 1024,
      steps: input.steps ?? 20,
      cfg_scale: input.cfgScale ?? 7,
      seed: input.seed ?? -1,
      batch_size: input.batch ?? 1,
      override_settings: overrides,
    };

    let data: any;
    if (input.image) {
      data = await this.http<any>(this.url('/sdapi/v1/img2img'), {
        method: 'POST',
        body: {
          ...common,
          init_images: [await this.resolveBase64(input.image)],
          denoising_strength: input.denoise ?? 0.6,
        },
        timeoutMs: 300_000,
      });
    } else {
      data = await this.http<any>(this.url('/sdapi/v1/txt2img'), {
        method: 'POST',
        body: common,
        timeoutMs: 300_000,
      });
    }

    const images: GeneratedImage[] = (data?.images ?? []).map((b64: string) => ({
      base64: b64,
      mimeType: 'image/png',
    }));
    return { result: { images }, model: input.model ?? this.config.defaultModel ?? 'default', raw: { info: data?.info } };
  }

  override async upscale(input: UpscaleInput): Promise<ProviderResult<{ images: GeneratedImage[] }>> {
    const data = await this.http<any>(this.url('/sdapi/v1/extra-single-image'), {
      method: 'POST',
      body: {
        image: await this.resolveBase64(input.image),
        upscaling_resize: input.scale ?? 4,
        upscaler_1: input.model ?? 'R-ESRGAN 4x+',
      },
      timeoutMs: 300_000,
    });
    return {
      result: { images: [{ base64: data?.image, mimeType: 'image/png' }] },
      model: input.model ?? 'R-ESRGAN 4x+',
      raw: { html_info: data?.html_info },
    };
  }

  async textToImage(input: TextToImageInput) {
    return this.generateImage(input);
  }

  async imageToImage(input: ImageToImageInput) {
    return this.generateImage({ ...input, image: input.image, denoise: input.strength });
  }

  async videoToImage(frames: string[], input: Omit<ImageToImageInput, 'image'>) {
    const images: GeneratedImage[] = [];
    let model = input.model ?? this.config.defaultModel ?? 'default';
    for (const frame of frames) {
      const result = await this.imageToImage({ ...input, image: frame });
      images.push(...result.result.images);
      model = result.model;
    }
    return { result: { images }, model };
  }

  async inpaint(input: InpaintInput) {
    const data = await this.http<any>(this.url('/sdapi/v1/img2img'), {
      method: 'POST', timeoutMs: 300_000,
      body: {
        prompt: input.prompt, negative_prompt: input.negativePrompt ?? '',
        init_images: [await this.resolveBase64(input.image)], mask: await this.resolveBase64(input.mask),
        denoising_strength: input.strength ?? 0.75, seed: input.seed ?? -1,
        width: input.width ?? 1024, height: input.height ?? 1024,
        steps: input.steps ?? 20, cfg_scale: input.cfgScale ?? 7,
        inpainting_fill: 1, inpaint_full_res: true,
        override_settings: input.model ? { sd_model_checkpoint: input.model } : undefined,
      },
    });
    return { result: { images: (data?.images ?? []).map((base64: string) => ({ base64, mimeType: 'image/png' })) }, model: input.model ?? this.config.defaultModel ?? 'default' };
  }

  async outpaint(input: OutpaintInput) {
    const data = await this.http<any>(this.url('/sdapi/v1/img2img'), {
      method: 'POST', timeoutMs: 300_000,
      body: {
        prompt: input.prompt, negative_prompt: input.negativePrompt ?? '',
        init_images: [await this.resolveBase64(input.image)], denoising_strength: input.strength ?? 0.8,
        seed: input.seed ?? -1, steps: input.steps ?? 20, cfg_scale: input.cfgScale ?? 7,
        script_name: 'Outpainting mk2',
        script_args: [null, input.left ?? 64, input.right ?? 64, input.top ?? 64, input.bottom ?? 64, 4, 0.05, 'fill', ['left','right','up','down']],
      },
    });
    return { result: { images: (data?.images ?? []).map((base64: string) => ({ base64, mimeType: 'image/png' })) }, model: input.model ?? this.config.defaultModel ?? 'default' };
  }

  async controlnet(input: ControlNetInput) {
    const moduleMap = { pose: 'openpose_full', depth: 'depth_midas', canny: 'canny', lineart: 'lineart_realistic', softedge: 'softedge_pidinet' } as const;
    const data = await this.http<any>(this.url('/sdapi/v1/img2img'), {
      method: 'POST', timeoutMs: 300_000,
      body: {
        prompt: input.prompt, negative_prompt: input.negativePrompt ?? '',
        init_images: [await this.resolveBase64(input.image)], denoising_strength: input.strength ?? 0.65,
        seed: input.seed ?? -1, steps: input.steps ?? 20, cfg_scale: input.cfgScale ?? 7,
        alwayson_scripts: { controlnet: { args: [{
          enabled: true, image: await this.resolveBase64(input.image),
          module: moduleMap[input.controlType], model: input.controlModel ?? 'None', weight: input.weight ?? 1,
        }] } },
      },
    });
    return { result: { images: (data?.images ?? []).map((base64: string) => ({ base64, mimeType: 'image/png' })) }, model: input.model ?? this.config.defaultModel ?? 'default' };
  }

  async removeBackground(input: RemoveBackgroundInput) {
    const data = await this.http<any>(this.url('/rembg'), { method: 'POST', timeoutMs: 300_000, body: { input_image: await this.resolveBase64(input.image) } });
    const base64 = data?.image ?? data?.output;
    return { result: { images: base64 ? [{ base64, mimeType: 'image/png' }] : [] }, model: 'rembg' };
  }

  async cancel(): Promise<void> {
    await this.http(this.url('/sdapi/v1/interrupt'), { method: 'POST', body: {} });
  }

  async queue() {
    const progress = await this.http<any>(this.url('/sdapi/v1/progress?skip_current_image=true'), { timeoutMs: 10_000 });
    return { running: progress?.state?.job_count > 0 ? 1 : 0, pending: Math.max(0, (progress?.state?.job_count ?? 0) - 1), raw: progress };
  }

  async models(): Promise<ModelInfo[]> {
    const data = await this.http<any>(this.url('/sdapi/v1/sd-models'), { timeoutMs: 15_000 });
    return (data ?? []).map((m: any) => ({ id: m.model_name, name: m.title }));
  }
}
