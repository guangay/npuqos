# npuqos

RK3568 NPU 流量分类 QoS 的打包仓库（iStoreOS / OpenWrt 24.10，aarch64）。

| 包 | 内容 |
|---|---|
| `librknnrt` | RKNN 用户态运行时 2.3.2（预编译，glibc blob） |
| `libglibc-shim` | 让 glibc blob 在 musl 上运行的符号垫片 |
| `libstdcxx-cxx11` | glibc 版 libstdc++（/usr/lib/cxx11） |
| `npu-flowqos` | `npu_flowqosd` 守护 + 3 个 .rknn 模型 + init + uci |
| `luci-app-npuqos` | 状态页 + 设置页 |

## 原理

`npu_flowqosd` 读取 `/proc/net/nf_conntrack`，把新流的 19 维特征送进两个小型 MLP
（TCP / QUIC，另有 IPv6 版），分类为 priority / interactive / stream / bulk 四档，
再用 ipsets + CONNMARK 打标，由 cake `diffserv4` 的四个 tin 承接；下行同时打 DSCP 供
支持 WMM 的 AP 加速。

## 依赖（固件侧必须一起满足）

- `kmod-rknpu`（`package/kernel/rockchip-drivers` 提供，需 `CONFIG_PACKAGE_kmod-rknpu=y`）
- 设备树使能 NPU 节点：`#include <rk3568-npu.dtsi>` + `&rknpu { status = "okay"; };`
- `iptables` 走 **legacy**（daemon 直接调 `/usr/sbin/iptables`；24.10 的 fw4/nft 环境下需装 `iptables-zz-legacy` 与 `kmod-ipt-*`）
- `ipset`、`kmod-ipt-ipset`、`tc`、`kmod-sched-cake`

## 作为 feed 使用

```
src-git npuqos https://github.com/guangay/npuqos.git;main
```

```
./scripts/feeds update npuqos
./scripts/feeds install -a -p npuqos
```

再在 `.config` 里选：

```
CONFIG_PACKAGE_kmod-rknpu=y
CONFIG_PACKAGE_librknnrt=y
CONFIG_PACKAGE_libglibc-shim=y
CONFIG_PACKAGE_libstdcxx-cxx11=y
CONFIG_PACKAGE_npu-flowqos=y
CONFIG_PACKAGE_luci-app-npuqos=y
```

## 注意

- 二进制为 aarch64_cortex-a53 + musl（经 glibc-shim），换架构不可用。
- `npu_flowqosd` 为闭源预编译；模型为 RKNN 2.x 格式，仅 RKNPU2 驱动可用。
- 若与 turboacc 的 SFE/flow-offload 同开，注意 fwmark 可能被硬件卸载绕过。