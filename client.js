/**
 * TokenView — Client half (Web).
 *
 * 零构建：`window.__ModuleLoader__.load`，只 `require('react')`。
 * 注入两个槽：
 *  - `shell.overlay` → 左下角头像上方的余额窗口（自动+手动刷新）；
 *  - `settings.general.item` → 通用设置「刷新间隔」行（configForms 读写 volatile 字段）。
 */
window.__ModuleLoader__.load({
  id: '@local/token-view',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React;

    const NAMESPACE = 'token-view';          // patch 行 id = configForms.get 的 key
    const LOCALE_NS = 'settings.token-view';
    const STYLE_ID = 'token-view-css';
    const API_PREFIX = '/api/token-view';
    const MIN_INTERVAL = 5;
    const MAX_INTERVAL = 3600;
    const DEFAULT_INTERVAL = 30;

    const DICT = {
      zh: {
        'interval.title': '刷新间隔',
        'interval.hint': '余额窗口自动刷新的时间间隔（秒，5–3600）',
        'interval.unit': '秒',
        'url.title': '接口地址',
        'url.hint': '查余额/用量接口的完整 URL（GET）',
        'key.title': 'API Key',
        'key.hint': 'Bearer 认证密钥，仅保存在本机 Host 侧',
        'saveFailed': '保存失败，请重试',
        'widget.title': 'Token 余额',
        'widget.loading': '正在刷新…',
        'widget.updated': '更新于 {time} · 点击刷新',
        'widget.clickToRefresh': '点击刷新',
        'widget.error': '刷新失败：{message}',
        'widget.notConfigured': '未配置接口地址/Key',
        'widget.empty': '无字段',
      },
      en: {
        'interval.title': 'Refresh interval',
        'interval.hint': 'Auto-refresh interval for the balance widget (seconds, 5–3600)',
        'interval.unit': 's',
        'url.title': 'API URL',
        'url.hint': 'Full URL of the balance/usage endpoint (GET)',
        'key.title': 'API Key',
        'key.hint': 'Bearer credential, kept Host-side only',
        'saveFailed': 'Save failed, retry',
        'widget.title': 'Token balance',
        'widget.loading': 'Refreshing…',
        'widget.updated': 'Updated {time} · click to refresh',
        'widget.clickToRefresh': 'Click to refresh',
        'widget.error': 'Refresh failed: {message}',
        'widget.notConfigured': 'Not configured',
        'widget.empty': 'No fields',
      },
    };

    const CSS = [
      '.token-view-card{position:fixed;top:6px;right:150px;z-index:1000;-webkit-app-region:no-drag;pointer-events:auto;cursor:pointer;display:flex;flex-direction:row;align-items:center;gap:6px;height:30px;max-width:210px;padding:0 10px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 2px 8px rgba(0,0,0,.14);color:var(--dsw-alias-label-primary);overflow:hidden;white-space:nowrap}',
      '.token-view-card:hover{border-color:var(--dsw-alias-text-accent)}',
      '.token-view-dot{width:8px;height:8px;border-radius:50%;flex:none}',
      '.token-view-chipLabel{font-size:10px;opacity:.6;flex:none}',
      '.token-view-chipValue{font-size:12px;font-weight:600;color:var(--dsw-alias-text-accent);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis}',
      '.token-view-chipHint{font-size:10px;opacity:.65;overflow:hidden;text-overflow:ellipsis}',
      '.token-view-hint{color:var(--dsw-alias-label-primary);opacity:.6;font-size:10px;line-height:14px}',
      '.token-view-hint--error{opacity:.9}',
      '.token-view-form{display:flex;flex-direction:column;gap:10px;padding:4px 0}',
      '.token-view-formRow{display:flex;flex-direction:column;gap:4px}',
      '.token-view-formLabel{font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);opacity:.75}',
      '.token-view-input--wide{width:100%;text-align:left}',
      '.token-view-settings{display:flex;flex-direction:column;gap:12px;padding:8px 0;max-width:560px}',
      '.token-view-settingsTitle{margin:0;font-size:16px;font-weight:600;line-height:24px;color:var(--dsw-alias-label-primary)}',
      '.token-view-row{display:flex;align-items:center;gap:8px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
      '.token-view-rowText{display:flex;flex-direction:column;flex:1;min-width:0;gap:4px;padding-right:48px}',
      '.token-view-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}',
      '.token-view-control{display:flex;align-items:center;gap:6px}',
      '.token-view-input{height:36px;width:76px;padding:0 10px;border:none;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;text-align:right}',
      '.token-view-input:focus{outline:2px solid var(--dsw-alias-text-accent);outline-offset:-2px}',
      '.token-view-input:disabled{cursor:default;opacity:.5}',
      '.token-view-unit{color:var(--dsw-alias-label-primary);opacity:.6;font-size:12px}',
    ].join('');

    function ensureStyles() {
      if (typeof document === 'undefined') return;
      if (document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]') !== null) return;
      const tag = document.createElement('style');
      tag.setAttribute('data-plugin-css', STYLE_ID);
      tag.setAttribute('data-plugin', 'token-view');
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }
    function removeStyles() {
      if (typeof document === 'undefined') return;
      document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]')?.remove();
    }

    function clampInterval(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return DEFAULT_INTERVAL;
      return Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, Math.trunc(n)));
    }
    function interpolate(template, params) {
      return String(template).replace(/\{(\w+)\}/g, (m, k) => (params && k in params ? String(params[k]) : ''));
    }
    function currentLang() {
      const probe = (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang)
        || (typeof navigator !== 'undefined' && navigator.language) || '';
      return /^zh/i.test(String(probe)) ? 'zh' : 'en';
    }
    function fallbackText(key) {
      const dict = DICT[currentLang()] || DICT.zh;
      return dict[key] ?? DICT.zh[key] ?? String(key);
    }
    function makeTranslator(t) {
      return (key, params) => {
        let raw = null;
        if (typeof t === 'function') {
          try { raw = t(key); } catch { raw = null; }
          if (raw === key) raw = null;
        }
        if (typeof raw !== 'string' || raw.length === 0) raw = fallbackText(key);
        return interpolate(raw, params);
      };
    }
    function formatLocalTime(iso) {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      const pad = (n) => String(n).padStart(2, '0');
      return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }

    /** 只取「余额」字段（美元），没有则退到最后一个金额字段。 */
    function pickBalanceField(fields) {
      if (!Array.isArray(fields) || fields.length === 0) return null;
      const bal = fields.find((f) => /余额/.test(String(f && f.name || '')));
      if (bal) return bal;
      const money = fields.filter((f) => /金额|余额/.test(String(f && f.name || '')));
      return money.length > 0 ? money[money.length - 1] : null;
    }

    /** 余额窗口（shell.overlay，左下角头像上方）。 */
    function BalanceWidget(props) {
      const { form, t } = props;
      const subscribe = useCallback((cb) => form.subscribe(cb), [form]);
      const getSnapshot = useCallback(() => form.getSnapshot(), [form]);
      const snapshot = useSyncExternalStore(subscribe, getSnapshot);
      const interval = clampInterval(snapshot?.value?.refreshInterval);

      const [status, setStatus] = useState('loading');
      const [fields, setFields] = useState([]);
      const [at, setAt] = useState(null);
      const [errorMsg, setErrorMsg] = useState('');
      const refreshingRef = useRef(false);

      const tr = useMemo(() => makeTranslator(t), [t]);

      const refresh = useCallback(async () => {
        if (refreshingRef.current) return;
        refreshingRef.current = true;
        setStatus('loading');
        try {
          const res = await fetch(API_PREFIX + '/refresh', { method: 'POST' });
          let data = null;
          try { data = await res.json(); } catch { data = null; }
          if (res.ok && data && data.ok === true) {
            setFields(Array.isArray(data.fields) ? data.fields : []);
            setAt(typeof data.at === 'string' ? data.at : null);
            setErrorMsg('');
            setStatus('ok');
          } else if (data && data.error) {
            setFields([]);
            setAt(null);
            if (data.error.code === 'NOT_CONFIGURED') { setErrorMsg(''); setStatus('not-configured'); }
            else { setErrorMsg(typeof data.error.message === 'string' ? data.error.message : ''); setStatus('error'); }
          } else {
            setFields([]); setAt(null); setErrorMsg(''); setStatus('error');
          }
        } catch {
          setFields([]); setAt(null); setErrorMsg(''); setStatus('error');
        } finally {
          refreshingRef.current = false;
        }
      }, []);

      // 挂载：读 config；未配置进 not-configured，否则立即刷新一次。
      useEffect(() => {
        let cancelled = false;
        (async () => {
          let configured = true;
          try {
            const res = await fetch(API_PREFIX + '/config');
            let data = null;
            try { data = await res.json(); } catch { data = null; }
            if (data && data.configured === false) configured = false;
          } catch {
            // config 读取失败时交给 refresh 决定状态
          }
          if (cancelled) return;
          if (configured) { await refresh(); }
          else { setFields([]); setAt(null); setStatus('not-configured'); }
        })();
        return () => { cancelled = true; };
      }, [refresh]);

      // 自动刷新：refreshInterval 或状态变化时重置定时器。
      useEffect(() => {
        if (status === 'not-configured') return undefined;
        const id = window.setInterval(() => { void refresh(); }, interval * 1000);
        return () => window.clearInterval(id);
      }, [interval, status, refresh]);

      const updated = at ? tr('widget.updated', { time: formatLocalTime(at) }) : tr('widget.clickToRefresh');
      const bal = pickBalanceField(fields);
      const balanceText = bal ? '$' + String(bal.value) : '';
      const dotColor = status === 'ok' ? '#30d158' : (status === 'loading' ? '#98989d' : '#ff453a');

      return h('div', {
        className: 'token-view-card',
        style: { pointerEvents: 'auto', cursor: 'pointer' },
        onClick: () => { void refresh(); },
        title: updated,
      },
        h('span', { className: 'token-view-dot', style: { backgroundColor: dotColor } }),
        status === 'loading' && h('span', { className: 'token-view-chipHint' }, tr('widget.loading')),
        status === 'ok' && balanceText === '' && h('span', { className: 'token-view-chipHint' }, tr('widget.empty')),
        status === 'ok' && balanceText !== '' && h('span', { className: 'token-view-chipValue' }, balanceText),
        status === 'error' && h('span', { className: 'token-view-chipHint' }, tr('widget.error', { message: errorMsg })),
        status === 'not-configured' && h('span', { className: 'token-view-chipHint' }, tr('widget.notConfigured')),
      );
    }

    /** 通用设置「刷新间隔」行（settings.general.item）。 */
    function IntervalRow(props) {
      const { form, t } = props;
      const subscribe = useCallback((cb) => form.subscribe(cb), [form]);
      const getSnapshot = useCallback(() => form.getSnapshot(), [form]);
      const snapshot = useSyncExternalStore(subscribe, getSnapshot);
      const current = clampInterval(snapshot?.value?.refreshInterval);
      const writable = snapshot?.writable === true;

      const [draft, setDraft] = useState(null);
      const [pending, setPending] = useState(false);
      const [failed, setFailed] = useState(false);

      const title = typeof t === 'function' ? t('interval.title') : DICT.zh['interval.title'];
      const hint = typeof t === 'function' ? t('interval.hint') : DICT.zh['interval.hint'];
      const unit = typeof t === 'function' ? t('interval.unit') : DICT.zh['interval.unit'];
      const failedText = typeof t === 'function' ? t('saveFailed') : DICT.zh['saveFailed'];

      const commit = async () => {
        if (draft === null) return;
        const next = clampInterval(parseInt(draft, 10));
        setDraft(null);
        if (next === current) return;
        setPending(true);
        setFailed(false);
        try {
          const accepted = await form.set('refreshInterval', next);
          if (accepted !== true && clampInterval(form.getSnapshot()?.value?.refreshInterval) !== next) setFailed(true);
        } catch {
          setFailed(true);
        } finally {
          setPending(false);
        }
      };

      const onChange = (ev) => setDraft(ev.target.value);
      const onCommit = (ev) => {
        if (ev.type === 'blur' || (ev.type === 'keydown' && ev.key === 'Enter')) void commit();
      };

      const shown = draft !== null ? draft : String(current);

      return h('div', { className: 'token-view-row' },
        h('div', { className: 'token-view-rowText' },
          h('div', { className: 'token-view-title' }, title),
          failed ? h('div', { className: 'token-view-hint' }, failedText) : h('div', { className: 'token-view-hint' }, hint),
        ),
        h('div', { className: 'token-view-control' },
          h('input', {
            type: 'number',
            min: MIN_INTERVAL,
            max: MAX_INTERVAL,
            step: 1,
            className: 'token-view-input',
            value: shown,
            disabled: pending || !writable,
            'aria-label': title,
            onChange,
            onBlur: onCommit,
            onKeyDown: onCommit,
          }),
          h('span', { className: 'token-view-unit' }, unit),
        ),
      );
    }

    /** 解析本插件的配置表单：优先用槽传入的 form，其次按候选 namespace 取 ctx.configForms。 */
    function resolveConfigForm(ctx, props) {
      const usable = (form) => (form && typeof form.getSnapshot === 'function' && typeof form.subscribe === 'function' ? form : null);
      const fromSlot = usable(props && props.form);
      if (fromSlot) return fromSlot;
      for (const ns of [NAMESPACE, 'include:token-view', '@local/token-view']) {
        try {
          const hit = usable(ctx.configForms.get(ns));
          if (hit) return hit;
        } catch { /* try next */ }
      }
      return null;
    }

    /** 表单不可用时的只读兜底；getSnapshot 必须返回同一引用，否则 useSyncExternalStore 会死循环。 */
    const EMPTY_FORM_SNAPSHOT = { value: {}, writable: false };
    const FALLBACK_FORM = {
      getSnapshot: () => EMPTY_FORM_SNAPSHOT,
      subscribe: () => () => {},
      set: async () => false,
    };

    /** 插件页/设置页配置面板：接口地址 / API Key / 刷新间隔。 */
    function ConfigPanel(props) {
      const { view } = props;
      const form = useMemo(() => resolveConfigForm(ctx, props) || FALLBACK_FORM, [props.form]);
      const subscribe = useCallback((cb) => form.subscribe(cb), [form]);
      const getSnapshot = useCallback(() => form.getSnapshot(), [form]);
      const snapshot = useSyncExternalStore(subscribe, getSnapshot);
      const value = (snapshot && snapshot.value) || {};
      const writable = snapshot?.writable === true;
      const interval = clampInterval(value.refreshInterval);
      const [urlDraft, setUrlDraft] = useState(null);
      const [keyDraft, setKeyDraft] = useState(null);
      const [intervalDraft, setIntervalDraft] = useState(null);
      const [failed, setFailed] = useState(false);

      const commit = async (field, next) => {
        setFailed(false);
        try {
          const accepted = await form.set(field, next);
          if (accepted !== true) setFailed(true);
        } catch { setFailed(true); }
      };

      if (view === 'summary') {
        const configured = String(value.apiUrl || '').trim() !== '';
        return h('span', { className: 'token-view-hint' },
          (configured ? '接口地址已配置' : '未配置接口地址') + ' · 刷新间隔 ' + interval + ' 秒');
      }

      const urlValue = urlDraft !== null ? urlDraft : String(value.apiUrl || '');
      const keyValue = keyDraft !== null ? keyDraft : String(value.apiKey || '');
      const intervalValue = intervalDraft !== null ? intervalDraft : String(interval);

      return h('div', { className: 'token-view-form' },
        h('label', { className: 'token-view-formRow' },
          h('span', { className: 'token-view-formLabel' }, '接口地址'),
          h('input', {
            type: 'url', className: 'token-view-input token-view-input--wide',
            placeholder: 'https://sophonapi.yyxxgame.com/api/usage/token/', value: urlValue, disabled: !writable,
            onChange: (e) => setUrlDraft(e.target.value),
            onBlur: () => { void commit('apiUrl', String(urlValue).trim()); setUrlDraft(null); },
            onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur(); },
          }),
        ),
        h('label', { className: 'token-view-formRow' },
          h('span', { className: 'token-view-formLabel' }, 'API Key'),
          h('input', {
            type: 'password', className: 'token-view-input token-view-input--wide',
            placeholder: 'Bearer 之后的密钥', value: keyValue, disabled: !writable,
            onChange: (e) => setKeyDraft(e.target.value),
            onBlur: () => { void commit('apiKey', keyValue); setKeyDraft(null); },
            onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur(); },
          }),
        ),
        h('label', { className: 'token-view-formRow' },
          h('span', { className: 'token-view-formLabel' }, '刷新间隔（秒，5–3600）'),
          h('input', {
            type: 'number', min: MIN_INTERVAL, max: MAX_INTERVAL, step: 1,
            className: 'token-view-input', value: intervalValue, disabled: !writable,
            onChange: (e) => setIntervalDraft(e.target.value),
            onBlur: () => { void commit('refreshInterval', clampInterval(parseInt(intervalValue, 10))); setIntervalDraft(null); },
            onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur(); },
          }),
        ),
        failed ? h('div', { className: 'token-view-hint token-view-hint--error' }, '保存失败，请重试') : null,
      );
    }

    /** 通用设置里的文本行（接口地址 / API Key）。 */
    function TextPrefRow(props) {
      const { form, t, field, titleKey, hintKey, type } = props;
      const subscribe = useCallback((cb) => form.subscribe(cb), [form]);
      const getSnapshot = useCallback(() => form.getSnapshot(), [form]);
      const snapshot = useSyncExternalStore(subscribe, getSnapshot);
      const value = (snapshot && snapshot.value) || {};
      const writable = snapshot?.writable === true;
      const current = String(value[field] ?? '');
      const [draft, setDraft] = useState(null);
      const [failed, setFailed] = useState(false);

      const title = typeof t === 'function' ? t(titleKey) : DICT.zh[titleKey];
      const hint = typeof t === 'function' ? t(hintKey) : DICT.zh[hintKey];
      const failedText = typeof t === 'function' ? t('saveFailed') : DICT.zh['saveFailed'];
      const shown = draft !== null ? draft : current;

      const commit = async () => {
        if (draft === null) return;
        const next = draft;
        setDraft(null);
        if (next === current) return;
        setFailed(false);
        try {
          const accepted = await form.set(field, next);
          if (accepted !== true && String(form.getSnapshot()?.value?.[field] ?? '') !== next) setFailed(true);
        } catch {
          setFailed(true);
        }
      };

      return h('div', { className: 'token-view-row' },
        h('div', { className: 'token-view-rowText' },
          h('div', { className: 'token-view-title' }, title),
          failed ? h('div', { className: 'token-view-hint' }, failedText) : h('div', { className: 'token-view-hint' }, hint),
        ),
        h('div', { className: 'token-view-control' },
          h('input', {
            type: type || 'text',
            className: 'token-view-input',
            style: { width: '240px', maxWidth: '40vw', textAlign: 'left' },
            value: shown,
            disabled: !writable,
            'aria-label': title,
            onChange: (e) => setDraft(e.target.value),
            onBlur: () => { void commit(); },
            onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur(); },
          }),
        ),
      );
    }

    return {
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
        ctx.effect(() => { ensureStyles(); return removeStyles; }, 'token-view: styles');
        ctx.effect(() => ctx.locale.register(LOCALE_NS, DICT), 'token-view: dictionary');
        const form = ctx.configForms.get(NAMESPACE);

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'token-view', order: 0, locale: LOCALE_NS,
        }, (props) => h(BalanceWidget, { ...props, form })));

        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item', id: 'token-view-interval', order: 60, locale: LOCALE_NS,
        }, (props) => h(IntervalRow, { ...props, form })));

        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item', id: 'token-view-url', order: 62, locale: LOCALE_NS,
        }, (props) => h(TextPrefRow, { ...props, form, field: 'apiUrl', titleKey: 'url.title', hintKey: 'url.hint', type: 'url' })));

        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item', id: 'token-view-key', order: 64, locale: LOCALE_NS,
        }, (props) => h(TextPrefRow, { ...props, form, field: 'apiKey', titleKey: 'key.title', hintKey: 'key.hint', type: 'password' })));

        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config', key: '@local/token-view#token-view',
        }, (props) => h(ConfigPanel, { ...props, form })));

        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config', key: '@local/token-view',
        }, (props) => h(ConfigPanel, { ...props, form })));
      },
    };
  },
});