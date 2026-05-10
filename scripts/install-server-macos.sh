#!/usr/bin/env bash
set -euo pipefail

repo="${HOME}/deskrelay"
repo_url="https://github.com/darkhtk/deskrelay.git"
branch="main"
workspace_roots="${HOME}/Projects"
with_tailscale=0
no_open_browser=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      repo="$2"
      shift 2
      ;;
    --repo-url)
      repo_url="$2"
      shift 2
      ;;
    --branch)
      branch="$2"
      shift 2
      ;;
    --workspace-roots)
      workspace_roots="$2"
      shift 2
      ;;
    --with-tailscale)
      with_tailscale=1
      shift
      ;;
    --no-open-browser)
      no_open_browser=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

tailscale_command() {
  if command_exists tailscale; then
    command -v tailscale
    return
  fi
  if [[ -x "/Applications/Tailscale.app/Contents/MacOS/Tailscale" ]]; then
    printf "%s\n" "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
  fi
}

ensure_git() {
  if command_exists git; then
    echo "Git: installed"
    return
  fi
  if command_exists brew; then
    echo "Installing Git..."
    brew install git
    if command_exists git; then
      echo "Git: installed"
      return
    fi
  fi
  if command_exists xcode-select; then
    echo "Git is missing. Starting Apple command line tools installer."
    xcode-select --install || true
    echo "Finish the command line tools install, then run this installer again."
    exit 1
  fi
  echo "Git is required. Install Git, then run this installer again." >&2
  exit 1
}

ensure_bun() {
  if command_exists bun; then
    echo "Bun: installed"
    return
  fi
  echo "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="${HOME}/.bun/bin:${PATH}"
  if ! command_exists bun; then
    echo "Bun installation finished, but bun is not on PATH. Open a new terminal and run this installer again." >&2
    exit 1
  fi
}

tailscale_ip() {
  local ts
  ts="$(tailscale_command || true)"
  if [[ -n "${ts}" ]]; then
    "${ts}" ip -4 2>/dev/null | head -n 1 || true
  fi
}

ensure_tailscale() {
  if [[ "${with_tailscale}" != "1" ]]; then
    if [[ -n "$(tailscale_command || true)" ]]; then
      local ip
      ip="$(tailscale_ip)"
      if [[ -n "${ip}" ]]; then
        echo "Tailscale: online (${ip})"
      else
        echo "Tailscale: installed, not logged in"
      fi
    else
      echo "Tailscale: skipped. Add --with-tailscale to install/login for external access."
    fi
    return
  fi

  if [[ -z "$(tailscale_command || true)" ]]; then
    if command_exists brew; then
      echo "Installing Tailscale..."
      brew install --cask tailscale
    else
      echo "Tailscale is missing and Homebrew is not installed. Install Tailscale, log in, then run this installer again." >&2
      exit 1
    fi
  fi

  local ip
  ip="$(tailscale_ip)"
  if [[ -n "${ip}" ]]; then
    echo "Tailscale: online (${ip})"
    return
  fi

  echo "Opening Tailscale. Finish login, then run this installer again if no IP appears."
  open -a Tailscale >/dev/null 2>&1 || true
  local ts
  ts="$(tailscale_command || true)"
  if [[ -n "${ts}" ]]; then
    "${ts}" up || true
  fi
  ip="$(tailscale_ip)"
  if [[ -z "${ip}" ]]; then
    echo "Tailscale has no IPv4 address yet. Finish Tailscale login, then run this installer again." >&2
    exit 1
  fi
  echo "Tailscale: online (${ip})"
}

normalize_repo_url() {
  local value
  value="${1%/}"
  value="${value%.git}"
  printf "%s\n" "${value}" | tr '[:upper:]' '[:lower:]'
}

backup_existing_repo() {
  local reason="$1"
  if [[ ! -e "${repo}" ]]; then
    return
  fi
  local stamp backup i
  stamp="$(date +%Y%m%d-%H%M%S)"
  backup="$(dirname "${repo}")/deskrelay.server.backup.${stamp}"
  i=1
  while [[ -e "${backup}" ]]; do
    backup="$(dirname "${repo}")/deskrelay.server.backup.${stamp}.${i}"
    i=$((i + 1))
  done
  echo "Warning: ${reason} Moving existing folder to ${backup}" >&2
  mv "${repo}" "${backup}"
}

clone_fresh() {
  git clone --branch "${branch}" "${repo_url}" "${repo}"
  cd "${repo}"
}

