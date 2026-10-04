'use client';

import { useEffect, useState } from 'react';
import type { SiteConfig } from '../../lib/site-config';

async function request(path: string, method: string, data?: unknown) {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data), cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed.');
  return body;
}

export default function Admin() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [password, setPassword] = useState('');
  const [config, setConfig] = useState<SiteConfig>({ ca: '', xUrl: '' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { request('/api/admin/config', 'GET').then(data => { setConfig(data); setLoggedIn(true); }).catch(() => {}); }, []);

  async function login(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      await request('/api/admin/login', 'POST', { password });
      setConfig(await request('/api/admin/config', 'GET'));
      setPassword(''); setLoggedIn(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Login failed.'); }
    finally { setBusy(false); }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try { setConfig(await request('/api/admin/config', 'PUT', config)); setMessage('Saved. Public pages will show the new CA and X profile.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Save failed.'); }
    finally { setBusy(false); }
  }

  return <main className="wrap admin-page">
    <a href="/" className="admin-back">← KIVO</a>
    <div className="pagehero"><div className="kicker">OWNER SETTINGS</div><h1>KIVO admin</h1><p>Publish the token mint address and the official X profile after verifying them. Changes appear without rebuilding the site.</p></div>
    {!loggedIn ? <form className="launch-panel admin-form" onSubmit={login}>
      <label className="field"><span className="tiny">ADMIN PASSWORD</span><input className="input" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)}/></label>
      <button type="submit" className="btn primary" disabled={busy}>SIGN IN</button>
    </form> : <form className="launch-panel admin-form" onSubmit={save}>
      <label className="field"><span className="tiny">KIVO TOKEN CA · SOLANA MINT ADDRESS</span><input className="input" placeholder="Leave empty for COMING SOON" value={config.ca} onChange={event => setConfig({ ...config, ca: event.target.value })}/></label>
      <label className="field"><span className="tiny">OFFICIAL X PROFILE</span><input className="input" placeholder="https://x.com/your_account" value={config.xUrl} onChange={event => setConfig({ ...config, xUrl: event.target.value })}/></label>
      <p className="form-note">CA is shown publicly and copied when visitors click the button. Verify the mint address and network yourself before publishing. Clearing a field returns it to COMING SOON.</p>
      <div className="actions"><button className="btn primary" type="submit" disabled={busy}>SAVE SETTINGS</button><button className="btn" type="button" onClick={async () => { await request('/api/admin/logout', 'POST'); setLoggedIn(false); setMessage(''); }}>SIGN OUT</button></div>
    </form>}
    {message && <p role="status" className="admin-message">{message}</p>}
  </main>;
}
