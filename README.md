# ALL PO ONE — 올포원

포켓몬 · 원피스 카드 컬렉션 판매 쇼케이스 사이트입니다.
빌드 도구 없이 순수 HTML/CSS/JS로만 동작하며, GitHub Pages로 배포됩니다.

- 사이트 주소: https://dlwjd0809-eng.github.io/cards/
- 저장소: https://github.com/dlwjd0809-eng/cards

## 파일 구성

| 파일 | 역할 |
| --- | --- |
| `index.html` | 페이지 구조 (보통 수정할 필요 없음) |
| `styles.css` | 디자인 |
| `cards.js` | **설정 + 카드 목록 — 여기만 고치면 됩니다** |
| `app.js` | 화면 동작 (수정할 필요 없음) |

## 자주 하는 수정

### 1) 오픈톡 링크 연결

`cards.js` 의 `SITE_CONFIG.openKakaoUrl` 에 카카오톡 오픈채팅방 주소를 넣습니다.

```js
openKakaoUrl: "https://open.kakao.com/o/abcd1234",
```

비어 있으면 [오픈톡 문의] 버튼을 눌렀을 때 "오픈톡 링크가 아직 연결되지 않았습니다" 안내가 뜨고,
[카드 정보 복사하기]는 그대로 동작합니다.

### 2) 카드 추가 · 수정

`cards.js` 의 `CARDS` 배열에 항목을 추가합니다. 필드 설명은 파일 안 주석에 있습니다.

```js
{
  id: "pk-새카드",          // 중복되지 않는 문자열
  game: "pokemon",           // "pokemon" | "onepiece"
  name: "카드 이름",
  setName: "세트 이름",
  cardNumber: "001/100",
  grade: "PSA 10",           // 화면에 보일 등급
  gradeBody: "PSA",          // 필터용: PSA | BGS | CGC | RAW | SEALED
  cert: "12345678",          // 인증번호 (없으면 생략)
  price: 120000,             // 원 단위 숫자
  status: "available",       // available(판매중) | reserved(예약중) | sold(판매완료)
  c1: "#0b3d66", c2: "#0e7490", accent: "#67e8f9",  // 카드 아트 색상
  glyph: "🌊",               // 아트에 들어갈 글자/이모지
  image: "",                 // 실물 사진 URL (넣으면 사진이 표시됨)
  note: "상세 화면 설명",
  sample: false              // 샘플 표시 끄기
}
```

### 3) 실물 사진 넣기

카드 사진을 `images/` 폴더에 넣고 `image: "images/파일명.jpg"` 처럼 지정하면
그라데이션 자리표시자 대신 사진이 표시됩니다. (권장 비율 5:7, 세로 사진)

### 4) 샘플 표시 끄기

실제 판매 카드로 모두 교체한 뒤 `cards.js` 에서 `showSampleBanner: false` 로 바꿉니다.

## 배포 방법

GitHub Pages는 이 저장소의 **`gh-pages` 브랜치**를 바라보고 있습니다.
`main` 은 작업용이고, 배포는 `deploy.sh` 가 `main` 을 `gh-pages` 로 밀어 넣어 처리합니다.

```bash
./deploy.sh "카드 3장 추가"
```

수동으로 할 때는:

```bash
git push origin main
git push origin main:gh-pages
```

푸시 후 1~2분 안에 https://dlwjd0809-eng.github.io/cards/ 에 반영됩니다.

> 저장소 설정(Settings → Pages)의 Source 를 바꿀 필요는 없습니다.
