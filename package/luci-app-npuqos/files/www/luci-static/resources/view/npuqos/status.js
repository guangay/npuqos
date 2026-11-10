'use strict';
'require view';
'require dom';
'require fs';
'require poll';
'require rpc';
/* NPU Smart QoS - status view (LuCI 22.03, pure JS+SVG, 3s polling) */

var uciAdd = rpc.declare({ object: 'uci', method: 'add', params: ['config', 'type', 'values'] });
var uciCommit = rpc.declare({ object: 'uci', method: 'commit', params: ['config'] });

var CLS = {
	priority:    { name: '优先 / Voice',  color: '#2eb872', mark: 4, tin: 'Voice 档（tin3，权重 1/4，最优先出队）' },
	interactive: { name: '交互 / 尽力而为', color: '#4a90d9', mark: 2, tin: 'Best Effort 档（tin0，全权重，默认档）' },
	stream:      { name: '流媒体 / 视频',  color: '#9b59d0', mark: 3, tin: 'Video 档（tin2，权重 1/2）' },
	bulk:        { name: '批量 / 后台',    color: '#e67e22', mark: 1, tin: 'Bulk 档（tin1，权重 1/16，仅用空闲带宽）' }
};
var KEYS = ['priority', 'interactive', 'stream', 'bulk'];
var TIN_ORDER = ['Bulk', 'Best Effort', 'Video', 'Voice'];
var TIN_COLOR = { 'Bulk': CLS.bulk.color, 'Best Effort': CLS.interactive.color, 'Video': CLS.stream.color, 'Voice': CLS.priority.color };

/* session-scoped state kept across poll re-renders */
var PREV = null;          /* { ts, infer, tinBytes: {eth0:n, wwan0_1:n} } */
var VIEW_MODE = 'flows';  /* 'flows' | 'bytes' */
var HIST = [];            /* [{t, flows, rate}] last ~4min */

function esc(s) {
	return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
		return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
	});
}

function fmtBytes(b) {
	if (b == null) return '-';
	if (b > 1e9) return (b / 1e9).toFixed(2) + ' GB';
	if (b > 1e6) return (b / 1e6).toFixed(1) + ' MB';
	if (b > 1e3) return (b / 1e3).toFixed(1) + ' KB';
	return b + ' B';
}

function fmtRate(bps) { /* bytes per second */
	if (bps == null || !isFinite(bps)) return '—';
	if (bps > 1e6) return (bps * 8 / 1e6).toFixed(1) + ' Mbps';
	if (bps > 1e3) return (bps * 8 / 1e3).toFixed(0) + ' Kbps';
	return (bps * 8).toFixed(0) + ' bps';
}

function fmtDelay(us) {
	if (us == null) return '—';
	if (us >= 1000) return (us / 1000).toFixed(1) + ' ms';
	return us + ' µs';
}

function bareIp(s) { return String(s || '').replace(/:[^:]*$/, ''); }

/* --- one-click static pin (whitelist) via ubus uci; daemon hot-reloads ~60s --- */
function pinDialog(ip) {
	var old = document.getElementById('nq-pin-modal');
	if (old) old.parentNode.removeChild(old);
	var ov = document.createElement('div');
	ov.id = 'nq-pin-modal';
	ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9999;display:flex;align-items:center;justify-content:center';
	ov.innerHTML = '<div class="nq-modal">' +
		'<h3>固定终端优先级</h3>' +
		'<p class="nq-mono">' + esc(ip) + '</p>' +
		'<select class="nq-pin-sel">' +
		'<option value="priority">优先 / Voice（游戏、通话）</option>' +
		'<option value="interactive">交互 / 尽力而为</option>' +
		'<option value="stream">流媒体 / 视频</option>' +
		'<option value="bulk">批量 / 后台</option></select>' +
		'<p class="nq-modal-tip">写入 uci 白名单（优先级高于 AI 分类），守护约 1 分钟内自动生效。</p>' +
		'<div class="nq-modal-btns"><button class="nq-btn" data-act="cancel">取消</button>' +
		'<button class="nq-btn nq-btn-pri" data-act="ok">固定</button></div></div>';
	document.body.appendChild(ov);
	ov.addEventListener('click', function(ev) {
		var act = ev.target.getAttribute && ev.target.getAttribute('data-act');
		if (ev.target === ov) act = 'cancel';
		if (!act) return;
		if (act == 'ok') {
			var cls = ov.querySelector('.nq-pin-sel').value;
			uciAdd('npuqos', 'host', { ip: ip, class: cls }).then(function() {
				return uciCommit('npuqos');
			}).then(function() {
				ov.querySelector('.nq-modal-tip').textContent = '✓ 已写入，约 1 分钟内生效（可在 服务→NPU 智能QoS 管理）';
				ov.querySelector('.nq-modal-btns').innerHTML = '<button class="nq-btn" data-act="cancel">完成</button>';
			}).catch(function(e) {
				ov.querySelector('.nq-modal-tip').textContent = '写入失败：' + e;
			});
		} else {
			ov.parentNode.removeChild(ov);
		}
	});
}

