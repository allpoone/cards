/* ============================================================
   JUN's CARD VAULT — 설정 파일
   ------------------------------------------------------------
   사이트에서 바꾸고 싶은 내용은 전부 이 파일에서 바꾸면 됩니다.
   1) SITE_CONFIG : 샵 이름, 오픈톡 링크, 거래 안내 문구
   2) CARDS       : 판매할 카드 목록 (추가/수정/삭제)
   두 곳만 고치면 index.html 은 건드릴 필요가 없습니다.
   ============================================================ */

const SITE_CONFIG = {
  /* ---- 샵 정보 -------------------------------------------------- */
  shopName: "JUN's CARD VAULT",
  shopNameKo: "준의 카드 볼트",
  tagline: "포켓몬 · 원피스 카드 컬렉션 정리 판매",
  intro:
    "오래 모아온 카드를 한 장씩 정리하고 있습니다. 모든 카드는 사진으로 상태를 확인하시고, 궁금한 점은 오픈톡으로 편하게 문의해 주세요.",

  /* ---- 오픈톡 링크 ----------------------------------------------
     카카오톡 오픈채팅방 주소를 아래 따옴표 안에 넣으면
     모든 [오픈톡 문의] 버튼이 바로 연결됩니다.
     예) openKakaoUrl: "https://open.kakao.com/o/abcd1234",
     비워 두면 "아직 연결되지 않았습니다" 안내가 뜹니다. */
  openKakaoUrl: "",
  openKakaoLabel: "오픈톡으로 문의",

  /* ---- 판매자 표시 이름 ---------------------------------------- */
  sellerName: "준",

  /* ---- 샘플 데이터 안내 배너 ------------------------------------
     실제 카드로 교체한 뒤에는 showSampleBanner: false 로 바꾸세요. */
  showSampleBanner: true,
  sampleBannerText:
    "지금 보이는 카드는 화면 확인용 샘플입니다. 실제 판매 목록은 순차적으로 업데이트됩니다.",

  /* ---- 등급 인증 조회 링크 --------------------------------------
     {cert} 자리에 인증번호가 들어갑니다. */
  gradeLookup: {
    PSA: "https://www.psacard.com/cert/{cert}",
    BGS: "https://www.beckett.com/grading/card-lookup?certNumber={cert}",
    CGC: "https://www.cgccards.com/certlookup/{cert}/",
  },

  /* ---- 거래 안내 ------------------------------------------------ */
  guideTitle: "거래 안내",
  guideIntro:
    "개인 컬렉션을 정리하는 판매라 사업자 등록 없이 거래합니다. 아래 내용을 확인해 주세요.",
  guideItems: [
    {
      icon: "🔍",
      title: "카드 상태 · 인증번호",
      body:
        "등급 카드는 PSA · BGS 인증번호를 상세 화면에서 바로 조회할 수 있습니다. 등급 없는 싱글(Raw)은 앞·뒷면 상태를 별도로 안내해 드립니다.",
    },
    {
      icon: "🤝",
      title: "직거래",
      body:
        "수도권 직거래 가능합니다. 장소와 시간은 오픈톡에서 협의하며, 카드 상태를 직접 확인하신 뒤 거래하실 수 있습니다.",
    },
    {
      icon: "📦",
      title: "택배 거래",
      body:
        "등급 카드는 슬리브 → 탑로더 → 에어캡 → 박스로 이중 포장해 발송합니다. 발송 전 포장 사진을 보내드리고, 분실·파손은 우체국 등기 배상 규정을 따릅니다.",
    },
    {
      icon: "💬",
      title: "문의 · 예약",
      body:
        "구매 문의는 카카오톡 오픈톡으로 받습니다. [카드 정보 복사하기]로 카드 정보를 복사해 붙여넣으시면 확인이 빠릅니다. 예약 중인 카드는 선착순으로 정리됩니다.",
    },
  ],
  guideNotice:
    "· 사진과 실물의 색감은 기기에 따라 조금 다를 수 있습니다.\n· 등급 카드의 케이스에 생긴 미세 스크래치는 감정 등급에 포함된 부분입니다.\n· 미성년자는 보호자 동의 후 거래해 주세요.",

  /* ---- 푸터 ---------------------------------------------------- */
  footerNote: "© 2026 JUN's CARD VAULT · 개인 컬렉션 판매",
};

/* ============================================================
   카드 목록
   ------------------------------------------------------------
   필수 필드
     id        : 고유 문자열 (중복 금지)
     game      : "pokemon" | "onepiece"
     name      : 카드 이름 (한국어)
     nameEn    : 카드 이름 (영문, 검색용 · 선택)
     setName   : 세트/확장팩 이름
     setCode   : 세트 코드 (선택)
     cardNumber: 카드 번호 (선택)
     grade     : 화면에 표시할 등급 문자열 (예: "PSA 10", "BGS 9.5", "Raw NM", "미개봉")
     gradeBody : 필터용 등급 종류 ("PSA" | "BGS" | "CGC" | "RAW" | "SEALED")
     price     : 원 단위 숫자 (예: 1250000)
     status    : "available"(판매중) | "reserved"(예약중) | "sold"(판매완료)
     c1, c2    : 카드 아트 그라데이션 색 (앞/뒤)
     accent    : 아트 포인트 색
     glyph     : 아트에 크게 들어갈 글자/이모지 (선택)
   선택 필드
     cert      : 인증번호 (있으면 조회 링크 생성)
     image     : 실제 카드 사진 URL (넣으면 그라데이션 대신 사진 표시)
     language  : "한국어" | "일본어" | "영어"
     note      : 상세 화면에 표시할 추가 설명
     sample    : true 이면 "SAMPLE" 표시
   ============================================================ */

