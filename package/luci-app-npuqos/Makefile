include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-npuqos
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=Proprietary
PKGARCH:=all

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-npuqos
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI support for NPU Smart QoS
  DEPENDS:=+luci-base +npu-flowqos
endef

define Package/luci-app-npuqos/description
  LuCI pages for NPU flow QoS: live status (flows, per-tin stats, top talkers)
  and settings (bandwidth calibration, static host priorities).
endef

define Package/luci-app-npuqos/install
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/npuqos
	$(INSTALL_DATA) ./files/www/luci-static/resources/view/npuqos/status.js $(1)/www/luci-static/resources/view/npuqos/
	$(INSTALL_DATA) ./files/www/luci-static/resources/view/npuqos/settings.js $(1)/www/luci-static/resources/view/npuqos/
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./files/usr/share/luci/menu.d/luci-app-npuqos.json $(1)/usr/share/luci/menu.d/
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./files/usr/share/rpcd/acl.d/luci-app-npuqos.json $(1)/usr/share/rpcd/acl.d/
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

$(eval $(call BuildPackage,luci-app-npuqos))