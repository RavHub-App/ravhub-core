export async function authenticate(repo: any, creds: any) {
  if (creds?.name || creds?.username) {
    const username = creds.name || creds.username;
    return {
      ok: true,
      user: { username, displayName: username },
    };
  }
  return { ok: false, message: 'Missing credentials' };
}
