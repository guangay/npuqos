include $(TOPDIR)/rules.mk

PKG_NAME:=npu-flowqos
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=Proprietary

include $(INCLUDE_DIR)/package.mk

define Package/npu-flowqos
  SECTION:=net
  CATEGORY:=Network
  TITLE:=NPU flow QoS classifier (RKNN dual-model, RK3568)
  DEPENDS:=+librknnrt +kmod-rknpu +iptables +ipset +kmod-ipt-ipset +tc +kmod-sched-cake
  PKGARCH:=aarch64_cortex-a53
endef

define Package/npu-flowqos/description
  NPU flow QoS daemon. Classifies new conntrack flows with two small MLP models
  (TCP / QUIC) running on the RK3568 NPU, then marks them with CONNMARK + ipsets
  for cake diffserv4 tins (priority / interactive / stream / bulk).
endef

define Package/npu-flowqos/conffiles
/etc/config/npuqos
endef

define Package/npu-flowqos/install
	$(INSTALL_DIR) $(1)/usr/bin/npuqos
	$(INSTALL_BIN) ./files/usr/bin/npuqos/npu_flowqosd $(1)/usr/bin/npuqos/
	$(INSTALL_DATA) ./files/usr/bin/npuqos/flow_mlp_tcp.rknn $(1)/usr/bin/npuqos/
	$(INSTALL_DATA) ./files/usr/bin/npuqos/flow_mlp_quic.rknn $(1)/usr/bin/npuqos/
	$(INSTALL_DATA) ./files/usr/bin/npuqos/flow_mlp_tcp_v6.rknn $(1)/usr/bin/npuqos/
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/etc/init.d/npuqosd $(1)/etc/init.d/
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/etc/config/npuqos $(1)/etc/config/
endef

$(eval $(call BuildPackage,npu-flowqos))