import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { type ObjectStorage } from './file-scan';

/** S3-совместимое хранилище (MinIO локально); ключи доступа — только в окружении worker (AG-10). */
export function createS3Storage(env: {
  S3_ENDPOINT: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY: string;
  S3_SECRET_KEY: string;
}): ObjectStorage {
  const client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  });
  return {
    async read(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    },
  };
}
