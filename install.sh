#!/bin/sh
# ============================================================
# RouteCraft for iStoreOS —— 一键安装 / 卸载脚本
#
# 用法：
#   ./install.sh              安装（自动检测 iStoreOS 版本）
#   ./install.sh install      同上
#   ./install.sh uninstall    完整卸载并还原原版 quickstart / 主题
#   ./install.sh status       查看当前检测结果与安装状态
#
# 一条命令在线安装：
#   wget -qO- https://raw.githubusercontent.com/Ozero-top/luci-theme-routecraft/main/install.sh | sh
#
# 说明：直接把源码文件写入系统，不生成 ipk / apk。
#       24.10 与 25.12 的目录布局一致，脚本按实际存在的文件自适应，
#       并对 quickstart 首页 / 向导入口做与安装包完全相同的处理。
# ============================================================

PKG="luci-theme-routecraft"
REPO="Ozero-top/luci-theme-routecraft"
BRANCH="main"
SRC_DIR_NAME="luci-theme-routecraft"
MANIFEST="/usr/share/routecraft/.installed-files"
RCBAK_SUFFIX=".rcorig"

VIEW="/usr/lib/lua/luci/view/quickstart/main.htm"
WIZ="/usr/lib/lua/luci/view/quickstart/wizard.htm"
CTRL="/usr/lib/lua/luci/controller/quickstart.lua"

# ---------- 基础输出 ----------
info()  { printf '  \033[36m>\033[0m %s\n' "$*"; }
ok()    { printf '  \033[32m+\033[0m %s\n' "$*"; }
warn()  { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()   { printf '  \033[31mx\033[0m %s\n' "$*" >&2; exit 1; }

need_root() {
	[ "$(id -u)" = "0" ] || die "需要 root 权限运行（请用 root 登录或在命令前加 sudo）"
}

# ---------- 系统检测 ----------
detect_system() {
	DIST_ID="unknown"
	DIST_RELEASE="unknown"
	DIST_ARCH=""
	if [ -f /etc/openwrt_release ]; then
		. /etc/openwrt_release 2>/dev/null
		DIST_ID="${DISTRIB_ID:-unknown}"
		DIST_RELEASE="${DISTRIB_RELEASE:-unknown}"
		DIST_ARCH="${DISTRIB_ARCH:-}"
	fi
	if command -v apk >/dev/null 2>&1; then
		PKG_MGR="apk"
	elif command -v opkg >/dev/null 2>&1; then
		PKG_MGR="opkg"
	else
		PKG_MGR="none"
	fi
	# 版本族：old = 24.10/23.x（opkg 时代），new = 25.12/26.x（apk 时代）
	case "$DIST_RELEASE" in
		25.*|26.*|SNAPSHOT*) FAMILY="new" ;;
		24.*|23.*|22.*)      FAMILY="old" ;;
		*)                   FAMILY="unknown" ;;
	esac
}

print_system() {
	printf '  系统版本 : %s %s (%s)\n' "$DIST_ID" "$DIST_RELEASE" "${DIST_ARCH:-未知架构}"
	printf '  包管理器 : %s\n' "$PKG_MGR"
	printf '  适配代码 : %s\n' "$FAMILY"
	printf '  quickstart 控制器 : %s\n' "$([ -f "$CTRL" ] && echo 存在 || echo 缺失)"
	printf '  quickstart 首页   : %s\n' "$([ -f "$VIEW" ] && echo 存在 || echo 缺失)"
}

