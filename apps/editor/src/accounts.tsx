import { useEffect, useRef, useState } from 'react';
import { api, type LoginState, type ProviderAccount } from './connection';

const providers = [{ id: 'openai', name: 'OpenAI', description: 'ChatGPT' }, { id: 'anthropic', name: 'Anthropic', description: 'Claude' }];

interface Props {
  accounts: ProviderAccount[];
  provider: string;
  busy: boolean;
  chooseProvider: (provider: string) => void;
  refresh: () => Promise<void>;
  loginRequest: number;
}

export function Accounts({ accounts, provider, busy, chooseProvider, refresh, loginRequest }: Props) {
  const [login, setLogin] = useState<LoginState | null>(null);
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState('');
  const [working, setWorking] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const picker = useRef<HTMLDivElement>(null);
  const pickerButton = useRef<HTMLButtonElement>(null);
  const selectedProvider = providers.find(option => option.id === provider)!;
  useEffect(() => {
    if (!pickerOpen) return;
    function dismiss(event: PointerEvent) {
      if (!picker.current?.contains(event.target as Node)) setPickerOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') { setPickerOpen(false); pickerButton.current?.focus(); }
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [pickerOpen]);
  const lastLoginRequest = useRef(loginRequest);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const current = accounts.find(a => a.id === provider);
  const pending = login?.status === 'pending';

  useEffect(() => {
    if (!login || login.status !== 'pending') return;
    let disposed = false;
    const poll = async () => {
      try {
        const next: LoginState = await (await api(`login/${login.id}`)).json();
        if (disposed) return;
        setLogin(next);
        if (next.status === 'pending') timer.current = setTimeout(poll, 800);
      } catch (e) { if (!disposed) setError(String(e)); }
    };
    timer.current = setTimeout(poll, 200);
    return () => { disposed = true; clearTimeout(timer.current); };
  }, [login?.id, login?.status]);

  useEffect(() => {
    if (login?.status !== 'complete') return;
    setShowLogin(false);
    void refresh().catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [login?.id, login?.status]);

  useEffect(() => { setAnswer(''); }, [login?.prompt?.id]);

  async function action(fn: () => Promise<void>) {
    setWorking(true); setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setWorking(false); }
  }
  function startLogin(id: string) {
    setShowLogin(true);
    setLogin(null);
    void action(async () => { setLogin(await (await api('login', 'POST', { provider: id })).json()); });
  }
  useEffect(() => {
    if (lastLoginRequest.current === loginRequest) return;
    lastLoginRequest.current = loginRequest;
    if (!current?.connected && !pending && !working) startLogin(provider);
  }, [loginRequest]);

  const authUrl = login?.events.findLast(e => e.type === 'auth_url');
  const progress = login?.events.findLast(e => e.type === 'progress');
  const safeUrl = authUrl?.url && /^https:\/\/(auth\.openai\.com|claude\.ai)\//.test(authUrl.url) ? authUrl.url : undefined;
  return <div className="provider-controls">
    <div className="provider-picker" ref={picker} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPickerOpen(false); }}>
      <button ref={pickerButton} className="provider-trigger" aria-label={`Provider: ${selectedProvider.name}`} aria-expanded={pickerOpen} aria-controls="provider-options" disabled={busy || pending || working || !accounts.length} onClick={() => setPickerOpen(!pickerOpen)}>
        <img src={`/${provider}.svg`} alt="" width="20" height="20" /><span>{selectedProvider.name}</span><svg className="provider-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      {pickerOpen && <div id="provider-options" className="provider-options" role="group" aria-label="Select provider">
        {providers.map(option => <button key={option.id} className="provider-option" aria-pressed={provider === option.id} onClick={() => {
          setPickerOpen(false); pickerButton.current?.focus();
          if (option.id === provider) return;
          chooseProvider(option.id); setLogin(null); setError('');
          if (!accounts.find(a => a.id === option.id)?.connected) startLogin(option.id);
          else setShowLogin(false);
        }}><img src={`/${option.id}.svg`} alt="" width="22" height="22" /><span>{option.name}<small>{option.description}</small></span>{provider === option.id && <span className="provider-check" aria-hidden="true">✓</span>}</button>)}
      </div>}
    </div>
    {current?.connected && <>
      <button className="sign-out" disabled={busy || working || pending} onClick={() => void action(async () => { await api('logout', 'POST', { provider }); await refresh(); setLogin(null); })}>Sign out</button>
    </>}
    {showLogin && <section className="settings accounts provider-popover" aria-label="Provider login">
    <div className="login-heading">{provider === 'openai' ? 'Sign in with ChatGPT' : 'Sign in with Claude'}</div>
    {working && !pending && <p role="status">Starting sign-in…</p>}
    {pending && <div className="login-flow">
      {safeUrl && <div><a className="login-link" href={safeUrl} target="_blank" rel="noreferrer">Continue to {login.provider === 'openai' ? 'ChatGPT' : 'Claude'} ↗</a><p>{authUrl?.instructions}</p></div>}
      {progress && <p role="status">{progress.message}</p>}
      {login.prompt && <form onSubmit={e => { e.preventDefault(); void action(async () => { await api(`login/${login.id}`, 'POST', { promptId: login.prompt!.id, value: answer }); setLogin(await (await api(`login/${login.id}`)).json()); }); }}>
        <label>{login.prompt.message}{login.prompt.type === 'select' ? <select aria-label="Login method" value={answer} onChange={e => setAnswer(e.target.value)}><option value="" disabled>Choose a login method</option>{login.prompt.options?.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
          : <input type={login.prompt.type === 'secret' ? 'password' : 'text'} autoComplete="off" value={answer} placeholder={login.prompt.placeholder} onChange={e => setAnswer(e.target.value)} />}</label><button disabled={working || !answer.trim()}>Continue</button>
      </form>}
      <button disabled={working} onClick={() => void action(async () => { await api(`login/${login.id}`, 'DELETE'); setLogin(await (await api(`login/${login.id}`)).json()); })}>Cancel login</button>
    </div>}
    {(error || login?.error) && <p className="message-error" role="alert">{error || login?.error}</p>}
    {login?.status === 'complete' && <p role="status">Signed in successfully.</p>}
    {!pending && !working && <div className="login-actions">{!current?.connected && <button onClick={() => startLogin(provider)}>Retry login</button>}<button onClick={() => setShowLogin(false)}>Close</button></div>}
    <p>Sign-in and token refresh use PI. Credentials stay on this local server.</p>
  </section>}
    {!showLogin && error && <span className="message-error" role="alert">{error}</span>}
  </div>;
}
