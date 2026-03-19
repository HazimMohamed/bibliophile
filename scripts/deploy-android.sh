#!/usr/bin/env bash
set -euo pipefail

# Experimental WSL/Linux path. This script is useful to keep around, but it has
# not been validated end-to-end against the current Windows-hosted emulator
# workflow, so treat it as a starting point rather than a guaranteed path.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"
ANDROID_DIR="$FRONTEND_DIR/android"
APP_ID="com.bibliophile.app"
PROXY_PORT="${BIBLIOPHILE_PROXY_PORT:-8787}"
SKIP_CLEAN="${BIBLIOPHILE_SKIP_CLEAN:-0}"
SKIP_UNINSTALL="${BIBLIOPHILE_SKIP_UNINSTALL:-0}"
SKIP_PROXY="${BIBLIOPHILE_SKIP_PROXY:-0}"
DEVICE_ID="${BIBLIOPHILE_ANDROID_DEVICE:-}"
AVD_NAME="${BIBLIOPHILE_ANDROID_AVD:-}"
PROXY_TARGET_BASE="${BIBLIOPHILE_PROXY_TARGET_BASE:-}"

step() {
  printf '\n==> %s\n' "$1"
}

info() {
  printf '    %s\n' "$1"
}

warn() {
  printf '    %s\n' "$1" >&2
}

pick_proxy_target() {
  echo "    1. Local backend on another port"
  echo "    2. Tailnet HTTPS backend"
  echo "    3. Other"

  while true; do
    read -r -p "    Select backend [1/2/3]: " choice
    case "$choice" in
      1)
        read -r -p "    Local backend port [8000]: " local_port
        local_port="${local_port:-8000}"
        PROXY_TARGET_BASE="http://127.0.0.1:${local_port}"
        return
        ;;
      2)
        PROXY_TARGET_BASE="https://zerver.ribbon-fir.ts.net/api"
        return
        ;;
      3)
        read -r -p "    Enter full backend base URL: " other_url
        if [[ -n "${other_url}" ]]; then
          PROXY_TARGET_BASE="${other_url}"
          return
        fi
        warn "Please enter a full URL like https://example.com/api"
        ;;
      *)
        warn "Please choose 1, 2, or 3."
        ;;
    esac
  done
}

find_android_tool() {
  local tool_name="$1"

  if command -v "$tool_name" >/dev/null 2>&1; then
    command -v "$tool_name"
    return
  fi

  local sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
  if [[ -n "${sdk_root}" && -x "${sdk_root}/${tool_name}/${tool_name}" ]]; then
    printf '%s\n' "${sdk_root}/${tool_name}/${tool_name}"
    return
  fi

  return 1
}

select_device() {
  if [[ -n "${DEVICE_ID}" ]]; then
    printf '%s\n' "${DEVICE_ID}"
    return
  fi

  mapfile -t devices < <(adb devices | awk 'NR>1 && $2=="device" {print $1}')

  if [[ "${#devices[@]}" -eq 0 ]]; then
    printf '\n'
    return
  fi

  if [[ "${#devices[@]}" -eq 1 ]]; then
    printf '%s\n' "${devices[0]}"
    return
  fi

  for device in "${devices[@]}"; do
    if [[ "${device}" == emulator-* ]]; then
      warn "Multiple devices detected. Picking ${device}."
      printf '%s\n' "${device}"
      return
    fi
  done

  warn "Multiple devices detected. Picking ${devices[0]}."
  printf '%s\n' "${devices[0]}"
}

pick_avd_name() {
  local emulator_path="$1"

  if [[ -n "${AVD_NAME}" ]]; then
    printf '%s\n' "${AVD_NAME}"
    return
  fi

  mapfile -t avds < <("$emulator_path" -list-avds | sed '/^\s*$/d')

  if [[ "${#avds[@]}" -eq 0 ]]; then
    warn "No Android virtual devices were found."
    return 1
  fi

  if [[ "${#avds[@]}" -eq 1 ]]; then
    printf '%s\n' "${avds[0]}"
    return
  fi

  for avd in "${avds[@]}"; do
    if [[ "${avd}" =~ Pixel[_[:space:]]?5 ]]; then
      printf '%s\n' "${avd}"
      return
    fi
  done

  for avd in "${avds[@]}"; do
    if [[ "${avd}" =~ Pixel ]]; then
      printf '%s\n' "${avd}"
      return
    fi
  done

  printf '%s\n' "${avds[0]}"
}

