/**
 * Images API — 列出平台可用的 base images。
 *
 * GET /v1/images → ImageListResponse { images: ImageDTO[] }
 *
 * 这是顶层端点（不在某个 sandbox 下），客户端在 create sandbox 前可先列出
 * 可用镜像供用户选择。
 */

import type { Client } from "./client.js";
import { getDefaultClient } from "./config.js";
import {
  imageInfoFromRaw,
  type ImageInfo,
  type RawImage,
} from "./types.js";

export type { ImageInfo };

/**
 * 列出平台全部可用 base images。
 *
 * @example
 * import { listImages } from "talon-sandbox";
 * const images = await listImages();
 * const def = images.find(i => i.isDefault);
 * console.log(def?.name);
 */
export async function listImages(opts: { client?: Client } = {}): Promise<ImageInfo[]> {
  const client = opts.client ?? getDefaultClient();
  const res = await client.get("/v1/images");
  const data = res.json<{ images: RawImage[] }>();
  return (data.images ?? []).map(imageInfoFromRaw);
}