const CARDS = [
  {
    id: "pk-kyogre-ex-psa10",
    game: "pokemon",
    name: "가이오가 ex 풀아트",
    nameEn: "Kyogre ex Full Art",
    setName: "마그마단 VS 아쿠아단",
    setCode: "ex8",
    cardNumber: "96/95",
    language: "일본어",
    grade: "PSA 10",
    gradeBody: "PSA",
    cert: "84217365",
    price: 1250000,
    status: "available",
    c1: "#06304f",
    c2: "#0e7490",
    accent: "#7dd3fc",
    glyph: "🌊",
    note: "1세대 아쿠아단 테마의 대표 풀아트. PSA 10 케이스 상태 깨끗합니다.",
    sample: true,
  },
  {
    id: "pk-charizard-ex-sar-psa10",
    game: "pokemon",
    name: "리자몽 ex SAR",
    nameEn: "Charizard ex Special Art Rare",
    setName: "포켓몬 카드 151",
    setCode: "SV2a",
    cardNumber: "201/165",
    language: "한국어",
    grade: "PSA 10",
    gradeBody: "PSA",
    cert: "79104428",
    price: 420000,
    status: "available",
    c1: "#5c1a0b",
    c2: "#f97316",
    accent: "#fdba74",
    glyph: "🔥",
    note: "센터링 좋은 개체. 151 SAR 중 가장 수요가 많은 카드입니다.",
    sample: true,
  },
  {
    id: "pk-pikachu-vmax-bgs95",
    game: "pokemon",
    name: "피카츄 VMAX 프로모",
    nameEn: "Pikachu VMAX Promo",
    setName: "스페셜 프로모팩",
    cardNumber: "SWSH-044",
    language: "한국어",
    grade: "BGS 9.5",
    gradeBody: "BGS",
    cert: "0014877212",
    price: 180000,
    status: "reserved",
    c1: "#4a3608",
    c2: "#facc15",
    accent: "#fef08a",
    glyph: "⚡",
    note: "예약 문의 진행 중입니다. 취소 시 다시 판매로 전환됩니다.",
    sample: true,
  },
  {
    id: "pk-mew-ex-sar-psa10",
    game: "pokemon",
    name: "뮤 ex SAR",
    nameEn: "Mew ex Special Art Rare",
    setName: "포켓몬 카드 151",
    setCode: "SV2a",
    cardNumber: "205/165",
    language: "한국어",
    grade: "PSA 10",
    gradeBody: "PSA",
    cert: "81239057",
    price: 95000,
    status: "available",
    c1: "#5b1035",
    c2: "#f472b6",
    accent: "#fbcfe8",
    glyph: "🩷",
    note: "입문용으로 인기 있는 카드. 케이스에 미세 스크래치 없습니다.",
    sample: true,
  },
  {
    id: "op-luffy-op01-003-psa10",
    game: "onepiece",
    name: "몽키 D. 루피 (리더) 패러렐",
    nameEn: "Monkey D. Luffy Leader Parallel",
    setName: "ROMANCE DAWN",
    setCode: "OP-01",
    cardNumber: "OP01-003",
    language: "일본어",
    grade: "PSA 10",
    gradeBody: "PSA",
    cert: "73558112",
    price: 310000,
    status: "available",
    c1: "#5c0f14",
    c2: "#ef4444",
    accent: "#fca5a5",
    glyph: "🏴‍☠️",
    note: "원피스 카드 게임 초기 리더 패러렐. 물량이 적어 꾸준히 찾는 카드입니다.",
    sample: true,
  },
  {
    id: "op-shanks-op01-120-raw",
    game: "onepiece",
    name: "샹크스",
    nameEn: "Shanks",
    setName: "ROMANCE DAWN",
    setCode: "OP-01",
    cardNumber: "OP01-120",
    language: "일본어",
    grade: "Raw NM",
    gradeBody: "RAW",
    price: 45000,
    status: "sold",
    c1: "#3b0a12",
    c2: "#b91c1c",
    accent: "#fecaca",
    glyph: "⚔️",
    note: "판매 완료된 카드입니다. 재고 문의는 오픈톡으로 주세요.",
    sample: true,
  },
  {
    id: "op-hancock-op07-117-psa10",
    game: "onepiece",
    name: "보아 행콕 (슈퍼 패러렐)",
    nameEn: "Boa Hancock Super Parallel",
    setName: "500년의 미래",
    setCode: "OP-07",
    cardNumber: "OP07-117",
    language: "일본어",
    grade: "PSA 10",
    gradeBody: "PSA",
    cert: "75920334",
    price: 150000,
    status: "available",
    c1: "#3b1573",
    c2: "#a855f7",
    accent: "#e9d5ff",
    glyph: "💜",
    note: "인기 캐릭터 슈퍼 패러렐. PSA 10 등급 개체입니다.",
    sample: true,
  },
  {
    id: "pk-151-booster-box-sealed",
    game: "pokemon",
    name: "포켓몬 카드 151 부스터 박스",
    nameEn: "Pokemon Card 151 Booster Box",
    setName: "포켓몬 카드 151",
    setCode: "SV2a",
    cardNumber: "30팩입",
    language: "한국어",
    grade: "미개봉",
    gradeBody: "SEALED",
    price: 130000,
    status: "available",
    c1: "#0f3b45",
    c2: "#22d3ee",
    accent: "#a5f3fc",
    glyph: "📦",
    note: "정품 미개봉 박스, 슈링크 상태 그대로입니다. 박스 모서리 상태 사진 요청 가능합니다.",
    sample: true,
  },
];
