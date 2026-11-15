/* ============================================================
   ALL PO ONE(올포원) — 설정 파일
   ------------------------------------------------------------
   사이트에서 바꾸고 싶은 내용은 전부 이 파일에서 바꾸면 됩니다.
   1) SITE_CONFIG : 샵 이름, 오픈톡·유튜브 링크, 입금 계좌, Supabase 설정, 거래 안내
   2) PRODUCTS    : 판매 상품 목록 (미개봉 박스 / 오리파 / 싱글·기타) + 재고(stock)
   두 곳만 고치면 index.html 은 건드릴 필요가 없습니다.

   ── 주문 시스템 안내 ──────────────────────────────────────
   · 장바구니 → 계좌이체 주문 → 입금 확인 → 발송
   · supabaseUrl / supabaseAnonKey 를 채우면 실제 DB에 주문·재고가 저장됩니다.
   · 비워 두면 "DB 연동 전 테스트 모드"로 이 브라우저에만 저장되어
     주문 흐름을 그대로 미리 테스트할 수 있습니다. (사장님 페이지와 같은 브라우저)
   ============================================================ */

const SITE_CONFIG = {
  /* ---- 샵 정보 -------------------------------------------------- */
  shopName: "ALL PO ONE",
  shopNameKo: "올포원",
  tagline: "포켓몬 · 원피스 미개봉 박스 & 오리파",
  intro:
    "미개봉 박스와 오리파를 유튜브 라이브로 실시간 개봉\u2060·\u2060판매합니다.\n잔여 수량과 당첨 라인업을 바로 확인해 보세요.",

  /* ---- 오픈톡 링크 ----------------------------------------------
     카카오톡 오픈채팅방 주소를 아래 따옴표 안에 넣으면
     모든 [오픈톡 문의] 버튼이 바로 연결됩니다.
     예) openKakaoUrl: "https://open.kakao.com/o/abcd1234",
     비워 두면 "아직 연결되지 않았습니다" 안내가 뜹니다. */
  openKakaoUrl: "https://open.kakao.com/o/sEmLjgXi",

  /* ---- 유튜브 라이브 링크 ----------------------------------------
     채널/라이브 주소를 넣으면 상단에 [유튜브 라이브] 버튼이 생깁니다.
     예) youtubeUrl: "https://www.youtube.com/@allpoone/live",  */
  youtubeUrl: "",

  /* ---- 계좌이체 입금 계좌 ----------------------------------------
     은행 / 계좌번호 / 예금주를 채우면 주문 완료 화면에 바로 표시되고,
     손님이 [계좌 복사] 버튼으로 그대로 복사할 수 있습니다.
     예) bankAccount: { bank: "카카오뱅크", number: "3333-01-1234567", holder: "홍길동" },
     비워 두면 "입금 계좌 준비 중" 안내가 뜹니다. */
  bankAccount: {
    bank: "케이뱅크",
    number: "100176120105",
    holder: "이준모",
  },

  /* ---- 계좌이체 안내 문구 ---------------------------------------- */
  transferNotice:
    "입금 확인 후 주문 상태가 [입금완료]로 변경됩니다. 보통 영업일 기준 1일 이내에 확인하며, 입금자명이 다르면 오픈톡으로 알려 주세요.",
  shippingNotice:
    "입금 확인 후 순차 발송합니다. 발송 시 주문 조회 화면에서 [발송완료]로 확인하실 수 있습니다.",

  /* ---- Supabase 연동 (선택) --------------------------------------
     Supabase 프로젝트의 Project URL 과 공개 키(publishable / anon)를 넣으면
     주문·재고가 실제 DB에 저장되고 관리자 페이지와 실시간으로 맞춰집니다.
     (설정 방법은 supabase-schema.sql 과 README.md 참고)
     예) supabaseUrl: "https://abcdefgh.supabase.co",
         supabaseAnonKey: "sb_publishable_..."   (구버전 프로젝트는 "eyJhbGciOi...")
     비워 두면 테스트 모드(localStorage)로 동작합니다. */
  supabaseUrl: "https://mibkujlbkjkvyuugepbp.supabase.co",
  supabaseAnonKey: "sb_publishable_xXLUpB6ZBqggfyUOUIAZiQ_tySi4MNJ",

  /* ---- 사장님 페이지(admin.html) 잠금 -----------------------------
     DB 모드에서는 Supabase Auth(이메일 + 비밀번호)로만 열립니다.
     이 파일에는 비밀번호·PIN 을 두지 마세요. (공개 저장소에 그대로 보입니다)
     관리자 계정·권한은 Supabase 대시보드와 SQL Editor 에서 설정합니다.
     → README.md 의 '사장님 페이지' 항목 참고 */

  /* ---- 샘플 데이터 안내 배너 ------------------------------------
     실제 상품으로 교체한 뒤에는 showSampleBanner: false 로 바꾸세요. */
  showSampleBanner: true,
  sampleBannerText:
    "지금 보이는 상품은 화면 확인용 샘플입니다. 실제 재고와 라인업은 라이브·오픈톡에서 업데이트됩니다.",

  /* ---- 거래 안내 ------------------------------------------------ */
  guideTitle: "진행 안내",
  guideIntro:
    "미개봉 박스와 오리파는 장바구니에 담아 계좌이체로 주문하고, 유튜브 라이브에서 실시간으로 개봉합니다. 입금이 확인되면 순차 발송합니다.",
  guideItems: [
    {
      icon: "📦",
      title: "미개봉 박스",
      body:
        "공장 슈링크 상태 그대로인 박스만 올립니다. 슈링크 O / X / 카톤 여부와 잔여 수량을 상품마다 표기하며, 재고는 사이트에 실시간으로 반영되어 품절 시 자동으로 담기가 막힙니다.",
    },
    {
      icon: "🎰",
      title: "오리파 참여",
      body:
        "1구 단위로 참여하는 랜덤 상품입니다. 총 구수와 남은 구수, 다이아·골드·실버·브론즈·라스트원상 라인업을 미리 공개하며, 번호(1~N번)를 직접 골라 참여할 수 있습니다. 잔여 구수가 0이 되면 자동으로 마감됩니다.",
    },
    {
      icon: "📺",
      title: "유튜브 라이브",
      body:
        "개봉은 라이브 방송으로 진행하고, 참여 순서와 당첨 결과를 화면에 그대로 보여드립니다. 당첨 카드는 방송 중에 바로 확인하실 수 있습니다.",
    },
    {
      icon: "🚚",
      title: "포장 · 발송",
      body:
        "박스는 에어캡 + 이중 박스로 포장해 발송하고, 오리파 당첨 카드는 슬리브·탑로더에 넣어 라이브 종료 후 순차 발송합니다. 입금 확인 후 발송이 시작되며, 주문 조회에서 상태를 확인할 수 있습니다.",
    },
  ],
  guideNotice:
    "· 장바구니 → 주문서 작성 → 계좌이체 순서로 주문합니다. 입금 확인 후 [입금완료]로 상태가 바뀝니다.\n· 슈링크 X 박스는 개봉 이력이 있을 수 있어 상세 화면에 상태를 함께 표기합니다.\n· 오리파는 재고 소진 시 자동 마감되며, 마감 후에는 추가 모집하지 않습니다.\n· 라이브 참여 시 오픈톡 닉네임을 남겨 주세요. (당첨자 확인용)\n· 미성년자는 보호자 동의 후 참여해 주세요.",

  /* ---- 푸터 ---------------------------------------------------- */
  footerNote: "© 2026 ALL PO ONE · 올포원 · 미개봉 박스 & 오리파",
};

