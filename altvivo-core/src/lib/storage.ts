import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'node:crypto';
import type { Config } from '../config.js';

export interface PresignPutInput {
  bucket: string;
  key: string;
  contentType: string;
  contentLength: number;
  sha256Hex: string;
  expiresIn: number;
}

export interface ObjectStorage {
  presignPut(input: PresignPutInput): Promise<{ url: string; headers: Record<string, string> }>;
  presignGet(bucket: string, key: string, expiresIn: number, downloadName: string): Promise<string>;
  head(bucket: string, key: string): Promise<{ size: number; contentType: string | undefined } | null>;
  readHead(bucket: string, key: string, bytes: number): Promise<Buffer>;
  remove(bucket: string, key: string): Promise<void>;
  /** Server-side write (generated invoice PDFs). */
  put(bucket: string, key: string, body: Buffer, contentType: string): Promise<void>;
}

/** Cloudflare R2 via the S3 API. Uploads never touch the VPS disk. */
export class R2Storage implements ObjectStorage {
  private readonly s3: S3Client;

  constructor(cfg: Config) {
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: cfg.R2_ENDPOINT ?? `https://${cfg.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: cfg.R2_ACCESS_KEY_ID, secretAccessKey: cfg.R2_SECRET_ACCESS_KEY },
      forcePathStyle: false,
    });
  }

  async presignPut(i: PresignPutInput) {
    const checksum = Buffer.from(i.sha256Hex, 'hex').toString('base64');
    const cmd = new PutObjectCommand({
      Bucket: i.bucket,
      Key: i.key,
      ContentType: i.contentType,
      ContentLength: i.contentLength,
      ChecksumSHA256: checksum,
    });
    // Content-Type, Content-Length and the SHA-256 checksum are part of the
    // signature: the browser cannot upload a different type, size or file.
    const url = await getSignedUrl(this.s3, cmd, {
      expiresIn: i.expiresIn,
      signableHeaders: new Set(['content-type', 'content-length', 'x-amz-checksum-sha256']),
      unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
    });
    return {
      url,
      headers: {
        'Content-Type': i.contentType,
        'Content-Length': String(i.contentLength),
        'x-amz-checksum-sha256': checksum,
      },
    };
  }

  presignGet(bucket: string, key: string, expiresIn: number, downloadName: string): Promise<string> {
    const safe = downloadName.replace(/["\\\r\n]/g, '_');
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${safe}"`,
      }),
      { expiresIn },
    );
  }

  async head(bucket: string, key: string) {
    try {
      const r = await this.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { size: Number(r.ContentLength ?? 0), contentType: r.ContentType };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw err;
    }
  }

  async readHead(bucket: string, key: string, bytes: number): Promise<Buffer> {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${bytes - 1}` }));
    const body = r.Body;
    if (!body) return Buffer.alloc(0);
    return Buffer.from(await body.transformToByteArray());
  }

  async remove(bucket: string, key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async put(bucket: string, key: string, body: Buffer, contentType: string): Promise<void> {
    const checksum = createHash('sha256').update(body).digest('base64');
    await this.s3.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.length, ChecksumSHA256: checksum }),
    );
  }
}
