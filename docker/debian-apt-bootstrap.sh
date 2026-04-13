#!/bin/sh
# 在 apt-get update / install 前将官方地址换为镜像站（默认阿里云，减轻国内拉 deb 极慢）
# 海外构建请设 USE_APT_MIRROR=0，或通过 compose build-arg 注入。
set -eu

apply_apt_mirror() {
  case "${USE_APT_MIRROR:-1}" in
  0 | false | FALSE | no | NO | off | OFF) return 0 ;;
  esac

  for f in /etc/apt/sources.list.d/debian.sources /etc/apt/sources.list.d/debian.list /etc/apt/sources.list; do
    if [ -f "$f" ]; then
      sed -i \
        -e 's|http://deb.debian.org/debian|http://mirrors.aliyun.com/debian|g' \
        -e 's|https://deb.debian.org/debian|https://mirrors.aliyun.com/debian|g' \
        -e 's|http://security.debian.org/debian-security|http://mirrors.aliyun.com/debian-security|g' \
        -e 's|https://security.debian.org/debian-security|https://mirrors.aliyun.com/debian-security|g' \
        "$f" || true
    fi
  done
}

apply_apt_mirror
apt-get update
apt-get install -y --no-install-recommends "$@"
rm -rf /var/lib/apt/lists/*