ensure_repo() {
  if [[ -e "${repo}" ]]; then
    if [[ ! -d "${repo}/.git" ]]; then
      backup_existing_repo "DeskRelay server path exists but is not a git repository."
      clone_fresh
      return
    fi
    cd "${repo}"
    local origin dirty
    origin="$(git config --get remote.origin.url || true)"
    if [[ -z "${origin}" || "$(normalize_repo_url "${origin}")" != "$(normalize_repo_url "${repo_url}")" ]]; then
      cd "$(dirname "${repo}")"
      backup_existing_repo "DeskRelay server git remote is not ${repo_url}."
      clone_fresh
      return
    fi
    if ! dirty="$(git status --porcelain)"; then
      cd "$(dirname "${repo}")"
      backup_existing_repo "DeskRelay server folder has unreadable git status."
      clone_fresh
      return
    fi
    if [[ -n "${dirty}" ]]; then
      cd "$(dirname "${repo}")"
      backup_existing_repo "DeskRelay server folder has local changes or unreadable git status."
      clone_fresh
      return
    fi
    if ! git fetch origin "${branch}" || ! git checkout "${branch}" || ! git pull --ff-only origin "${branch}"; then
      cd "$(dirname "${repo}")"
      backup_existing_repo "DeskRelay server repo could not update cleanly."
      clone_fresh
    fi
    return
  fi
  clone_fresh
}

new_token() {
  openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
}

write_env() {
  mkdir -p "${repo}/.self-server/state/connector" \
    "${repo}/.self-server/state/identity" \
    "${repo}/.self-server/logs" \
    "${repo}/.self-server/workspace" \
    "${repo}/.self-server/tmp" \
    "${workspace_roots}"

  local token_file="${repo}/.self-server/site-token.txt"
  local token
  if [[ -f "${token_file}" ]]; then
    token="$(tr -d '\r\n' <"${token_file}")"
  else
    token="$(new_token)"
    printf "%s\n" "${token}" >"${token_file}"
  fi

  cat >"${repo}/.self-server/dev.env.sh" <<EOF
export CR_NAS_DEV_ROOT='${repo}/.self-server'
export CR_LOCAL_DEV='1'
export CR_SITE_HOST='127.0.0.1'
export CR_SITE_PORT='18192'
export CR_SITE_TOKEN='${token}'
export CR_SITE_TOKEN_FILE='${repo}/.self-server/site-token.txt'
export CR_SITE_DEVICE_REGISTRY_FILE='${repo}/.self-server/state/site-devices.json'
export CR_SITE_AUTH_OPTIONAL='0'
export CR_SITE_USAGE_DISABLED='1'
export CR_SITE_BACKEND_URL='http://127.0.0.1:18192'
export CR_CONNECTOR_HOST='127.0.0.1'
export CR_CONNECTOR_PORT='18191'
export CR_CONNECTOR_STATE_DIR='${repo}/.self-server/state/connector'
export CR_CONNECTOR_STATE_FILE='${repo}/.self-server/state/connector/daemon.json'
export CR_CONNECTOR_AUTH_FILE='${repo}/.self-server/state/connector/auth.json'
export CR_IDENTITY_DIR='${repo}/.self-server/state/identity'
export CR_CONNECTOR_WORKSPACE_ROOTS='${workspace_roots}'
export CR_CONNECTOR_DISABLE_AUTOLOAD='0'
export CR_DEV_FRONTEND_URL='http://127.0.0.1:18193'
export CR_DEV_SITE_URL='http://127.0.0.1:18192'
export CR_DEV_DAEMON_URL='http://127.0.0.1:18191'
export CR_DEV_PROCESS_FILE='${repo}/.self-server/state/dev-processes.json'
export CR_DEV_LOG_DIR='${repo}/.self-server/logs'
export CR_DEV_WORKSPACE_DIR='${repo}/.self-server/workspace'
export TEMP='${repo}/.self-server/tmp'
export TMP='${repo}/.self-server/tmp'
EOF
}

stop_existing() {
  if [[ -f "${repo}/.self-server/state/dev-processes.json" ]]; then
    bun -e "const fs=require('fs'); const p='${repo}/.self-server/state/dev-processes.json'; try { for (const row of JSON.parse(fs.readFileSync(p,'utf8'))) { if (row.pid) { try { process.kill(row.pid, 'SIGTERM'); } catch {} } } } catch {}"
    sleep 1
  fi
}

