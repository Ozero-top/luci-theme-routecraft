# -*- coding: utf-8 -*-
"""Build luci-theme-routecraft packages.

Usage: python build-ipk.py

两个格式：
  - OpenWrt / iStoreOS 24.10 (.ipk)  —— debian-binary + control.tar.gz + data.tar.gz
    安装：opkg install luci-theme-routecraft_1.0.0-27_2410_all.ipk

  - Alpine / iStoreOS 25.12 (.ipk)   —— 和 24.10 结构相同的 ipk
    25.12 底层换成了 Alpine apk-tools，但 Alpine apk 的 v2 格式
    （双 gzip 流拼接 + abuild-tar --cut + APK-TOOLS.checksum.SHA1 PAX 头）
    Python 标准库无法生成。故我们产标准 ipk，通过下面任一方式安装：

    方式 1（推荐）：手动解压
      tar xzf luci-theme-routecraft_1.0.0-27_2512_all.ipk
      tar xzf data.tar.gz -C /
      tar xzf control.tar.gz
      sh postinst            # 自动备份原版 + 切 UCI + 创建 wizard.htm（25.12 没有）

    方式 2：如果系统自带 is-opkg（桥接器）
      is-opkg install luci-theme-routecraft_1.0.0-27_2512_all.ipk
"""
import io
import os
import sys
import tarfile
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "luci-theme-routecraft")
DIST = os.path.join(ROOT, "dist")
VERSION = "1.0.0"
RELEASE = "27"
STAMP = time.strftime("%Y%m%d%H%M")
PKGNAME = "luci-theme-routecraft"

EXEC_FILES = {
    "CONTROL/postinst", "CONTROL/prerm", "CONTROL/postrm", "CONTROL/preinst",
}


def read_norm(path):
    with open(path, "rb") as f:
        return f.read().replace(b"\r\n", b"\n")


def add_file(tar, arcname, data, mode):
    info = tarfile.TarInfo(arcname)
    info.size = len(data)
    info.mode = mode
    info.uid = info.gid = 0
    info.uname = info.gname = "root"
    info.mtime = int(time.time())
    tar.addfile(info, io.BytesIO(data))


def collect_files():
    ctrl, data = [], []
    for base, _dirs, files in os.walk(SRC):
        for name in files:
            full = os.path.join(base, name)
            rel = os.path.relpath(full, SRC).replace(os.sep, "/")
            (ctrl if rel.startswith("CONTROL/") else data).append((rel, full))
    ctrl.sort()
    data.sort()
    return ctrl, data


def build_ipk(data_files, control_files, suffix):
    """OpenWrt 标准 ipk：debian-binary + control.tar.gz + data.tar.gz"""
    os.makedirs(DIST, exist_ok=True)
    installed_size = sum(os.path.getsize(p) for _, p in data_files) // 1024

    data_buf = io.BytesIO()
    with tarfile.open(fileobj=data_buf, mode="w:gz", format=tarfile.USTAR_FORMAT) as tar:
        for rel, full in data_files:
            raw = read_norm(full)
            mode = 0o755 if rel in EXEC_FILES else 0o644
            add_file(tar, "./" + rel, raw, mode)

    ctrl_buf = io.BytesIO()
    with tarfile.open(fileobj=ctrl_buf, mode="w:gz", format=tarfile.USTAR_FORMAT) as tar:
        for rel, full in control_files:
            arc = rel.split("/", 1)[1]
            raw = read_norm(full)
            mode = 0o755 if arc in {"postinst", "prerm", "postrm", "preinst"} else 0o644
            add_file(tar, "./" + arc, raw, mode)

    name = "%s_%s-%s_%s_all.ipk" % (PKGNAME, VERSION, RELEASE, suffix)
    path = os.path.join(DIST, name)
    with tarfile.open(path, "w:gz", format=tarfile.USTAR_FORMAT) as tar:
        add_file(tar, "./debian-binary", b"2.0\n", 0o644)
        add_file(tar, "./control.tar.gz", ctrl_buf.getvalue(), 0o644)
        add_file(tar, "./data.tar.gz", data_buf.getvalue(), 0o644)
    print("  ipk:", name)
    return path


def main():
    ctrl, data = collect_files()
    built = []

    # 两个 ipk，内容完全相同，文件名区分目标固件
    built.append(build_ipk(data, ctrl, "2410"))
    built.append(build_ipk(data, ctrl, "2512"))

    print("\ndone:", len(built), "package(s) in dist/")
    print("\n安装提示:")
    print("  iStoreOS 24.10: opkg install luci-theme-routecraft_%s-%s_2410_all.ipk" % (VERSION, RELEASE))
    print("  iStoreOS 25.12: 手动解压（apk-tools 不支持标准 ipk，也没有 abuild-tar）")
    print("    tar xzf luci-theme-routecraft_%s-%s_2512_all.ipk" % (VERSION, RELEASE))
    print("    tar xzf data.tar.gz -C /")
    print("    tar xzf control.tar.gz && sh postinst")


if __name__ == "__main__":
    main()
