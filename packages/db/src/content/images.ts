import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/** BR-CNT-06, BR-FILE-01: сигнатура файла совпадает с типом по расширению. */
export function imageMatches(bytes: Buffer, mime: string): boolean {
  const starts = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  switch (mime) {
    case 'image/png':
      return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return starts([0xff, 0xd8, 0xff]);
    case 'image/webp':
      return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8);
    default:
      return false;
  }
}

/** Хранилище картинок базовых уроков: S3 (MinIO локально), как у файлов учителя (раздел 2.1). */
export interface MediaStore {
  /** Положить объект, если его ещё нет (ключ — по sha256, содержимое не меняется). */
  ensure(key: string, body: Buffer, mime: string): Promise<'uploaded' | 'exists'>;
}

/** S3-хранилище из переменных окружения сервера (AG-10); null — переменные не заданы. */
export function s3MediaStoreFromEnv(env: NodeJS.ProcessEnv = process.env): MediaStore | null {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY } = env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) return null;
  const client = new S3Client({
    endpoint: S3_ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
  });
  return {
    async ensure(key, body, mime) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
        return 'exists';
      } catch (err) {
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status !== 404 && (err as { name?: string }).name !== 'NotFound') throw err;
      }
      await client.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: body, ContentType: mime }));
      return 'uploaded';
    },
  };
}
