include $(TOPDIR)/rules.mk

PKG_NAME:=libglibc-shim
PKG_VERSION:=1
PKG_RELEASE:=1
PKG_LICENSE:=NCSA

include $(INCLUDE_DIR)/package.mk

define Package/libglibc-shim
  SECTION:=libs
  CATEGORY:=Libraries
  TITLE:=glibc symbol shim for proprietary blobs on musl
endef

define Package/libglibc-shim/description
  Provides the glibc symbols/version nodes that prebuilt vendor blobs
  (librknnrt.so, libstdc++.so.6) reference, so they can load on musl.
endef

define Package/libglibc-shim/install
	$(INSTALL_DIR) $(1)/usr/lib
	$(INSTALL_BIN) ./files/usr/lib/libglibc-shim.so.0 $(1)/usr/lib/
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

$(eval $(call BuildPackage,libglibc-shim))