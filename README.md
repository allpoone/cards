# ALL PO ONE — 올포원

포켓몬 · 원피스 **미개봉 박스 & 오리파** 판매 쇼케이스 사이트입니다.
빌드 도구 없이 순수 HTML/CSS/JS로만 동작하며, GitHub Pages로 배포됩니다.

- 사이트 주소: 이 저장소의 **Settings → Pages** 에 표시되는 주소
- 배포 브랜치: `gh-pages` (작업 브랜치는 `main`)

## 파일 구성

| 파일 | 역할 |
| --- | --- |
| `index.html` | 페이지 구조 (보통 수정할 필요 없음) |
| `styles.css` | 디자인 |
| `cards.js` | **설정 + 상품 목록 — 여기만 고치면 됩니다** |
| `app.js` | 화면 동작 (수정할 필요 없음) |
| `logo.png` | 가게 로고 원본 (1254×1254, og:image·apple-touch-icon 용) |
| `logo-160.png` | 헤더·파비콘용 소형 로고 (160×160) |

## 자주 하는 수정

### 1) 오픈톡 · 유튜브 라이브 링크 연결

`cards.js` 의 `SITE_CONFIG` 에서 두 줄만 채우면 됩니다.

```js
openKakaoUrl: "https://open.kakao.com/o/abcd1234",   // 오픈톡 방 주소
youtubeUrl: "https://www.youtube.com/@채널/live",     // 라이브 주소
```

- `openKakaoUrl` 이 비어 있으면 [오픈톡 문의] 버튼을 눌렀을 때
  "오픈톡 링크가 아직 연결되지 않았습니다" 안내가 뜨고, [정보 복사하기]는 그대로 동작합니다.
- `youtubeUrl` 을 넣으면 상단에 [유튜브 라이브] 버튼이 생깁니다.

### 2) 상품 추가 · 수정

`cards.js` 의 `PRODUCTS` 배열에 항목을 추가합니다. 필드 설명은 파일 안 주석에 있습니다.

**미개봉 박스**

```js
{
  id: "box-새상품",
  type: "box",                 // box | oripa | single
  game: "pokemon",             // pokemon | onepiece
  name: "테라스탈 페스티벌 ex 박스",
  series: "테라스탈 페스티벌 ex",   // 검색에 쓰입니다
  setCode: "SV8a",
  language: "JP",              // JP | KR | EN
  shrink: "O",                 // O | X | CARTON
  remaining: 4,                // 남은 수량
  price: 320000,               // 박스당 가격
  status: "available",         // available | low | soldout
  c1: "#1a1040", c2: "#7c3aed", accent: "#c4b5fd", glyph: "💎",
  sample: false
}
```

**오리파**

```js
{
  id: "oripa-새회차",
  type: "oripa",
  game: "onepiece",
  name: "OP-09 오리파",
  series: "신세계",
  language: "JP",
  price: 9900,                 // 1구 가격
  totalUnits: 50,              // 총 구수
  remainingUnits: 18,          // 남은 구수
  status: "low",
  prizes: [
    { label: "메인 어타리", name: "루피 리더 패러렐 PSA 10" },
    { label: "라스트원상", name: "OP-09 박스 1박스" }
  ],
  lineupNote: "메인 1개 · 라스트원상 1개 구성",
  c1: "#5c0f14", c2: "#ef4444", accent: "#fca5a5", glyph: "🎰",
  sample: false
}
```

`remainingUnits` 를 0으로 두면 자동으로 **완판** 표시되고 문의 버튼이 비활성화됩니다.

### 3) 실물 사진 넣기

상품 사진을 `images/` 폴더에 넣고 `image: "images/파일명.jpg"` 를 추가하면
그라데이션 자리표시자 대신 사진이 표시됩니다. (권장 비율 5:7 세로)

### 4) 샘플 표시 끄기
실제 상품으로 모두 교체한 뒤 `SITE_CONFIG.showSampleBanner` 를 `false` 로 바꾸고,
각 상품의 `sample: true` 를 지웁니다.

## 로고 교체

새 로고 이미지를 `logo.png` 에 덮어쓰고, 같은 이미지를 160×160으로 줄여 `logo-160.png` 에 저장한 뒤 `./deploy.sh "로고 교체"` 를 실행하면 됩니다.

```bash
python3 -c "from PIL import Image; im=Image.open('logo.png').convert('RGB'); im.resize((160,160), Image.LANCZOS).save('logo-160.png')"
```

## 배포 방법

GitHub Pages는 이 저장소의 **`gh-pages` 브랜치**를 바라봅니다.
`main` 에서 작업한 뒤 스크립트로 배포하면 됩니다.

```bash
./deploy.sh "상품 3종 추가"
```

수동으로 할 때는:

```bash
git push origin main
git push origin main:gh-pages
```

푸시 후 1~2분 안에 사이트에 반영됩니다.
