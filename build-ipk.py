# -*- coding: utf-8 -*-
"""Build luci-theme-routecraft ipk (tar.gz outer, ustar inner).

Usage: python build-ipk.py          # 同时产 24.10 / 25.12 两个包
       python build-ipk.py 25       # 只产指定版本

两个版本的源码完全相同，postinst 在安装时自动检测 wizard.htm 是否存在
（24.10 自带，25.12 没有就从原版 main.htm 复制创建）。
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
RELEASE_BASE = "26"           # Release 号（每次迭代递增）
STAMP = time.strftime("%Y%m%d%H%M")

EXEC_FILES = {"CONTROL/postinst", "CONTROL/prerm", "CONTROL/postrm", "CONTROL/preinst"}
# 两个目标：24.10 和 25.12
TARGETS = [
    ("24.10", "rc24"),
    ("25.12", "rc25"),
]


def read_normalized(path):
    with open(path, "rb") as f:
        data = f.read()
    return data.replace(b"\r\n", b"\n")


def inject(data, installed_size, release_tag):
    return (data.replace(b"RCVERSION", STAMP.encode())
                .replace(b"RCSIZE", str(installed_size).encode())
                .replace(b"RCVER", ("%s-%s" % (VERSION, RELEASE_BASE)).encode())
                .replace(b"RCTARGET", release_tag.encode()))


def add_bytes(tar, arcname, data, mode, is_dir=False):
    info = tarfile.TarInfo(arcname)
    info.size = 0 if is_dir else len(data)
    info.mode = mode
    info.uid = info.gid = 0
    info.uname = info.gname = "root"
    info.mtime = int(time.time())
    if is_dir:
        info.type = tarfile.DIRTYPE
    tar.addfile(info, io.BytesIO(data))


def build_one(ver_label, release_tag):
    os.makedirs(DIST, exist_ok=True)

    data_files = []
    control_files = []
    for base, _dirs, files in os.walk(SRC):
        for name in files:
            full = os.path.join(base, name)
            rel = os.path.relpath(full, SRC).replace(os.sep, "/")
            if rel.startswith("CONTROL/"):
                control_files.append((rel, full))
            else:
                data_files.append((rel, full))

    data_files.sort()
    control_files.sort()
    installed_size = sum(os.path.getsize(p) for _, p in data_files) // 1024

    # data.tar.gz (ustar)
    data_buf = io.BytesIO()
    with tarfile.open(fileobj=data_buf, mode="w:gz", format=tarfile.USTAR_FORMAT) as tar:
        dirs = set()
        for rel, _ in data_files:
            parts = rel.split("/")[:-1]
            for i in range(1, len(parts) + 1):
                dirs.add("/".join(parts[:i]))
        for d in sorted(dirs):
            add_bytes(tar, "./" + d + "/", b"", 0o755, is_dir=True)
        for rel, full in data_files:
            raw = inject(read_normalized(full), installed_size, release_tag)
            mode = 0o755 if rel in EXEC_FILES else 0o644
            add_bytes(tar, "./" + rel, raw, mode)

    # control.tar.gz (ustar)
    ctrl_buf = io.BytesIO()
    with tarfile.open(fileobj=ctrl_buf, mode="w:gz", format=tarfile.USTAR_FORMAT) as tar:
        for rel, full in control_files:
            arc = rel.split("/", 1)[1]
            raw = inject(read_normalized(full), installed_size, release_tag)
            mode = 0o755 if arc in {"postinst", "prerm", "postrm", "preinst"} else 0o644
            add_bytes(tar, "./" + arc, raw, mode)

    ipk_name = "luci-theme-routecraft_%s-%s_%s_all.ipk" % (VERSION, RELEASE_BASE, ver_label.replace(".", ""))
    ipk_path = os.path.join(DIST, ipk_name)
    with tarfile.open(ipk_path, "w:gz", format=tarfile.USTAR_FORMAT) as tar:
        add_bytes(tar, "./debian-binary", b"2.0\n", 0o644)
        add_bytes(tar, "./control.tar.gz", ctrl_buf.getvalue(), 0o644)
        add_bytes(tar, "./data.tar.gz", data_buf.getvalue(), 0o644)

    print("built:", ipk_path, "(%s, %s)" % (ver_label, release_tag))
    return ipk_path


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    built = []
    for ver_label, release_tag in TARGETS:
        if only and release_tag != only:
            continue
        built.append(build_one(ver_label, release_tag))
    print("----")
    print("done:", len(built), "package(s) in dist/")


if __name__ == "__main__":
    main()
