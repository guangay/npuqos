'use strict';
'require view';
'require form';
/* NPU Smart QoS - settings view (uci form) */
return view.extend({
	title: _('NPU 智能QoS - 设置'),

	load: function() {
		return Promise.resolve();
	},

	render: function() {
		var m, s, o;

		m = new form.Map('npuqos', _('NPU 智能QoS'),
			_('基于 NPU 神经网络的流量分类 QoS。模型按 TCP/UDP 双协议分发，四档标记对接 cake 队列；低置信度自动回退默认档。'));

	s = m.section(form.NamedSection, 'main', 'npuqos', _('基本设置'));
	s.addremove = false;

	o = s.option(form.Flag, 'enabled', _('启用 NPU 智能QoS'),
		_('关闭后停止分类守护并恢复原始队列（fq/mq）。'));
	o.rmempty = false;
	o.default = '1';

	o = s.option(form.Value, 'bw_eth0', _('有线出口带宽 (Mbit/s)'),
		_('eth0 上联的可用带宽。0 = 不限速（纯分档模式，仅在拥塞时体现优先级）。设置后 cake 将按带宽整形，四档优先级立即生效。'));
	o.datatype = 'uinteger';
	o.placeholder = '0';

	o = s.option(form.Value, 'bw_wwan', _('5G 出口带宽 (Mbit/s)'),
		_('wwan0_1（RM520N 5G）上联的可用带宽。0 = 不限速。'));
	o.datatype = 'uinteger';
	o.placeholder = '0';

	o = s.option(form.Value, 'bw_eth0_down', _('有线下行带宽 (Mbit/s)'),
		_('从 eth0 下载的可用带宽（入向整形，经 ifb）。0 = 不整形。设置后下行四档同样生效。'));
	o.datatype = 'uinteger';
	o.placeholder = '0';

	o = s.option(form.Value, 'bw_wwan_down', _('5G 下行带宽 (Mbit/s)'),
		_('从 5G 下载的可用带宽（入向整形，经 ifb）。0 = 不整形。'));
	o.datatype = 'uinteger';
	o.placeholder = '0';

		s = m.section(form.GridSection, 'host', _('静态主机优先级'),
			_('为指定终端（如游戏主机、办公电脑）固定优先级，优先级高于 AI 分类。'));
		s.anonymous = true;
		s.addremove = true;
		s.nodescriptions = true;

		o = s.option(form.Value, 'ip', _('IP 地址'),
			_('IPv4 或 IPv6'));
		o.datatype = 'ipaddr';
		o.placeholder = '192.168.100.50';

		o = s.option(form.ListValue, 'class', _('优先类别'));
		o.value('priority', _('优先（Voice 档）'));
		o.value('interactive', _('交互（Best Effort 档）'));
		o.value('stream', _('流媒体（Video 档）'));
		o.value('bulk', _('批量（Bulk 档）'));
		o.default = 'priority';

		return m.render();
	}
});
