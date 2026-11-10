# RouteCraft

iStoreOS 的 LuCI 主题。一个源，两种模式（暖纸面浅色 / 暖炭灰深色），顶栏 MODE 按钮一键切。

适配 iStoreOS 24.10 与 25.12（apk 版），同一份源码，由 `install.sh` 自动识别版本后写入。别的固件不打算适配。

## 装

不用装包，跑脚本就行。脚本会自动识别 iStoreOS 版本（24.10 / 25.12）并写入对应的文件：

```bash
# 在仓库目录里
./install.sh

# 或者一条命令在线装（自动下载源码）
wget -qO- https://raw.githubusercontent.com/Ozero-top/luci-theme-routecraft/main/install.sh | sh
```

装完自动启用，刷新浏览器就是。首页要重新登录一次才能取到实时数据（脚本会重载 ACL）。

## 卸

```bash
./install.sh uninstall
```

自动还原 main.htm、控制器、UCI 主题，删除写入的文件并清模板缓存。quickstart 原版功能会完整回来。

## 状态

```bash
./install.sh status
```

打印识别到的系统版本、包管理器、quickstart 文件是否存在、当前主题。

## 它干了啥

- 登录页换了独立模板，深色网格 + 居中卡
- 侧栏重新做了编号手风琴菜单，顶栏深色 + MODE 切色
- quickstart 首页整个推翻重写成仪表盘：HERO 速率框、核心指标四卡、实时流量曲线、物理网口列表、服务状态、快捷设置（里面嵌了完整的局域网设备管理、DNS 配置、软件源切换等弹窗）
- 网络向导 / 无线向导功能保留，只换界面。首页和向导原本共用模板，装的时候把向导入口单独指到 wizard.htm
- 网口配置页、RAID、S.M.A.R.T. 这些 Vue 内表格页面也做了主题覆盖（硬编码浅底会被深模式打脸）

## 源码结构

```
luci-theme-routecraft/
├── usr/share/ucode/luci/template/themes/routecraft/   页面骨架 + 登录模板
├── www/luci-static/routecraft/
│   ├── cascade.css         主题全部样式（浅/深变量 + 组件）
│   ├── home.css / home.js  quickstart 替换首页
│   └── theme.js            MODE 切换 / 移动端抽屉
├── usr/share/routecraft/
│   └── quickstart-main.htm 首页模板（postinst 复制到 quickstart/main.htm）
├── usr/share/rpcd/acl.d/
│   └── luci-theme-routecraft.json  首页 ubus 取数权限
├── www/luci-static/resources/
│   ├── menu-routecraft.js        侧栏菜单模块
│   └── view/routecraft/sysauth.js 登录交互
├── etc/uci-defaults/
└── CONTROL/    安装包用的脚本（postinst / prerm / postrm）
```

`install.sh` 的逻辑与 `CONTROL/` 里的脚本一致，只是改为直接写文件，因此不再需要打包。