/* ============================================================
   상품 목록
   ------------------------------------------------------------
   공통 필드
     id        : 고유 문자열 (중복 금지)
     type      : "box"(미개봉 박스) | "oripa"(오리파) | "etc"(기타)
     game      : "pokemon" | "onepiece"
     name      : 상품 이름
     nameEn    : 영문 이름 (선택, 검색용)
     series    : 시리즈/확장팩 이름 (검색 대상)
     setCode   : 세트 코드 (선택)
     language  : "JP"(일판) | "KR"(한판) | "EN"(영판)
     price     : 원 단위 숫자 (박스당 / 1구 / 1팩 가격)
     status    : "available"(판매중) | "low"(마감임박) | "soldout"(완판)
     stock     : 현재 재고 수량 (장바구니 담기 가능 수량, 0이면 자동 품절)
     c1, c2    : 카드 아트 그라데이션 색 (앞/뒤)
     accent    : 아트 포인트 색
     glyph     : 아트에 크게 들어갈 글자/이모지
   박스(box) / 싱글(single) 추가 필드
     shrink    : "O"(슈링크 O) | "X"(슈링크 X) | "CARTON"(카톤)
     remaining : 남은 수량 (박스/팩 단위) — stock 과 같게 맞춰 두세요.
     total     : 처음 수량 (선택)
     unitNote  : 수량 단위 설명 (예: "1카톤 = 12박스")
   오리파(oripa) 추가 필드
     totalUnits     : 총 구수
     remainingUnits : 남은 구수
     prizes         : [{ tier: "dia"|"gold"|"silver"|"bronze"|"last", label: "다이아", name: "...", qty: 1 }, ...]
     lineupNote     : 라인업 안내 문구 (선택)
   선택 필드
     image     : 실제 상품 사진 URL (넣으면 그라데이션 대신 사진 표시)
     note      : 상세 화면에 표시할 추가 설명
     sample    : true 이면 "SAMPLE" 표시
   ============================================================ */