function exportCsv() {
	var st = CURRENT_ST;
	if (!st) return;
	var rows = [['type', 'time', 'src', 'dst', 'domain', 'class', 'conf', 'mark', 'bytes']];
	(st.recent || []).forEach(function(f) {
		rows.push(['flow', f.t, f.src, f.dst, f.h || '', f.cls, f.conf, f.mark, f.b || 0]);
	});
	(st.top || []).forEach(function(t) {
		rows.push(['host', '', t.ip, '', t.h || '', '', '', '', t.bytes]);
	});
	var csv = rows.map(function(r) { return r.map(function(c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
	var a = document.createElement('a');
	a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8' }));
	a.download = 'npuqos_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.csv';
	document.body.appendChild(a); a.click();
	setTimeout(function() { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function histHtml(raw) {
	var entries = [];
	String(raw || '').split('\n').forEach(function(l) {
		var p = l.trim().split(/\s+/);
		if (p.length >= 5 && /^\d+$/.test(p[0])) {
			var d = new Date(+p[0] * 1000);
			entries.push({ h: d.getHours(), b: (+p[3] || 0) + (+p[4] || 0), f: +p[1] || 0 });
		}
	});
	if (entries.length < 1) return '<em>积累中（每小时落盘一次，下个整点出图）…</em>';
	entries = entries.slice(-24);
	var max = Math.max.apply(null, entries.map(function(e) { return e.b; })) || 1;
	var bars = entries.map(function(e, i) {
		var pct = Math.max(2, Math.round(100 * e.b / max));
		return '<div class="nq-hist-col" title="' + e.h + '点 · ' + fmtBytes(e.b) + ' · ' + e.f + ' 活跃流">' +
			'<div class="nq-hist-bar" style="height:' + pct + '%"></div>' +
			'<span class="nq-hist-lab">' + (i % 3 == 0 ? e.h : '') + '</span></div>';
	}).join('');
	return '<div class="nq-hist"><div class="nq-hist-head"><span>峰值 ' + fmtBytes(max) + '</span></div>' +
		'<div class="nq-hist-row">' + bars + '</div></div>';
}

function card(inner, color, title) {
	var d = document.createElement('div');
	d.className = 'nq-card';
	d.style.borderTop = '3px solid ' + (color || '#8b8b8b');
	if (title) d.title = title;
	d.innerHTML = inner;
	return d;
}

function donutSvg(counts, centerLabel) {
	var total = 0;
	KEYS.forEach(function(k) { total += counts[k] || 0; });
	var r = 62, c = 2 * Math.PI * r, off = 0, segs = '';
	KEYS.forEach(function(k) {
		var v = counts[k] || 0;
		if (total > 0 && v > 0) {
			var len = c * v / total;
			segs += '<circle class="nq-donut-seg" cx="80" cy="80" r="' + r + '" stroke="' + CLS[k].color +
				'" stroke-dasharray="' + len.toFixed(2) + ' ' + (c - len).toFixed(2) +
				'" stroke-dashoffset="' + (-off).toFixed(2) + '" />';
			off += len;
		}
	});
	return '<div class="nq-donut-wrap"><svg viewBox="0 0 160 160" class="nq-donut">' +
		'<circle cx="80" cy="80" r="' + r + '" stroke="rgba(128,128,128,.18)" stroke-width="22" fill="none"/>' +
		segs + '</svg>' +
		'<div class="nq-donut-center"><b>' + (VIEW_MODE == 'bytes' ? fmtBytes(total) : total) + '</b><span>' + centerLabel + '</span></div></div>';
}

function barsHtml(counts) {
	var total = 0;
	KEYS.forEach(function(k) { total += counts[k] || 0; });
	var h = '';
	KEYS.forEach(function(k) {
		var v = counts[k] || 0, pct = total ? Math.round(100 * v / total) : 0;
		var valTxt = VIEW_MODE == 'bytes' ? fmtBytes(v) : v;
		h += '<div class="nq-bar-row"><div class="nq-bar-head" title="' + esc(CLS[k].tin) + '">' +
			'<span class="nq-bar-dot" style="background:' + CLS[k].color + '"></span>' +
			'<span class="nq-bar-name">' + CLS[k].name + '</span>' +
			'<span class="nq-bar-val">' + valTxt + ' <i>(' + pct + '%)</i></span></div>' +
			'<div class="nq-bar-track"><div class="nq-bar-fill" style="width:' + pct + '%;background:' + CLS[k].color + '"></div></div></div>';
	});
	return h;
}

function sparkline(entries, getVal, color, fmt) {
	if (!fmt) fmt = fmtBytes;
	if (!entries || entries.length < 2)
		return '<div class="nq-spark-empty">采集中（约 1 分钟后出图）…</div>';
	var W = 300, H = 56, PAD = 3;
	var vals = entries.map(getVal), min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
	if (max == min) { max = min + 1; }
	var pts = vals.map(function(v, i) {
		var x = PAD + (W - 2 * PAD) * i / (vals.length - 1);
		var y = H - PAD - (H - 2 * PAD) * (v - min) / (max - min);
		return x.toFixed(1) + ',' + y.toFixed(1);
	}).join(' ');
	var last = vals[vals.length - 1];
	return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="nq-spark-svg" preserveAspectRatio="none">' +
		'<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="2"/>' +
		'<title>范围 ' + fmt(min) + ' ~ ' + fmt(max) + '</title></svg>' +
		'<div class="nq-spark-last" style="color:' + color + '">' + fmt(last) + '</div>';
}

function topHtml(top) {
	if (!top || !top.length) return '<em>暂无数据</em>';
	var max = Math.max.apply(null, top.map(function(t) { return t.bytes; })) || 1;
	var h = '';
	top.forEach(function(t, i) {
		var pct = Math.max(2, Math.round(100 * t.bytes / max));
		var dom = t.h ? '<span class="nq-dom" title="' + esc(t.h) + '"> ' + esc(t.h.length > 22 ? t.h.slice(0, 22) + '…' : t.h) + '</span>' : '';
		h += '<div class="nq-top-row"><span class="nq-top-rank">' + (i + 1) + '</span>' +
			'<span class="nq-top-ip nq-mono" title="' + esc(t.ip) + '（发起 ' + t.flows + ' 条流' + (t.h ? ' · ' + esc(t.h) : '') + '）">' + esc(t.ip) + dom + '</span>' +
			'<div class="nq-bar-track"><div class="nq-bar-fill" style="width:' + pct + '%;background:linear-gradient(90deg,#4a90d9,#9b59d0)"></div></div>' +
			'<span class="nq-top-val">' + fmtBytes(t.bytes) + '<i> / ' + t.flows + ' 流</i></span></div>';
	});
	return h;
}

function tinsHtml(tins, rates) {
	if (!tins) return '';
	var h = '';
	Object.keys(tins).forEach(function(dev) {
		var devRate = rates && rates[dev] != null ? '　当前出口 ' + fmtRate(rates[dev]) : '';
		h += '<h4 style="margin:10px 0 4px 0">出口接口：' + esc(dev) + '<span class="nq-tin-rate">' + devRate + '</span></h4><div class="nq-tin-grid">';
		TIN_ORDER.forEach(function(t) {
			var st = tins[dev][t] || {};
			h += '<div class="nq-tin"><div class="nq-tin-head" style="background:' + TIN_COLOR[t] + '">' + t + '</div>' +
				'<div class="nq-tin-body"><div class="nq-tin-num">' + fmtBytes(st.bytes || 0) +
				'</div><div class="nq-tin-lab">' + (st.pkts || 0).toLocaleString() + ' 包</div>' +
				'<div class="nq-tin-sub">丢 ' + (st.drops || 0) + ' · 标 ' + (st.marks || 0) + ' · 延 ' + fmtDelay(st.delay_us) + '</div></div></div>';
		});
		h += '</div>';
	});
	return h;
}

function recentHtml(recent) {
	if (!recent || !recent.length) return '<em>暂无分类记录（等待新流…）</em>';
	var h = '<div class="nq-table-wrap"><table class="table nq-table"><thead><tr>' +
		'<th>时间</th><th>源</th><th>目标</th><th>类别</th><th>流量</th><th style="width:120px">置信度</th><th>标记</th><th style="width:44px">固定</th></tr></thead><tbody>';
	recent.forEach(function(f) {
		var c = CLS[f.cls] || { name: f.cls, color: '#888', mark: f.mark };
		var pct = Math.round((f.conf || 0) * 100);
		var dom = f.h ? '<div class="nq-dom" title="' + esc(f.h) + '">' + esc(f.h.length > 28 ? f.h.slice(0, 28) + '…' : f.h) + '</div>' : '';
		h += '<tr><td class="nq-mono">' + esc(f.t) + '</td>' +
			'<td class="nq-mono">' + esc(f.src) + '</td>' +
			'<td class="nq-mono">' + esc(f.dst) + dom + '</td>' +
			'<td><span class="nq-badge" style="background:' + c.color + '" title="' + esc(c.tin || '') + '">' + c.name + '</span></td>' +
			'<td class="nq-mono">' + fmtBytes(f.b || 0) + '</td>' +
			'<td><div class="nq-conf" title="模型对本次分类的把握；低于 60% 回落默认档"><div class="nq-conf-fill" style="width:' + pct + '%;background:' + c.color + '"></div><span>' + pct + '%</span></div></td>' +
			'<td><span class="nq-mono nq-mark" title="fwmark ' + f.mark + ' → cake ' + (f.mark == 1 ? 'Bulk' : f.mark == 2 ? 'Best Effort' : f.mark == 3 ? 'Video' : 'Voice') + ' 队列">mark ' + f.mark + '</span></td>' +
			'<td><button class="nq-pin" title="把该终端固定到指定档位（白名单，高于 AI 分类）" data-ip="' + esc(bareIp(f.src)) + '">钉</button></td></tr>';
	});
	return h + '</tbody></table></div>';
}

function helpHtml() {
	return '<details class="nq-help"' + (HELP_OPEN ? ' open' : '') + '><summary>四档说明：类别如何映射到队列（点开查看）</summary>' +
		'<div class="nq-table-wrap"><table class="table nq-table"><thead><tr><th>类别</th><th>fwmark</th><th>cake 队列</th><th>带宽权重</th><th>典型流量</th></tr></thead><tbody>' +
		'<tr><td><span class="nq-badge" style="background:#2eb872">优先 / Voice</span></td><td class="nq-mono">4</td><td>Voice (tin3)</td><td>1/4，优先出队</td><td>游戏对战、通话、SSH</td></tr>' +
		'<tr><td><span class="nq-badge" style="background:#4a90d9">交互 / 尽力而为</span></td><td class="nq-mono">2</td><td>Best Effort (tin0)</td><td>全权重（默认档）</td><td>网页、API、IM 心跳</td></tr>' +
		'<tr><td><span class="nq-badge" style="background:#9b59d0">流媒体 / 视频</span></td><td class="nq-mono">3</td><td>Video (tin2)</td><td>1/2</td><td>视频、音乐、直播</td></tr>' +
		'<tr><td><span class="nq-badge" style="background:#e67e22">批量 / 后台</span></td><td class="nq-mono">1</td><td>Bulk (tin1)</td><td>1/16，仅空闲带宽</td><td>下载、同步、备份</td></tr>' +
		'</tbody></table></div>' +
		'<p>模型置信度低于 60% 时保守回退到默认档；下行同时打 DSCP（EF/AF41/CS1）供支持 WMM 的 AP 无线侧加速。' +
		'拥塞时优先级才可见——要到「服务 → NPU 智能QoS」标定出口带宽后，四档抢占效果才会直观体现。</p></details>';
}

var CSS_TEXT = null;
var HELP_OPEN = false;   /* survives poll rebuilds; synced via toggle event */
var ACTIVE_ROOT = null;   /* the live displayed root; all (re)draws go into it */

function buildAll(st) {
	var root = ACTIVE_ROOT;
	if (!root) { root = document.createElement('div'); ACTIVE_ROOT = root; }
	root.innerHTML = '';
	/* inject stylesheet into <head> once: rebuilding the view container must
	 * never destroy it (toggle clicks / poll redraws wiped container styles) */
	if (!CSS_TEXT) {
		CSS_TEXT = document.createElement('style');
		CSS_TEXT.textContent = [
			'.nq-hero{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:14px}',
			'.nq-card{background:var(--background,#fff);border:1px solid var(--border,#ddd);border-radius:8px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}',
			'.nq-card h3{margin:0 0 6px 0;font-size:12px;font-weight:600;color:#8a8a8a;letter-spacing:.5px;text-transform:uppercase}',
			'.nq-card b{font-size:26px;font-weight:700}',
			'.nq-card span.nq-sub{display:block;font-size:12px;color:#999;margin-top:2px}',
			'.nq-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}',
			'.nq-chip{font-size:12px;color:#555;background:var(--background,#fff);border:1px solid var(--border,#ddd);border-radius:12px;padding:3px 10px;white-space:nowrap}',
			'.nq-chip b{font-weight:700;color:#333}',
			'.nq-grid{display:grid;grid-template-columns:340px 1fr;gap:14px;align-items:stretch}',
			'@media(max-width:800px){.nq-grid{grid-template-columns:1fr}}',
			'.nq-panel{background:var(--background,#fff);border:1px solid var(--border,#ddd);border-radius:8px;padding:16px;min-width:0}',
			'.nq-help{background:rgba(74,144,217,.06);border:1px solid rgba(74,144,217,.25);border-radius:8px;padding:8px 14px;margin-bottom:14px;font-size:13px}',
			'.nq-help summary{cursor:pointer;font-weight:600;color:#4a90d9}',
			'.nq-help p{color:#666;margin:8px 0 2px 0}',
			'.nq-toggle{display:inline-flex;border:1px solid var(--border,#ccc);border-radius:6px;overflow:hidden;margin-bottom:8px}',
			'.nq-toggle button{border:0;background:transparent;padding:4px 14px;font-size:12px;cursor:pointer;color:#666}',
			'.nq-toggle button.on{background:#4a90d9;color:#fff;font-weight:600}',
			'.nq-donut-wrap{position:relative;width:220px;margin:0 auto}',
			'.nq-donut{width:220px;height:220px;transform:rotate(-90deg)}',
			'.nq-donut-seg{fill:none;stroke-width:22;transition:stroke-dasharray .6s}',
			'.nq-donut-center{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center}',
			'.nq-donut-center b{font-size:30px}.nq-donut-center span{color:#999;font-size:12px}',
			'.nq-bar-row{margin:12px 0}',
			'.nq-bar-head{display:flex;align-items:center;gap:8px;margin-bottom:4px}',
			'.nq-bar-dot{width:10px;height:10px;border-radius:50%;flex:none}',
			'.nq-bar-name{flex:1;font-size:13px;color:#666}',
			'.nq-bar-track{width:100%;height:14px;background:rgba(128,128,128,.12);border-radius:7px;overflow:hidden}',
			'.nq-bar-fill{height:100%;border-radius:7px;transition:width .6s}',
			'.nq-bar-val{font-size:13px}.nq-bar-val i{color:#aaa;font-style:normal;font-size:11px}',
			'.nq-top-row{display:flex;align-items:center;gap:8px;margin:10px 0;min-width:0}',
			'.nq-top-rank{width:18px;height:18px;border-radius:50%;background:#eef2f7;color:#557;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none}',
			'.nq-top-ip{flex:0 0 150px;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.nq-top-row .nq-bar-track{flex:1;height:10px}',
			'.nq-top-val{flex:none;width:110px;text-align:right;font-size:12px}.nq-top-val i{color:#aaa;font-style:normal;font-size:11px}',
			'.nq-tin-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}',
			'@media(max-width:700px){.nq-tin-grid{grid-template-columns:repeat(2,1fr)}.nq-top-ip{flex-basis:110px}}',
			'.nq-tin{border:1px solid var(--border,#ddd);border-radius:8px;overflow:hidden;min-width:0}',
			'.nq-tin-head{color:#fff;font-size:12px;font-weight:600;padding:6px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.nq-tin-body{padding:10px;text-align:center}',
			'.nq-tin-num{font-size:18px;font-weight:700;white-space:nowrap}',
			'.nq-tin-lab{font-size:11px;color:#999}',
			'.nq-tin-sub{font-size:11.5px;color:#666;margin-top:4px;white-space:nowrap}',
			'.nq-tin-rate{font-size:12px;color:#2eb872;font-weight:600;margin-left:8px}',
			'.nq-spark{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}',
			'@media(max-width:700px){.nq-spark{grid-template-columns:1fr}}',
			'.nq-spark-item{border:1px dashed var(--border,#ccc);border-radius:8px;padding:8px 10px;position:relative;min-height:80px}',
			'.nq-spark-item h4{margin:0 0 4px 0;font-size:12px;color:#8a8a8a;font-weight:600}',
			'.nq-spark-svg{width:100%;height:56px;display:block}',
			'.nq-spark-last{position:absolute;right:10px;top:6px;font-size:12px;font-weight:700}',
			'.nq-spark-empty{color:#aaa;font-size:12px;padding:20px 0;text-align:center}',
			'.nq-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}',
			'.nq-table td,.nq-table th{padding:6px 8px;font-size:12.5px;vertical-align:middle;white-space:nowrap}',
			'.nq-mono{font-family:monospace;font-size:12px;word-break:break-all}',
			'.nq-badge{color:#fff;font-size:11px;padding:2px 9px;border-radius:10px;font-weight:600;white-space:nowrap}',
			'.nq-conf{position:relative;height:16px;background:rgba(128,128,128,.12);border-radius:8px;overflow:hidden}',
			'.nq-conf-fill{height:100%;border-radius:8px;transition:width .4s}',
			'.nq-conf span{position:absolute;left:0;right:0;top:0;text-align:center;font-size:10.5px;line-height:16px;color:#333;text-shadow:0 0 2px #fff}',
			'.nq-mark{color:#777}',
			'.nq-dom{font-size:10.5px;color:#8a97a8;margin-top:1px}',
			'.nq-top-ip{display:flex;flex-direction:column;line-height:1.2;overflow:hidden}',
			'.nq-pin{border:1px solid #4a90d9;background:#fff;color:#4a90d9;border-radius:4px;font-size:11px;padding:2px 8px;cursor:pointer}',
			'.nq-pin:hover{background:#4a90d9;color:#fff}',
			'.nq-btn{border:1px solid var(--border,#ccc);background:#fff;border-radius:5px;font-size:12px;padding:4px 12px;cursor:pointer;color:#555}',
			'.nq-btn:hover{border-color:#4a90d9;color:#4a90d9}',
			'.nq-btn-pri{background:#4a90d9;color:#fff;border-color:#4a90d9}',
			'.nq-modal{background:#fff;border-radius:10px;box-shadow:0 8px 40px rgba(0,0,0,.25);padding:20px 24px;min-width:300px;max-width:90vw}',
			'.nq-modal h3{margin:0 0 6px 0;font-size:16px}',
			'.nq-modal p{margin:4px 0;font-size:13px;color:#555}',
			'.nq-pin-sel{width:100%;margin:8px 0;padding:6px;border:1px solid #ccc;border-radius:5px;font-size:13px}',
			'.nq-modal-tip{color:#999;font-size:12px}',
			'.nq-modal-btns{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}',
			'.nq-hist-head{text-align:right;font-size:11px;color:#999}',
			'.nq-hist-row{display:flex;align-items:flex-end;gap:2px;height:90px}',
			'.nq-hist-col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;min-width:0}',
			'.nq-hist-bar{width:100%;background:linear-gradient(180deg,#4a90d9,#9b59d0);border-radius:2px 2px 0 0;min-height:2px}',
			'.nq-hist-lab{font-size:9px;color:#aaa;height:12px;line-height:12px}',
			'@media(max-width:720px){',
			'  .nq-hero{gap:8px}',
			'  .nq-card{padding:10px 12px;border-radius:7px}',
			'  .nq-card h3{font-size:10.5px;margin-bottom:4px}',
			'  .nq-card b{font-size:19px}',
			'  .nq-card span.nq-sub{font-size:10.5px}',
			'  .nq-panel{padding:12px;border-radius:7px}',
			'  .nq-donut-wrap{width:170px}',
			'  .nq-donut{width:170px;height:170px}',
			'  .nq-donut-center b{font-size:21px}',
			'  .nq-donut-center span{font-size:10.5px}',
			'  .nq-bar-name{font-size:12px}',
			'  .nq-chip{font-size:11px;padding:2px 8px;border-radius:10px}',
			'  .nq-table td,.nq-table th{font-size:11px;padding:5px 6px}',
			'  .nq-help .nq-table td,.nq-help .nq-table th{font-size:10.5px;white-space:normal}',
			'  .nq-tin-num{font-size:15px}',
			'  .nq-tin-head{font-size:11px;padding:5px 8px}',
			'  .nq-tin-sub{font-size:10.5px}',
			'  .nq-top-ip{flex-basis:104px}',
			'  .nq-top-val{width:86px;font-size:11px}',
			'  .nq-conf{height:14px}',
			'  .nq-conf span{font-size:9.5px;line-height:14px}',
			'  .nq-pin{padding:3px 10px;font-size:12px}',
			'  .nq-hist-row{height:70px}',
			'  .nq-btn{padding:5px 10px}',
			'}'
		].join('\n');
		document.head.appendChild(CSS_TEXT);
	}

	if (!st) {
		var warn = document.createElement('div');
		warn.className = 'alert-message warning';
		warn.textContent = _('状态文件不可读（/tmp/npuqos_status.json）。请确认 npu-flowqos 服务正在运行。');
		root.appendChild(warn);
		return root;
	}

	/* --- rate deltas (vs previous poll) --- */
	var rates = {}, infRate = null, totalRate = 0;
	if (PREV && st.ts > PREV.ts) {
		var dt = st.ts - PREV.ts;
		Object.keys(st.tins || {}).forEach(function(dev) {
			var sum = 0;
			TIN_ORDER.forEach(function(t) { sum += (st.tins[dev][t] || {}).bytes || 0; });
			if (PREV.tinBytes[dev] != null && sum >= PREV.tinBytes[dev])
				rates[dev] = (sum - PREV.tinBytes[dev]) / dt;
		});
		infRate = (st.infer_n - PREV.infer) / dt;
	}
	Object.keys(rates).forEach(function(d) { totalRate += rates[d]; });
	var tinBytesNow = {};
	Object.keys(st.tins || {}).forEach(function(dev) {
		var sum = 0;
		TIN_ORDER.forEach(function(t) { sum += (st.tins[dev][t] || {}).bytes || 0; });
		tinBytesNow[dev] = sum;
	});
	PREV = { ts: st.ts, infer: st.infer_n, tinBytes: tinBytesNow };
	HIST.push({ t: st.ts, flows: st.flows || 0, rate: totalRate });
	if (HIST.length > 90) HIST.shift();

	var uptime = st.uptime || 0;
	var upstr = Math.floor(uptime / 3600) + '时' + Math.floor((uptime % 3600) / 60) + '分';
	var npu = (st.npu_load || '').replace(/[^0-9]/g, '') || '0';
	var avg = st.avg_ms || 0;
	var h = st.health || {};

	/* --- hero --- */
	var hero = document.createElement('div');
	hero.className = 'nq-hero';
	hero.appendChild(card('<h3>活跃流</h3><b>' + (st.flows || 0) + '</b><span class="nq-sub">conntrack ' + (h.ct || 0) + ' 条在跟踪</span>', '#4a90d9',
		'当前跟踪的连接流数（流表上限 ' + (h.flows_max || 2048) + '）'));
	hero.appendChild(card('<h3>出口速率</h3><b>' + fmtRate(totalRate) + '</b><span class="nq-sub">双出口合计·实时</span>', '#2eb872',
		'eth0 + wwan0_1 出口字节速率（页面每 3 秒差分）'));
	hero.appendChild(card('<h3>分类速率</h3><b>' + (infRate != null ? infRate.toFixed(1) + ' 次/s' : '—') + '</b><span class="nq-sub">累计 ' + (st.infer_n || 0).toLocaleString() + ' 次 · 均 ' + (avg < 0.01 && avg >= 0 ? '&lt;0.01' : avg.toFixed(2)) + ' ms</span>', '#9b59d0',
		'NPU 模型推理次数与单次耗时'));
	hero.appendChild(card('<h3>NPU 负载</h3><b>' + npu + '%</b><span class="nq-sub">分类几乎零开销</span>', '#e67e22',
		'来自 /sys/kernel/debug/rknpu/load'));
	hero.appendChild(card('<h3>保守回退</h3><b>' + (st.fallbacks || 0) + '</b><span class="nq-sub">低置信度回落默认档</span>', '#57606f',
		'模型置信度 < 60% 时不冒险，回落 Best Effort 默认档'));
	hero.appendChild(card('<h3>服务运行</h3><b>' + upstr + '</b><span class="nq-sub">守护进程在线</span>', '#57606f'));
	root.appendChild(hero);

	/* --- health chips --- */
	var sp = st.split || {};
	var chips = document.createElement('div');
	chips.className = 'nq-chips';
	chips.innerHTML =
		'<span class="nq-chip">自愈重建 <b>' + (h.selfheals != null ? h.selfheals : '—') + '</b> 次</span>' +
		'<span class="nq-chip" title="npuqos* ipset 集合内条目总数">ipset 条目 <b>' + (h.ipset != null && h.ipset >= 0 ? h.ipset : '—') + '</b></span>' +
		'<span class="nq-chip" title="流表容量水位">流表 <b>' + (st.flows || 0) + '/' + (h.flows_max || 2048) + '</b></span>' +
		'<span class="nq-chip">TCP <b>' + (sp.tcp || 0) + '</b></span>' +
		'<span class="nq-chip">UDP <b>' + (sp.udp || 0) + '</b></span>' +
		'<span class="nq-chip">IPv6 <b>' + (sp.v6 || 0) + '</b> 条流</span>';
	root.appendChild(chips);

	/* --- help --- */
	var help = document.createElement('div');
	help.innerHTML = helpHtml();
	root.appendChild(help.firstChild);
	var details = root.querySelector('.nq-help');
	if (details)
		details.addEventListener('toggle', function() { HELP_OPEN = details.open; });

	/* --- charts + top talkers --- */
	var grid = document.createElement('div');
	grid.className = 'nq-grid';
	var p1 = document.createElement('div');
	p1.className = 'nq-panel';
	var modeData = VIEW_MODE == 'bytes' ? (st.bytes || {}) : (st.classes || {});
	var toggle = document.createElement('div');
	toggle.className = 'nq-toggle';
	toggle.innerHTML = '<button class="' + (VIEW_MODE == 'flows' ? 'on' : '') + '" data-m="flows">按流数</button>' +
		'<button class="' + (VIEW_MODE == 'bytes' ? 'on' : '') + '" data-m="bytes">按流量</button>';
	toggle.querySelectorAll('button').forEach(function(btn) {
		btn.onclick = function() {
			VIEW_MODE = btn.getAttribute('data-m');
			buildAll(CURRENT_ST);
		};
	});
	var p1h = document.createElement('h3');
	p1h.style.marginTop = '0';
	p1h.textContent = '分类分布';
	p1.appendChild(p1h);
	p1.appendChild(toggle);
	var chartBox = document.createElement('div');
	chartBox.innerHTML = donutSvg(modeData, VIEW_MODE == 'bytes' ? '存量流字节' : '累计已分类流') + barsHtml(modeData);
	p1.appendChild(chartBox);
	var p2 = document.createElement('div');
	p2.className = 'nq-panel';
	p2.innerHTML = '<h3 style="margin-top:0">流量Top 终端（当前跟踪流，按发起方统计）</h3>' + topHtml(st.top);
	grid.appendChild(p1); grid.appendChild(p2);
	root.appendChild(grid);

	/* --- sparklines --- */
	var spark = document.createElement('div');
	spark.className = 'nq-panel';
	spark.style.marginTop = '14px';
	spark.innerHTML = '<h3 style="margin-top:0">走势（本页面会话内，约 4 分钟）</h3><div class="nq-spark">' +
		'<div class="nq-spark-item"><h4>活跃流</h4>' + sparkline(HIST, function(e) { return e.flows; }, '#4a90d9', function(v) { return String(Math.round(v)); }) + '</div>' +
		'<div class="nq-spark-item"><h4>出口速率 (B/s)</h4>' + sparkline(HIST, function(e) { return e.rate; }, '#2eb872') + '</div>' +
		'</div>';
	root.appendChild(spark);

	/* --- recent --- */
	var recPanel = document.createElement('div');
	recPanel.className = 'nq-panel';
	recPanel.style.marginTop = '14px';
	var recHead = document.createElement('h3');
	recHead.style.marginTop = '0';
	recHead.innerHTML = '实时分类流（近 ' + ((st.recent || []).length) + ' 条）';
	var csvBtn = document.createElement('button');
	csvBtn.className = 'nq-btn nq-btn-csv';
	csvBtn.textContent = '导出 CSV';
	csvBtn.style.cssText = 'float:right;margin-top:-4px';
	csvBtn.onclick = exportCsv;
	recHead.appendChild(csvBtn);
	recPanel.appendChild(recHead);
	var recBody = document.createElement('div');
	recBody.innerHTML = recentHtml(st.recent);
	recBody.addEventListener('click', function(ev) {
		if (ev.target.classList && ev.target.classList.contains('nq-pin') && ev.target.getAttribute('data-ip'))
			pinDialog(ev.target.getAttribute('data-ip'));
	});
	recPanel.appendChild(recBody);
	root.appendChild(recPanel);

	/* --- 24h history --- */
	var histPanel = document.createElement('div');
	histPanel.className = 'nq-panel';
	histPanel.style.marginTop = '14px';
	histPanel.innerHTML = '<h3 style="margin-top:0">近 24 小时流量（每小时，含四档队列）</h3>' + histHtml(HIST_RAW);
	root.appendChild(histPanel);

	/* --- cake tins --- */
	var tinPanel = document.createElement('div');
	tinPanel.className = 'nq-panel';
	tinPanel.style.marginTop = '14px';
	tinPanel.innerHTML = '<h3 style="margin-top:0">cake 队列四档统计（每 10 秒刷新）</h3>' +
		(st.tins ? tinsHtml(st.tins, rates) : '<em>等待队列统计…</em>');
	root.appendChild(tinPanel);

	return root;
}

var CURRENT_ST = null;
var HIST_RAW = null;

return view.extend({
	title: _('NPU 智能QoS - 运行状态'),

	load: function() {
		return Promise.all([
			fs.read('/tmp/npuqos_status.json').catch(function() { return null; }),
			fs.read('/usr/bin/npuqos/history.log').catch(function() { return null; })
		]);
	},

	render: function(data) {
		var st = null, hist = null;
		try { st = data && data[0] ? JSON.parse(data[0]) : null; } catch (e) {}
		HIST_RAW = data ? data[1] : null;
		CURRENT_ST = st;
		ACTIVE_ROOT = document.createElement('div');
		buildAll(st);

		poll.add(L.bind(function() {
			return Promise.all([
				fs.read('/tmp/npuqos_status.json').catch(function() { return null; }),
				fs.read('/usr/bin/npuqos/history.log').catch(function() { return null; })
			]).then(function(res) {
				var nst = null;
				try { nst = res[0] ? JSON.parse(res[0]) : null; } catch (e) {}
				CURRENT_ST = nst;
				HIST_RAW = res[1];
				buildAll(nst);
			}).catch(function() {});
		}, this), 3);

		return ACTIVE_ROOT;
	},

	handleSaveApply: null, handleSave: null, handleReset: null
});
