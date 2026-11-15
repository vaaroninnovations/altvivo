import { randomUUID } from 'node:crypto';

export interface TurnstileVerifier {
  verify(token: string | undefined, remoteIp: string): Promise<boolean>;
}

/** Cloudflare Turnstile server-side validation (siteverify). */
export class CloudflareTurnstile implements TurnstileVerifier {
  constructor(private readonly secret: string, private readonly allowedHostnames: string[]) {}

  async verify(token: string | undefined, remoteIp: string): Promise<boolean> {
    if (!token || token.length > 2048) return false;
    const body = new URLSearchParams({ secret: this.secret, response: token, remoteip: remoteIp, idempotency_key: randomUUID() });
    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { success?: boolean; hostname?: string };
      if (!data.success) return false;
      if (!data.hostname) return false;
      if (this.allowedHostnames.includes(data.hostname)) return true;
      // Cloudflare's published test secrets ("1x0000...") report "example.com".
      return data.hostname === 'example.com' && this.secret.startsWith('1x0000');
    } catch {
      return false;
    }
  }
}