const PRODUCTS = [
  /* ── 미개봉 박스 ─────────────────────────────────────────── */
  {
    id: "box-terastal-festival-jp",
    type: "box",
    game: "pokemon",
    name: "테라스탈 페스티벌 ex 박스",
    nameEn: "Terastal Festival ex Booster Box",
    series: "테라스탈 페스티벌 ex",
    setCode: "SV8a",
    language: "JP",
    shrink: "O",
    stock: 4,
    remaining: 4,
    total: 6,
    price: 320000,
    status: "available",
    c1: "#1a1040",
    c2: "#7c3aed",
    accent: "#c4b5fd",
    glyph: "💎",
    note: "공장 슈링크 그대로입니다. 박스 모서리 상태 사진 요청 가능하며, 라이브 개봉 시 실시간으로 상태를 보여드립니다.",
    sample: true,
  },
  {
    id: "box-pokemon-151-kr",
    type: "box",
    game: "pokemon",
    name: "포켓몬 카드 151 박스",
    nameEn: "Pokemon Card 151 Booster Box",
    series: "포켓몬 카드 151",
    setCode: "SV2a",
    language: "KR",
    shrink: "O",
    stock: 2,
    remaining: 2,
    total: 3,
    price: 130000,
    status: "low",
    c1: "#4a3608",
    c2: "#facc15",
    accent: "#fef08a",
    glyph: "⚡",
    note: "잔여 2박스로 마감이 가까운 상품입니다. 결제 전 오픈톡에서 재고를 먼저 확인해 주세요.",
    sample: true,
  },
  {
    id: "box-op09-jp",
    type: "box",
    game: "onepiece",
    name: "OP-09 신세계 박스",
    nameEn: "One Piece Card Game OP-09 Booster Box",
    series: "신세계",
    setCode: "OP-09",
    language: "JP",
    shrink: "O",
    stock: 3,
    remaining: 3,
    total: 5,
    price: 165000,
    status: "available",
    c1: "#5c0f14",
    c2: "#ef4444",
    accent: "#fca5a5",
    glyph: "🏴‍☠️",
    note: "일판 정품 미개봉 박스입니다. 1박스 단위로 판매하며, 여러 박스 묶음 구매 시 포장을 합쳐 발송합니다.",
    sample: true,
  },
  {
    id: "box-op07-en-carton",
    type: "box",
    game: "onepiece",
    name: "OP-07 500년 후의 미래 카톤",
    nameEn: "One Piece OP-07 500 Years in the Future Carton",
    series: "500년 후의 미래",
    setCode: "OP-07",
    language: "EN",
    shrink: "CARTON",
    stock: 1,
    remaining: 1,
    total: 1,
    price: 1050000,
    status: "available",
    c1: "#2b1a08",
    c2: "#b45309",
    accent: "#fcd34d",
    glyph: "📦",
    unitNote: "1카톤 = 12박스",
    note: "영판 카톤(12박스) 단위 판매입니다. 낱박스 분할은 하지 않으며, 카톤 상태 그대로 발송됩니다.",
    sample: true,
  },

  /* ── 오리파 ──────────────────────────────────────────────── */
  {
    id: "oripa-eevee-heroes-kr",
    type: "oripa",
    game: "pokemon",
    name: "이브이 히어로즈 오리파",
    nameEn: "Eevee Heroes Oripa",
    series: "이브이 히어로즈",
    setCode: "S6a",
    language: "KR",
    price: 9900,
    stock: 18,
    totalUnits: 50,
    remainingUnits: 18,
    status: "low",
    prizes: [
      { tier: "dia", label: "다이아", name: "리자몽 ex SAR PSA 10", qty: 1 },
      { tier: "gold", label: "골드", name: "뮤 ex SAR (한판)", qty: 3 },
      { tier: "silver", label: "실버", name: "인기 SAR · SR", qty: 6 },
      { tier: "bronze", label: "브론즈", name: "랜덤 SR · AR 1장", qty: 12 },
      { tier: "last", label: "라스트원상", name: "이브이 SAR 3종 세트 + 151 박스", qty: 1 },
    ],
    lineupNote: "다이아 1개 · 골드 3개 · 실버 6개 · 브론즈 12개 · 라스트원상 1개 구성, 남은 구수 18구입니다.",
    c1: "#5b1035",
    c2: "#f472b6",
    accent: "#fbcfe8",
    glyph: "🎰",
    note: "1구 9,900원, 중복 당첨 가능한 구조입니다. 라이브에서 구 순서대로 개봉하며 결과를 바로 확인하실 수 있습니다.",
    sample: true,
  },
  {
    id: "oripa-op05-jp",
    type: "oripa",
    game: "onepiece",
    name: "OP-05 오리파",
    nameEn: "OP-05 Oripa",
    series: "새 시대의 주인공",
    setCode: "OP-05",
    language: "JP",
    price: 19900,
    stock: 7,
    totalUnits: 30,
    remainingUnits: 7,
    status: "low",
    prizes: [
      { tier: "dia", label: "다이아", name: "루피 리더 패러렐 PSA 10", qty: 1 },
      { tier: "gold", label: "골드", name: "샹크스 SR (일판)", qty: 3 },
      { tier: "silver", label: "실버", name: "에이스 SR / 인기 패러렐", qty: 6 },
      { tier: "bronze", label: "브론즈", name: "랜덤 SR · AR 1장", qty: 12 },
      { tier: "last", label: "라스트원상", name: "OP-05 박스 1박스", qty: 1 },
    ],
    lineupNote: "다이아 1개 · 골드 3개 · 실버 6개 · 브론즈 12개 · 라스트원상 1개 구성, 남은 구수 7구입니다.",
    c1: "#3b1573",
    c2: "#a855f7",
    accent: "#e9d5ff",
    glyph: "🎲",
    note: "일판 오리파로 1구 19,900원입니다. 마감이 가까워 남은 구수가 적습니다.",
    sample: true,
  },
  {
    id: "oripa-pokemon-151-kr",
    type: "oripa",
    game: "pokemon",
    name: "포켓몬 151 오리파",
    nameEn: "Pokemon 151 Oripa",
    series: "포켓몬 카드 151",
    setCode: "SV2a",
    language: "KR",
    price: 6900,
    stock: 0,
    totalUnits: 40,
    remainingUnits: 0,
    status: "soldout",
    prizes: [
      { tier: "dia", label: "다이아", name: "리자몽 ex SAR PSA 10", qty: 1 },
      { tier: "gold", label: "골드", name: "뮤츠 ex SAR", qty: 2 },
      { tier: "silver", label: "실버", name: "인기 AR · ex", qty: 5 },
      { tier: "bronze", label: "브론즈", name: "랜덤 SR 1장", qty: 10 },
      { tier: "last", label: "라스트원상", name: "151 부스터 박스 1박스", qty: 1 },
    ],
    lineupNote: "전 구수 완판된 회차입니다. 다음 회차는 라이브 공지로 안내됩니다.",
    c1: "#0f3b45",
    c2: "#22d3ee",
    accent: "#a5f3fc",
    glyph: "🎁",
    note: "완판된 회차입니다. 재오픈 문의는 오픈톡으로 남겨 주시면 공지드립니다.",
    sample: true,
  },

  /* ── 싱글 · 기타 ─────────────────────────────────────────── */
  {
    id: "single-terastal-pack-jp",
    type: "etc",
    game: "pokemon",
    name: "테라스탈 페스티벌 ex 낱팩",
    nameEn: "Terastal Festival ex Single Pack",
    series: "테라스탈 페스티벌 ex",
    setCode: "SV8a",
    language: "JP",
    stock: 24,
    remaining: 24,
    price: 4500,
    status: "available",
    c1: "#06304f",
    c2: "#0e7490",
    accent: "#7dd3fc",
    glyph: "🃏",
    unitNote: "박스 개봉 후 낱팩 판매",
    note: "미개봉 낱팩입니다. 박스에서 개봉한 팩을 그대로 발송하며, 랜덤 구성이라 특정 카드는 보장되지 않습니다.",
    sample: true,
  },
];
