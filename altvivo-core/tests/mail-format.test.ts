import { describe, expect, it } from 'vitest';
import { mailPlainText, renderMailHtml } from '../src/lib/mail-format.js';

const plain = { a: 'A', h1: 'H1', h2: 'H2', p: 'P', ul: 'UL', ol: 'OL', li: 'LI', quote: 'Q' };
const html = (t: string) => renderMailHtml(t, plain);

describe('mailbox formatting', () => {
  it('renders inline marks', () => {
    expect(html('**bold** *it* __under__ ~~gone~~')).toBe('<p style="P"><strong>bold</strong> <em>it</em> <u>under</u> <s>gone</s></p>');
  });

  it('renders headings, lists, quotes and paragraphs', () => {
    const out = html('# Title\n\nLine one\nLine two\n\n- a\n• b\n\n1. x\n2. y\n\n> quoted\n> more');
    expect(out).toContain('<div role="heading" aria-level="2" style="H1">Title</div>');
    expect(out).toContain('<p style="P">Line one<br>Line two</p>');
    expect(out).toContain('<ul style="UL"><li style="LI">a</li><li style="LI">b</li></ul>');
    expect(out).toContain('<ol style="OL"><li style="LI">x</li><li style="LI">y</li></ol>');
    expect(out).toContain('<blockquote style="Q">quoted<br>more</blockquote>');
  });

  it('links only http(s) and mailto, and autolinks bare URLs', () => {
    expect(html('[site](https://altvivo.bio/x?a=1&b=2)')).toBe('<p style="P"><a href="https://altvivo.bio/x?a=1&amp;b=2" style="A">site</a></p>');
    expect(html('[bad](javascript:alert(1))')).not.toContain('<a');
    expect(html('see https://altvivo.bio.')).toBe('<p style="P">see <a href="https://altvivo.bio" style="A">https://altvivo.bio</a>.</p>');
  });

  it('cannot inject markup', () => {
    const out = html('<script>x</script> **<img src=x onerror=alert(1)>** [a"b](https://x.co/"onmouseover=1)');
    expect(out).not.toMatch(/<script|<img|"onmouseover/);
    expect(out).toContain('&lt;script&gt;');
  });

  it('leaves placeholders, emails and snake_case alone', () => {
    expect(html('Dear [Name], write to a_b@c.org about some_var')).toBe('<p style="P">Dear [Name], write to a_b@c.org about some_var</p>');
  });

  it('plain text drops the marks and spells out links', () => {
    expect(mailPlainText('## Hi\n**Bold** and [site](https://altvivo.bio) and [me](mailto:hello@altvivo.bio)')).toBe('Hi\nBold and site (https://altvivo.bio) and me (hello@altvivo.bio)');
  });
});
