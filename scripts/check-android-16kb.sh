#!/usr/bin/env bash
#
# Google Play requires 16 KB page-size support for 64-bit native code. Checks an .apk or .aab:
#   - every 64-bit .so (arm64-v8a, x86_64) has LOAD segments aligned to at least 16 KB;
#   - an .apk's uncompressed .so entries sit at 16 KB offsets (zipalign -c -P 16).
# 32-bit libraries (armeabi-v7a) run on 4 KB-page devices only and are not checked.
#
#   bash scripts/check-android-16kb.sh <file.apk|file.aab> [...]
#
# Our libnode.so is nodejs-mobile 18.20.4 rebuilt with -Wl,-z,max-page-size=16384 (upstream
# main d9552e0e, no official release yet); see platforms/mobile/README.md, Android step 4.
set -euo pipefail

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
READELF="$(ls -d "$SDK"/ndk/*/toolchains/llvm/prebuilt/*/bin/llvm-readelf 2>/dev/null | sort -V | tail -1)"
ZIPALIGN="$(ls -d "$SDK"/build-tools/*/zipalign 2>/dev/null | sort -V | tail -1)"
[ -x "$READELF" ] || { echo "[16kb] llvm-readelf not found under $SDK/ndk" >&2; exit 2; }
[ $# -gt 0 ] || { echo "usage: $0 <file.apk|file.aab> [...]" >&2; exit 2; }

status=0
for artifact in "$@"; do
  [ -f "$artifact" ] || { echo "[16kb] no such file: $artifact" >&2; exit 2; }
  work="$(mktemp -d)"
  unzip -q "$artifact" '*lib/*.so' -d "$work" 2>/dev/null || true
  checked=0
  while IFS= read -r so; do
    case "$so" in */lib/arm64-v8a/*|*/lib/x86_64/*|lib/arm64-v8a/*|lib/x86_64/*) ;; *) continue ;; esac
    checked=$((checked + 1))
    # Smallest LOAD alignment in the file, compared with 0x4000.
    min=""
    for align in $("$READELF" -lW "$work/$so" | awk '$1 == "LOAD" { print $NF }'); do
      value=$((align))
      if [ -z "$min" ] || [ "$value" -lt "$min" ]; then min=$value; fi
    done
    if [ "${min:-0}" -lt 16384 ]; then
      printf '[16kb] FAIL %s: %s LOAD alignment %#x\n' "$(basename "$artifact")" "$so" "${min:-0}"
      status=1
    fi
  done < <(cd "$work" && find . -name '*.so' | sed 's|^\./||' | sort)
  rm -rf "$work"
  [ "$checked" -gt 0 ] || { echo "[16kb] FAIL $(basename "$artifact"): no 64-bit native libraries found"; status=1; }
  case "$artifact" in
    *.apk)
      [ -x "$ZIPALIGN" ] || { echo "[16kb] zipalign not found under $SDK/build-tools" >&2; exit 2; }
      if ! "$ZIPALIGN" -c -P 16 4 "$artifact" >/dev/null 2>&1; then
        echo "[16kb] FAIL $(basename "$artifact"): native libraries not at 16 KB offsets (zipalign -c -P 16)"
        status=1
      fi
      ;;
  esac
  [ "$status" = 0 ] && echo "[16kb] ok $(basename "$artifact"): $checked 64-bit libraries 16 KB aligned"
done
exit "$status"
