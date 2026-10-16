import { Inject, Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { FILE_LIMITS } from '@syntara/shared';
import { ENV, type Env } from '../../config/env';

/**
 * S3-совместимое хранилище (MinIO локально, раздел 2.1; AWS SDK v3). Ключи доступа — только на сервере (AG-10):
 * браузер получает лишь подписанные ссылки — на загрузку (API-T-16) и на чтение сроком 10 минут (BR-FILE-04).
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(ENV) env: Env) {
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    });
  }

  /** Подписанная ссылка на PUT; Content-Type входит в подпись. */
  uploadUrl(key: string, mime: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: mime }),
      {
        expiresIn: FILE_LIMITS.signedUrlSeconds,
      },
    );
  }

  /** BR-FILE-04: ссылка на чтение сроком 10 минут; имя файла — для «Сохранить как». */
  downloadUrl(key: string, fileName?: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(fileName
          ? { ResponseContentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(fileName)}` }
          : {}),
      }),
      { expiresIn: FILE_LIMITS.signedUrlSeconds },
    );
  }

  /** Размер загруженного объекта; null — объекта нет. */
  async size(key: string): Promise<number | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return head.ContentLength ?? 0;
    } catch (err) {
      if (err instanceof NotFound || (err as { name?: string }).name === 'NotFound') return null;
      throw err;
    }
  }

  /** Первые байты объекта — для проверки сигнатуры (BR-FILE-02). */
  async head(key: string, bytes = 8192): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
    );
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
