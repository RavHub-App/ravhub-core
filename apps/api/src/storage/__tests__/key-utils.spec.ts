import { tryNormalizeRepoNames, buildKey, sanitizeSegment } from '../key-utils';

describe('key-utils normalization', () => {
  it('should include comma->slash and slash->comma variants', () => {
    const raw = 'testorg,e2e-image';
    const out = tryNormalizeRepoNames(raw);
    expect(out).toEqual(
      expect.arrayContaining(['testorg,e2e-image', 'testorg/e2e-image']),
    );
  });

  it('should decode encoded segments and include decoded variants', () => {
    const encoded = 'testorg%2Fe2e-image';
    const out = tryNormalizeRepoNames(encoded);
    expect(out).toEqual(
      expect.arrayContaining(['testorg%2Fe2e-image', 'testorg/e2e-image']),
    );
  });

  it('buildKey should split and encode segments consistently', () => {
    const k = buildKey('docker', 'testorg/e2e-image', 'manifests', 'v1');
    // normalized buildKey splits the repo segment into two parts
    expect(k).toBe('docker/testorg/e2e-image/manifests/v1');
  });

  it('sanitizeSegment should url-encode reserved characters', () => {
    const s = sanitizeSegment('a/b,c: d');
    expect(s).toContain('%2F');
    expect(s).toContain('%2C');
    expect(s).toContain('%3A');
  });
});
