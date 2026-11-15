# ALL PO ONE — 올포원

포켓몬 · 원피스 **미개봉 박스 & 오리파** 판매 쇼케이스 사이트입니다.
빌드 도구 없이 순수 HTML/CSS/JS로만 동작하며, GitHub Pages로 배포됩니다.

- 사이트 주소: 이 저장소의 **Settings → Pages** 에 표시되는 주소
- 배포 브랜치: `gh-pages` (작업 브랜치는 `main`)

## 파일 구성

| 파일 | 역할 |
| --- | --- |
| `index.html` | 손님 화면 구조 (보통 수정할 필요 없음) |
| `styles.css` | 디자인 |
| `cards.js` | **설정 + 상품 목록 — 여기만 고치면 됩니다** |
| `store.js` | 재고 · 장바구니 · 주문 데이터 처리 (Supabase / localStorage) |
| `app.js` | 상품 카드 · 상세 화면 동작 |
| `shop.js` | 장바구니 · 주문서 · 입금 안내 · 주문 조회 화면 |
| `admin.html` · `admin.js` · `admin.css` | **사장님 페이지** (주문 처리 · 재고 수정) |
| `supabase-schema.sql` | Supabase 테이블 · RLS · RPC 함수 (DB 연동할 때 실행) |
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
  stock: 4,                    // 현재 재고 (장바구니 담기 가능 수량)
  remaining: 4,                // 남은 수량 (stock 과 같게)
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
  stock: 18,                   // 현재 남은 구수
  totalUnits: 50,              // 총 구수
  remainingUnits: 18,          // 남은 구수 (stock 과 같게)
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

`remainingUnits` 를 0으로 두면 자동으로 **완판** 표시되고 장바구니 담기가 막힙니다.
주문이 들어가 재고가 0이 되면 사이트가 자동으로 품절 처리합니다.

### 3) 실물 사진 넣기

상품 사진을 `images/` 폴더에 넣고 `image: "images/파일명.jpg"` 를 추가하면
그라데이션 자리표시자 대신 사진이 표시됩니다. (권장 비율 5:7 세로)

### 4) 샘플 표시 끄기

실제 상품으로 모두 교체한 뒤 `SITE_CONFIG.showSampleBanner` 를 `false` 로 바꾸고,
각 상품의 `sample: true` 를 지웁니다.

## 장바구니 · 계좌이체 주문

손님은 상품 카드의 **[장바구니 담기]** → 헤더(모바일은 하단 바) 장바구니 →
수량 조절 → **[주문하기]** → 주문서 작성 → **계좌이체로 주문하기** 순서로 주문합니다.

- 품절·완판 상품은 담기 버튼이 비활성화되고, 남은 재고보다 많이 담을 수 없습니다.
- 주문이 접수되면 `APO-YYYYMMDD-XXXX` 형식의 주문번호가 만들어지고 상태는 **입금대기**가 됩니다.
- 손님은 **[내 주문 조회]** 에서 주문번호 또는 주문자명+연락처로 상태를 확인할 수 있습니다.
  (`입금대기` → `입금완료` → `발송완료`, 또는 `취소됨`)

### 1) 입금 계좌 넣기 (가장 먼저 할 일)

`cards.js` 의 `SITE_CONFIG` 에서 세 줄만 채우면 주문 완료 화면에 바로 표시됩니다.

```js
bankAccount: {
  bank: "카카오뱅크",
  number: "3333-01-1234567",
  holder: "예금주 이름",
},
```

비워 두면 "계좌 정보 준비 중" 안내가 뜨고, 손님은 오픈톡으로 문의하게 됩니다.

### 2) 테스트 모드 (지금 상태)

`supabaseUrl` 이 비어 있으면 **DB 연동 전 테스트 모드**로 동작합니다.

- 주문·재고·주문내역이 이 브라우저(localStorage)에만 저장됩니다.
- 화면 위에 작은 파란 배너로 테스트 모드임을 안내합니다.
- 같은 브라우저에서 `admin.html` 을 열면 방금 넣은 테스트 주문을 그대로 처리해 볼 수 있습니다.

### 3) 실제 DB로 전환 (Supabase)

