#!/usr/bin/env bash
# ALL PO ONE — 사이트 배포 스크립트
# 사용법: ./deploy.sh "커밋 메시지"
set -euo pipefail
cd "$(dirname "$0")"

MSG="${1:-사이트 업데이트}"

git add -A
if git diff --cached --quiet; then
  echo "· 변경 사항이 없습니다."
else
  git commit -m "$MSG"
fi

echo "· main 푸시"
git push origin main
echo "· gh-pages(배포 브랜치) 푸시"
git push origin main:gh-pages

echo "· 완료 — 1~2분 뒤 https://dlwjd0809-eng.github.io/cards/ 에 반영됩니다."
