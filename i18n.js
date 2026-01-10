// Lightweight i18n loader and runtime. Rewritten to be robust.
(function () {
	console.log('[i18n] script loaded');
	const STORAGE_KEY = 'lang';
	const DEFAULT_LANG = 'hu';
	const SUPPORTED = new Set(['hu', 'it']);

	const getInitialLang = () => {
		try {
			const saved = localStorage.getItem(STORAGE_KEY);
			if (saved && SUPPORTED.has(saved)) return saved;
		} catch (e) {
			/* ignore storage errors */
		}
		const docLang = document.documentElement && document.documentElement.lang;
		if (docLang && SUPPORTED.has(docLang)) return docLang;
		return DEFAULT_LANG;
	};

	const getByPath = (obj, path) => {
		if (!obj || !path) return undefined;
		return path.split('.').reduce((acc, part) => (acc && Object.prototype.hasOwnProperty.call(acc, part) ? acc[part] : undefined), obj);
	};

	// Determine absolute base path for the `i18n` folder so fetch() uses
	// Determine base path for the `i18n` folder.
	// Use a relative path first to work for both root and nested pages on GitHub Pages.
	const getI18nBasePath = () => {
		try {
			// Prefer relative path from current document, which will resolve to
			// /<repo>/i18n/ when the page is at /<repo>/tortenet.html and to
			// /i18n/ when served at site root.
			return './i18n/';
		} catch (e) {
			return '/i18n/';
		}
	};

	const fetchJson = async (url) => {
		const res = await fetch(url, { cache: 'no-store' });
		if (!res.ok) throw new Error(`Failed to load ${url}: HTTP ${res.status}`);
		return res.json();
	};

	const applyTranslations = (dict, fallbackDict) => {
		const resolve = (key) => {
			if (!key) return undefined;
			const v = getByPath(dict, key);
			if (typeof v === 'string' && v.trim().length > 0) return v;
			if (fallbackDict) {
				const f = getByPath(fallbackDict, key);
				if (typeof f === 'string' && f.trim().length > 0) return f;
			}
			return undefined;
		};

		const metaTitle = resolve('meta.title');
		if (typeof metaTitle === 'string') {
			document.title = metaTitle;
		}

		const metaDesc = resolve('meta.description');
		if (typeof metaDesc === 'string') {
			const meta = document.querySelector('meta[name="description"]');
			if (meta) meta.setAttribute('content', metaDesc);
		}

		document.querySelectorAll('[data-i18n]').forEach((el) => {
			const key = el.getAttribute('data-i18n');
			const value = resolve(key);
			if (typeof value === 'string') el.textContent = value;
		});

		document.querySelectorAll('[data-i18n-html]').forEach((el) => {
			const key = el.getAttribute('data-i18n-html');
			const value = resolve(key);
			if (typeof value === 'string') el.innerHTML = value;
		});

		document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
			const spec = el.getAttribute('data-i18n-attr') || '';
			spec
				.split(';')
				.map((s) => s.trim())
				.filter(Boolean)
				.forEach((pair) => {
					const parts = pair.split(':');
					const attr = parts[0] && parts[0].trim();
					const key = parts[1] && parts[1].trim();
					if (!attr || !key) return;
					const value = resolve(key);
					if (typeof value === 'string') el.setAttribute(attr, value);
				});
		});
	};

	// expose a refresh API later by storing last-loaded dictionaries
	let __lastDict = null;
	let __lastFallback = null;

	const updateLangUi = (lang) => {
		if (!lang) return;
		document.documentElement.lang = lang;
		document.querySelectorAll('[data-set-lang]').forEach((btn) => {
			const isActive = btn.getAttribute('data-set-lang') === lang;
			btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
		});
	};

	const setLang = async (lang) => {
		console.log('[i18n] setLang()', lang);
		if (!SUPPORTED.has(lang)) lang = DEFAULT_LANG;
		try {
			localStorage.setItem(STORAGE_KEY, lang);
		} catch (e) {
			// ignore storage errors
		}
		updateLangUi(lang);

		// Try multiple base paths when loading language files to be resilient on GitHub Pages
		const bases = [getI18nBasePath(), './', '/i18n/'];
		let dict = null;
		let dictBase = null;
		let firstErr = null;
		for (const b of bases) {
			const dictUrl = `${b}${lang}.json`;
			try {
				dict = await fetchJson(dictUrl);
				dictBase = b;
				console.debug('[i18n] fetched', dictUrl);
				break;
			} catch (e) {
				if (!firstErr) firstErr = e;
				console.warn('[i18n] fetch failed', dictUrl, e);
			}
		}

		if (!dict) {
			console.error('[i18n] failed to load any language file for', lang, firstErr);
			// Attempt to fallback to DEFAULT_LANG using same bases
			if (lang !== DEFAULT_LANG) {
				let fallbackLoaded = false;
				for (const b of bases) {
					const defUrl = `${b}${DEFAULT_LANG}.json`;
					try {
						const baseDict = await fetchJson(defUrl);
						applyTranslations(baseDict || {}, {});
						fallbackLoaded = true;
						console.debug('[i18n] applied default translations from', defUrl);
						break;
					} catch (e) {
						console.warn('[i18n] fallback fetch failed', defUrl, e);
					}
				}
				if (!fallbackLoaded) console.warn('[i18n] could not load any default translations');
			}
			return;
		}

		let fallbackDict = null;
		if (lang !== DEFAULT_LANG) {
			for (const b of bases) {
				const fallbackUrl = `${b}${DEFAULT_LANG}.json`;
				try {
					fallbackDict = await fetchJson(fallbackUrl);
					console.debug('[i18n] fetched fallback', fallbackUrl);
					break;
				} catch (e) {
					console.warn('[i18n] fetch failed fallback', fallbackUrl, e);
				}
			}
			if (!fallbackDict) console.warn('[i18n] could not load fallback language');
		}

		applyTranslations(dict || {}, fallbackDict || {});
		__lastDict = dict || {};
		__lastFallback = fallbackDict || {};
		// expose a safe global API to reapply translations for dynamic content
		try {
			window.i18n = window.i18n || {};
			window.i18n.refresh = () => applyTranslations(__lastDict || {}, __lastFallback || {});
			window.i18n.setLang = (l) => setLang(l);
		} catch (e) {
			// ignore if environment disallows global assignment
		}
		console.debug('[i18n] translations applied for', lang);
	};

	const init = () => {
		const lang = getInitialLang();
		console.log('[i18n] init()', 'initial lang=', lang);

		// Click delegation for language buttons (handles clicks on inner text)
		document.addEventListener('click', (e) => {
			let el = e.target;
			while (el && el.nodeType !== Node.ELEMENT_NODE) el = el.parentNode;
			if (!(el instanceof Element)) return;
			const btn = el.closest('[data-set-lang]');
			if (!btn) return;
			e.preventDefault();
			const next = btn.getAttribute('data-set-lang');
			console.log('[i18n] click on', btn, '->', next);
			if (!next) return;
			setLang(next);
		});

		// Keyboard support for focused language controls
		document.addEventListener('keydown', (e) => {
			if (e.key !== 'Enter' && e.key !== ' ') return;
			const active = document.activeElement;
			if (!(active instanceof Element)) return;
			if (active.hasAttribute('data-set-lang')) {
				e.preventDefault();
				const next = active.getAttribute('data-set-lang');
				if (next) setLang(next);
			}
		});

		setLang(lang);
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
