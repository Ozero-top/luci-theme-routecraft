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

	/* 概况页：DHCP 租约表默认折叠，只留设备数与展开按钮。
	   LuCI 的视图是异步实例化的，用 MutationObserver 等它渲染完。 */
	function collapseLeases() {
		if (document.body.getAttribute('data-page') !== 'admin-status-overview') return;
		var view = document.getElementById('view');
		if (!view) return;
		Array.prototype.forEach.call(view.children, function (sec) {
			if (sec.getAttribute('data-rc-lease')) return;
			var h = sec.querySelector('h3');
			if (!h || h.textContent.indexOf('租约') < 0) return;
			var table = sec.querySelector('.table');
			if (!table) return;
			var wrap = table.parentElement;
			var rows = [].filter.call(sec.querySelectorAll('.tr'), function (tr) {
				return tr.children.length && tr.children[0].tagName === 'TD';
			});
			if (rows.length < 4) return;
			sec.setAttribute('data-rc-lease', '1');
			wrap.classList.add('rc-lease-body');
			var btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'rc-lease-toggle';
			btn.innerHTML = '<b>' + rows.length + ' 台设备</b><span>' + h.textContent.trim() + '</span><i>展开</i>';
			btn.addEventListener('click', function () {
				var open = sec.classList.toggle('rc-lease-open');
				btn.querySelector('i').textContent = open ? '收起' : '展开';
			});
			sec.insertBefore(btn, wrap);
		});
	}

	/* 易有云状态卡体积小，单独占一格会留下大片空白，
	   直接并到「端口状态」卡底部，填掉端口卡下方的空白区。
	   注意它由 include 渲染，节点在 #maincontent > .includes 里，不在 #view 内。 */
	function mergeYiyouyun() {
		if (document.body.getAttribute('data-page') !== 'admin-status-overview') return;
		var ports = null, yy = null;
		Array.prototype.forEach.call(document.querySelectorAll('#view > .cbi-section'), function (sec) {
			var h = sec.querySelector('h3');
			if (h && h.textContent.indexOf('端口状态') >= 0) ports = sec;
		});
		Array.prototype.forEach.call(document.querySelectorAll('#maincontent .cbi-section'), function (sec) {
			var h = sec.querySelector('h3') || sec.querySelector('legend');
			if (h && h.textContent.indexOf('易有云') >= 0) yy = sec;
		});
		if (!ports || !yy || ports.contains(yy)) return;
		ports.classList.add('rc-ports-merged');
		ports.appendChild(yy);
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

		var refresh = function () { collapseLeases(); mergeYiyouyun(); };
		refresh();
		var main = document.getElementById('maincontent');
		if (main && document.body.getAttribute('data-page') === 'admin-status-overview') {
			/* 视图与 include 都是异步渲染，观察整个容器；用 150ms 防抖避开轮询刷新 */
			var pending = null;
			var schedule = function () {
				if (pending) return;
				pending = setTimeout(function () { pending = null; refresh(); }, 150);
			};
			new MutationObserver(schedule).observe(main, { childList: true, subtree: true });
			setTimeout(refresh, 1500);
		}
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
