import { describe, expect, it } from 'vitest';
import { fetchRemoteImage, isPublicAddress, sniffImage } from '../src/lib/remote-image.js';

describe('remote image guard', () => {
  it('only treats public unicast addresses as public', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'not-an-ip'])
      expect(isPublicAddress(ip), ip).toBe(false);
    for (const ip of ['8.8.8.8', '104.16.1.1', '2606:4700::1111', '::ffff:8.8.8.8']) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it('refuses non-https, credentials, odd ports and private hosts before connecting', async () => {
    for (const url of ['http://example.com/a.jpg', 'https://u:p@example.com/a.jpg', 'https://example.com:8443/a.jpg', 'https://169.254.169.254/latest', 'https://db.internal/a.png', 'javascript:alert(1)'])
      await expect(fetchRemoteImage(url), url).rejects.toThrow();
  });

  it('sniffs image signatures', () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe('image/jpeg');
    expect(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });
});
