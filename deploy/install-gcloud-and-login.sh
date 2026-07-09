#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/cloud-run.env"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck source=/dev/null
  source "${ENV_FILE}"
fi

PROJECT_ID="${PROJECT_ID:-verdant-branch-501217-u8}"
SDK_DIR="${HOME}/google-cloud-sdk"
ARCH="$(uname -m)"

case "${ARCH}" in
  arm64)
    PACKAGE="google-cloud-cli-darwin-arm.tar.gz"
    ;;
  x86_64)
    PACKAGE="google-cloud-cli-darwin-x86_64.tar.gz"
    ;;
  *)
    echo "Unsupported macOS architecture: ${ARCH}" >&2
    exit 1
    ;;
esac

DOWNLOAD_URL="https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/${PACKAGE}"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

if [[ ! -x "${SDK_DIR}/bin/gcloud" ]]; then
  echo "Downloading ${PACKAGE}..."
  curl -L --fail -o "${TMP_DIR}/${PACKAGE}" "${DOWNLOAD_URL}"

  echo "Installing Google Cloud CLI to ${SDK_DIR}..."
  tar -xf "${TMP_DIR}/${PACKAGE}" -C "${HOME}"
  "${SDK_DIR}/install.sh" --quiet --usage-reporting=false --path-update=true --command-completion=true
else
  echo "Google Cloud CLI already exists at ${SDK_DIR}/bin/gcloud"
fi

GCLOUD="${SDK_DIR}/bin/gcloud"

echo "Google Cloud CLI version:"
"${GCLOUD}" --version

echo "Starting browser login..."
"${GCLOUD}" auth login

echo "Setting active project to ${PROJECT_ID}..."
"${GCLOUD}" config set project "${PROJECT_ID}"

echo "Current authenticated accounts:"
"${GCLOUD}" auth list

echo "Current gcloud config:"
"${GCLOUD}" config list

echo "Done. Open a new terminal, or run:"
echo "  source ~/.zshrc"
