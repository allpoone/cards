#!/usr/bin/env bash
# ALL PO ONE — 사이트 배포 스크립트
# 사용법: ./deploy.sh "커밋 메시지"
set -euo pipefail
cd "$(dirname "$0")"

# 항상 main 브랜치에서 작업합니다.
git checkout main >/dev/null 2>&1 || { echo "! main 브랜치를 찾을 수 없습니다."; exit 1; }

CUR=$(git rev-parse --abbrev-ref HEAD)
if [ "$CUR" != "main" ]; then echo "! main 브랜치로 전환하지 못했습니다 (현재: $CUR)"; exit 1; fi

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

echo "· 완료 — 1~2분 뒤 사이트에 반영됩니다."