# ---------- 源码定位（本地优先，否则在线下载） ----------
resolve_source() {
	SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
	if [ -n "${ROUTECRAFT_SRC:-}" ] && [ -d "$ROUTECRAFT_SRC/$SRC_DIR_NAME" ]; then
		SRC="$ROUTECRAFT_SRC/$SRC_DIR_NAME"
		ok "使用指定源码：$SRC"
		return 0
	fi
	if [ -n "$SELF_DIR" ] && [ -d "$SELF_DIR/$SRC_DIR_NAME" ]; then
		SRC="$SELF_DIR/$SRC_DIR_NAME"
		ok "使用本地源码：$SRC"
		return 0
	fi

	# 在线下载（管道执行 / 单独下载脚本的场景）
	info "本地未找到源码，正在从 GitHub 下载..."
	TMP="/tmp/routecraft-install.$$"
	rm -rf "$TMP"; mkdir -p "$TMP" || die "无法创建临时目录 $TMP"
	URL="https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz"
	TGZ="$TMP/src.tar.gz"
	if command -v wget >/dev/null 2>&1; then
		wget -qO "$TGZ" "$URL" || die "下载失败：$URL"
	elif command -v curl >/dev/null 2>&1; then
		curl -fsSL -o "$TGZ" "$URL" || die "下载失败：$URL"
	else
		die "系统没有 wget / curl，无法在线下载。请 git clone 仓库后在目录内运行本脚本。"
	fi
	tar -xzf "$TGZ" -C "$TMP" || die "解压失败"
	for d in "$TMP"/*/"$SRC_DIR_NAME"; do
		[ -d "$d" ] && SRC="$d" && break
	done
	[ -n "${SRC:-}" ] && [ -d "$SRC" ] || die "下载包内未找到 $SRC_DIR_NAME 目录"
	TARBALL_TMP="$TMP"
	ok "已下载源码到 $SRC"
}

cleanup_tmp() {
	[ -n "${TARBALL_TMP:-}" ] && rm -rf "$TARBALL_TMP"
}

# ---------- 安装 ----------
do_install() {
	need_root
	detect_system
	echo "RouteCraft 安装"
	print_system
	[ "$FAMILY" = "unknown" ] && warn "未能识别系统版本，将按通用方式安装（按文件是否存在自适应）"
	[ ! -d /www ] && die "未找到 /www，这看起来不是 OpenWrt / iStoreOS 系统"

	resolve_source
	echo
	info "写入主题文件..."
	LIST="/tmp/routecraft-filelist.$$"
	( cd "$SRC" && find . -type f ! -path './CONTROL/*' > "$LIST" ) || die "无法枚举源码文件"
	mkdir -p "$(dirname "$MANIFEST")" || die "无法创建 $MANIFEST 所在目录"
	: > "$MANIFEST"
	while read -r rel; do
		[ -z "$rel" ] && continue
		rel="${rel#./}"
		dst="/$rel"
		mkdir -p "$(dirname "$dst")" || die "创建目录失败：$dst"
		# 目标已存在且不是本主题内容时，先备份一次
		if [ -f "$dst" ] && [ ! -f "$dst$RCBAK_SUFFIX" ]; then
			cp -f "$dst" "$dst$RCBAK_SUFFIX" || die "备份失败：$dst"
		fi
		cp -f "$SRC/$rel" "$dst" || die "复制失败：$rel"
		printf '%s\n' "$dst" >> "$MANIFEST"
	done < "$LIST"
	rm -f "$LIST"

	# 便于自查：统计
	CNT=$(wc -l < "$MANIFEST" 2>/dev/null)
	ok "已写入 ${CNT:-0} 个文件"

	echo
	info "启用主题（UCI）..."
	uci -q batch <<EOF
set luci.themes.RouteCraft=/luci-static/routecraft
set luci.main.mediaurlbase=/luci-static/routecraft
commit luci
EOF
	[ $? -eq 0 ] && ok "luci.main.mediaurlbase = /luci-static/routecraft"

	# quickstart 首页替换（与安装包 postinst 逻辑一致）
	if [ -f "$VIEW" ] && [ -f /usr/share/routecraft/quickstart-main.htm ]; then
		[ -f "$VIEW.rcbak" ] || cp "$VIEW" "$VIEW.rcbak"
		cp -f /usr/share/routecraft/quickstart-main.htm "$VIEW"
		ok "已替换 quickstart 首页（原文件备份为 main.htm.rcbak）"
	fi

	if [ "$FAMILY" = "new" ]; then
		# 25.12：没有 wizard.htm 时用原版 main.htm 生成向导壳
		if [ ! -f "$WIZ" ] && [ -f "$VIEW.rcbak" ]; then
			cp "$VIEW.rcbak" "$WIZ"
			ok "25.12 适配：已从原版 main.htm 生成 wizard.htm"
		fi
	else
		[ -f "$WIZ" ] && ok "24.10 适配：wizard.htm 已随源码写入"
	fi

	if [ -f "$CTRL" ]; then
		[ -f "$CTRL.rcbak" ] || cp "$CTRL" "$CTRL.rcbak"
		sed -i 's#render("quickstart/main"#render("quickstart/wizard"#' "$CTRL"
		ok "向导入口已指向 wizard.htm（控制器备份为 quickstart.lua.rcbak）"
	else
		warn "未找到 quickstart 控制器，跳过向导入口处理"
	fi

	echo
	info "刷新服务与缓存..."
	/etc/init.d/rpcd reload >/dev/null 2>&1 && ok "rpcd ACL 已重载"
	clear_caches
	cleanup_tmp

	echo
	ok "安装完成。请在浏览器刷新 LuCI；首次使用首页数据需要重新登录一次。"
}

clear_caches() {
	rm -f /tmp/luci-indexcache 2>/dev/null
	rm -rf /tmp/luci-templatecache /tmp/luci-modulecache 2>/dev/null
}

# ---------- 卸载 ----------
do_uninstall() {
	need_root
	detect_system
	echo "RouteCraft 卸载"
	print_system
	echo

	info "还原 quickstart 首页与控制器..."
	[ -f "$VIEW.rcbak" ] && mv -f "$VIEW.rcbak" "$VIEW" && ok "main.htm 已还原"
	[ -f "$CTRL.rcbak" ] && mv -f "$CTRL.rcbak" "$CTRL" && ok "quickstart.lua 已还原"

	info "还原主题 UCI..."
	CURRENT="$(uci -q get luci.main.mediaurlbase)"
	if [ "$CURRENT" = "/luci-static/routecraft" ]; then
		NEW=""
		for cand in /luci-static/argon /luci-static/bootstrap /luci-static/core /luci-static/material; do
			if [ -d "/www$cand" ]; then NEW="$cand"; break; fi
		done
		if [ -n "$NEW" ]; then
			uci set luci.main.mediaurlbase="$NEW"
			ok "主题已回退到 $NEW"
		else
			uci -q delete luci.main.mediaurlbase
			warn "未找到可用备用主题，已清空 mediaurlbase 交给 LuCI 回退"
		fi
	fi
	uci -q delete luci.themes.RouteCraft 2>/dev/null
	uci commit luci 2>/dev/null

	info "删除主题文件..."
	if [ -f "$MANIFEST" ]; then
		while read -r f; do
			[ -z "$f" ] && continue
			if [ -f "$f$RCBAK_SUFFIX" ]; then
				mv -f "$f$RCBAK_SUFFIX" "$f"
			else
				rm -f "$f"
			fi
		done < "$MANIFEST"
		ok "已按清单删除文件并还原被覆盖的原文件"
	else
		# 兜底：清单丢失时按已知路径清理
		rm -rf /www/luci-static/routecraft
		rm -f /www/luci-static/resources/menu-routecraft.js
		rm -rf /www/luci-static/resources/view/routecraft
		rm -rf /usr/share/ucode/luci/template/themes/routecraft
		rm -rf /usr/share/routecraft
		rm -f /usr/share/rpcd/acl.d/luci-theme-routecraft.json
		rm -f /usr/lib/lua/luci/view/quickstart/wizard.htm
		rm -f /etc/uci-defaults/30_luci-theme-routecraft
		ok "已按默认路径清理"
	fi
	rm -f "$MANIFEST"

	clear_caches
	/etc/init.d/rpcd reload >/dev/null 2>&1

	# 清理可能残留的空目录
	for d in /www/luci-static/routecraft \
	         /www/luci-static/resources/view/routecraft \
	         /usr/share/ucode/luci/template/themes/routecraft \
	         /usr/share/routecraft; do
		[ -d "$d" ] && rmdir "$d" 2>/dev/null
	done

	echo
	ok "卸载完成，已刷新浏览器即可看到原版界面。"
}

# ---------- 状态 ----------
do_status() {
	detect_system
	echo "RouteCraft 状态"
	print_system
	if [ -f "$MANIFEST" ]; then
		printf '  安装状态 : 已安装（%s 个文件）\n' "$(wc -l < "$MANIFEST" 2>/dev/null)"
	else
		printf '  安装状态 : 未安装（无清单文件）\n'
	fi
	printf '  当前主题 : %s\n' "$(uci -q get luci.main.mediaurlbase)"
}

# ---------- 入口 ----------
ACTION="${1:-install}"
case "$ACTION" in
	install)   do_install ;;
	uninstall|remove) do_uninstall ;;
	status)    do_status ;;
	-h|--help|help)
		echo "用法: $0 [install|uninstall|status]"
		;;
	*)
		die "未知参数：$ACTION（可用：install / uninstall / status）"
		;;
esac
