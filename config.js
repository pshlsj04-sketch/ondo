// ONDO 설정 파일. 이 파일 하나만 고치면 됩니다.
// 값을 비워 두면 "데모 모드"로 동작합니다. (서버 없이 이 브라우저에만 저장, 결제는 흉내만)
// 아래 세 값을 채우면 "실서비스 모드"로 바뀝니다. 자세한 방법은 README.md 의 2~5단계를 보세요.
window.ONDO_CONFIG = {
  // Supabase 대시보드 > Project Settings > API
  supabaseUrl: "https://codeauwxwytnuduoctmd.supabase.co",
  supabaseAnonKey: "sb_publishable_JrUJ2VFooFHxqBLtOK4eKA_n6xZ2efx",   // 공개해도 되는 publishable 키입니다. secret/service_role 키는 절대 넣지 마세요.

  // 토스페이먼츠 개발자센터 > API 키 > 결제위젯 연동 키의 "클라이언트 키"
  // 테스트: test_gck_... / 실제 결제: live_gck_... (시크릿 키는 여기에 넣지 않습니다)
  tossClientKey: "",

  // 데모 모드에서만 쓰는 값입니다. true 로 두면 무료 베타 화면을 미리 볼 수 있어요.
  // 실서비스에서는 이 값이 아니라 Supabase 의 설정값(README의 "무료 베타 켜기")이 기준입니다.
  freeBeta: false,

  // 사이트 하단과 약관에 표시되는 사업자 정보. 통신판매업 신고 후 실제 값으로 바꾸세요.
  // 사업자등록 전에는 name 과 contact 만 채워 두면, 하단에 "현재 베타 운영 중 · 문의 ..." 로만 표시돼요.
  // regNo(사업자등록번호)를 채우면 상호·대표·신고번호·주소가 모두 나타나니, 그때 나머지도 채우세요.
  business: {
    name: "ONDO 운영팀",           // 상호 (사업자등록 후 실제 상호로)
    ceo: "",                       // 대표자
    regNo: "",                     // 사업자등록번호
    mailOrderNo: "",               // 통신판매업 신고번호
    address: "",                   // 사업장 주소
    contact: "37.5ondo@gmail.com", // 고객센터·문의 이메일 또는 전화번호
    privacyOfficer: "ONDO 운영팀"  // 개인정보 보호책임자 (이름 또는 부서명)
  }
};
