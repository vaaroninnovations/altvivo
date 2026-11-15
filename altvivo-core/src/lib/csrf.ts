import { hmacHex, randomToken, safeEqual } from './crypto.js';

/**
 * Signed double-submit CSRF token: "<random>.<hmac>". The signature stops a
 * compromised sibling subdomain from planting ("tossing") a token of its own
 * choosing into the shared `.altvivo.bio` cookie jar.
 */
export class CsrfService {
  constructor(private readonly secret: string) {}

  issue(): string {
    const nonce = randomToken(24);
    return `${nonce}.${hmacHex(this.secret, `csrf:${nonce}`)}`;
  }

  isWellFormed(token: string | undefined): token is string {
    if (!token) return false;
    const [nonce, sig, extra] = token.split('.');
    if (!nonce || !sig || extra !== undefined) return false;
    return safeEqual(sig, hmacHex(this.secret, `csrf:${nonce}`));
  }

  /** Header must equal cookie AND carry a valid signature. */
  validate(cookieValue: string | undefined, headerValue: string | undefined): boolean {
    if (!cookieValue || !headerValue) return false;
    if (!safeEqual(cookieValue, headerValue)) return false;
    return this.isWellFormed(cookieValue);
  }
}
