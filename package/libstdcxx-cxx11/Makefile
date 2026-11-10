include $(TOPDIR)/rules.mk

PKG_NAME:=libstdcxx-cxx11
PKG_VERSION:=12.2.0
PKG_RELEASE:=1
PKG_LICENSE:=GPL-3.0-with-GCC-exception

include $(INCLUDE_DIR)/package.mk

define Package/libstdcxx-cxx11
  SECTION:=libs
  CATEGORY:=Libraries
  TITLE:=glibc-built libstdc++ with cxx11 ABI
  DEPENDS:=+libglibc-shim
  PKGARCH:=aarch64_cortex-a53
endef

define Package/libstdcxx-cxx11/description
  libstdc++ 6.0.30 built against glibc, installed under /usr/lib/cxx11 and used
  by vendor blobs (librknnrt, npu_flowqosd) via libglibc-shim.
endef

define Package/libstdcxx-cxx11/install
	$(INSTALL_DIR) $(1)/usr/lib/cxx11
	$(INSTALL_BIN) ./files/usr/lib/cxx11/libstdc++.so.6.0.30 $(1)/usr/lib/cxx11/
endef

define Package/libstdcxx-cxx11/postinst
#!/bin/sh
[ -e /usr/lib/cxx11/libstdc++.so.6 ] || ln -s libstdc++.so.6.0.30 /usr/lib/cxx11/libstdc++.so.6
exit 0
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

$(eval $(call BuildPackage,libstdcxx-cxx11))