start_emulator_if_needed() {
  local emulator_path="$1"
  local existing
  existing="$(select_device)"
  if [[ -n "${existing}" ]]; then
    printf '%s\n' "${existing}"
    return
  fi

  step "Starting Android emulator"
  local avd
  avd="$(pick_avd_name "$emulator_path")"
  info "Launching AVD ${avd}"
  nohup "$emulator_path" -avd "$avd" >/tmp/bibliophile-emulator.log 2>&1 &

  local deadline=$((SECONDS + 180))
  while (( SECONDS < deadline )); do
    sleep 3
    local candidate
    candidate="$(select_device)"
    if [[ -n "${candidate}" ]] && [[ "$(adb -s "$candidate" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; then
      info "Emulator ${candidate} is booted and ready."
      printf '%s\n' "${candidate}"
      return
    fi
  done

  warn "Timed out waiting for the emulator to boot."
  return 1
}

start_dev_proxy() {
  local node_path="$1"
  local target_base="$2"
  local proxy_root="${TMPDIR:-/tmp}/bibliophile-dev-proxy"
  local pid_file="${proxy_root}/proxy.pid"
  local log_file="${proxy_root}/proxy.log"
  local err_file="${proxy_root}/proxy.err.log"

  mkdir -p "${proxy_root}"

  if [[ -f "${pid_file}" ]]; then
    local old_pid
    old_pid="$(cat "${pid_file}")"
    if [[ -n "${old_pid}" ]] && kill -0 "${old_pid}" 2>/dev/null; then
      kill "${old_pid}" 2>/dev/null || true
      info "Stopped previous dev proxy process ${old_pid}"
    fi
  fi

  nohup "${node_path}" "${SCRIPT_DIR}/dev-proxy.js" --target-base "${target_base}" --port "${PROXY_PORT}" >"${log_file}" 2>"${err_file}" &
  local proxy_pid=$!
  printf '%s' "${proxy_pid}" >"${pid_file}"
  sleep 1

  if ! kill -0 "${proxy_pid}" 2>/dev/null; then
    warn "Dev proxy exited immediately."
    [[ -f "${err_file}" ]] && cat "${err_file}" >&2
    return 1
  fi

  info "Proxy target: ${target_base}"
  info "Proxy URL:    http://10.0.2.2:${PROXY_PORT}/api"
  info "Proxy log:    ${log_file}"
}

step "Locating local Android tools"
ADB_PATH="$(find_android_tool adb || true)"
EMULATOR_PATH="$(find_android_tool emulator || true)"
NODE_PATH="$(command -v node || true)"

if [[ -z "${ADB_PATH}" ]]; then
  warn "Could not find adb. Install Android platform-tools or add them to PATH."
  exit 1
fi

if [[ -z "${NODE_PATH}" ]]; then
  warn "Could not find node. Install Node.js or add it to PATH."
  exit 1
fi

info "adb:      ${ADB_PATH}"
info "node:     ${NODE_PATH}"
[[ -n "${EMULATOR_PATH}" ]] && info "emulator: ${EMULATOR_PATH}"

step "Ensuring adb server is running"
"${ADB_PATH}" start-server >/dev/null

step "Selecting target device"
DEVICE="$(select_device)"
if [[ -z "${DEVICE}" ]]; then
  if [[ -z "${EMULATOR_PATH}" ]]; then
    warn "No device detected and emulator could not be found."
    exit 1
  fi
  DEVICE="$(start_emulator_if_needed "${EMULATOR_PATH}")"
fi
info "Device: ${DEVICE}"

if [[ "${SKIP_PROXY}" != "1" ]]; then
  step "Choose dev proxy backend"
  [[ -n "${PROXY_TARGET_BASE}" ]] || pick_proxy_target
  step "Starting local dev proxy"
  start_dev_proxy "${NODE_PATH}" "${PROXY_TARGET_BASE}"
fi

step "Building Android web assets"
(cd "${FRONTEND_DIR}" && npm run build:android && npm run cap:sync)

step "Building Android app"
if [[ "${SKIP_CLEAN}" != "1" ]]; then
  (cd "${ANDROID_DIR}" && ./gradlew clean)
fi
(cd "${ANDROID_DIR}" && ./gradlew assembleDebug)

APK_PATH="${ANDROID_DIR}/app/build/outputs/apk/debug/app-debug.apk"
if [[ ! -f "${APK_PATH}" ]]; then
  warn "Expected APK was not found at ${APK_PATH}"
  exit 1
fi

if [[ "${SKIP_UNINSTALL}" != "1" ]]; then
  step "Removing previous app install"
  "${ADB_PATH}" -s "${DEVICE}" uninstall "${APP_ID}" >/dev/null 2>&1 || true
fi

step "Installing fresh APK"
"${ADB_PATH}" -s "${DEVICE}" install -r "${APK_PATH}"

step "Launching Bibliophile"
"${ADB_PATH}" -s "${DEVICE}" shell am start -n "${APP_ID}/.MainActivity" >/dev/null

printf '\nDeploy complete.\n'
if [[ "${SKIP_PROXY}" != "1" ]]; then
  printf 'Proxy relay remains available at http://10.0.2.2:%s/api\n' "${PROXY_PORT}"
fi
