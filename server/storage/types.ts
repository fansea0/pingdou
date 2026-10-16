/**
 * 作品图存储的最小能力集。实现者只需回答五个问题：
 * 怎么写、怎么读、存不存在、怎么删、这个 key 对外是什么地址。
 *
 * 刻意保持小 —— 每多一个方法，将来每多一个实现就多一份要维护的东西。
 */
export interface StoredObjectInfo {
  readonly key: string;
  readonly size: number;
  /** put 时传入、原样回显。本地盘不回读（无 sidecar），当前无调用方依赖该值。 */
  readonly contentType: string;
}

export interface StorageDriver {
  readonly name: string;

  put(key: string, body: Buffer, contentType: string): Promise<StoredObjectInfo>;
  get(key: string): Promise<Buffer>;
  /** 不存在返回 null（不是抛错）—— 「有没有」是查询语义，不是错误语义。 */
  head(key: string): Promise<StoredObjectInfo | null>;
  /** 删除不存在的 key 必须成功（幂等）。 */
  delete(key: string): Promise<void>;

  /**
   * key → 对外可访问 URL。本地盘返回 `/media/works/xxx.png`，S3 返回 CDN 地址。
   *
   * 这是「存储细节」和「前端拿到的地址」之间唯一的翻译层，正因为有它，
   * 数据库才只需要存 key、不存 URL（换存储时老数据一行不用洗）。
   */
  publicUrl(key: string): string;
}
