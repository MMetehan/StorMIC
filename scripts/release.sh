#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CURRENT=$(node -e "console.log(require('$ROOT/package.json').version)")

echo "Mevcut versiyon: v$CURRENT"
printf "Yeni versiyon    : "
read -r NEW_VERSION

if [ -z "$NEW_VERSION" ]; then
  echo "İptal edildi."
  exit 1
fi

# package.json + package-lock.json güncelle
npm --prefix "$ROOT" version "$NEW_VERSION" --no-git-tag-version --allow-same-version > /dev/null
echo "✓ Versiyon → v$NEW_VERSION"

printf "Commit mesajı (boş = 'release v$NEW_VERSION'): "
read -r MSG
MSG="${MSG:-release v$NEW_VERSION}"

git -C "$ROOT" add package.json package-lock.json
git -C "$ROOT" commit -m "$MSG"
git -C "$ROOT" tag -a "v$NEW_VERSION" -m "$MSG"
git -C "$ROOT" push
git -C "$ROOT" push --tags

echo ""
echo "✓ v$NEW_VERSION gönderildi — GitHub Actions build başladı."
