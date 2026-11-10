include $(TOPDIR)/rules.mk

PKG_NAME:=librknnrt
PKG_VERSION:=2.3.2
PKG_RELEASE:=2
PKG_LICENSE:=Proprietary

include $(INCLUDE_DIR)/package.mk

define Package/librknnrt
  SECTION:=libs
  CATEGORY:=Libraries
  TITLE:=Rockchip NPU userspace runtime (RKNN, prebuilt)
  DEPENDS:=+libstdcxx-cxx11 +libglibc-shim
endef

define Package/librknnrt/description
  Prebuilt librknnrt.so 2.3.2 for RK3568 NPU. Pairs with kmod-rknpu (driver 0.9.8+).
  The blob is glibc-built; it runs on musl through libglibc-shim.
endef

define Package/librknnrt/install
	$(INSTALL_DIR) $(1)/usr/lib
	$(INSTALL_BIN) ./files/usr/lib/librknnrt.so $(1)/usr/lib/
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

$(eval $(call BuildPackage,librknnrt))