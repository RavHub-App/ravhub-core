export async function authenticate(repo: any, creds: any) {
  if (creds?.username) {
    return {
      ok: true,
      user: { username: creds.username, displayName: creds.username },
    };
  }
  return { ok: false, message: 'Missing credentials' };
}
