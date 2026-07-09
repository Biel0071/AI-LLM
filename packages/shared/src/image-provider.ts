import type { GeneratedImage, HealthStatus, ModelInfo, ProviderResult } from './types';

export type ControlNetMode = 'pose' | 'depth' | 'canny' | 'lineart' | 'softedge';
export interface ImageBaseInput { provider?: string; model?: string; seed?: number; }
export interface TextToImageInput extends ImageBaseInput { prompt: string; negativePrompt?: string; width?: number; height?: number; steps?: number; cfgScale?: number; batch?: number; }
export interface ImageToImageInput extends TextToImageInput { image: string; strength?: number; }
export interface InpaintInput extends ImageToImageInput { mask: string; }
export interface OutpaintInput extends ImageToImageInput { top?: number; right?: number; bottom?: number; left?: number; }
export interface ControlNetInput extends ImageToImageInput { controlType: ControlNetMode; controlModel?: string; weight?: number; }
export interface RemoveBackgroundInput extends ImageBaseInput { image: string; }
export interface ImageQueueStatus { running: number; pending: number; raw?: unknown; }
export interface ImageResult { images: GeneratedImage[]; }

export interface ImageProvider {
  readonly name: string;
  health(): Promise<HealthStatus>;
  models(): Promise<ModelInfo[]>;
  textToImage(input: TextToImageInput): Promise<ProviderResult<ImageResult>>;
  imageToImage(input: ImageToImageInput): Promise<ProviderResult<ImageResult>>;
  videoToImage(frames: string[], input: Omit<ImageToImageInput, 'image'>): Promise<ProviderResult<ImageResult>>;
  upscale(input: { image: string; scale?: number; model?: string }): Promise<ProviderResult<ImageResult>>;
  removeBackground(input: RemoveBackgroundInput): Promise<ProviderResult<ImageResult>>;
  inpaint(input: InpaintInput): Promise<ProviderResult<ImageResult>>;
  outpaint(input: OutpaintInput): Promise<ProviderResult<ImageResult>>;
  controlnet(input: ControlNetInput): Promise<ProviderResult<ImageResult>>;
  cancel(id?: string): Promise<void>;
  queue(): Promise<ImageQueueStatus>;
}