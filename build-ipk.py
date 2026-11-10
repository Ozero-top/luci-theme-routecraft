# -*- coding: utf-8 -*-
"""Build luci-theme-routecraft ipk (tar.gz outer, ustar inner).

Usage: python build-ipk.py
Output: dist/luci-theme-routecraft_<ver>-<rel>_all.ipk
"""
import io
import os
import tarfile
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "luci-theme-routecraft")
DIST = os.path.join(ROOT, "dist")
VERSION = "1.0.0"
RELEASE = "25"
STAMP = time.strftime("%Y%m%d%H%M")

EXEC_FILES = {"CONTROL/postinst", "CONTROL/prerm", "CONTROL/postrm", "CONTROL/preinst"}


def read_normalized(path):
    with open(path, "rb") as f:
        data = f.read()
    # normalize CRLF -> LF for everything (templates, css, js, shell)
    return data.replace(b"\r\n", b"\n")


def inject(data, installed_size):
    return (data.replace(b"RCVERSION", STAMP.encode())
                .replace(b"RCSIZE", str(installed_size).encode())
                .replace(b"RCVER", ("%s-%s" % (VERSION, RELEASE)).encode()))


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


def build():
    os.makedirs(DIST, exist_ok=True)

    # collect files
    data_files = []   # (arcname-in-ipk, abspath)
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
        # directories first
        dirs = set()
        for rel, _ in data_files:
            parts = rel.split("/")[:-1]
            for i in range(1, len(parts) + 1):
                dirs.add("/".join(parts[:i]))
        for d in sorted(dirs):
            add_bytes(tar, "./" + d + "/", b"", 0o755, is_dir=True)
        for rel, full in data_files:
            raw = inject(read_normalized(full), installed_size)
            mode = 0o755 if rel in EXEC_FILES else 0o644
            add_bytes(tar, "./" + rel, raw, mode)

    # control.tar.gz (ustar)
    ctrl_buf = io.BytesIO()
    with tarfile.open(fileobj=ctrl_buf, mode="w:gz", format=tarfile.USTAR_FORMAT) as tar:
        for rel, full in control_files:
            arc = rel.split("/", 1)[1]
            raw = inject(read_normalized(full), installed_size)
            mode = 0o755 if arc in {"postinst", "prerm", "postrm", "preinst"} else 0o644
            add_bytes(tar, "./" + arc, raw, mode)

    # outer ipk: plain tar.gz with debian-binary / control.tar.gz / data.tar.gz
    ipk_name = "luci-theme-routecraft_%s-%s_all.ipk" % (VERSION, RELEASE)
    ipk_path = os.path.join(DIST, ipk_name)
    with tarfile.open(ipk_path, "w:gz", format=tarfile.USTAR_FORMAT) as tar:
        add_bytes(tar, "./debian-binary", b"2.0\n", 0o644)
        add_bytes(tar, "./control.tar.gz", ctrl_buf.getvalue(), 0o644)
        add_bytes(tar, "./data.tar.gz", data_buf.getvalue(), 0o644)

    print("built:", ipk_path)
    print("data files:", len(data_files), "control files:", len(control_files),
          "installed-size(KB):", installed_size)


if __name__ == "__main__":
    build()
