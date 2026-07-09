import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { StandardResponse } from '@ai-platform/shared';
import { prisma } from '../lib/prisma';

export async function persistImageResponse(
  response: StandardResponse<any>,
  meta: { tenantId?: string; projectId?: string; prompt?: string; kind: string; seed?: number },
): Promise<StandardResponse<any>> {
  const images = response.result?.images;
  if (!Array.isArray(images)) return response;
  const dir = process.env.IMAGE_STORAGE_PATH ?? '/app/storage/images';
  await mkdir(dir, { recursive: true });
  for (const image of images) {
    if (!image?.base64) continue;
    const record = await prisma.image.create({ data: {
      tenantId: meta.tenantId, projectId: meta.projectId, provider: response.provider, model: response.model,
      prompt: meta.prompt, kind: meta.kind, base64Size: image.base64.length,
      seed: meta.seed != null ? BigInt(meta.seed) : undefined,
    }});
    await writeFile(path.join(dir, `${record.id}.png`), Buffer.from(image.base64, 'base64'));
    const url = `/v1/images/${record.id}/file`;
    await prisma.image.update({ where: { id: record.id }, data: { url } });
    image.url = url;
  }
  return response;
}