1. [supabase.com](https://supabase.com) 에서 프로젝트를 만듭니다. (무료 플랜 가능)
2. **SQL Editor** 에 `supabase-schema.sql` 전체를 붙여넣고 실행합니다.
3. 관리자 PIN 을 바꿉니다.

   ```sql
   update private.shop_settings set admin_pin = '1234' where id = 1;
   ```

4. **Project Settings → API** 의 `Project URL` 과 `anon public` 키를 `cards.js` 에 넣습니다.

   ```js
   supabaseUrl: "https://xxxxxxxx.supabase.co",
   supabaseAnonKey: "eyJhbGciOi...",
   ```

5. `./deploy.sh "Supabase 연동"` 으로 배포하면 파란 테스트 배너가 사라지고 실제 DB 로 저장됩니다.

DB 로 바꾸면 재고 차감이 **원자적(atomic)** 으로 처리되어, 동시에 여러 명이 주문해도
재고가 음수가 되지 않습니다. 재고가 0이 되는 순간 자동으로 품절(`sold`) 처리됩니다.

## 사장님 페이지 (`admin.html`)

주소: `https://allpoone.github.io/cards/admin.html`

- **잠금**: `cards.js` 의 `adminPin` (기본값 `0000` — 배포 후 꼭 바꾸세요)
- **주문 관리**: 전체 / 입금대기 / 입금완료 / 발송완료 / 취소 필터
  - **[입금확인 완료]** → `입금완료`
  - **[발송완료]** → `발송완료`
  - **[미입금 취소(재고복구)]** → `취소됨` + 차감했던 재고 자동 복구 + 품절 해제
- **재고 관리**: 상품별 `-` / `+` 또는 숫자 입력 후 **[저장]** → 사이트에 즉시 반영 (0이면 자동 품절)

> PIN 잠금은 화면 잠금입니다. 실제 서버 보안은 `supabase-schema.sql` 의 RLS +
> 관리자 함수(`update_order_status`, `admin_set_stock`)가 담당합니다. 여러 명이
> 함께 관리해야 한다면 Supabase Auth 사용자에 `app_metadata.role = 'admin'` 을 주고
> PIN 없이 쓰는 방식을 권장합니다.

### 주문 상태 흐름

```
입금대기 (pending_payment)
   ├─ [입금확인 완료] → 입금완료 (paid) ─ [발송완료] → 발송완료 (shipped)
   └─ [미입금 취소]   → 취소됨 (cancelled, 재고 복구)
```

## 자동 입금 확인 (은행 알림 → 입금완료)

Supabase 연동 후에는 **안드로이드 MacroDroid** 같은 앱으로 은행 입금 푸시 알림을 받아
`auto_confirm_deposit` 함수를 호출하면, 1초 만에 주문이 **[입금완료]** 로 바뀝니다.
(테스트 모드에서는 동작하지 않습니다.)

### 1) 시크릿 확인

Supabase **SQL Editor** 에서 실행하면 자동 입금 확인용 시크릿이 나옵니다. (설치할 때 무작위 생성)

```sql
select deposit_secret from private.shop_settings;
```

바꾸고 싶으면:

```sql
update private.shop_settings set deposit_secret = '길고-복잡한-임의의-문자열' where id = 1;
```

### 2) 호출 주소

```
POST https://<프로젝트>.supabase.co/rest/v1/rpc/auto_confirm_deposit
headers:
  apikey: <anon public key>
  Authorization: Bearer <anon public key>
  Content-Type: application/json
body:
  {"p_notification_text": "홍길동 50,000원 입금", "p_secret": "<deposit_secret>"}
```

터미널에서 먼저 확인:

```bash
curl -s -X POST 'https://<프로젝트>.supabase.co/rest/v1/rpc/auto_confirm_deposit' \
  -H 'apikey: <anon key>' \
  -H 'Authorization: Bearer <anon key>' \
  -H 'Content-Type: application/json' \
  -d '{"p_notification_text":"홍길동 50,000원 입금","p_secret":"<deposit_secret>"}'
```

### 3) MacroDroid 설정

1. **트리거**: `알림(Notification) 수신` → 은행 앱 선택 → (선택) 알림 내용에 `입금` 포함
2. **동작**: `HTTP 요청(HTTP Request)`
   - Method: `POST`
   - URL: 위 주소
   - Content-Type: `application/json`
   - Body: `{"p_notification_text":"[알림 텍스트 변수]","p_secret":"<deposit_secret>"}`
   - 헤더: `apikey`, `Authorization: Bearer <anon key>`
3. 알림 텍스트 변수는 MacroDroid 의 `알림 제목/내용` 매직 텍스트를 그대로 넣으면 됩니다.

### 4) 응답과 안전장치

| 응답 `status` | 의미 | 처리 |
| --- | --- | --- |
| `matched` | 주문 1건을 찾아 `입금완료` 처리 | 그대로 발송 준비 |
| `ambiguous` | 같은 금액·입금자명의 입금대기 주문이 2건 이상 | **자동 확정하지 않음** → 관리자 페이지에서 직접 확인 |
| `unmatched` | 금액·입금자명이 맞는 주문이 없음 (`no_candidate`), 이미 처리된 주문, 알림에 금액 없음 | 관리자 페이지에서 확인 |

- 금액은 알림에서 **첫 번째 `숫자 + 원`** 을 사용하되, `잔액`·`잔고` 뒤에 오는 숫자는 건너뜁니다.
- 입금자명은 주문의 `입금자명`(없으면 주문자명)이 알림 텍스트에 **그대로 포함**되어야 매칭됩니다.
- 모든 시도는 `deposit_events` 에 남고, 사장님 페이지의 **자동 입금 확인 로그** 에서 확인할 수 있습니다.
- 시크릿은 anon 키와 별개입니다. 시크릿을 모르면 다른 사람이 주문 상태를 바꿀 수 없습니다.

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
