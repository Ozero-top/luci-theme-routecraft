/* RouteCraft theme runtime: dark/light mode + mobile nav */
(function () {
	var KEY = 'rc-dark';

	function isDark() {
		return document.documentElement.getAttribute('data-darkmode') === 'true';
	}

	function label() {
		return isDark() ? 'MODE · LIGHT' : 'MODE · DARK';
	}

	function apply(dark, persist) {
		document.documentElement.setAttribute('data-darkmode', dark ? 'true' : 'false');
		if (document.body)
			document.body.setAttribute('theme', dark ? 'dark' : 'light');
		window.__rcDark = dark;
		if (persist) {
			try { localStorage.setItem(KEY, dark ? 'true' : 'false'); } catch (e) {}
		}
		var b1 = document.getElementById('rc-mode');
		if (b1) b1.textContent = label();
		var b2 = document.getElementById('rc-login-mode');
		if (b2) b2.textContent = label();
	}

	function bind(id) {
		var b = document.getElementById(id);
		if (b) b.addEventListener('click', function () { apply(!isDark(), true); });
	}

	document.addEventListener('DOMContentLoaded', function () {
		apply(isDark(), false);
		bind('rc-mode');
		bind('rc-login-mode');

		var burger = document.getElementById('rc-burger');
		var mask = document.getElementById('rc-nav-mask');
		if (burger)
			burger.addEventListener('click', function () {
				document.body.classList.toggle('rc-nav-open');
			});
		if (mask)
			mask.addEventListener('click', function () {
				document.body.classList.remove('rc-nav-open');
			});
	});

	/* follow OS theme while the user has not picked one manually */
	try {
		var mq = window.matchMedia('(prefers-color-scheme: dark)');
		mq.addEventListener('change', function (ev) {
			var saved = null;
			try { saved = localStorage.getItem(KEY); } catch (e) {}
			if (saved === null) apply(ev.matches, false);
		});
	} catch (e) {}
})();