wait_http() {
  local url="$1"
  local header="${2:-}"
  local deadline=$((SECONDS + 25))
  while [[ ${SECONDS} -lt ${deadline} ]]; do
    if [[ -n "${header}" ]]; then
      if curl -fsS -H "${header}" "${url}" >/dev/null 2>&1; then
        return
      fi
    else
      if curl -fsS "${url}" >/dev/null 2>&1; then
        return
      fi
    fi
    sleep 0.5
  done
  echo "Timed out waiting for ${url}" >&2
  exit 1
}

start_processes() {
  # shellcheck disable=SC1091
  source "${repo}/.self-server/dev.env.sh"
  stop_existing

  nohup bash -lc "source '${repo}/.self-server/dev.env.sh'; cd '${repo}'; bun run packages/pc-connector-daemon/src/bin.ts" >"${CR_DEV_LOG_DIR}/daemon.log" 2>&1 &
  local daemon_pid=$!
  local deadline=$((SECONDS + 20))
  while [[ ${SECONDS} -lt ${deadline} ]]; do
    [[ -f "${CR_CONNECTOR_AUTH_FILE}" ]] && break
    sleep 0.25
  done
  if [[ ! -f "${CR_CONNECTOR_AUTH_FILE}" ]]; then
    echo "Daemon auth file was not created. See ${CR_DEV_LOG_DIR}/daemon.log" >&2
    exit 1
  fi
  local daemon_token
  daemon_token="$(bun -e "console.log(JSON.parse(require('fs').readFileSync('${CR_CONNECTOR_AUTH_FILE}','utf8')).token)")"
  wait_http "${CR_DEV_DAEMON_URL}/status" "Authorization: Bearer ${daemon_token}"

  nohup bash -lc "source '${repo}/.self-server/dev.env.sh'; cd '${repo}'; bun run packages/site-backend/src/bin.ts" >"${CR_DEV_LOG_DIR}/site-backend.log" 2>&1 &
  local backend_pid=$!
  wait_http "${CR_DEV_SITE_URL}/healthz"

  bun -e "const body=JSON.stringify({daemonUrl:process.env.CR_DEV_DAEMON_URL,label:'Local dev (' + require('os').hostname() + ')',authToken:'${daemon_token}'}); fetch(process.env.CR_DEV_SITE_URL + '/api/devices', {method:'POST', headers:{authorization:'Bearer '+process.env.CR_SITE_TOKEN, 'content-type':'application/json'}, body}).then(r=>{if(!r.ok) throw new Error('device register '+r.status);}).catch(e=>{console.error(e); process.exit(1);})"

  nohup bash -lc "source '${repo}/.self-server/dev.env.sh'; cd '${repo}'; bun --filter @deskrelay/site-frontend dev -- --host 0.0.0.0 --port 18193" >"${CR_DEV_LOG_DIR}/site-frontend.log" 2>&1 &
  local frontend_pid=$!
  wait_http "${CR_DEV_FRONTEND_URL}"

  bun -e "const fs=require('fs'); const rows=[{name:'daemon',pid:${daemon_pid},log:'${CR_DEV_LOG_DIR}/daemon.log'},{name:'site-backend',pid:${backend_pid},log:'${CR_DEV_LOG_DIR}/site-backend.log'},{name:'site-frontend',pid:${frontend_pid},log:'${CR_DEV_LOG_DIR}/site-frontend.log'}]; fs.writeFileSync(process.env.CR_DEV_PROCESS_FILE, JSON.stringify(rows, null, 2));"

  echo "DeskRelay self server is running."
  echo "Local URL: ${CR_DEV_FRONTEND_URL}"
  echo "Site token: ${CR_SITE_TOKEN}"
  if [[ -n "$(tailscale_command || true)" ]]; then
    local ip
    ip="$(tailscale_ip)"
    if [[ -n "${ip}" ]]; then
      echo "Tailscale URL: http://${ip}:18193/#site-token=${CR_SITE_TOKEN}"
    fi
  fi
  local lan
  lan="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  if [[ -n "${lan}" ]]; then
    echo "LAN URL: http://${lan}:18193/#site-token=${CR_SITE_TOKEN}"
  fi
  if [[ "${no_open_browser}" != "1" ]]; then
    open "${CR_DEV_FRONTEND_URL}/#site-token=${CR_SITE_TOKEN}" >/dev/null 2>&1 || true
  fi
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer is for macOS. Use scripts/install-server.ps1 on Windows." >&2
  exit 1
fi

echo "DeskRelay self-host server installer for macOS"
echo "Repo: ${repo}"
echo "Branch: ${branch}"
echo "Workspace roots: ${workspace_roots}"
echo "Note: macOS server support is experimental. Windows remains the primary connector target."

ensure_git
ensure_bun
ensure_tailscale
ensure_repo
bun install
write_env
start_processes
