/* RouteCraft — quickstart 替换首页数据引擎
   纯浏览器端实现：fetch 直连 /ubus，token 由模板注入 window.rcHomeToken。
   不依赖 luci.js / vue，页面挂掉不影响后台其他功能。 */
(function () {
	'use strict';

	var SID = (window.L && L.env && L.env.sessionid) || window.rcHomeToken || '00000000000000000000000000000000';
	var UBUS_URL = (window.L && L.env && L.env.ubuspath) || '/ubus';
	var $ = function (id) { return document.getElementById(id); };

	/* ---------- ubus 调用 ---------- */
	var _id = 0;
	function ubus(obj, method, params) {
		return fetch(UBUS_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0', id: ++_id, method: 'call',
				params: [SID, obj, method, params || {}]
			})
		}).then(function (r) { return r.json(); }).then(function (res) {
			if (res.error) throw res.error;
			if (!res.result || res.result[0] !== 0) throw res.result;
			return res.result[1];
		});
	}

	/* ---------- 格式化 ---------- */
	function fmtBytes(b) {
		b = Number(b) || 0;
		if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
		if (b >= 1048576) return (b / 1048576).toFixed(0) + ' MB';
		if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
		return b + ' B';
	}
	function fmtUptime(sec) {
		sec = Math.floor(sec);
		var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600),
			m = Math.floor(sec % 3600 / 60);
		var hm = ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2);
		return d > 0 ? d + 'd ' + hm : hm;
	}
	function fmtRate(mbps, valEl, unitEl) {
		if (mbps >= 1) { valEl.textContent = mbps.toFixed(1); unitEl.textContent = 'Mbps'; }
		else { valEl.textContent = (mbps * 1024).toFixed(0); unitEl.textContent = 'Kbps'; }
	}
	function cssVar(n) {
		return getComputedStyle(document.body).getPropertyValue(n).trim();
	}
	function rgba(hex, a) {
		var h = hex.replace('#', '');
		if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
		var n = parseInt(h, 16);
		return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
	}

	/* ---------- 运行时间（本地走时） ---------- */
	var uptimeSec = 0;
	setInterval(function () {
		if (uptimeSec > 0) {
			uptimeSec++;
			var t = fmtUptime(uptimeSec);
			$('rch-c-up').textContent = t;
			$('rch-hero-up').textContent = t;
		}
		var d = new Date();
		$('rch-c-time').textContent =
			('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
	}, 1000);

	/* ---------- 系统信息 ---------- */
	function loadSystem() {
		ubus('system', 'board').then(function (b) {
			$('rch-host').textContent = b.hostname || 'router';
			$('rch-c-model').textContent = b.model || b.board_name || '—';
			$('rch-c-kernel').textContent = b.kernel || '—';
			$('rch-c-arch').textContent = (b.system || '').split(' ')[0] || '—';
			$('rch-c-fw').textContent = (b.release && (b.release.description || b.release.version)) || '—';
		}).catch(function () {});

		ubus('system', 'info').then(function (i) {
			uptimeSec = i.uptime || 0;
			var t = fmtUptime(uptimeSec);
			$('rch-c-up').textContent = t;
			$('rch-hero-up').textContent = t;

			var load = (i.load || [0, 0, 0]).map(function (v) { return (v / 65536).toFixed(2); });
			$('rch-load-big').textContent = load[0];
			$('rch-load1').textContent = load[0];
			$('rch-load5').textContent = load[1];
			$('rch-load15').textContent = load[2];
			$('rch-hero-load').textContent = load[0];

			var mem = i.memory || {};
			var total = mem.total || 0, free = mem.free || 0, buf = mem.buffered || 0;
			var used = Math.max(total - free - buf, 0);
			var pct = total ? Math.round(used / total * 100) : 0;
			$('rch-mem-pct').textContent = pct;
			$('rch-mem-bar').style.width = pct + '%';
			$('rch-mem-total').textContent = fmtBytes(total);
			$('rch-mem-avail').textContent = fmtBytes(free + buf);
			$('rch-mem-buf').textContent = fmtBytes(buf);
			$('rch-hero-mem').textContent = fmtBytes(free + buf);

			var root = i.root || {};
			if (root.total) {
				/* ubus root 统计单位是 KiB */
				var rt = root.total * 1024, ru = (root.used || 0) * 1024;
				var rpct = Math.round(ru / rt * 100);
				$('rch-sto-pct').textContent = rpct;
				$('rch-sto-bar').style.width = rpct + '%';
				$('rch-sto-used').textContent = fmtBytes(ru);
				$('rch-sto-total').textContent = fmtBytes(rt);
			}
		}).catch(function () {});
	}

	/* ---------- 接口 ---------- */
	var rateDevices = [];   /* 参与速率采样的底层设备名 */
	var lastCounters = {};  /* dev -> {rx, tx, t} */
	var histRX = [], histTX = [];
	var HIST_LEN = 60;
	for (var i = 0; i < HIST_LEN; i++) { histRX.push(0); histTX.push(0); }

	function ifaceIcon(name) {
		name = (name || '').toUpperCase();
		if (name.indexOf('WAN') === 0) return 'WAN';
		if (name.indexOf('LAN') === 0) return 'LAN';
		if (name.indexOf('WG') === 0) return 'WG';
		if (name.indexOf('VPN') >= 0 || name.indexOf('TUN') === 0) return 'VPN';
		if (name.indexOf('DOCKER') === 0) return 'DCK';
		if (name.indexOf('WWAN') === 0) return '4G';
		return name.slice(0, 3) || '?';
	}

	/* 物理网口：原 quickstart 首页展示的是 eth0/eth1… 这些物理端口 */
	function fmtLink(s) {
		var m = /([\d.]+)\s*Mbit/.exec(s || '');
		if (!m) return s || '—';
		var v = Number(m[1]);
		return v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + ' Gbps' : v + ' Mbps';
	}

	function renderPorts(res) {
		var list = $('rch-iface-list');
		var rows = [];
		((res && res.interfaces) || []).forEach(function (it) {
			(it.ports || []).forEach(function (p) { rows.push({ it: it, p: p }); });
		});
		rows.sort(function (a, b) {
			var ra = a.it.firewallType === 'wan' ? 0 : 1;
			var rb = b.it.firewallType === 'wan' ? 0 : 1;
			if (ra !== rb) return ra - rb;
			return String(a.p.name).localeCompare(String(b.p.name));
		});
		list.innerHTML = '';
		rows.forEach(function (x) {
			var it = x.it, p = x.p;
			var up = String(p.linkState || '').toUpperCase() === 'UP';
			var role = it.firewallType === 'wan' ? 'WAN' : 'LAN';
			var sub = [
				it.ipv4Addr || '',
				fmtLink(p.linkSpeed),
				p.duplex === 'full' ? '全双工' : (p.duplex === 'half' ? '半双工' : ''),
				it.portName || ''
			].filter(Boolean).join(' · ');
			var row = document.createElement('div');
			row.className = 'rch-iface-row';
			row.innerHTML =
				'<div class="rch-iface-ic' + (up ? ' on' : '') + '">' + role + '</div>' +
				'<div><h4>' + esc(p.name || '—') + '</h4><div class="sub">' + esc(sub) + '</div></div>' +
				'<span class="rch-pill ' + (up ? 'up' : 'down') + '">' + (up ? 'UP' : 'DOWN') + '</span>';
			list.appendChild(row);
		});
		if (!rows.length) list.innerHTML = '<div class="rch-iface-row"><div class="sub">未获取到网口数据</div></div>';
	}

	function renderIfaces(dump) {
		var list = $('rch-iface-list');
		list.innerHTML = '';
		var rows = (dump && dump.interface) || [];
		rows = rows.filter(function (r) { return r.interface !== 'loopback'; });
		rows.sort(function (a, b) { return (b.up ? 1 : 0) - (a.up ? 1 : 0); });

		rows.forEach(function (r) {
			var dev = r.l3_device || r.device || '—';
			var ip4 = (r['ipv4-address'] && r['ipv4-address'][0]);
			var sub = ip4 ? ip4.address + '/' + ip4.mask : (r.proto || '');
			sub += ' · ' + (r.proto || '—');
			if (r.up && r.uptime) sub += ' · ' + fmtUptime(r.uptime);

			var row = document.createElement('div');
			row.className = 'rch-iface-row';
			row.innerHTML =
				'<div class="rch-iface-ic' + (r.up ? ' on' : '') + '">' + ifaceIcon(r.interface) + '</div>' +
				'<div><h4>' + dev + '</h4><div class="sub">' + sub + '</div></div>' +
				'<span class="rch-pill ' + (r.up ? 'up' : 'down') + '">' + (r.up ? 'UP' : 'DOWN') + '</span>';
			list.appendChild(row);
		});
		if (!rows.length) list.innerHTML = '<div class="rch-iface-row"><div class="sub">未获取到接口数据</div></div>';
	}

	function renderWanDetail(dump) {
		var wan = null;
		((dump && dump.interface) || []).forEach(function (r) {
			if (!wan && r.interface === 'wan') wan = r;
		});
		if (!wan) ((dump && dump.interface) || []).forEach(function (r) {
			if (!wan && r.up) wan = r;
		});
		var tb = $('rch-wan-detail');
		if (!wan) { tb.innerHTML = '<tr><td>状态</td><td>无在线 WAN</td></tr>'; return; }

		$('rch-wan-proto').textContent = wan.proto || '—';
		var ip4 = (wan['ipv4-address'] && wan['ipv4-address'][0]);
		var ip6 = (wan['ipv6-address'] && wan['ipv6-address'][0]);
		var dns = (wan['dns-server'] || []).slice(0, 2).join('  ') || '—';
		var rows = [
			['接口', wan.interface],
			['设备', wan.l3_device || wan.device || '—'],
			['协议', wan.proto || '—'],
			['IPv4', ip4 ? ip4.address + ' /' + ip4.mask : '—'],
			['IPv6', ip6 ? ip6.address : '—'],
			['DNS', dns],
			['在线时长', wan.uptime ? fmtUptime(wan.uptime) : '—']
		];
		tb.innerHTML = rows.map(function (r) {
			return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>';
		}).join('');

		/* 速率采样设备：优先 WAN 的 l3_device */
		var dev = wan.l3_device || wan.device;
		if (dev) {
			rateDevices = [dev];
			$('rch-rx-dev').textContent = dev;
			$('rch-tx-dev').textContent = dev;
			$('rch-chart-note').textContent = '接口 ' + dev + ' · 窗口 120s';
		}
	}

	/* ---------- 速率采样 + 流量图 ---------- */
	function sampleRates() {
		if (!rateDevices.length) return;
		Promise.all(rateDevices.map(function (d) {
			return ubus('network.device', 'status', { name: d }).then(function (s) {
				return { dev: d, st: (s && s.statistics) || {} };
			}).catch(function () { return null; });
		})).then(function (res) {
			var now = Date.now(), rx = 0, tx = 0, ok = false;
			res.forEach(function (r) {
				if (!r) return;
				var cur = { rx: r.st.rx_bytes || 0, tx: r.st.tx_bytes || 0, t: now };
				var last = lastCounters[r.dev];
				if (last && cur.rx >= last.rx && cur.tx >= last.tx) {
					var dt = (now - last.t) / 1000;
					if (dt > 0) {
						rx += (cur.rx - last.rx) * 8 / 1e6 / dt;
						tx += (cur.tx - last.tx) * 8 / 1e6 / dt;
						ok = true;
					}
				}
				lastCounters[r.dev] = cur;
			});
			if (!ok) return;
			histRX.push(rx); histRX.shift();
			histTX.push(tx); histTX.shift();
			fmtRate(rx, $('rch-rx'), $('rch-rx-unit'));
			fmtRate(tx, $('rch-tx'), $('rch-tx-unit'));
			drawChart();
		});
	}

	function niceMax(v) {
		var steps = [1, 2, 2.5, 5], base = 1;
		while (base * 10 <= v) base *= 10;
		for (var i = 0; i < steps.length; i++)
			if (steps[i] * base >= v) return steps[i] * base;
		return base * 10;
	}

	function drawChart() {
		var c = $('rch-traffic'); if (!c) return;
		var ctx = c.getContext('2d'), dpr = window.devicePixelRatio || 1;
		var w = c.clientWidth, h = c.clientHeight;
		if (!w || !h) return;
		if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);

		var pad = 16, ph = h - pad * 2 - 8;
		var peak = Math.max.apply(null, histRX.concat(histTX).concat([1]));
		var max = niceMax(peak * 1.2);

		/* 网格 + Y 轴刻度 */
		ctx.strokeStyle = cssVar('--rc-line'); ctx.lineWidth = 1;
		ctx.fillStyle = cssVar('--rc-mute'); ctx.font = '9px "IBM Plex Mono", monospace';
		for (var g = 0; g <= 4; g++) {
			var y = pad + ph / 4 * g;
			ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
			ctx.fillText((max * (1 - g / 4)).toFixed(max >= 10 ? 0 : 1) + '', 6, y - 3);
		}
		ctx.fillText('Mbps', w - 36, pad - 4);

		function plot(data, color, fill) {
			ctx.beginPath();
			data.forEach(function (v, i) {
				var x = i / (data.length - 1) * w,
					y = pad + ph * (1 - Math.min(Math.max(v, 0), max) / max);
				i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
			});
			ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.stroke();
			if (fill) {
				ctx.lineTo(w, pad + ph); ctx.lineTo(0, pad + ph); ctx.closePath();
				ctx.fillStyle = fill; ctx.fill();
			}
		}
		plot(histTX, cssVar('--rc-steel'));
		plot(histRX, cssVar('--rc-orange'), rgba(cssVar('--rc-orange'), .08));
	}
	window.addEventListener('resize', drawChart);

	/* ---------- 服务 ---------- */
	var SVC_WATCH = [
		['dockerd', 'Docker'], ['ttyd', 'TTYD 终端'], ['samba4', 'SMB 共享'],
		['wsdd2', 'WSD 发现'], ['ddns', 'DDNS'], ['smartdns', 'SmartDNS'],
		['mosdns', 'MosDNS'], ['adguardhome', 'AdGuard Home'], ['mwan3', 'MWAN3 负载均衡'],
		['openclash', 'OpenClash'], ['passwall', 'PassWall'], ['passwall2', 'PassWall2'],
		['aria2', 'Aria2'], ['transmission', 'Transmission'], ['qbittorrent', 'qBittorrent'],
		['zerotier', 'ZeroTier'], ['tailscaled', 'Tailscale'], ['frpc', 'FRP 客户端'],
		['frps', 'FRP 服务端'], ['alist', 'Alist'], ['jellyfin', 'Jellyfin'],
		['unishare', '统一共享'], ['linkease', '易有云'], ['quickstart', 'QuickStart']
	];

	function loadServices() {
		ubus('rc', 'list').then(function (rc) {
			var list = $('rch-svc-list');
			list.innerHTML = '';
			var found = 0;
			SVC_WATCH.forEach(function (w) {
				var svc = rc && rc[w[0]];
				if (!svc) return;
				found++;
				var running = !!svc.running;
				var row = document.createElement('div');
				row.className = 'rch-svc-row';
				row.innerHTML =
					'<span class="rch-svc-dot' + (running ? ' on' : '') + '"></span>' +
					'<div><h4>' + w[1] + '</h4><div class="sub">' + w[0] + (svc.enabled ? ' · ENABLED' : '') + '</div></div>' +
					'<span class="rch-pill ' + (running ? 'up' : 'down') + '">' + (running ? 'RUNNING' : 'STOPPED') + '</span>';
				list.appendChild(row);
			});
			if (!found)
				list.innerHTML = '<div class="rch-svc-row"><div class="sub">未检测到受管服务</div></div>';
		}).catch(function () {
			$('rch-svc-list').innerHTML = '<div class="rch-svc-row"><div class="sub">rc 服务状态不可用</div></div>';
		});
	}

	/* ---------- istore API（原 quickstart 首页功能的数据源） ---------- */
	var ISTORE_URL = '/cgi-bin/luci/istore';
	function istore(path, opts) {
		opts = opts || {};
		return fetch(ISTORE_URL + path, {
			method: opts.method || 'GET',
			credentials: 'same-origin',
			headers: opts.body ? { 'Content-Type': 'application/json;charset=utf-8' } : undefined,
			body: opts.body ? JSON.stringify(opts.body) : undefined
		}).then(function (r) { return r.json(); }).then(function (j) {
			if (j && j.error) throw (j.error.message || j.error);
			return j && j.result !== undefined ? j.result : j;
		});
	}
	/* 原应用约定：success 为 0 表示成功，其余带 error */
	function istorePost(path, body) {
		return istore(path, { method: 'POST', body: body }).then(function (r) {
			r = r || {};
			if (typeof r.success === 'number' && r.success !== 0) throw (r.error || '操作失败');
			return r;
		});
	}

	/* ---------- 弹窗框架 ---------- */
	var modalRoot = $('rch-modal'), modalBody = $('rch-modal-body'), modalTitle = $('rch-modal-title');
	var modalBox = modalRoot.querySelector('.rch-modal-box');
	/* 挂到 body 直接子级：祖先若带 transform/filter，会让 position:fixed 相对祖先定位，
	   遮罩就只能盖住内容区一角（灰块）。移出来保证覆盖整个视口。 */
	if (modalRoot.parentNode !== document.body) document.body.appendChild(modalRoot);
	function openModal(title, html, opts) {
		opts = opts || {};
		modalTitle.textContent = title;
		modalBody.innerHTML = html;
		modalBox.className = 'rch-modal-box' + (opts.wide ? ' wide' : '');
		modalRoot.hidden = false;
		document.body.style.overflow = 'hidden';
	}
	function closeModal() {
		modalRoot.hidden = true;
		document.body.style.overflow = '';
	}
	modalRoot.addEventListener('click', function (e) {
		if (e.target.getAttribute && e.target.getAttribute('data-close')) closeModal();
	});
	document.addEventListener('keydown', function (e) {
		if (e.key === 'Escape' && !modalRoot.hidden) closeModal();
	});
	function modalAlert(kind, msg) {
		var a = modalBody.querySelector('.rch-modal-alert');
		if (!a) {
			a = document.createElement('div');
			modalBody.insertBefore(a, modalBody.firstChild);
		}
		a.className = 'rch-modal-alert ' + kind;
		a.textContent = msg;
		a.scrollIntoView();
	}
	var LOADING = '<div class="rch-modal-loading">加载中…</div>';
	function ipOk(v) { return /^(\d{1,3}\.){3}\d{1,3}$/.test(v); }
	function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

	/* ---------- 局域网设备管理（原 quickstart devicemanagement） ---------- */
	var dmState = { tab: 'devices', devices: [], static: [], limited: [], global: null, filter: '', loaded: false };

	function dmShell() {
		return '<div class="rch-dm">' +
			'<div class="rch-dm-tabs">' +
				'<button type="button" class="rch-dm-tab on" data-dmtab="devices">设备列表</button>' +
				'<button type="button" class="rch-dm-tab" data-dmtab="static">静态分配列表</button>' +
				'<button type="button" class="rch-dm-tab" data-dmtab="limit">限速设备列表</button>' +
				'<button type="button" class="rch-dm-tab" data-dmtab="global">全局设置</button>' +
			'</div>' +
			'<div class="rch-dm-bar">' +
				'<input type="text" id="rch-dm-search" placeholder="请输入名称 / IP / MAC…">' +
				'<button type="button" class="rch-dm-refresh" id="rch-dm-refresh">刷新</button>' +
			'</div>' +
			'<div class="rch-dm-pane" id="rch-dm-pane"><div class="rch-modal-loading">加载中…</div></div>' +
		'</div>';
	}

	function dmOpen() {
		openModal('局域网设备管理', dmShell(), { wide: true });
		bindDmEvents();
		if (dmState.loaded) dmPaint(); else dmLoadAll();
	}

	function bindDmEvents() {
		modalBody.querySelectorAll('.rch-dm-tab').forEach(function (b) {
			b.addEventListener('click', function () { dmSwitchTab(b.getAttribute('data-dmtab')); });
		});
		var s = $('rch-dm-search');
		if (s) s.addEventListener('input', function () {
			dmState.filter = this.value.trim().toLowerCase();
			dmPaint();
		});
		var r = $('rch-dm-refresh');
		if (r) r.addEventListener('click', function () {
			r.disabled = true;
			dmLoadAll().then(function () { r.disabled = false; });
		});
	}

	function dmSwitchTab(tab) {
		dmState.tab = tab;
		modalBody.querySelectorAll('.rch-dm-tab').forEach(function (b) {
			b.classList.toggle('on', b.getAttribute('data-dmtab') === tab);
		});
		dmPaint();
	}

	function dmLoadAll() {
		return Promise.all([
			istore('/lanctrl/listDevices/').catch(function () { return []; }),
			istore('/lanctrl/listStaticDevices/').catch(function () { return []; }),
			istore('/lanctrl/listSpeedLimitedDevices/').catch(function () { return '__unsupported__'; }),
			istore('/lanctrl/globalConfigs/').catch(function () { return null; })
		]).then(function (r) {
			/* listDevices 实际返回 {result:{devices:[...]}}，istore() 已剥掉 result */
			var dev = r[0];
			dmState.devices = Array.isArray(dev) ? dev : ((dev && dev.devices) || []);
			dmState.static = Array.isArray(r[1]) ? r[1] : ((r[1] && r[1].devices) || []);
			dmState.limited = (r[2] === '__unsupported__') ? null : (Array.isArray(r[2]) ? r[2] : ((r[2] && r[2].devices) || []));
			dmState.global = r[3] || null;
			dmState.loaded = true;
			var cnt = $('rch-qc-devcount');
			if (cnt) cnt.textContent = dmState.devices.length + ' 台';
			dmPaint();
		});
	}

	function dmPaint() {
		var pane = $('rch-dm-pane');
		if (!pane) return;
		if (!dmState.loaded) { pane.innerHTML = '<div class="rch-modal-loading">加载中…</div>'; return; }
		pane.innerHTML = dmState.tab === 'devices' ? dmRenderDevices()
			: dmState.tab === 'static' ? dmRenderStatic()
			: dmState.tab === 'limit' ? dmRenderLimit()
			: dmRenderGlobal();
	}

	function dmRenderDevices() {
		var q = dmState.filter;
		var list = dmState.devices.filter(function (d) {
			if (!q) return true;
			return (d.hostname || '').toLowerCase().indexOf(q) >= 0
				|| (d.ip || '').indexOf(q) >= 0
				|| (d.mac || '').toLowerCase().indexOf(q) >= 0;
		});
		if (!list.length) return '<div class="rch-modal-empty">没有匹配的设备</div>';
		return '<table class="rch-dm-table"><thead><tr>' +
			'<th>主机名称</th><th>IP 地址</th><th>MAC 地址</th><th>上传速度</th><th>下载速度</th><th>标签</th><th>操作</th>' +
			'</tr></thead><tbody>' + list.map(function (d) {
			var tags = '';
			tags += (d.staticAssigned && d.staticAssigned.assignedIP)
				? '<span class="rch-dm-tag">静态</span>'
				: '<span class="rch-dm-tag mute">动态</span>';
			if (d.speedLimit && d.speedLimit.networkAccess === false)
				tags += '<span class="rch-dm-tag warn">已限制</span>';
			var i = dmState.devices.indexOf(d);
			return '<tr>' +
				'<td class="nm">' + esc(d.hostname || '—') + '</td>' +
				'<td>' + esc(d.ip || '—') + '</td>' +
				'<td>' + esc(d.mac || '—') + '</td>' +
				'<td>' + esc(d.uploadSpeedStr || '—') + '</td>' +
				'<td>' + esc(d.downloadSpeedStr || '—') + '</td>' +
				'<td>' + tags + '</td>' +
				'<td class="rch-dm-acts">' +
					'<a href="#" data-dmact="static" data-i="' + i + '">静态分配</a>' +
					'<a href="#" data-dmact="limit" data-i="' + i + '">限速配置</a>' +
					'<a href="#" data-dmact="detail" data-i="' + i + '">详情</a>' +
				'</td></tr>';
		}).join('') + '</tbody></table>';
	}

	function dmRenderStatic() {
		var list = dmState.static || [];
		if (!list.length) return '<div class="rch-modal-empty">暂无静态分配记录</div>';
		return '<table class="rch-dm-table"><thead><tr>' +
			'<th>主机名称</th><th>IP 地址</th><th>MAC 地址</th><th>绑定</th><th>操作</th>' +
			'</tr></thead><tbody>' + list.map(function (d, i) {
			return '<tr>' +
				'<td class="nm">' + esc(d.hostname || '—') + '</td>' +
				'<td>' + esc(d.assignedIP || '—') + '</td>' +
				'<td>' + esc(d.assignedMac || '—') + '</td>' +
				'<td><span class="rch-dm-tag">静态</span></td>' +
				'<td class="rch-dm-acts"><a href="#" data-dmrust="' + i + '">解除绑定</a></td>' +
			'</tr>';
		}).join('') + '</tbody></table>';
	}

	function dmRenderLimit() {
		if (dmState.limited === null)
			return '<div class="rch-modal-empty">当前设备不支持限速（后端未启用 eqos 流量控制）</div>';
		var list = dmState.limited || [];
		if (!list.length) return '<div class="rch-modal-empty">暂无已限速设备</div>';
		return '<table class="rch-dm-table"><thead><tr>' +
			'<th>IP 地址</th><th>MAC 地址</th><th>网络访问</th><th>上传限速</th><th>下载限速</th><th>注解</th>' +
			'</tr></thead><tbody>' + list.map(function (d) {
			return '<tr>' +
				'<td>' + esc(d.ip || '—') + '</td>' +
				'<td>' + esc(d.mac || '—') + '</td>' +
				'<td>' + (d.networkAccess === false ? '<span class="rch-dm-tag warn">禁止</span>' : '<span class="rch-dm-tag">允许</span>') + '</td>' +
				'<td>' + esc(d.uploadSpeed ? d.uploadSpeed + ' Mbit/s' : '—') + '</td>' +
				'<td>' + esc(d.downloadSpeed ? d.downloadSpeed + ' Mbit/s' : '—') + '</td>' +
				'<td>' + esc(d.comment || '—') + '</td>' +
			'</tr>';
		}).join('') + '</tbody></table>';
	}

	function dmRenderGlobal() {
		var g = dmState.global || {};
		var dhcp = g.dhcpGlobal || {};
		var tags = g.dhcpTags || [];
		var gw = (dhcp.gatewaySels || []).map(function (x) { return x.title || x.ip || x; }).join('、') || '—';
		return '<div class="rch-dm-global">' +
			'<div class="rch-dm-gitem"><label>DHCP 服务</label><b>' + (dhcp.dhcpEnabled ? '已启用' : '已关闭') + '</b></div>' +
			'<div class="rch-dm-gitem"><label>可选网关</label><b>' + esc(gw) + '</b></div>' +
			'<div class="rch-dm-gitem"><label>浮动网关</label><b>' + (g.floatGateway && Object.keys(g.floatGateway).length ? '已配置' : '未配置') + '</b></div>' +
			'<div class="rch-dm-gitem"><label>限速</label><b>' + (g.speedLimit && Object.keys(g.speedLimit).length ? '已配置' : '未配置') + '</b></div>' +
			'<div class="rch-dm-taglist"><label>DHCP 标签</label>' + (tags.length
				? tags.map(function (t) {
					return '<span class="rch-dm-tag">' + esc(t.tagTitle || t.tagName || '—') +
						(t.gateway ? ' · ' + esc(t.gateway) : '') + '</span>';
				}).join('')
				: '<span class="rch-dm-tag mute">无</span>') + '</div>' +
			'<p class="rch-f-note">如需修改 DHCP 网关 / 标签 / 浮动网关等高级设置，请到「网络 → 接口」或原版向导页操作。</p>' +
		'</div>';
	}

	/* 设备行操作（事件委托，只绑一次） */
	modalBody.addEventListener('click', function (e) {
		var t = e.target;
		var a = t.closest ? t.closest('[data-dmact]') : null;
		if (a) {
			e.preventDefault();
			var d = dmState.devices[Number(a.getAttribute('data-i'))];
			if (!d) return;
			var act = a.getAttribute('data-dmact');
			if (act === 'static') dmStaticDialog(d);
			else if (act === 'limit') dmLimitDialog(d);
			else dmDetailDialog(d);
			return;
		}
		var r = t.closest ? t.closest('[data-dmrust]') : null;
		if (r) {
			e.preventDefault();
			dmUnbindStatic(dmState.static[Number(r.getAttribute('data-dmrust'))]);
		}
	});

	function dmUnbindStatic(item) {
		if (!item) return;
		istorePost('/lanctrl/staticDeviceConfig/', {
			ip: item.assignedIP, mac: item.assignedMac,
			hostname: item.hostname || '',
			assignedMac: item.assignedMac,
			bindIP: false, assignedIP: '',
			dhcpGateway: 'myself'
		}).then(function () {
			modalAlert('ok', '已解除绑定');
			dmLoadAll();
		}).catch(function (e) {
			modalAlert('err', '解除失败：' + e);
		});
	}

	function dmStaticDialog(d) {
		var gws = (dmState.global && dmState.global.dhcpGlobal && dmState.global.dhcpGlobal.gatewaySels) || [{ title: 'myself' }];
		var cur = d.staticAssigned || {};
		var bind = !!cur.assignedIP;
		openModal('静态分配 · ' + (d.hostname || d.ip),
			'<div class="rch-f-row"><label>主机名称</label><input type="text" value="' + esc(d.hostname || '') + '" disabled></div>' +
			'<div class="rch-f-row"><label>MAC 地址</label><input type="text" value="' + esc(d.mac) + '" disabled></div>' +
			'<div class="rch-f-row"><label>当前 IP 地址</label><input type="text" value="' + esc(d.ip) + '" disabled></div>' +
			'<label class="rch-f-check"><input type="checkbox" id="rch-sa-bind"' + (bind ? ' checked' : '') + '>绑定静态 IP</label>' +
			'<div id="rch-sa-ipwrap"' + (bind ? '' : ' style="display:none"') + '>' +
				'<div class="rch-f-row"><label>静态 IP 地址</label><input type="text" id="rch-sa-ip" value="' + esc(cur.assignedIP || d.ip) + '"></div>' +
			'</div>' +
			'<div class="rch-f-row"><label>网关</label><select id="rch-sa-gw">' + gws.map(function (g) {
				var v = g.title || g.ip || g;
				return '<option value="' + esc(v) + '">' + esc(v === 'myself' ? '本机（自动）' : v) + '</option>';
			}).join('') + '</select></div>' +
			'<p class="rch-f-note">绑定后该设备每次上线都会拿到同一个 IP；取消勾选则恢复动态分配。</p>' +
			'<div class="rch-modal-actions">' +
				'<button class="rch-btn ghost" id="rch-sa-back">返回列表</button>' +
				'<button class="rch-btn" id="rch-sa-save">保存</button>' +
			'</div>');
		$('rch-sa-bind').addEventListener('change', function () {
			$('rch-sa-ipwrap').style.display = this.checked ? '' : 'none';
		});
		$('rch-sa-back').addEventListener('click', dmOpen);
		$('rch-sa-save').addEventListener('click', function () {
			var on = $('rch-sa-bind').checked;
			var ip = $('rch-sa-ip').value.trim();
			if (on && !ipOk(ip)) { modalAlert('err', '静态 IP 地址格式不正确'); return; }
			var btn = this;
			btn.disabled = true; btn.textContent = '保存中…';
			istorePost('/lanctrl/staticDeviceConfig/', {
				ip: d.ip, mac: d.mac, hostname: d.hostname || '',
				assignedMac: d.mac,
				bindIP: on,
				assignedIP: on ? ip : '',
				dhcpGateway: $('rch-sa-gw').value
			}).then(function () {
				modalAlert('ok', '保存成功');
				btn.disabled = false; btn.textContent = '保存';
				dmLoadAll();
			}).catch(function (e) {
				modalAlert('err', '保存失败：' + e);
				btn.disabled = false; btn.textContent = '保存';
			});
		});
	}

	function dmLimitDialog(d) {
		var lim = d.speedLimit || {};
		var blocked = lim.networkAccess === false;
		openModal('限速配置 · ' + (d.hostname || d.ip),
			'<div class="rch-f-row"><label>IP 地址</label><input type="text" value="' + esc(d.ip) + '" disabled></div>' +
			'<div class="rch-f-row"><label>MAC 地址</label><input type="text" value="' + esc(d.mac) + '" disabled></div>' +
			'<label class="rch-f-check"><input type="checkbox" id="rch-sl-block"' + (blocked ? ' checked' : '') + '>禁止该设备访问网络</label>' +
			'<div id="rch-sl-rate"' + (blocked ? ' style="display:none"' : '') + '>' +
				'<div class="rch-f-row"><label>下载限速（Mbit/s）</label><input type="text" id="rch-sl-down" value="' + esc(lim.downloadSpeed || '') + '" placeholder="如 100"></div>' +
				'<div class="rch-f-row"><label>上传限速（Mbit/s）</label><input type="text" id="rch-sl-up" value="' + esc(lim.uploadSpeed || '') + '" placeholder="如 10"></div>' +
			'</div>' +
			'<div class="rch-f-row"><label>注解（可选）</label><input type="text" id="rch-sl-comment" value="' + esc(lim.comment || '') + '" placeholder="如 访客设备"></div>' +
			'<p class="rch-f-note">禁止访问会同时把上下行限速置 0；恢复时重新填写速率并取消勾选即可。</p>' +
			'<div class="rch-modal-actions">' +
				'<button class="rch-btn ghost" id="rch-sl-back">返回列表</button>' +
				'<button class="rch-btn" id="rch-sl-save">保存</button>' +
			'</div>');
		$('rch-sl-block').addEventListener('change', function () {
			$('rch-sl-rate').style.display = this.checked ? 'none' : '';
		});
		$('rch-sl-back').addEventListener('click', dmOpen);
		$('rch-sl-save').addEventListener('click', function () {
			var block = $('rch-sl-block').checked;
			var down = $('rch-sl-down').value.trim();
			var up = $('rch-sl-up').value.trim();
			if (!block) {
				if (!down || !/^\d+(\.\d+)?$/.test(down)) { modalAlert('err', '请填写正确的下载限速'); return; }
				if (!up || !/^\d+(\.\d+)?$/.test(up)) { modalAlert('err', '请填写正确的上传限速'); return; }
			}
			var btn = this;
			btn.disabled = true; btn.textContent = '保存中…';
			istorePost('/lanctrl/speedLimitConfig/', {
				ip: d.ip, mac: d.mac,
				networkAccess: !block,
				downloadSpeed: block ? 0 : Number(down),
				uploadSpeed: block ? 0 : Number(up),
				comment: $('rch-sl-comment').value.trim()
			}).then(function () {
				modalAlert('ok', '保存成功');
				btn.disabled = false; btn.textContent = '保存';
				dmLoadAll();
			}).catch(function (e) {
				modalAlert('err', '保存失败：' + e);
				btn.disabled = false; btn.textContent = '保存';
			});
		});
	}

	function dmDetailDialog(d) {
		openModal('设备详情 · ' + (d.hostname || d.ip),
			'<div class="rch-dm-global">' +
				'<div class="rch-dm-gitem"><label>主机名称</label><b>' + esc(d.hostname || '—') + '</b></div>' +
				'<div class="rch-dm-gitem"><label>IP 地址</label><b>' + esc(d.ip || '—') + '</b></div>' +
				'<div class="rch-dm-gitem"><label>MAC 地址</label><b>' + esc(d.mac || '—') + '</b></div>' +
				'<div class="rch-dm-gitem"><label>接入接口</label><b>' + esc(d.intr || '—') + '</b></div>' +
				'<div class="rch-dm-gitem"><label>厂商</label><b>' + esc(d.vendor || '—') + '</b></div>' +
				'<div class="rch-dm-gitem"><label>实时速度</label><b>▼ ' + esc(d.downloadSpeedStr || '0 B/s') + ' / ▲ ' + esc(d.uploadSpeedStr || '0 B/s') + '</b></div>' +
			'</div>' +
			'<div id="rch-dd-hist" class="rch-dd-hist"><div class="rch-modal-loading">读取速率采样…</div></div>' +
			'<div class="rch-modal-actions"><button class="rch-btn ghost" id="rch-dd-back">返回列表</button></div>');
		$('rch-dd-back').addEventListener('click', dmOpen);
		istore('/lanctrl/speedsForOneDevice/', { method: 'POST', body: { ip: d.ip } }).then(function (r) {
			var items = (r && r.items) || [];
			var box = $('rch-dd-hist');
			if (!box) return;
			if (!items.length) { box.innerHTML = '<div class="rch-modal-empty">暂无采样数据</div>'; return; }
			var max = 1;
			items.forEach(function (x) {
				max = Math.max(max, Number(x.downloadSpeed) || 0, Number(x.uploadSpeed) || 0);
			});
			box.innerHTML = '<div class="rch-dd-label">最近 ' + items.length + ' 个采样点</div>' +
				items.map(function (x) {
					var dw = Math.round((Number(x.downloadSpeed) || 0) / max * 100);
					var uw = Math.round((Number(x.uploadSpeed) || 0) / max * 100);
					var t = x.endTime ? new Date(x.endTime * 1000).toLocaleTimeString() : '';
					return '<div class="rch-dd-row">' +
						'<span class="t">' + esc(t) + '</span>' +
						'<span class="bar"><i class="dn" style="width:' + dw + '%"></i></span>' +
						'<span class="bar"><i class="up" style="width:' + uw + '%"></i></span>' +
					'</div>';
				}).join('');
		}).catch(function () {
			var box = $('rch-dd-hist');
			if (box) box.innerHTML = '<div class="rch-modal-empty">速率采样读取失败</div>';
		});
	}

	/* ---------- DNS 配置 ---------- */
	function openDns() {
		openModal('DNS 配置', LOADING);
		istore('/guide/dns-config/').then(function (c) {
			c = c || {};
			var ips = c.manualDnsIp || [];
			var manual = c.dnsProto === 'manual';
			modalBody.innerHTML =
				'<div class="rch-f-radios">' +
					'<label class="' + (!manual ? 'on' : '') + '"><input type="radio" name="rch-dns" value="auto"' + (!manual ? ' checked' : '') + '>自动获取</label>' +
					'<label class="' + (manual ? 'on' : '') + '"><input type="radio" name="rch-dns" value="manual"' + (manual ? ' checked' : '') + '>手动设置</label>' +
				'</div>' +
				'<div id="rch-dns-fields">' +
					'<div class="rch-f-row"><label>首选 DNS 服务器</label><input type="text" id="rch-dns1" value="' + esc(ips[0] || '') + '" placeholder="如 223.5.5.5"></div>' +
					'<div class="rch-f-row"><label>备用 DNS 服务器（可选）</label><input type="text" id="rch-dns2" value="' + esc(ips[1] || '') + '" placeholder="如 119.29.29.29"></div>' +
				'</div>' +
				'<p class="rch-f-note">作用于 WAN 口（' + esc(c.interfaceName || 'wan') + '）。自动获取 = 使用运营商 / 上游分配的 DNS。</p>' +
				'<div class="rch-modal-actions"><button class="rch-btn" id="rch-dns-save">保存配置</button></div>';

			var fields = $('rch-dns-fields');
			function sync() {
				var m = modalBody.querySelector('input[name="rch-dns"]:checked').value === 'manual';
				fields.style.display = m ? '' : 'none';
				modalBody.querySelectorAll('.rch-f-radios label').forEach(function (l) {
					l.classList.toggle('on', l.querySelector('input').checked);
				});
			}
			modalBody.querySelectorAll('input[name="rch-dns"]').forEach(function (r) {
				r.addEventListener('change', sync);
			});
			sync();

			$('rch-dns-save').addEventListener('click', function () {
				var proto = modalBody.querySelector('input[name="rch-dns"]:checked').value;
				var body = { interfaceName: c.interfaceName || 'wan', dnsProto: proto };
				if (proto === 'manual') {
					var d1 = $('rch-dns1').value.trim(), d2 = $('rch-dns2').value.trim();
					if (!ipOk(d1)) { modalAlert('err', '首选 DNS 地址格式不正确'); return; }
					if (d2 && !ipOk(d2)) { modalAlert('err', '备用 DNS 地址格式不正确'); return; }
					body.manualDnsIp = d2 ? [d1, d2] : [d1];
				}
				this.disabled = true; this.textContent = '配置中…';
				istorePost('/guide/dns-config/', body).then(function () {
					modalAlert('ok', 'DNS 配置已保存');
					$('rch-qc-dnsmode').textContent = proto === 'manual' ? '手动' : '自动';
					var b = $('rch-dns-save'); if (b) { b.disabled = false; b.textContent = '保存配置'; }
				}).catch(function (e) {
					modalAlert('err', '保存失败：' + e);
					var b = $('rch-dns-save'); if (b) { b.disabled = false; b.textContent = '保存配置'; }
				});
			});
		}).catch(function () {
			modalBody.innerHTML = '<div class="rch-modal-empty">DNS 配置读取失败</div>';
		});
	}

	/* ---------- 软件源 ---------- */
	function openSrc() {
		openModal('软件源配置', LOADING);
		Promise.all([istore('/guide/soft-source/'), istore('/guide/soft-source/list/')]).then(function (rs) {
			var cur = (rs[0] && rs[0].softSource) || {};
			var list = (rs[1] && rs[1].softSourceList) || [];
			var opts = list.map(function (s) {
				return '<option value="' + esc(s.identity) + '"' + (s.identity === cur.identity ? ' selected' : '') + '>' + esc(s.name) + '</option>';
			}).join('');
			modalBody.innerHTML =
				'<div class="rch-f-row"><label>当前软件源</label><select id="rch-src-sel">' + opts + '</select></div>' +
				'<p class="rch-f-note">切换后建议到 系统 → 软件包 执行一次「更新列表」（opkg update）再安装软件。</p>' +
				'<div class="rch-modal-actions"><button class="rch-btn" id="rch-src-save">切换软件源</button></div>';
			$('rch-src-save').addEventListener('click', function () {
				var id = $('rch-src-sel').value;
				this.disabled = true; this.textContent = '切换中…';
				istorePost('/guide/soft-source/', { softSourceIdentity: id }).then(function () {
					var name = list.filter(function (s) { return s.identity === id; })[0];
					modalAlert('ok', '软件源已切换为 ' + (name ? name.name : id));
					$('rch-qc-srcname').textContent = name ? name.name : id;
					var b = $('rch-src-save'); if (b) { b.disabled = false; b.textContent = '切换软件源'; }
				}).catch(function (e) {
					modalAlert('err', '切换失败：' + e);
					var b = $('rch-src-save'); if (b) { b.disabled = false; b.textContent = '切换软件源'; }
				});
			});
		}).catch(function () {
			modalBody.innerHTML = '<div class="rch-modal-empty">软件源信息读取失败</div>';
		});
	}

	/* ---------- 内网配置 ---------- */
	function openLan() {
		openModal('内网配置 LAN', LOADING);
		istore('/guide/lan/').then(function (c) {
			c = c || {};
			modalBody.innerHTML =
				'<div class="rch-f-row"><label>LAN IP 地址</label><input type="text" id="rch-lan-ip" value="' + esc(c.lanIp || '') + '"></div>' +
				'<div class="rch-f-row"><label>子网掩码</label><input type="text" id="rch-lan-mask" value="' + esc(c.netMask || '255.255.255.0') + '"></div>' +
				'<label class="rch-f-check"><input type="checkbox" id="rch-lan-dhcp"' + (c.enableDhcp ? ' checked' : '') + '>启用 DHCP 服务</label>' +
				'<div id="rch-lan-dhcpfields">' +
					'<div class="rch-f-row"><label>DHCP 起始地址</label><input type="text" id="rch-lan-start" value="' + esc(c.dhcpStart || '') + '"></div>' +
					'<div class="rch-f-row"><label>DHCP 结束地址</label><input type="text" id="rch-lan-end" value="' + esc(c.dhcpEnd || '') + '"></div>' +
				'</div>' +
				'<p class="rch-f-note">注意：修改 LAN IP 后，需要用新地址重新打开管理页面。</p>' +
				'<div class="rch-modal-actions"><button class="rch-btn" id="rch-lan-save">保存配置</button></div>';

			var dhcpFields = $('rch-lan-dhcpfields');
			$('rch-lan-dhcp').addEventListener('change', function () {
				dhcpFields.style.display = this.checked ? '' : 'none';
			});
			dhcpFields.style.display = c.enableDhcp ? '' : 'none';

			$('rch-lan-save').addEventListener('click', function () {
				var ip = $('rch-lan-ip').value.trim(), mask = $('rch-lan-mask').value.trim();
				var dhcp = $('rch-lan-dhcp').checked;
				var st = $('rch-lan-start').value.trim(), en = $('rch-lan-end').value.trim();
				if (!ipOk(ip)) { modalAlert('err', 'LAN IP 格式不正确'); return; }
				if (!ipOk(mask)) { modalAlert('err', '子网掩码格式不正确'); return; }
				if (dhcp && (!ipOk(st) || !ipOk(en))) { modalAlert('err', 'DHCP 地址段格式不正确'); return; }
				this.disabled = true; this.textContent = '配置中…';
				istorePost('/guide/lan/', {
					lanIp: ip, netMask: mask, enableDhcp: dhcp, dhcpStart: st, dhcpEnd: en
				}).then(function () {
					modalAlert('ok', '内网配置已保存。如 IP 有变动，请用新地址重新登录。');
				}).catch(function (e) {
					modalAlert('err', '保存失败：' + e);
					var b = $('rch-lan-save'); if (b) { b.disabled = false; b.textContent = '保存配置'; }
				});
			});
		}).catch(function () {
			modalBody.innerHTML = '<div class="rch-modal-empty">内网配置读取失败</div>';
		});
	}

	/* ---------- 系统维护 ---------- */
	function openMaint() {
		openModal('系统维护',
			'<p class="rch-f-note" style="margin:0 0 6px">重启路由器。重启期间网络会中断约 1 分钟，之后刷新本页面重新登录即可。</p>' +
			'<div class="rch-modal-actions">' +
				'<button class="rch-btn ghost" data-close="1">取消</button>' +
				'<button class="rch-btn" id="rch-reboot-go">确认重启</button>' +
			'</div>');
		$('rch-reboot-go').addEventListener('click', function () {
			this.disabled = true; this.textContent = '重启指令发送中…';
			istore('/system/reboot/', { method: 'POST' }).catch(function () {}).then(function () {
				modalBody.innerHTML = '<div class="rch-modal-loading">重启指令已发送，设备正在重启。约 1 分钟后刷新页面。</div>';
			});
		});
	}

	/* ---------- 快捷设置初始化 ---------- */
	function loadQC() {
		document.querySelectorAll('[data-qc]').forEach(function (btn) {
			btn.addEventListener('click', function () {
				var act = btn.getAttribute('data-qc');
				if (act === 'devices') dmOpen();
				else if (act === 'dns') openDns();
				else if (act === 'src') openSrc();
				else if (act === 'lan') openLan();
				else if (act === 'maint') openMaint();
			});
		});
		/* 终端链接：与原版一致，指向 ttyd */
		var ttyd = $('rch-qc-ttyd');
		if (ttyd) {
			ttyd.href = 'http://' + location.hostname + ':7681';
			ttyd.target = '_blank';
			ttyd.rel = 'noopener';
		}
		/* 按钮角标预载 */
		istore('/network/device/list/').then(function (r) {
			$('rch-qc-devcount').textContent = ((r && r.devices) || []).length + ' 台';
		}).catch(function () {});
		istore('/guide/dns-config/').then(function (c) {
			$('rch-qc-dnsmode').textContent = (c && c.dnsProto === 'manual') ? '手动' : '自动';
		}).catch(function () {});
		istore('/guide/soft-source/').then(function (r) {
			var s = r && r.softSource;
			if (s) $('rch-qc-srcname').textContent = s.name || s.identity || '—';
		}).catch(function () {});
	}

	/* ---------- CPU 使用率 / 温度（istore system status） ---------- */
	function loadIstoreStatus() {
		istore('/system/status/').then(function (s) {
			if (!s) return;
			if (typeof s.cpuUsage === 'number') $('rch-c-cpu').textContent = s.cpuUsage + ' %';
			if (typeof s.cpuTemperature === 'number') $('rch-c-temp').textContent = s.cpuTemperature + ' °C';
		}).catch(function () {});
	}

	/* ---------- 启动 ---------- */
	function tick() {
		loadSystem();
		sampleRates();
	}
	loadSystem();
	ubus('network.interface', 'dump').then(function (dump) {
		renderWanDetail(dump);
		sampleRates();
		/* 左列改为物理网口（原 quickstart 样式），取不到时退回逻辑接口列表 */
		istore('/network/interface/status/').then(renderPorts).catch(function () { renderIfaces(dump); });
	}).catch(function () {
		$('rch-iface-list').innerHTML = '<div class="rch-iface-row"><div class="sub">接口数据不可用</div></div>';
	});
	loadServices();
	loadQC();
	loadIstoreStatus();
	setInterval(loadIstoreStatus, 10000);
	setInterval(tick, 2000);
	drawChart();
})();
